import type { AArch64State, ParsedInstruction } from '../../types';
import { hex8_64 } from './state';

export interface XReg { idx: number; w32: boolean }

export function parseXR(t: string | undefined): XReg {
  if (!t) return { idx: -1, w32: false };
  const u = t.toUpperCase().trim();
  if (u === 'XZR') return { idx: 31, w32: false };
  if (u === 'WZR') return { idx: 31, w32: true };
  if (u === 'SP')  return { idx: 31, w32: false };
  if (u === 'WSP') return { idx: 31, w32: true };
  if (u === 'LR')  return { idx: 30, w32: false };
  const mx = u.match(/^X(\d+)$/);
  if (mx) { const i = +mx[1]; return i <= 30 ? { idx: i, w32: false } : { idx: -1, w32: false }; }
  const mw = u.match(/^W(\d+)$/);
  if (mw) { const i = +mw[1]; return i <= 30 ? { idx: i, w32: true } : { idx: -1, w32: true }; }
  return { idx: -1, w32: false };
}

function readXR(st: AArch64State, t: string): number {
  const u = t.toUpperCase().trim();
  if (u === 'XZR' || u === 'WZR') return 0;
  const { idx, w32 } = parseXR(t);
  if (idx < 0) return 0;
  const v = st.xregs[idx] ?? 0;
  return w32 ? (v | 0) : v;
}

function writeXR(st: AArch64State, t: string, v: number): void {
  const u = t.toUpperCase().trim();
  if (u === 'XZR' || u === 'WZR') return; // no-op
  const { idx, w32 } = parseXR(t);
  if (idx < 0) return;
  st.xregs[idx] = w32 ? ((v | 0) >>> 0 | 0) : v;
  st.changed.add(idx);
}

function parseImm(t: string | undefined): number {
  if (!t) return NaN;
  t = t.trim();
  if (t.startsWith('#')) t = t.slice(1);
  // Handle 'LSL #12' style in MOVK — but this function just parses a plain imm token
  if (/^0[xX]/.test(t)) return parseInt(t, 16);
  if (/^0[bB]/.test(t)) return parseInt(t.slice(2), 2);
  return parseInt(t, 10);
}

function flagsAdd64(st: AArch64State, a: number, b: number, r: number, w32: boolean): void {
  if (w32) {
    const ua = a >>> 0, ub = b >>> 0, ur = r >>> 0;
    st.pstate.N = (ur >>> 31) === 1;
    st.pstate.Z = ur === 0;
    st.pstate.C = (ua + ub) > 0xFFFFFFFF;
    st.pstate.V = ((a | 0) > 0 && (b | 0) > 0 && (r | 0) < 0) ||
                  ((a | 0) < 0 && (b | 0) < 0 && (r | 0) >= 0);
  } else {
    const ua = a >>> 0, ub = b >>> 0, ur = r >>> 0;
    st.pstate.N = (ur >>> 31) === 1;
    st.pstate.Z = ur === 0;
    st.pstate.C = (ua + ub) > 0xFFFFFFFF;
    st.pstate.V = ((a | 0) > 0 && (b | 0) > 0 && (r | 0) < 0) ||
                  ((a | 0) < 0 && (b | 0) < 0 && (r | 0) >= 0);
  }
  (['N', 'Z', 'C', 'V'] as const).forEach(f => st.flagChg.add(f));
}

function flagsSub64(st: AArch64State, a: number, b: number, r: number, w32: boolean): void {
  if (w32) {
    const ua = a >>> 0, ub = b >>> 0, ur = r >>> 0;
    st.pstate.N = (ur >>> 31) === 1;
    st.pstate.Z = ur === 0;
    st.pstate.C = ua >= ub;
    st.pstate.V = ((a | 0) > 0 && (b | 0) < 0 && (r | 0) < 0) ||
                  ((a | 0) < 0 && (b | 0) > 0 && (r | 0) > 0);
  } else {
    const ua = a >>> 0, ub = b >>> 0, ur = r >>> 0;
    st.pstate.N = (ur >>> 31) === 1;
    st.pstate.Z = ur === 0;
    st.pstate.C = ua >= ub;
    st.pstate.V = ((a | 0) > 0 && (b | 0) < 0 && (r | 0) < 0) ||
                  ((a | 0) < 0 && (b | 0) > 0 && (r | 0) > 0);
  }
  (['N', 'Z', 'C', 'V'] as const).forEach(f => st.flagChg.add(f));
}

