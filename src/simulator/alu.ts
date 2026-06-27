import type { SimulatorState, ParsedInstruction } from '../types';
import { toU32, toS32, hex8 } from './state';
import { parseReg } from '../parser/registers';
import { evalCondition } from './conditions';

function parseImm(t: string | undefined): number {
  if (!t) return NaN;
  t = t.trim();
  if (t.startsWith('#')) t = t.slice(1);
  if (/^0[xX]/.test(t)) return parseInt(t, 16);
  if (/^0[bB]/.test(t)) return parseInt(t.slice(2), 2);
  return parseInt(t, 10);
}

interface Op2Result { value: number; carry: boolean }

function resolveOp2(st: SimulatorState, toks: string[], i: number): Op2Result {
  const t = toks[i];
  if (!t) return { value: 0, carry: st.cpsr.C };
  const ri = parseReg(t);
  if (ri >= 0) {
    let v = st.regs[ri];
    let c = st.cpsr.C;
    const sh = (toks[i + 1] || '').toUpperCase();
    if (['LSL', 'LSR', 'ASR', 'ROR'].includes(sh)) {
      const s2 = toks[i + 2] || '#0';
      const srReg = parseReg(s2);
      let sa = s2.startsWith('#') ? parseImm(s2) : (srReg >= 0 ? st.regs[srReg] & 0xFF : 0);
      if (sh === 'LSL') {
        c = sa > 0 ? ((v >>> (32 - sa)) & 1) === 1 : c;
        v = sa >= 32 ? 0 : v << sa;
      } else if (sh === 'LSR') {
        c = sa > 0 ? ((v >>> (sa - 1)) & 1) === 1 : c;
        v = sa >= 32 ? 0 : v >>> sa;
      } else if (sh === 'ASR') {
        c = sa > 0 ? ((v >> (sa - 1)) & 1) === 1 : c;
        v = sa >= 32 ? v >> 31 : v >> sa;
      } else if (sh === 'ROR') {
        sa &= 31;
        c = sa > 0 ? ((v >>> (sa - 1)) & 1) === 1 : c;
        v = sa ? ((v >>> sa) | (v << (32 - sa))) : v;
      }
    }
    return { value: v, carry: c };
  }
  const im = parseImm(t);
  return { value: isNaN(im) ? 0 : im, carry: st.cpsr.C };
}

function flagsAdd(st: SimulatorState, a: number, b: number, r: number): void {
  st.cpsr.N = (toU32(r) >>> 31) === 1;
  st.cpsr.Z = toU32(r) === 0;
  st.cpsr.C = (toU32(a) + toU32(b)) > 0xFFFFFFFF;
  st.cpsr.V = (toS32(a) > 0 && toS32(b) > 0 && toS32(r) < 0) ||
              (toS32(a) < 0 && toS32(b) < 0 && toS32(r) >= 0);
  (['N', 'Z', 'C', 'V'] as const).forEach(f => st.flagChg.add(f));
}

function flagsSub(st: SimulatorState, a: number, b: number, r: number): void {
  st.cpsr.N = (toU32(r) >>> 31) === 1;
  st.cpsr.Z = toU32(r) === 0;
  st.cpsr.C = toU32(a) >= toU32(b);
  st.cpsr.V = (toS32(a) > 0 && toS32(b) < 0 && toS32(r) < 0) ||
              (toS32(a) < 0 && toS32(b) > 0 && toS32(r) > 0);
  (['N', 'Z', 'C', 'V'] as const).forEach(f => st.flagChg.add(f));
}

function flagsLogic(st: SimulatorState, r: number, c: boolean): void {
  st.cpsr.N = (toU32(r) >>> 31) === 1;
  st.cpsr.Z = toU32(r) === 0;
  st.cpsr.C = c;
  (['N', 'Z', 'C'] as const).forEach(f => st.flagChg.add(f));
}

/** dp3: decode 3-operand or 2-operand (Rd, op2) instruction */
function dp3(st: SimulatorState, toks: string[]): { rd: number; rn: number; op2: Op2Result } {
  if (toks.length >= 4) {
    return { rd: parseReg(toks[1]), rn: parseReg(toks[2]), op2: resolveOp2(st, toks, 3) };
  }
  const rd = parseReg(toks[1]);
  return { rd, rn: rd, op2: resolveOp2(st, toks, 2) };
}

