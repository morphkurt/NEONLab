// Per-instruction data-flow animation shown during step mode

let hideTimer: ReturnType<typeof setTimeout> | null = null;

export interface OpAnimState {
  /** Register snapshot before execution (index → value) */
  before: Map<number, number>;
  /** Register names (R0..R15 or X0..X30) */
  names: (i: number) => string;
  /** Whether this is AArch64 (64-bit display) */
  is64: boolean;
}

// ── Token helpers ─────────────────────────────────────────────────────────────

function parseRegIdx(tok: string): number {
  if (!tok) return -1;
  const t = tok.replace(/^[RWXB]/, '').replace(/[.,!].*$/, '');
  const n = parseInt(t, 10);
  return isNaN(n) ? -1 : n;
}

function isReg(tok: string): boolean {
  return /^[RWXB]\d/.test(tok);
}

function stripBracket(tok: string): string {
  return tok.replace(/^\[/, '').replace(/[!\]].*/,'');
}

// Parse the mnemonic base (strip condition/size suffix for display)
function baseMn(mn: string): string {
  return mn.replace(/\.(EQ|NE|LT|GT|LE|GE|CS|CC|MI|PL|VS|VC|HI|LS|AL)$/, '').split('.')[0];
}

interface OpDesc {
  op: string;        // display label for the operation box
  srcs: number[];    // source register indices
  dst: number;       // destination register index, -1 if none (e.g. CMP)
  isStore: boolean;  // STR/ST1 etc.
  isBranch: boolean;
  isFlag: boolean;   // CMP/TST etc. — result goes to flags
}

function describeOp(toks: string[]): OpDesc {
  const mn  = (toks[0] ?? '').toUpperCase();
  const base = baseMn(mn);
  const t1 = (toks[1] ?? '').toUpperCase();
  const t2 = (toks[2] ?? '').toUpperCase();
  const t3 = (toks[3] ?? '').toUpperCase();

  const noDesc: OpDesc = { op: base, srcs: [], dst: -1, isStore: false, isBranch: false, isFlag: false };

  // Skip branches, loads/stores of V regs, NEON ops we can't easily describe
  if (base === 'B' || mn.startsWith('B.') || base === 'BL' || base === 'BLR' ||
      base === 'BR' || base === 'CBZ' || base === 'CBNZ' || base === 'TBZ' || base === 'TBNZ') {
    return { ...noDesc, isBranch: true };
  }

  // CMP, TST, CMN — no destination register, result is flags
  if (base === 'CMP' || base === 'TST' || base === 'CMN') {
    const s0 = isReg(t1) ? parseRegIdx(t1) : -1;
    const s1 = isReg(t2) ? parseRegIdx(t2) : -1;
    return { op: base, srcs: [s0, s1].filter(x => x >= 0), dst: -1, isStore: false, isBranch: false, isFlag: true };
  }

  // STR / STRB / STP — source data reg + address reg
  if (base === 'STR' || base === 'STRB' || base === 'STP') {
    const src0 = isReg(t1) ? parseRegIdx(t1) : -1;
    const src1 = base === 'STP' && isReg(t2) ? parseRegIdx(t2) : -1;
    const addrTok = base === 'STP' ? t3 : t2;
    const addrReg = isReg(stripBracket(addrTok)) ? parseRegIdx(stripBracket(addrTok)) : -1;
    return { op: base, srcs: [src0, src1, addrReg].filter(x => x >= 0), dst: -1, isStore: true, isBranch: false, isFlag: false };
  }

  // LDR / LDRB / LDP — destination + address reg
  if (base === 'LDR' || base === 'LDRB' || base === 'LDP') {
    const dst = isReg(t1) ? parseRegIdx(t1) : -1;
    const dst2 = base === 'LDP' && isReg(t2) ? parseRegIdx(t2) : -1;
    const addrTok = base === 'LDP' ? t3 : t2;
    const addrReg = isReg(stripBracket(addrTok)) ? parseRegIdx(stripBracket(addrTok)) : -1;
    const dsts = [dst, dst2].filter(x => x >= 0);
    return { op: base, srcs: [addrReg].filter(x => x >= 0), dst: dsts[0] ?? -1, isStore: false, isBranch: false, isFlag: false };
  }

  // MOV / MVN — 1 source
  if (base === 'MOV' || base === 'MVN' || base === 'MOVZ' || base === 'MOVK' || base === 'NEG') {
    const dst = isReg(t1) ? parseRegIdx(t1) : -1;
    const src = isReg(t2) ? parseRegIdx(t2) : -1;
    return { op: base, srcs: src >= 0 ? [src] : [], dst, isStore: false, isBranch: false, isFlag: false };
  }

  // NOP, RET, SUBS (treat SUBS as SUB for display)
  if (base === 'NOP' || base === 'RET') return { ...noDesc, dst: -1 };

  // Generic: dest = toks[1], srcs = toks[2..] that are registers
  const dst = isReg(t1) ? parseRegIdx(t1) : -1;
  const srcs: number[] = [];
  for (let i = 2; i < toks.length; i++) {
    const tok = (toks[i] ?? '').toUpperCase().replace(/[!\]].*/,'').replace(/^\[/,'');
    if (isReg(tok)) srcs.push(parseRegIdx(tok));
  }
  return { op: base, srcs, dst, isStore: false, isBranch: false, isFlag: false };
}