export function execALU64(st: AArch64State, instr: ParsedInstruction): string {
  const toks = instr.tokens;
  const n0 = (toks[0] || '').toUpperCase();

  switch (n0) {
    case 'NOP': return 'NOP';

    case 'RET': {
      st.pc = st.xregs[30];
      st.changed.add(30);
      return 'RET';
    }

    case 'MOV':
    case 'MOVZ': {
      const rd = toks[1];
      if (!rd) throw new Error('MOV: missing dest');
      const { w32 } = parseXR(rd);
      let v: number;
      const src = toks[2];
      if (!src) throw new Error('MOV: missing src');
      const sr = parseXR(src);
      if (sr.idx >= 0 || src.toUpperCase() === 'XZR' || src.toUpperCase() === 'WZR') {
        v = readXR(st, src);
      } else {
        v = parseImm(src);
        if (isNaN(v)) throw new Error(`MOV: bad src ${src}`);
      }
      if (w32) v = v & 0xFFFFFFFF;
      writeXR(st, rd, v);
      return `${rd}=${hex8_64(v)}`;
    }

    case 'MOVK': {
      const rd = toks[1];
      if (!rd) throw new Error('MOVK: missing dest');
      const { w32 } = parseXR(rd);
      const immTok = toks[2];
      const imm = parseImm(immTok) & 0xFFFF;
      // Check for LSL #shift
      let shift = 0;
      const lslIdx = toks.findIndex(t => t.toUpperCase() === 'LSL');
      if (lslIdx >= 0 && toks[lslIdx + 1]) {
        shift = parseImm(toks[lslIdx + 1]);
      }
      const cur = st.xregs[parseXR(rd).idx] ?? 0;
      const mask = ~(0xFFFF << shift);
      const v = (cur & mask) | ((imm << shift) >>> 0);
      const fv = w32 ? v & 0xFFFFFFFF : v;
      writeXR(st, rd, fv);
      return `${rd}=${hex8_64(fv)}`;
    }

    case 'ADD':
    case 'ADDS': {
      const rd = toks[1], rn = toks[2], rm = toks[3];
      if (!rd || !rn) throw new Error('ADD: missing operands');
      const { w32 } = parseXR(rd);
      const a = readXR(st, rn);
      let b: number;
      if (rm && (rm.startsWith('#') || !isNaN(+rm))) {
        b = parseImm(rm);
        // Check for LSL #12 shift on immediate
        const lslIdx = toks.findIndex(t => t.toUpperCase() === 'LSL');
        if (lslIdx >= 0 && toks[lslIdx + 1]) {
          const sh = parseImm(toks[lslIdx + 1]);
          b = (b << sh) >>> 0;
        }
      } else {
        b = rm ? readXR(st, rm) : 0;
      }
      let r = (a + b) | 0;
      if (w32) r = r & 0xFFFFFFFF;
      if (n0 === 'ADDS') flagsAdd64(st, a, b, r, w32);
      if (rd.toUpperCase() !== 'XZR' && rd.toUpperCase() !== 'WZR') writeXR(st, rd, r);
      return `${rd}=${hex8_64(a)}+${hex8_64(b)}=${hex8_64(r)}`;
    }

    case 'SUB':
    case 'SUBS': {
      const rd = toks[1], rn = toks[2], rm = toks[3];
      if (!rd || !rn) throw new Error('SUB: missing operands');
      const { w32 } = parseXR(rd);
      const a = readXR(st, rn);
      let b: number;
      if (rm && (rm.startsWith('#') || !isNaN(+rm))) {
        b = parseImm(rm);
        const lslIdx = toks.findIndex(t => t.toUpperCase() === 'LSL');
        if (lslIdx >= 0 && toks[lslIdx + 1]) {
          const sh = parseImm(toks[lslIdx + 1]);
          b = (b << sh) >>> 0;
        }
      } else {
        b = rm ? readXR(st, rm) : 0;
      }
      let r = (a - b) | 0;
      if (w32) r = r & 0xFFFFFFFF;
      if (n0 === 'SUBS') flagsSub64(st, a, b, r, w32);
      if (rd.toUpperCase() !== 'XZR' && rd.toUpperCase() !== 'WZR') writeXR(st, rd, r);
      return `${rd}=${hex8_64(r)}`;
    }

    case 'NEG':
    case 'NEGS': {
      const rd = toks[1], rm = toks[2];
      if (!rd || !rm) throw new Error('NEG: missing operands');
      const { w32 } = parseXR(rd);
      const a = readXR(st, rm);
      let r = (0 - a) | 0;
      if (w32) r = r & 0xFFFFFFFF;
      if (n0 === 'NEGS') flagsSub64(st, 0, a, r, w32);
      writeXR(st, rd, r);
      return `${rd}=${hex8_64(r)}`;
    }

    case 'MUL': {
      const rd = toks[1], rn = toks[2], rm = toks[3];
      if (!rd || !rn || !rm) throw new Error('MUL: missing operands');
      const { w32 } = parseXR(rd);
      const a = readXR(st, rn), b = readXR(st, rm);
      const r = w32 ? Math.imul(a, b) : Math.imul(a, b); // keep 32-bit semantics for JS
      const fv = w32 ? r & 0xFFFFFFFF : r;
      writeXR(st, rd, fv);
      return `${rd}=${hex8_64(fv)}`;
    }

    case 'LSL': {
      const rd = toks[1], rn = toks[2], sa = toks[3];
      if (!rd || !rn) throw new Error('LSL: missing operands');
      const { w32 } = parseXR(rd);
      const a = readXR(st, rn);
      const shift = sa ? (sa.startsWith('#') ? parseImm(sa) : readXR(st, sa)) : 0;
      const r = w32 ? ((a << shift) & 0xFFFFFFFF) : (a << shift) | 0;
      writeXR(st, rd, r);
      return `${rd}=${hex8_64(r)}`;
    }

    case 'LSR': {
      const rd = toks[1], rn = toks[2], sa = toks[3];
      if (!rd || !rn) throw new Error('LSR: missing operands');
      const { w32 } = parseXR(rd);
      const a = readXR(st, rn);
      const shift = sa ? (sa.startsWith('#') ? parseImm(sa) : readXR(st, sa)) : 0;
      const r = w32 ? ((a >>> 0) >>> shift) : (a >>> shift);
      writeXR(st, rd, r);
      return `${rd}=${hex8_64(r)}`;
    }

    case 'ASR': {
      const rd = toks[1], rn = toks[2], sa = toks[3];
      if (!rd || !rn) throw new Error('ASR: missing operands');
      const { w32 } = parseXR(rd);
      const a = readXR(st, rn);
      const shift = sa ? (sa.startsWith('#') ? parseImm(sa) : readXR(st, sa)) : 0;
      const r = w32 ? ((a | 0) >> shift) : (a >> shift);
      writeXR(st, rd, r);
      return `${rd}=${hex8_64(r)}`;
    }

    case 'AND':
    case 'ANDS': {
      const rd = toks[1], rn = toks[2], rm = toks[3];
      if (!rd || !rn || !rm) throw new Error('AND: missing operands');
      const { w32 } = parseXR(rd);
      const a = readXR(st, rn);
      const b = rm.startsWith('#') ? parseImm(rm) : readXR(st, rm);
      let r = (a & b) | 0;
      if (w32) r = r & 0xFFFFFFFF;
      writeXR(st, rd, r);
      return `${rd}=${hex8_64(r)}`;
    }

    case 'ORR': {
      const rd = toks[1], rn = toks[2], rm = toks[3];
      if (!rd || !rn || !rm) throw new Error('ORR: missing operands');
      const { w32 } = parseXR(rd);
      const a = readXR(st, rn);
      const b = rm.startsWith('#') ? parseImm(rm) : readXR(st, rm);
      let r = (a | b) | 0;
      if (w32) r = r & 0xFFFFFFFF;
      writeXR(st, rd, r);
      return `${rd}=${hex8_64(r)}`;
    }

    case 'EOR': {
      const rd = toks[1], rn = toks[2], rm = toks[3];
      if (!rd || !rn || !rm) throw new Error('EOR: missing operands');
      const { w32 } = parseXR(rd);
      const a = readXR(st, rn);
      const b = rm.startsWith('#') ? parseImm(rm) : readXR(st, rm);
      let r = (a ^ b) | 0;
      if (w32) r = r & 0xFFFFFFFF;
      writeXR(st, rd, r);
      return `${rd}=${hex8_64(r)}`;
    }

    case 'BIC': {
      const rd = toks[1], rn = toks[2], rm = toks[3];
      if (!rd || !rn || !rm) throw new Error('BIC: missing operands');
      const { w32 } = parseXR(rd);
      const a = readXR(st, rn);
      const b = rm.startsWith('#') ? parseImm(rm) : readXR(st, rm);
      let r = (a & ~b) | 0;
      if (w32) r = r & 0xFFFFFFFF;
      writeXR(st, rd, r);
      return `${rd}=${hex8_64(r)}`;
    }

    case 'CMP': {
      // SUBS into XZR — sets flags, no writeback
      const rn = toks[1], rm = toks[2];
      if (!rn || !rm) throw new Error('CMP: missing operands');
      const { w32 } = parseXR(rn);
      const a = readXR(st, rn);
      const b = rm.startsWith('#') ? parseImm(rm) : readXR(st, rm);
      const r = (a - b) | 0;
      flagsSub64(st, a, b, r, w32);
      return `CMP N=${st.pstate.N?1:0}Z=${st.pstate.Z?1:0}C=${st.pstate.C?1:0}V=${st.pstate.V?1:0}`;
    }

    case 'CMN': {
      const rn = toks[1], rm = toks[2];
      if (!rn || !rm) throw new Error('CMN: missing operands');
      const { w32 } = parseXR(rn);
      const a = readXR(st, rn);
      const b = rm.startsWith('#') ? parseImm(rm) : readXR(st, rm);
      const r = (a + b) | 0;
      flagsAdd64(st, a, b, r, w32);
      return `CMN flags`;
    }

    case 'TST': {
      const rn = toks[1], rm = toks[2];
      if (!rn || !rm) throw new Error('TST: missing operands');
      const a = readXR(st, rn);
      const b = rm.startsWith('#') ? parseImm(rm) : readXR(st, rm);
      const r = (a & b) | 0;
      st.pstate.N = (r >>> 31) === 1;
      st.pstate.Z = (r >>> 0) === 0;
      (['N', 'Z'] as const).forEach(f => st.flagChg.add(f));
      return `TST flags`;
    }

    default:
      throw new Error(`Unknown AArch64 ALU instruction: ${n0}`);
  }
}
