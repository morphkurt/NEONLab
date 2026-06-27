// Per-instruction data-flow animation shown during step mode

let hideTimer: ReturnType<typeof setTimeout> | null = null;

// ── Register index parsers ────────────────────────────────────────────────────

const GP_ALIASES: Record<string, number> = { SP: 13, LR: 14, PC: 15, FP: 11, IP: 12 };

function parseGPIdx(tok: string): number {
  const u = tok.toUpperCase().replace(/^[WwXxRrBb]/, '').replace(/[^0-9].*/g, '');
  const alias = GP_ALIASES[tok.toUpperCase()];
  if (alias !== undefined) return alias;
  const n = parseInt(u, 10);
  return isNaN(n) ? -1 : n;
}

/** V (AArch64), Q (ARMv7 128-bit), D (ARMv7 64-bit → maps to Q idx >> 1) */
function parseVIdx(tok: string): number {
  const s = tok.replace(/^\{/, '').replace(/[.}\s,].*/, '').trim().toUpperCase();
  const mq = s.match(/^[QV](\d+)$/);
  if (mq) return +mq[1];
  const md = s.match(/^D(\d+)$/);
  if (md) return +md[1] >> 1; // D0/D1 → Q0, D2/D3 → Q1, …
  return -1;
}

function isGPReg(tok: string): boolean {
  const u = tok.toUpperCase();
  if (GP_ALIASES[u] !== undefined) return true;
  return /^[WXRB]\d/.test(u);
}

