// Per-instruction data-flow animation shown during step mode

let hideTimer: ReturnType<typeof setTimeout> | null = null;

// ── Register index parsers ────────────────────────────────────────────────────

function parseGPIdx(tok: string): number {
  if (!tok) return -1;
  const t = tok.replace(/^[RWXB]/, '').replace(/[^0-9].*/g, '');
  const n = parseInt(t, 10);
  return isNaN(n) ? -1 : n;
}

function parseVIdx(tok: string): number {
  // Handles: {V2.4S} V2.4S V2
  const s = tok.replace(/^\{/, '').replace(/\}.*$/, '').trim();
  const m = s.match(/^[Vv](\d+)/);
  return m ? +m[1] : -1;
}

function isGPReg(tok: string): boolean {
  return /^[WwXxRrBb]\d/.test(tok) && !tok.startsWith('V') && !tok.startsWith('v');
}

function isVReg(tok: string): boolean {
  return /^\{?[Vv]\d/.test(tok);
}

function stripMem(tok: string): string {
  // '[X0,#16]!' → 'X0'
  return tok.replace(/^\[/, '').replace(/[,!\]].*/g, '').trim();
}

// ── Describe an instruction's operand roles ───────────────────────────────────

interface OpDesc {
  op: string;
  gpSrcs: number[];   // GP register source indices
  gpDsts: number[];   // GP register destination indices
  vSrcs: number[];    // V register source indices
  vDsts: number[];    // V register destination indices
  isStore: boolean;
  isBranch: boolean;
  isFlag: boolean;    // result goes to flags (CMP/TST/CMN)
  flagsAlso: boolean; // also sets flags (ADDS/SUBS/etc.)
}

function describeOp(toks: string[]): OpDesc {
  const mn   = (toks[0] ?? '').toUpperCase();
  const base = mn.replace(/S$/, '');  // strip trailing S for flag-setting variants (ADDS→ADD)
  const t1   = (toks[1] ?? '').toUpperCase();
  const t2   = (toks[2] ?? '').toUpperCase();
  const t3   = (toks[3] ?? '').toUpperCase();

  const none: OpDesc = { op: mn, gpSrcs: [], gpDsts: [], vSrcs: [], vDsts: [],
                         isStore: false, isBranch: false, isFlag: false, flagsAlso: false };

  // ── Branches ──────────────────────────────────────────────────────────────
  if (['B','BL','BLR','BR','CBZ','CBNZ','TBZ','TBNZ'].includes(base) ||
      mn.startsWith('B.')) {
    return { ...none, isBranch: true };
  }

  // ── NOP / RET ─────────────────────────────────────────────────────────────
  if (mn === 'NOP' || mn === 'RET') return none;

  // ── CMP / CMN / TST — flag-only ───────────────────────────────────────────
  if (mn === 'CMP' || mn === 'CMN' || mn === 'TST') {
    const s0 = isGPReg(t1) ? parseGPIdx(t1) : -1;
    const s1 = isGPReg(t2) ? parseGPIdx(t2) : -1;
    return { ...none, op: mn, gpSrcs: [s0, s1].filter(x => x >= 0), isFlag: true };
  }

  // ── NEON / V-register instructions ────────────────────────────────────────

  // DUP Vd.4S, Wn  — GP source, V dest
  if (mn === 'DUP') {
    const vd = isVReg(t1) ? parseVIdx(t1) : -1;
    const gs = isGPReg(t2) ? parseGPIdx(t2) : -1;
    return { ...none, op: 'DUP', gpSrcs: gs >= 0 ? [gs] : [], vDsts: vd >= 0 ? [vd] : [] };
  }

  // LD1 {Vd.4S}, [Xn] / LD1 {Vd.4S}, [Xn], #16  — addr GP src, V dest
  if (mn === 'LD1') {
    const vd = isVReg(t1) ? parseVIdx(t1) : -1;
    const addrReg = stripMem(t2);
    const ga = isGPReg(addrReg) ? parseGPIdx(addrReg) : -1;
    return { ...none, op: 'LD1', gpSrcs: ga >= 0 ? [ga] : [], vDsts: vd >= 0 ? [vd] : [] };
  }

  // ST1 {Vs.4S}, [Xn] / ST1 {Vs.4S}, [Xn], #16  — V source, addr GP src, memory dest
  if (mn === 'ST1') {
    const vs = isVReg(t1) ? parseVIdx(t1) : -1;
    const addrReg = stripMem(t2);
    const ga = isGPReg(addrReg) ? parseGPIdx(addrReg) : -1;
    return { ...none, op: 'ST1', gpSrcs: ga >= 0 ? [ga] : [],
             vSrcs: vs >= 0 ? [vs] : [], isStore: true };
  }

  // V-reg arithmetic: ADD/SUB/MUL/AND/ORR/EOR/MOV/NEG Vd, Vn[, Vm]
  if (isVReg(t1)) {
    const vd = parseVIdx(t1);
    const vn = isVReg(t2) ? parseVIdx(t2) : -1;
    const vm = isVReg(t3) ? parseVIdx(t3) : -1;
    return {
      ...none, op: base,
      vSrcs: [vn, vm].filter(x => x >= 0),
      vDsts: vd >= 0 ? [vd] : [],
    };
  }

  // ── GP-register instructions ──────────────────────────────────────────────

  const flagsAlso = ['ADDS','SUBS','NEGS','ANDS'].includes(mn);

  // STR / STRB  — data src, addr src, memory dest
  if (mn === 'STR' || mn === 'STRB') {
    const ds = isGPReg(t1) ? parseGPIdx(t1) : -1;
    const ar = isGPReg(stripMem(t2)) ? parseGPIdx(stripMem(t2)) : -1;
    return { ...none, op: mn, gpSrcs: [ds, ar].filter(x => x >= 0), isStore: true };
  }

  // STP X1, X2, [Xn, #off]  — two data srcs, addr src, memory dest
  if (mn === 'STP') {
    const d1 = isGPReg(t1) ? parseGPIdx(t1) : -1;
    const d2 = isGPReg(t2) ? parseGPIdx(t2) : -1;
    const ar = isGPReg(stripMem(t3)) ? parseGPIdx(stripMem(t3)) : -1;
    return { ...none, op: 'STP', gpSrcs: [d1, d2, ar].filter(x => x >= 0), isStore: true };
  }

  // LDR / LDRB — addr src, GP dest
  if (mn === 'LDR' || mn === 'LDRB') {
    const dd = isGPReg(t1) ? parseGPIdx(t1) : -1;
    const ar = isGPReg(stripMem(t2)) ? parseGPIdx(stripMem(t2)) : -1;
    return { ...none, op: mn, gpSrcs: ar >= 0 ? [ar] : [], gpDsts: dd >= 0 ? [dd] : [] };
  }

  // LDP X1, X2, [Xn, #off]  — addr src, two GP dests
  if (mn === 'LDP') {
    const d1 = isGPReg(t1) ? parseGPIdx(t1) : -1;
    const d2 = isGPReg(t2) ? parseGPIdx(t2) : -1;
    const ar = isGPReg(stripMem(t3)) ? parseGPIdx(stripMem(t3)) : -1;
    return { ...none, op: 'LDP', gpSrcs: ar >= 0 ? [ar] : [],
             gpDsts: [d1, d2].filter(x => x >= 0) };
  }

  // MOV / MOVZ — one GP src (if reg), one GP dest
  if (mn === 'MOV' || mn === 'MOVZ') {
    const dd = isGPReg(t1) ? parseGPIdx(t1) : -1;
    const ss = isGPReg(t2) ? parseGPIdx(t2) : -1;
    return { ...none, op: 'MOV', gpSrcs: ss >= 0 ? [ss] : [],
             gpDsts: dd >= 0 ? [dd] : [] };
  }

  // MOVK — dest is read-modify-write (it's both src and dst)
  if (mn === 'MOVK') {
    const dd = isGPReg(t1) ? parseGPIdx(t1) : -1;
    return { ...none, op: 'MOVK', gpSrcs: dd >= 0 ? [dd] : [],
             gpDsts: dd >= 0 ? [dd] : [] };
  }

  // NEG / NEGS — one GP src, one GP dest
  if (base === 'NEG') {
    const dd = isGPReg(t1) ? parseGPIdx(t1) : -1;
    const ss = isGPReg(t2) ? parseGPIdx(t2) : -1;
    return { ...none, op: mn, gpSrcs: ss >= 0 ? [ss] : [],
             gpDsts: dd >= 0 ? [dd] : [], flagsAlso };
  }

  // Generic: toks[1]=dest, toks[2..]=sources
  const dd = isGPReg(t1) ? parseGPIdx(t1) : -1;
  const gpSrcs: number[] = [];
  for (let i = 2; i < toks.length; i++) {
    const t = (toks[i] ?? '').toUpperCase();
    if (t === 'LSL' || t === 'LSR' || t === 'ASR') break; // shift modifier, not a reg
    if (isGPReg(t)) gpSrcs.push(parseGPIdx(t));
  }
  return { ...none, op: base || mn, gpSrcs, gpDsts: dd >= 0 ? [dd] : [], flagsAlso };
}

// ── Formatting ────────────────────────────────────────────────────────────────

function fmtGP(v: number): string {
  return '0x' + (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

function fmtLane(v: number): string {
  const u = v >>> 0;
  return u <= 0xFFFF ? String(u) : '0x' + u.toString(16).toUpperCase().padStart(4, '0');
}

// ── Snapshots ─────────────────────────────────────────────────────────────────

export function snapshotRegs(regs: number[], indices: number[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const i of indices) m.set(i, regs[i] ?? 0);
  return m;
}

export function snapshotVRegs(vregs: Int32Array[], indices: number[]): Map<number, number[]> {
  const m = new Map<number, number[]>();
  for (const i of indices) {
    const arr = vregs[i];
    m.set(i, arr ? Array.from(arr) : [0, 0, 0, 0]);
  }
  return m;
}

/** GP register indices mentioned in token list */
export function regsInToks(toks: string[]): number[] {
  const out = new Set<number>();
  for (const tok of toks) {
    const t = tok.replace(/^\[/, '').replace(/[,!\]].*/g, '').toUpperCase();
    if (isGPReg(t)) {
      const i = parseGPIdx(t);
      if (i >= 0) out.add(i);
    }
  }
  return Array.from(out);
}

/** V register indices mentioned in token list */
export function vRegsInToks(toks: string[]): number[] {
  const out = new Set<number>();
  for (const tok of toks) {
    if (isVReg(tok)) {
      const i = parseVIdx(tok);
      if (i >= 0) out.add(i);
    }
  }
  return Array.from(out);
}

// ── Main render ───────────────────────────────────────────────────────────────

export function showOpAnim(
  toks: string[],
  gpBefore: Map<number, number>,
  gpAfter: Map<number, number>,
  vBefore: Map<number, number[]>,
  vAfter: Map<number, number[]>,
  regName: (i: number) => string,
): void {
  const el = document.getElementById('op-anim');
  if (!el) return;

  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }

  const desc = describeOp(toks);
  if (desc.isBranch) { hideOpAnim(); return; }

  const hasAny = desc.gpSrcs.length || desc.gpDsts.length ||
                 desc.vSrcs.length  || desc.vDsts.length  ||
                 desc.isFlag || desc.isStore;
  if (!hasAny) { hideOpAnim(); return; }

  const mn  = (toks[0] ?? '').toUpperCase();
  const raw = toks.join(' ');

  // GP source nodes
  const gpSrcHtml = desc.gpSrcs.map(ri => {
    const v = gpBefore.get(ri) ?? 0;
    return `<div class="oa-node oa-src">
      <span class="oa-rname">${regName(ri)}</span>
      <span class="oa-val">${fmtGP(v)}</span>
      <span class="oa-dec">${v | 0}</span>
    </div>`;
  }).join('');

  // V source nodes
  const vSrcHtml = desc.vSrcs.map(vi => {
    const lanes = vBefore.get(vi) ?? [0, 0, 0, 0];
    return `<div class="oa-node oa-src oa-vsrc">
      <span class="oa-rname">V${vi}</span>
      <span class="oa-lanes">[${lanes.map(fmtLane).join(', ')}]</span>
    </div>`;
  }).join('');

  const srcHtml = gpSrcHtml + vSrcHtml;

  // GP dest nodes
  const gpDstHtml = desc.gpDsts.map(ri => {
    const v = gpAfter.get(ri) ?? 0;
    return `<div class="oa-node oa-dst">
      <span class="oa-rname">${regName(ri)}</span>
      <span class="oa-val">${fmtGP(v)}</span>
      <span class="oa-dec">${v | 0}</span>
    </div>`;
  }).join('');

  // V dest nodes
  const vDstHtml = desc.vDsts.map(vi => {
    const lanes = vAfter.get(vi) ?? [0, 0, 0, 0];
    return `<div class="oa-node oa-dst oa-vdst">
      <span class="oa-rname">V${vi}</span>
      <span class="oa-lanes">[${lanes.map(fmtLane).join(', ')}]</span>
    </div>`;
  }).join('');

  // Flag / memory destinations
  const specialDstHtml = desc.isFlag
    ? `<div class="oa-node oa-dst oa-flags">NZCV flags</div>`
    : desc.isStore
    ? `<div class="oa-node oa-dst oa-mem">memory</div>`
    : '';

  // Extra flag indicator for ADDS/SUBS/etc.
  const flagAlsoHtml = desc.flagsAlso
    ? `<div class="oa-also-flags">+ sets NZCV</div>` : '';

  const dstHtml = gpDstHtml + vDstHtml + specialDstHtml;
  const hasArrow = dstHtml.length > 0;

  el.innerHTML = `
    <div class="oa-mnemonic">${mn}</div>
    <div class="oa-raw">${raw}</div>
    <div class="oa-flow">
      ${srcHtml ? `<div class="oa-srcs">${srcHtml}</div>` : ''}
      ${srcHtml || hasArrow ? `<div class="oa-op-box">${desc.op}</div>` : ''}
      ${hasArrow ? `<div class="oa-arrow">↓</div><div class="oa-dsts">${dstHtml}</div>` : ''}
      ${flagAlsoHtml}
    </div>`;

  el.classList.remove('oa-fade');
  el.style.display = 'flex';
  void el.offsetWidth;
  el.classList.add('oa-visible');
}

export function hideOpAnim(): void {
  const el = document.getElementById('op-anim');
  if (!el) return;
  el.classList.remove('oa-visible');
  el.classList.add('oa-fade');
  hideTimer = setTimeout(() => {
    if (el) el.style.display = 'none';
    hideTimer = null;
  }, 300);
}