export function execALU(st: SimulatorState, instr: ParsedInstruction): string {
  const toks = instr.tokens;
  const n0 = (toks[0] || '').toUpperCase();

  // MOV and conditional MOVs
  if (/^MOVS?([A-Z]*)$/.test(n0)) {
    const hasS = n0.startsWith('MOVS') && n0.length === 4;
    const cc = hasS
      ? ''
      : n0.startsWith('MOVS')
        ? n0.slice(4)
        : n0.slice(3);
    if (!evalCondition(cc, st.cpsr)) return `${n0} not taken`;
    const rd = parseReg(toks[1]);
    if (rd < 0) throw new Error('Bad reg');
    const { value: v, carry } = resolveOp2(st, toks, 2);
    st.regs[rd] = v;
    st.changed.add(rd);
    if (hasS) flagsLogic(st, v, carry);
    return `R${rd}=${hex8(v)}`;
  }

  switch (n0) {
    case 'NOP': return 'NOP';

    case 'MVN':
    case 'MVNS': {
      const rd = parseReg(toks[1]);
      if (rd < 0) throw new Error('Bad reg');
      const { value: v, carry } = resolveOp2(st, toks, 2);
      const r = ~v;
      st.regs[rd] = r;
      st.changed.add(rd);
      if (n0 === 'MVNS') flagsLogic(st, r, carry);
      return `R${rd}=~${hex8(v)}`;
    }

    case 'ADD':
    case 'ADDS': {
      const { rd, rn, op2 } = dp3(st, toks);
      if (rd < 0) throw new Error('Bad reg');
      const a = st.regs[rn < 0 ? rd : rn], b = op2.value, r = (a + b) | 0;
      st.regs[rd] = r;
      st.changed.add(rd);
      if (n0 === 'ADDS') flagsAdd(st, a, b, r);
      return `R${rd}=${hex8(a)}+${hex8(b)}=${hex8(r)}`;
    }

    case 'SUB':
    case 'SUBS': {
      const { rd, rn, op2 } = dp3(st, toks);
      if (rd < 0) throw new Error('Bad reg');
      const a = st.regs[rn < 0 ? rd : rn], b = op2.value, r = (a - b) | 0;
      st.regs[rd] = r;
      st.changed.add(rd);
      if (n0 === 'SUBS') flagsSub(st, a, b, r);
      return `R${rd}=${hex8(r)}`;
    }

    case 'RSB': {
      const rd = parseReg(toks[1]), rn = parseReg(toks[2]);
      if (rd < 0) throw new Error('Bad reg');
      const { value: b } = resolveOp2(st, toks, 3);
      const a = st.regs[rn < 0 ? rd : rn], r = (b - a) | 0;
      st.regs[rd] = r;
      st.changed.add(rd);
      return `R${rd}=${hex8(r)}`;
    }

    case 'MUL':
    case 'MULS': {
      const rd = parseReg(toks[1]), rm = parseReg(toks[2]);
      const rsi = parseReg(toks[3]), rs = rsi >= 0 ? rsi : rd;
      if (rd < 0 || rm < 0) throw new Error('Bad reg');
      const a = st.regs[rm], b = st.regs[rs], r = Math.imul(a, b);
      st.regs[rd] = r;
      st.changed.add(rd);
      return `R${rd}=${toS32(a)}*${toS32(b)}=${hex8(r)}`;
    }

    case 'MLA': {
      const rd = parseReg(toks[1]), rm = parseReg(toks[2]);
      const rs = parseReg(toks[3]), ra = parseReg(toks[4]);
      if (rd < 0 || rm < 0 || rs < 0 || ra < 0) throw new Error('Bad reg');
      const r = (Math.imul(st.regs[rm], st.regs[rs]) + st.regs[ra]) | 0;
      st.regs[rd] = r;
      st.changed.add(rd);
      return `R${rd}=${hex8(r)}`;
    }

    case 'AND':
    case 'ANDS': {
      const { rd, rn, op2 } = dp3(st, toks);
      if (rd < 0) throw new Error('Bad reg');
      const a = st.regs[rn < 0 ? rd : rn], b = op2.value, r = (a & b) | 0;
      st.regs[rd] = r;
      st.changed.add(rd);
      if (n0 === 'ANDS') flagsLogic(st, r, op2.carry);
      return `R${rd}=${hex8(r)}`;
    }

    case 'ORR':
    case 'ORRS': {
      const { rd, rn, op2 } = dp3(st, toks);
      if (rd < 0) throw new Error('Bad reg');
      const a = st.regs[rn < 0 ? rd : rn], b = op2.value, r = (a | b) | 0;
      st.regs[rd] = r;
      st.changed.add(rd);
      if (n0 === 'ORRS') flagsLogic(st, r, op2.carry);
      return `R${rd}=${hex8(r)}`;
    }

    case 'EOR':
    case 'EORS': {
      const { rd, rn, op2 } = dp3(st, toks);
      if (rd < 0) throw new Error('Bad reg');
      const a = st.regs[rn < 0 ? rd : rn], b = op2.value, r = (a ^ b) | 0;
      st.regs[rd] = r;
      st.changed.add(rd);
      if (n0 === 'EORS') flagsLogic(st, r, op2.carry);
      return `R${rd}=${hex8(r)}`;
    }

    case 'BIC': {
      const { rd, rn, op2 } = dp3(st, toks);
      if (rd < 0) throw new Error('Bad reg');
      const a = st.regs[rn < 0 ? rd : rn], b = op2.value, r = (a & ~b) | 0;
      st.regs[rd] = r;
      st.changed.add(rd);
      return `R${rd}=${hex8(r)}`;
    }

    case 'LSL':
    case 'LSLS': {
      const rd = parseReg(toks[1]), rm = parseReg(toks[2]);
      if (rd < 0 || rm < 0) throw new Error('Bad reg');
      const t3 = toks[3];
      const saReg = t3 && !t3.startsWith('#') ? parseReg(t3) : -1;
      const sa = t3?.startsWith('#') ? parseImm(t3) : (saReg >= 0 ? st.regs[saReg] & 0xFF : 0);
      const a = st.regs[rm];
      const c = sa > 0 ? ((a >>> (32 - sa)) & 1) === 1 : st.cpsr.C;
      const r = sa >= 32 ? 0 : a << sa;
      st.regs[rd] = r;
      st.changed.add(rd);
      if (n0 === 'LSLS') flagsLogic(st, r, c);
      return `R${rd}=${hex8(r)}`;
    }

    case 'LSR':
    case 'LSRS': {
      const rd = parseReg(toks[1]), rm = parseReg(toks[2]);
      if (rd < 0 || rm < 0) throw new Error('Bad reg');
      const t3 = toks[3];
      const saReg = t3 && !t3.startsWith('#') ? parseReg(t3) : -1;
      const sa = t3?.startsWith('#') ? parseImm(t3) : (saReg >= 0 ? st.regs[saReg] & 0xFF : 0);
      const a = st.regs[rm];
      const c = sa > 0 ? ((a >>> (sa - 1)) & 1) === 1 : st.cpsr.C;
      const r = sa >= 32 ? 0 : a >>> sa;
      st.regs[rd] = r;
      st.changed.add(rd);
      if (n0 === 'LSRS') flagsLogic(st, r, c);
      return `R${rd}=${hex8(r)}`;
    }

    case 'ASR':
    case 'ASRS': {
      const rd = parseReg(toks[1]), rm = parseReg(toks[2]);
      if (rd < 0 || rm < 0) throw new Error('Bad reg');
      const t3 = toks[3];
      const saReg = t3 && !t3.startsWith('#') ? parseReg(t3) : -1;
      const sa = t3?.startsWith('#') ? parseImm(t3) : (saReg >= 0 ? st.regs[saReg] & 0xFF : 0);
      const a = st.regs[rm];
      const c = sa > 0 ? ((a >> (sa - 1)) & 1) === 1 : st.cpsr.C;
      const r = sa >= 32 ? a >> 31 : a >> sa;
      st.regs[rd] = r;
      st.changed.add(rd);
      if (n0 === 'ASRS') flagsLogic(st, r, c);
      return `R${rd}=${hex8(r)}`;
    }

    case 'ROR': {
      const rd = parseReg(toks[1]), rm = parseReg(toks[2]);
      if (rd < 0 || rm < 0) throw new Error('Bad reg');
      const t3 = toks[3];
      const saReg = t3 && !t3.startsWith('#') ? parseReg(t3) : -1;
      const rawSa = t3?.startsWith('#') ? parseImm(t3) : (saReg >= 0 ? st.regs[saReg] & 0xFF : 0);
      const rsa = rawSa & 31;
      const a = st.regs[rm];
      const c = rsa > 0 ? ((a >>> (rsa - 1)) & 1) === 1 : st.cpsr.C;
      const r = rsa ? ((a >>> rsa) | (a << (32 - rsa))) : a;
      st.regs[rd] = r;
      st.changed.add(rd);
      return `R${rd}=${hex8(r)}`;
    }

    case 'CMP': {
      const rn = parseReg(toks[1]);
      if (rn < 0) throw new Error('Bad reg');
      const { value: b } = resolveOp2(st, toks, 2);
      const a = st.regs[rn];
      flagsSub(st, a, b, (a - b) | 0);
      return `CMP N=${st.cpsr.N ? 1 : 0}Z=${st.cpsr.Z ? 1 : 0}C=${st.cpsr.C ? 1 : 0}V=${st.cpsr.V ? 1 : 0}`;
    }

    case 'CMN': {
      const rn = parseReg(toks[1]);
      if (rn < 0) throw new Error('Bad reg');
      const { value: b } = resolveOp2(st, toks, 2);
      const a = st.regs[rn];
      flagsAdd(st, a, b, (a + b) | 0);
      return `CMN flags`;
    }

    case 'TST': {
      const rn = parseReg(toks[1]);
      if (rn < 0) throw new Error('Bad reg');
      const { value: b, carry } = resolveOp2(st, toks, 2);
      flagsLogic(st, st.regs[rn] & b, carry);
      return `TST flags`;
    }

    default:
      throw new Error(`Unknown ALU instruction: ${n0}`);
  }
}