function isVReg(tok: string): boolean {
  return /^\{?[VQD]\d/i.test(tok);
}

function stripMem(tok: string): string {
  // '[X0,#16]!' or '[R0]' → base register name
  return tok.replace(/^\[/, '').replace(/[,!\]].*/g, '').trim();
}

/** Parse register list token like '{R4,R5,R6,LR}' */
function parseRegList(tok: string): number[] {
  const inner = tok.replace(/^\{/, '').replace(/\}.*$/, '');
  return inner.split(',').map(s => parseGPIdx(s.trim())).filter(i => i >= 0);
}

function isBranchMn(mn: string): boolean {
  // All Bxx (but not BIC), CBZ, CBNZ, TBZ, TBNZ, BX
  return ['CBZ','CBNZ','TBZ','TBNZ','BX'].includes(mn) ||
         (mn.startsWith('B') && mn !== 'BIC');
}

// ── OpDesc ────────────────────────────────────────────────────────────────────

interface OpDesc {
  op: string;
  gpSrcs: number[];
  gpDsts: number[];
  vSrcs: number[];
  vDsts: number[];
  isStore: boolean;
  isBranch: boolean;
  isFlag: boolean;
  flagsAlso: boolean;
}

function empty(op: string): OpDesc {
  return { op, gpSrcs: [], gpDsts: [], vSrcs: [], vDsts: [],
           isStore: false, isBranch: false, isFlag: false, flagsAlso: false };
}

function describeOp(toks: string[]): OpDesc {
  const mn   = (toks[0] ?? '').toUpperCase();
  // base: strip trailing S for flag-setting variants (ADDS→ADD), but keep ADCS etc.
  const base = /^(ADD|SUB|NEG|AND|ORR|EOR|MOV|LSL|LSR|ASR|MVN)S$/.test(mn)
    ? mn.slice(0, -1) : mn;
  const t1 = (toks[1] ?? '').toUpperCase();
  const t2 = (toks[2] ?? '').toUpperCase();
  const t3 = (toks[3] ?? '').toUpperCase();

  // ── Branches ──────────────────────────────────────────────────────────────
  if (isBranchMn(mn)) return { ...empty(mn), isBranch: true };

  // ── NOP / RET / BX LR ─────────────────────────────────────────────────────
  if (mn === 'NOP' || mn === 'RET') return empty(mn);

  // ── Flag-only: CMP, CMN, TST ──────────────────────────────────────────────
  if (mn === 'CMP' || mn === 'CMN' || mn === 'TST') {
    return {
      ...empty(mn), isFlag: true,
      gpSrcs: [t1, t2].map(t => isGPReg(t) ? parseGPIdx(t) : -1).filter(i => i >= 0),
    };
  }

  // ── PUSH / POP ────────────────────────────────────────────────────────────
  if (mn === 'PUSH') {
    const regs = parseRegList(t1);
    return { ...empty('PUSH'), gpSrcs: regs, isStore: true };
  }
  if (mn === 'POP') {
    const regs = parseRegList(t1);
    return { ...empty('POP'), gpDsts: regs };
  }

  // ── ARMv7 NEON (V-prefixed mnemonics with Q/D operands) ───────────────────
  if (mn.startsWith('V') && !mn.startsWith('VS')) {
    // VLD1/VLD2 — {Qd}, [Rn]: V dest, GP addr src
    if (mn.startsWith('VLD')) {
      const vd = isVReg(t1) ? parseVIdx(t1) : -1;
      const ar = isGPReg(stripMem(t2)) ? parseGPIdx(stripMem(t2)) : -1;
      return { ...empty(base), gpSrcs: ar >= 0 ? [ar] : [], vDsts: vd >= 0 ? [vd] : [] };
    }
    // VDUP — Qd, Rn: GP src, V dest
    if (mn.startsWith('VDUP')) {
      const vd = isVReg(t1) ? parseVIdx(t1) : -1;
      const gs = isGPReg(t2) ? parseGPIdx(t2) : -1;
      return { ...empty('VDUP'), gpSrcs: gs >= 0 ? [gs] : [], vDsts: vd >= 0 ? [vd] : [] };
    }
    // VMOV: could be Rd,Sn or Qd,Qn or Qd,#imm
    if (mn.startsWith('VMOV')) {
      if (isGPReg(t1)) {
        // VMOV Rd, Sn — GP dest
        const dd = parseGPIdx(t1);
        return { ...empty('VMOV'), gpDsts: dd >= 0 ? [dd] : [] };
      }
      const vd = parseVIdx(t1), vn = isVReg(t2) ? parseVIdx(t2) : -1;
      return { ...empty('VMOV'), vSrcs: vn >= 0 ? [vn] : [], vDsts: vd >= 0 ? [vd] : [] };
    }
    // VPADD — Dd, Dn, Dm (D regs)
    if (mn.startsWith('VPADD')) {
      const vd = parseVIdx(t1), vn = parseVIdx(t2), vm = parseVIdx(t3);
      return { ...empty('VPADD'), vSrcs: [vn,vm].filter(i=>i>=0), vDsts: vd>=0?[vd]:[] };
    }
    // VMLA — Qd, Qn, Qm (accumulate: Qd is src and dst)
    if (mn.startsWith('VMLA')) {
      const vd = parseVIdx(t1), vn = parseVIdx(t2), vm = parseVIdx(t3);
      return { ...empty('VMLA'), vSrcs: [vd,vn,vm].filter(i=>i>=0), vDsts: vd>=0?[vd]:[] };
    }
    // VNEG, VABS — Qd, Qn (unary)
    if (mn.startsWith('VNEG') || mn.startsWith('VABS')) {
      const vd = parseVIdx(t1), vn = parseVIdx(t2);
      return { ...empty(base), vSrcs: vn>=0?[vn]:[], vDsts: vd>=0?[vd]:[] };
    }
    // VSHL, VSHR — Qd, Qn, #imm
    if (mn.startsWith('VSHL') || mn.startsWith('VSHR')) {
      const vd = parseVIdx(t1), vn = parseVIdx(t2);
      return { ...empty(base), vSrcs: vn>=0?[vn]:[], vDsts: vd>=0?[vd]:[] };
    }
    // VCEQ, VCGT, VCLT, VMAX, VMIN — Qd, Qn, Qm
    if (mn.startsWith('VCEQ')||mn.startsWith('VCGT')||mn.startsWith('VCLT')||
        mn.startsWith('VMAX')||mn.startsWith('VMIN')) {
      const vd = parseVIdx(t1), vn = parseVIdx(t2), vm = parseVIdx(t3);
      return { ...empty(base), vSrcs:[vn,vm].filter(i=>i>=0), vDsts:vd>=0?[vd]:[] };
    }
    // Generic V-prefixed with Q/D dest: VADD, VSUB, VMUL, VAND, VORR, VEOR, etc.
    if (isVReg(t1)) {
      const vd = parseVIdx(t1), vn = parseVIdx(t2), vm = parseVIdx(t3);
      return { ...empty(base), vSrcs:[vn,vm].filter(i=>i>=0), vDsts:vd>=0?[vd]:[] };
    }
  }

  // VST1/VST2 (V-prefixed, starts with VS — excluded from above)
  if (mn.startsWith('VST')) {
    const vs = isVReg(t1) ? parseVIdx(t1) : -1;
    const ar = isGPReg(stripMem(t2)) ? parseGPIdx(stripMem(t2)) : -1;
    return { ...empty(base), gpSrcs: ar >= 0 ? [ar] : [],
             vSrcs: vs >= 0 ? [vs] : [], isStore: true };
  }

  // ── AArch64 NEON (V registers with .4S etc.) ──────────────────────────────

  // DUP Vd.4S, Wn
  if (mn === 'DUP') {
    const vd = isVReg(t1) ? parseVIdx(t1) : -1;
    const gs = isGPReg(t2) ? parseGPIdx(t2) : -1;
    return { ...empty('DUP'), gpSrcs: gs >= 0 ? [gs] : [], vDsts: vd >= 0 ? [vd] : [] };
  }

  // LD1 {Vd.4S}, [Xn]
  if (mn === 'LD1' || mn === 'LD2') {
    const vd = isVReg(t1) ? parseVIdx(t1) : -1;
    const ar = isGPReg(stripMem(t2)) ? parseGPIdx(stripMem(t2)) : -1;
    return { ...empty(mn), gpSrcs: ar >= 0 ? [ar] : [], vDsts: vd >= 0 ? [vd] : [] };
  }

  // ST1 {Vs.4S}, [Xn]
  if (mn === 'ST1' || mn === 'ST2') {
    const vs = isVReg(t1) ? parseVIdx(t1) : -1;
    const ar = isGPReg(stripMem(t2)) ? parseGPIdx(stripMem(t2)) : -1;
    return { ...empty(mn), gpSrcs: ar >= 0 ? [ar] : [],
             vSrcs: vs >= 0 ? [vs] : [], isStore: true };
  }

  // V-register destination (AArch64 V regs like V4.4S)
  if (isVReg(t1)) {
    const vd = parseVIdx(t1), vn = parseVIdx(t2), vm = parseVIdx(t3);
    return { ...empty(base), vSrcs:[vn,vm].filter(i=>i>=0), vDsts:vd>=0?[vd]:[] };
  }

  // ── GP-register instructions ──────────────────────────────────────────────

  const flagsAlso = /^(ADDS|SUBS|NEGS|ANDS|ORRS|EORS|LSLS|LSRS|ASRS|MVNS|MULS)$/.test(mn);

  // STR / STRB — data src, addr src
  if (mn === 'STR' || mn === 'STRB') {
    const ds = isGPReg(t1) ? parseGPIdx(t1) : -1;
    const ar = isGPReg(stripMem(t2)) ? parseGPIdx(stripMem(t2)) : -1;
    return { ...empty(mn), gpSrcs: [ds, ar].filter(i => i >= 0), isStore: true };
  }

  // STP X1, X2, [Xn, #off]
  if (mn === 'STP') {
    const d1 = isGPReg(t1) ? parseGPIdx(t1) : -1;
    const d2 = isGPReg(t2) ? parseGPIdx(t2) : -1;
    const ar = isGPReg(stripMem(t3)) ? parseGPIdx(stripMem(t3)) : -1;
    return { ...empty('STP'), gpSrcs: [d1, d2, ar].filter(i => i >= 0), isStore: true };
  }

  // LDR / LDRB — addr src, GP dest
  if (mn === 'LDR' || mn === 'LDRB') {
    const dd = isGPReg(t1) ? parseGPIdx(t1) : -1;
    const ar = isGPReg(stripMem(t2)) ? parseGPIdx(stripMem(t2)) : -1;
    return { ...empty(mn), gpSrcs: ar >= 0 ? [ar] : [], gpDsts: dd >= 0 ? [dd] : [] };
  }

  // LDP X1, X2, [Xn]
  if (mn === 'LDP') {
    const d1 = isGPReg(t1) ? parseGPIdx(t1) : -1;
    const d2 = isGPReg(t2) ? parseGPIdx(t2) : -1;
    const ar = isGPReg(stripMem(t3)) ? parseGPIdx(stripMem(t3)) : -1;
    return { ...empty('LDP'), gpSrcs: ar >= 0 ? [ar] : [],
             gpDsts: [d1, d2].filter(i => i >= 0) };
  }

  // MOV / MOVZ
  if (base === 'MOV' || mn === 'MOVZ' || mn === 'MVN' || mn === 'MVNS') {
    const dd = isGPReg(t1) ? parseGPIdx(t1) : -1;
    const ss = isGPReg(t2) ? parseGPIdx(t2) : -1;
    return { ...empty(base), gpSrcs: ss >= 0 ? [ss] : [],
             gpDsts: dd >= 0 ? [dd] : [], flagsAlso };
  }

  // MOVK — read-modify-write on dest
  if (mn === 'MOVK') {
    const dd = isGPReg(t1) ? parseGPIdx(t1) : -1;
    return { ...empty('MOVK'), gpSrcs: dd >= 0 ? [dd] : [],
             gpDsts: dd >= 0 ? [dd] : [] };
  }

  // NEG / NEGS
  if (base === 'NEG') {
    const dd = isGPReg(t1) ? parseGPIdx(t1) : -1;
    const ss = isGPReg(t2) ? parseGPIdx(t2) : -1;
    return { ...empty(base), gpSrcs: ss >= 0 ? [ss] : [],
             gpDsts: dd >= 0 ? [dd] : [], flagsAlso };
  }

  // RSB — reverse subtract: Rd = op2 - Rn
  if (mn === 'RSB') {
    const dd = isGPReg(t1) ? parseGPIdx(t1) : -1;
    const ss = isGPReg(t2) ? parseGPIdx(t2) : -1;
    return { ...empty('RSB'), gpSrcs: ss >= 0 ? [ss] : [],
             gpDsts: dd >= 0 ? [dd] : [] };
  }

  // MLA — Rd = Rm * Rs + Ra  (4 registers)
  if (mn === 'MLA') {
    const dd = isGPReg(t1) ? parseGPIdx(t1) : -1;
    const srcs = [t2, t3, (toks[4] ?? '').toUpperCase()]
      .map(t => isGPReg(t) ? parseGPIdx(t) : -1).filter(i => i >= 0);
    return { ...empty('MLA'), gpSrcs: srcs, gpDsts: dd >= 0 ? [dd] : [] };
  }

  // Generic: dest = toks[1], srcs = toks[2..] that are GP regs (stop at shift modifier)
  const dd = isGPReg(t1) ? parseGPIdx(t1) : -1;
  const gpSrcs: number[] = [];
  for (let i = 2; i < toks.length; i++) {
    const t = (toks[i] ?? '').toUpperCase();
    if (['LSL','LSR','ASR','ROR'].includes(t)) break; // shift modifier keyword
    if (isGPReg(t)) gpSrcs.push(parseGPIdx(t));
  }
  return { ...empty(base || mn), gpSrcs, gpDsts: dd >= 0 ? [dd] : [], flagsAlso };
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
    const t = tok.replace(/^\[/, '').replace(/[,!\]].*/g, '').trim().toUpperCase();
    if (isGPReg(t)) {
      const i = parseGPIdx(t);
      if (i >= 0) out.add(i);
    }
    // Also expand reglist tokens {R4,R5,LR}
    if (tok.startsWith('{') && !isVReg(tok)) {
      for (const r of parseRegList(tok)) out.add(r);
    }
  }
  return Array.from(out);
}

