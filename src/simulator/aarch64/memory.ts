import type { AArch64State, ParsedInstruction } from '../../types';
import { parseXR } from './alu';

function parseImm(t: string | undefined): number {
  if (!t) return NaN;
  t = t.trim();
  if (t.startsWith('#')) t = t.slice(1);
  if (/^0[xX]/.test(t)) return parseInt(t, 16);
  return parseInt(t, 10);
}

interface MemAddr {
  addr: number;
  baseIdx: number;
  writeback: boolean;
  wbAddr: number;
}

/**
 * Parse a memory token like '[X0]', '[X0,#16]', '[X0,#-16]!', '[SP,#-16]!'
 */
function parseMem(tok: string, st: AArch64State): MemAddr {
  // tok is already uppercased and trimmed, e.g. '[X0,#16]!' or '[X0]'
  const writeback = tok.endsWith('!');
  const inner = tok.replace(/!$/, '').replace(/^\[/, '').replace(/\]$/, '');
  const parts = inner.split(',').map(s => s.trim());
  const baseReg = parts[0];
  const { idx: baseIdx } = parseXR(baseReg);
  const base = baseIdx >= 0 ? st.xregs[baseIdx] : 0;
  let offset = 0;
  if (parts[1]) {
    offset = parseImm(parts[1]);
    if (isNaN(offset)) offset = 0;
  }
  const addr = (base + offset) >>> 0;
  const wbAddr = addr;
  return { addr, baseIdx: baseIdx >= 0 ? baseIdx : 31, writeback, wbAddr };
}

function readMem(st: AArch64State, addr: number): number {
  return (st.memory[addr >>> 0] ?? 0) | 0;
}

function writeMem(st: AArch64State, addr: number, val: number): void {
  st.memory[addr >>> 0] = val | 0;
}

export function execMemory64(st: AArch64State, instr: ParsedInstruction): string {
  const toks = instr.tokens;
  const n0 = (toks[0] || '').toUpperCase();

  switch (n0) {
    case 'LDR':
    case 'LDRB': {
      // LDR Xd/Wd, [Xn, #off]  or  LDR Xd/Wd, [Xn], #off  (post-index)
      const rdTok = toks[1];
      const memTok = toks[2]; // '[Xn,#off]' or '[Xn]'
      const postTok = toks[3]; // '#off' for post-index or undefined
      if (!rdTok || !memTok) throw new Error(`${n0}: missing operands`);
      const { idx: rdIdx } = parseXR(rdTok);
      if (rdIdx < 0) throw new Error(`${n0}: bad dest reg`);
      const mem = parseMem(memTok, st);
      let val = readMem(st, mem.addr);
      if (n0 === 'LDRB') val = val & 0xFF;
      st.xregs[rdIdx] = val;
      st.changed.add(rdIdx);
      // Handle writeback (pre-index '!')
      if (mem.writeback) {
        st.xregs[mem.baseIdx] = mem.wbAddr;
        st.changed.add(mem.baseIdx);
      }
      // Handle post-index
      if (postTok) {
        const off = parseImm(postTok);
        if (!isNaN(off)) {
          const baseAddr = parseMem(memTok, st);
          st.xregs[baseAddr.baseIdx] = (st.xregs[baseAddr.baseIdx] + off) | 0;
          st.changed.add(baseAddr.baseIdx);
        }
      }
      return `${rdTok}=mem[0x${mem.addr.toString(16).toUpperCase()}]`;
    }

    case 'STR':
    case 'STRB': {
      const rsTok = toks[1];
      const memTok = toks[2];
      const postTok = toks[3];
      if (!rsTok || !memTok) throw new Error(`${n0}: missing operands`);
      const { idx: rsIdx } = parseXR(rsTok);
      let val = rsIdx >= 0 ? st.xregs[rsIdx] : 0;
      if (n0 === 'STRB') val = val & 0xFF;
      const mem = parseMem(memTok, st);
      writeMem(st, mem.addr, val);
      if (mem.writeback) {
        st.xregs[mem.baseIdx] = mem.wbAddr;
        st.changed.add(mem.baseIdx);
      }
      if (postTok) {
        const off = parseImm(postTok);
        if (!isNaN(off)) {
          const baseAddr = parseMem(memTok, st);
          st.xregs[baseAddr.baseIdx] = (st.xregs[baseAddr.baseIdx] + off) | 0;
          st.changed.add(baseAddr.baseIdx);
        }
      }
      return `mem[0x${mem.addr.toString(16).toUpperCase()}]=${val}`;
    }

    case 'LDP': {
      // LDP Xd1, Xd2, [Xn, #off]  or  LDP Xd1, Xd2, [Xn], #off
      const rd1Tok = toks[1], rd2Tok = toks[2], memTok = toks[3], postTok = toks[4];
      if (!rd1Tok || !rd2Tok || !memTok) throw new Error('LDP: missing operands');
      const { idx: rd1 } = parseXR(rd1Tok);
      const { idx: rd2 } = parseXR(rd2Tok);
      const mem = parseMem(memTok, st);
      const v1 = readMem(st, mem.addr);
      const v2 = readMem(st, (mem.addr + 4) >>> 0);
      if (rd1 >= 0) { st.xregs[rd1] = v1; st.changed.add(rd1); }
      if (rd2 >= 0) { st.xregs[rd2] = v2; st.changed.add(rd2); }
      if (mem.writeback) {
        st.xregs[mem.baseIdx] = mem.wbAddr;
        st.changed.add(mem.baseIdx);
      }
      if (postTok) {
        const off = parseImm(postTok);
        if (!isNaN(off)) {
          st.xregs[mem.baseIdx] = (st.xregs[mem.baseIdx] + off) | 0;
          st.changed.add(mem.baseIdx);
        }
      }
      return `LDP ${rd1Tok},${rd2Tok} from 0x${mem.addr.toString(16).toUpperCase()}`;
    }

    case 'STP': {
      // STP Xs1, Xs2, [Xn, #off]!  or  STP Xs1, Xs2, [Xn]
      const rs1Tok = toks[1], rs2Tok = toks[2], memTok = toks[3], postTok = toks[4];
      if (!rs1Tok || !rs2Tok || !memTok) throw new Error('STP: missing operands');
      const { idx: rs1 } = parseXR(rs1Tok);
      const { idx: rs2 } = parseXR(rs2Tok);
      const v1 = rs1 >= 0 ? st.xregs[rs1] : 0;
      const v2 = rs2 >= 0 ? st.xregs[rs2] : 0;
      // Pre-index: compute addr, write back, then store
      const mem = parseMem(memTok, st);
      if (mem.writeback) {
        // Write back first for pre-index
        st.xregs[mem.baseIdx] = mem.wbAddr;
        st.changed.add(mem.baseIdx);
      }
      writeMem(st, mem.addr, v1);
      writeMem(st, (mem.addr + 4) >>> 0, v2);
      if (postTok) {
        const off = parseImm(postTok);
        if (!isNaN(off)) {
          st.xregs[mem.baseIdx] = (st.xregs[mem.baseIdx] + off) | 0;
          st.changed.add(mem.baseIdx);
        }
      }
      return `STP ${rs1Tok},${rs2Tok} to 0x${mem.addr.toString(16).toUpperCase()}`;
    }

    default:
      throw new Error(`Unknown AArch64 memory instruction: ${n0}`);
  }
}