// ── Formatting ────────────────────────────────────────────────────────────────

function fmtVal(v: number, is64: boolean): string {
  if (is64) {
    const lo = (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
    return `0x${lo}`;
  }
  return '0x' + (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

// ── Main render ───────────────────────────────────────────────────────────────

export function showOpAnim(
  toks: string[],
  before: Map<number, number>,
  after: Map<number, number>,
  is64: boolean,
  regName: (i: number) => string,
): void {
  const el = document.getElementById('op-anim');
  if (!el) return;

  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }

  const desc = describeOp(toks);

  // Don't show animation for branches or truly empty ops
  if (desc.isBranch) { hideOpAnim(); return; }
  if (desc.srcs.length === 0 && desc.dst < 0 && !desc.isFlag && !desc.isStore) {
    hideOpAnim(); return;
  }

  const mn = (toks[0] ?? '').toUpperCase();
  const raw = toks.join(' ');

  // Build source nodes HTML
  const srcHtml = desc.srcs.map(ri => {
    const bv = before.get(ri) ?? 0;
    return `<div class="oa-node oa-src">
      <span class="oa-rname">${regName(ri)}</span>
      <span class="oa-val">${fmtVal(bv, is64)}</span>
      <span class="oa-dec">(${bv | 0})</span>
    </div>`;
  }).join('');

  // Build destination node HTML
  let dstHtml = '';
  if (desc.dst >= 0) {
    const av = after.get(desc.dst) ?? 0;
    dstHtml = `<div class="oa-node oa-dst">
      <span class="oa-rname">${regName(desc.dst)}</span>
      <span class="oa-val">${fmtVal(av, is64)}</span>
      <span class="oa-dec">(${av | 0})</span>
    </div>`;
  } else if (desc.isFlag) {
    dstHtml = `<div class="oa-node oa-dst oa-flags">NZCV flags</div>`;
  } else if (desc.isStore) {
    dstHtml = `<div class="oa-node oa-dst oa-mem">memory</div>`;
  }

  el.innerHTML = `
    <div class="oa-mnemonic">${mn}</div>
    <div class="oa-raw">${raw}</div>
    <div class="oa-flow">
      ${srcHtml.length ? `<div class="oa-srcs">${srcHtml}</div>` : ''}
      ${srcHtml.length || dstHtml ? `<div class="oa-op-box">${desc.op}</div>` : ''}
      ${dstHtml ? `<div class="oa-arrow">↓</div>${dstHtml}` : ''}
    </div>`;

  el.classList.remove('oa-fade');
  el.style.display = 'flex';
  // Trigger reflow so the animation restarts
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

export function snapshotRegs(regs: number[] | Int32Array, indices: number[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const i of indices) m.set(i, regs[i] ?? 0);
  return m;
}

/** Pull register indices mentioned in a token list */
export function regsInToks(toks: string[]): number[] {
  const out = new Set<number>();
  for (const tok of toks) {
    const t = tok.replace(/^\[/, '').replace(/[!\]].*/,'').toUpperCase();
    if (/^[RWXB]\d/.test(t)) {
      const i = parseRegIdx(t);
      if (i >= 0) out.add(i);
    }
  }
  return Array.from(out);
}