/** V / Q / D register indices mentioned in token list */
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

// ── Formatting ────────────────────────────────────────────────────────────────

function fmtGP(v: number): string {
  return '0x' + (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

function fmtLane(v: number): string {
  const u = v >>> 0;
  return u <= 9999 ? String(u) : '0x' + u.toString(16).toUpperCase();
}

// ── Main render ───────────────────────────────────────────────────────────────

export function showOpAnim(
  toks: string[],
  gpBefore: Map<number, number>,
  gpAfter: Map<number, number>,
  vBefore: Map<number, number[]>,
  vAfter: Map<number, number[]>,
  gpRegName: (i: number) => string,
  vRegName: (i: number) => string,
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

  const gpSrcHtml = desc.gpSrcs.map(ri => {
    const v = gpBefore.get(ri) ?? 0;
    return `<div class="oa-node oa-src">
      <span class="oa-rname">${gpRegName(ri)}</span>
      <span class="oa-val">${fmtGP(v)}</span>
      <span class="oa-dec">${v | 0}</span>
    </div>`;
  }).join('');

  const vSrcHtml = desc.vSrcs.map(vi => {
    const lanes = vBefore.get(vi) ?? [0, 0, 0, 0];
    return `<div class="oa-node oa-src oa-vsrc">
      <span class="oa-rname">${vRegName(vi)}</span>
      <span class="oa-lanes">[${lanes.map(fmtLane).join(', ')}]</span>
    </div>`;
  }).join('');

  const gpDstHtml = desc.gpDsts.map(ri => {
    const v = gpAfter.get(ri) ?? 0;
    return `<div class="oa-node oa-dst">
      <span class="oa-rname">${gpRegName(ri)}</span>
      <span class="oa-val">${fmtGP(v)}</span>
      <span class="oa-dec">${v | 0}</span>
    </div>`;
  }).join('');

  const vDstHtml = desc.vDsts.map(vi => {
    const lanes = vAfter.get(vi) ?? [0, 0, 0, 0];
    return `<div class="oa-node oa-dst oa-vdst">
      <span class="oa-rname">${vRegName(vi)}</span>
      <span class="oa-lanes">[${lanes.map(fmtLane).join(', ')}]</span>
    </div>`;
  }).join('');

  const specialDstHtml = desc.isFlag
    ? `<div class="oa-node oa-dst oa-flags">NZCV flags</div>`
    : desc.isStore
    ? `<div class="oa-node oa-dst oa-mem">memory</div>`
    : '';

  const flagAlsoHtml = desc.flagsAlso
    ? `<div class="oa-also-flags">+ sets NZCV</div>` : '';

  const srcHtml = gpSrcHtml + vSrcHtml;
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
