import type { SimulatorState, ParsedInstruction } from '../types';
import { hex8 } from './state';
import { parseReg } from '../parser/registers';

function parseImm(t: string | undefined): number {
  if (!t) return NaN;
  t = t.trim();
  if (t.startsWith('#')) t = t.slice(1);
  if (/^0[xX]/.test(t)) return parseInt(t, 16);
  return parseInt(t, 10);
}

export function execMemory(st: SimulatorState, instr: ParsedInstruction): string {
  const toks = instr.tokens;
  const n0 = (toks[0] || '').toUpperCase();

  switch (n0) {
    case 'LDR': {
      const rd = parseReg(toks[1]);
      if (rd < 0) throw new Error('Bad reg');
      const src = toks[2] ?? '';
      if (src.startsWith('=')) {
        const v = parseImm(src.slice(1));
        st.regs[rd] = isNaN(v) ? 0 : v;
        st.changed.add(rd);
        return `R${rd}=${hex8(st.regs[rd])}`;
      }
      if (src.startsWith('[')) {
        const inn = src.slice(1, src.lastIndexOf(']')).split(',');
        const rn  = parseReg(inn[0]?.trim() ?? '');
        const off = inn[1] ? parseImm(inn[1].trim()) : 0;
        const addr = ((st.regs[rn >= 0 ? rn : 0]) + (isNaN(off) ? 0 : off)) >>> 0;
        st.regs[rd] = st.memory[addr] ?? 0;
        st.changed.add(rd);
        return `R${rd}=MEM[${hex8(addr)}]=${hex8(st.regs[rd])}`;
      }
      throw new Error('Bad LDR');
    }

    case 'STR': {
      const rd = parseReg(toks[1]);
      if (rd < 0) throw new Error('Bad reg');
      const dst = toks[2] ?? '';
      if (!dst.startsWith('[')) throw new Error('Expected [Rn]');
      const inn = dst.slice(1, dst.lastIndexOf(']')).split(',');
      const rn  = parseReg(inn[0]?.trim() ?? '');
      const off = inn[1] ? parseImm(inn[1].trim()) : 0;
      const addr = ((st.regs[rn >= 0 ? rn : 0]) + (isNaN(off) ? 0 : off)) >>> 0;
      st.memory[addr] = st.regs[rd];
      return `MEM[${hex8(addr)}]=R${rd}`;
    }

    case 'LDRB': {
      const rd = parseReg(toks[1]);
      if (rd < 0) throw new Error('Bad reg');
      const src = toks[2] ?? '';
      if (src.startsWith('[')) {
        const inn = src.slice(1, src.lastIndexOf(']')).split(',');
        const rn  = parseReg(inn[0]?.trim() ?? '');
        const off = inn[1] ? parseImm(inn[1].trim()) : 0;
        const addr = ((st.regs[rn >= 0 ? rn : 0]) + (isNaN(off) ? 0 : off)) >>> 0;
        st.regs[rd] = (st.memory[addr] ?? 0) & 0xFF;
        st.changed.add(rd);
        return `R${rd}=MEM8[${hex8(addr)}]`;
      }
      throw new Error('Bad LDRB');
    }

    case 'STRB': {
      const rd = parseReg(toks[1]);
      if (rd < 0) throw new Error('Bad reg');
      const dst = toks[2] ?? '';
      if (!dst.startsWith('[')) throw new Error('Expected [Rn]');
      const inn = dst.slice(1, dst.lastIndexOf(']')).split(',');
      const rn  = parseReg(inn[0]?.trim() ?? '');
      const off = inn[1] ? parseImm(inn[1].trim()) : 0;
      const addr = ((st.regs[rn >= 0 ? rn : 0]) + (isNaN(off) ? 0 : off)) >>> 0;
      st.memory[addr] = st.regs[rd] & 0xFF;
      return `MEM8[${hex8(addr)}]=R${rd}&0xFF`;
    }

    case 'PUSH': {
      const raw = instr.raw;
      const lst = raw.slice(raw.indexOf('{') + 1, raw.lastIndexOf('}'));
      const rs = lst.split(',').map(s => parseReg(s.trim())).filter(r => r >= 0).sort((a, b) => b - a);
      rs.forEach(r => {
        st.regs[13] = (st.regs[13] - 4) | 0;
        st.memory[st.regs[13] >>> 0] = st.regs[r];
      });
      st.changed.add(13);
      return `PUSH`;
    }

    case 'POP': {
      const raw = instr.raw;
      const lst = raw.slice(raw.indexOf('{') + 1, raw.lastIndexOf('}'));
      const rs = lst.split(',').map(s => parseReg(s.trim())).filter(r => r >= 0).sort((a, b) => a - b);
      rs.forEach(r => {
        st.regs[r] = st.memory[st.regs[13] >>> 0] ?? 0;
        st.regs[13] = (st.regs[13] + 4) | 0;
        st.changed.add(r);
      });
      st.changed.add(13);
      return `POP`;
    }

    default:
      throw new Error(`Unknown memory instruction: ${n0}`);
  }
}
