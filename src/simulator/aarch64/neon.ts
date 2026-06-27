import type { AArch64State, ParsedInstruction } from '../../types';
import { parseXR } from './alu';

interface VReg { idx: number; arr: string }

function parseVR(t: string): VReg | null {
  if (!t) return null;
  // Strip braces: {V2.4S} → V2.4S
  const s = t.replace(/^\{/, '').replace(/\}$/, '').trim();
  const m = s.match(/^V(\d+)(?:\.(\w+))?$/i);
  if (!m) return null;
  const idx = +m[1];
  const arr = (m[2] || '4S').toUpperCase();
  return { idx, arr };
}

function laneCount(arr: string): number {
  switch (arr.toUpperCase()) {
    case '4S': return 4;
    case '2S': return 2;
    case '8H': return 8;
    case '16B': return 16;
    case '2D': return 2;
    default: return 4;
  }
}

function readMem(st: AArch64State, addr: number): number {
  return (st.memory[addr >>> 0] ?? 0) | 0;
}

function writeMem(st: AArch64State, addr: number, val: number): void {
  st.memory[addr >>> 0] = val | 0;
}

export function execNeon64(st: AArch64State, instr: ParsedInstruction): string {
  const toks = instr.tokens;
  const n0 = (toks[0] || '').toUpperCase();

  switch (n0) {
    case 'DUP': {
      // DUP Vd.4S, Wn
      const vd = parseVR(toks[1]);
      if (!vd) throw new Error('DUP: bad dest');
      const rnTok = toks[2];
      const { idx: rnIdx } = parseXR(rnTok);
      const val = rnIdx >= 0 ? st.xregs[rnIdx] & 0xFFFFFFFF : 0;
      st.vregs[vd.idx].fill(val | 0);
      st.vregChg.add(vd.idx);
      return `V${vd.idx}=[${val},${val},${val},${val}]`;
    }

    case 'LD1': {
      // LD1 {Vd.4S}, [Xn]  or  LD1 {Vd.4S}, [Xn], #16
      const vdTok = toks[1]; // e.g. '{V2.4S}'
      const memTok = toks[2]; // e.g. '[X0]'
      const postTok = toks[3]; // '#16' for post-index

      const vd = parseVR(vdTok);
      if (!vd) throw new Error('LD1: bad dest');

      // Parse base register from [Xn]
      const inner = memTok.replace(/^\[/, '').replace(/\]$/, '');
      const { idx: baseIdx } = parseXR(inner);
      if (baseIdx < 0) throw new Error('LD1: bad base reg');

      const base = st.xregs[baseIdx] >>> 0;
      const count = laneCount(vd.arr);
      const lanes: number[] = [];
      for (let i = 0; i < count; i++) {
        lanes.push(readMem(st, (base + i * 4) >>> 0));
      }
      // Fill Int32Array with loaded lanes
      for (let i = 0; i < 4; i++) {
        st.vregs[vd.idx][i] = (lanes[i] ?? 0) | 0;
      }
      st.vregChg.add(vd.idx);

      if (postTok) {
        const off = postTok.startsWith('#') ? parseInt(postTok.slice(1), 10) : 0;
        if (!isNaN(off)) {
          st.xregs[baseIdx] = (st.xregs[baseIdx] + off) | 0;
          st.changed.add(baseIdx);
        }
      }
      return `V${vd.idx} loaded from 0x${base.toString(16).toUpperCase()}`;
    }

    case 'ST1': {
      // ST1 {Vs.4S}, [Xn]  or  ST1 {Vs.4S}, [Xn], #16
      const vsTok = toks[1];
      const memTok = toks[2];
      const postTok = toks[3];

      const vs = parseVR(vsTok);
      if (!vs) throw new Error('ST1: bad src');

      const inner = memTok.replace(/^\[/, '').replace(/\]$/, '');
      const { idx: baseIdx } = parseXR(inner);
      if (baseIdx < 0) throw new Error('ST1: bad base reg');

      const base = st.xregs[baseIdx] >>> 0;
      const count = laneCount(vs.arr);
      for (let i = 0; i < count; i++) {
        writeMem(st, (base + i * 4) >>> 0, st.vregs[vs.idx][i] ?? 0);
      }

      if (postTok) {
        const off = postTok.startsWith('#') ? parseInt(postTok.slice(1), 10) : 0;
        if (!isNaN(off)) {
          st.xregs[baseIdx] = (st.xregs[baseIdx] + off) | 0;
          st.changed.add(baseIdx);
        }
      }
      return `V${vs.idx} stored to 0x${base.toString(16).toUpperCase()}`;
    }

    case 'ADD': {
      const vd = parseVR(toks[1]), vn = parseVR(toks[2]), vm = parseVR(toks[3]);
      if (!vd || !vn || !vm) throw new Error('ADD(V): missing operands');
      for (let i = 0; i < 4; i++) {
        st.vregs[vd.idx][i] = (st.vregs[vn.idx][i] + st.vregs[vm.idx][i]) | 0;
      }
      st.vregChg.add(vd.idx);
      return `V${vd.idx}=V${vn.idx}+V${vm.idx}`;
    }

    case 'SUB': {
      const vd = parseVR(toks[1]), vn = parseVR(toks[2]), vm = parseVR(toks[3]);
      if (!vd || !vn || !vm) throw new Error('SUB(V): missing operands');
      for (let i = 0; i < 4; i++) {
        st.vregs[vd.idx][i] = (st.vregs[vn.idx][i] - st.vregs[vm.idx][i]) | 0;
      }
      st.vregChg.add(vd.idx);
      return `V${vd.idx}=V${vn.idx}-V${vm.idx}`;
    }

    case 'MUL': {
      const vd = parseVR(toks[1]), vn = parseVR(toks[2]), vm = parseVR(toks[3]);
      if (!vd || !vn || !vm) throw new Error('MUL(V): missing operands');
      for (let i = 0; i < 4; i++) {
        st.vregs[vd.idx][i] = Math.imul(st.vregs[vn.idx][i], st.vregs[vm.idx][i]);
      }
      st.vregChg.add(vd.idx);
      return `V${vd.idx}=V${vn.idx}*V${vm.idx}`;
    }

    case 'USHR': {
      // USHR Vd.4S, Vn.4S, #imm
      const vd = parseVR(toks[1]), vn = parseVR(toks[2]);
      const immTok = toks[3];
      if (!vd || !vn || !immTok) throw new Error('USHR: missing operands');
      const sh = immTok.startsWith('#') ? parseInt(immTok.slice(1), 10) : parseInt(immTok, 10);
      for (let i = 0; i < 4; i++) {
        st.vregs[vd.idx][i] = ((st.vregs[vn.idx][i] >>> 0) >>> sh) | 0;
      }
      st.vregChg.add(vd.idx);
      return `V${vd.idx}=V${vn.idx}>>>${sh}`;
    }

    case 'SSHR': {
      const vd = parseVR(toks[1]), vn = parseVR(toks[2]);
      const immTok = toks[3];
      if (!vd || !vn || !immTok) throw new Error('SSHR: missing operands');
      const sh = immTok.startsWith('#') ? parseInt(immTok.slice(1), 10) : parseInt(immTok, 10);
      for (let i = 0; i < 4; i++) {
        st.vregs[vd.idx][i] = (st.vregs[vn.idx][i] >> sh) | 0;
      }
      st.vregChg.add(vd.idx);
      return `V${vd.idx}=V${vn.idx}>>${sh}`;
    }

    case 'SHL': {
      const vd = parseVR(toks[1]), vn = parseVR(toks[2]);
      const immTok = toks[3];
      if (!vd || !vn || !immTok) throw new Error('SHL: missing operands');
      const sh = immTok.startsWith('#') ? parseInt(immTok.slice(1), 10) : parseInt(immTok, 10);
      for (let i = 0; i < 4; i++) {
        st.vregs[vd.idx][i] = (st.vregs[vn.idx][i] << sh) | 0;
      }
      st.vregChg.add(vd.idx);
      return `V${vd.idx}=V${vn.idx}<<${sh}`;
    }

    case 'AND': {
      const vd = parseVR(toks[1]), vn = parseVR(toks[2]), vm = parseVR(toks[3]);
      if (!vd || !vn || !vm) throw new Error('AND(V): missing operands');
      for (let i = 0; i < 4; i++) {
        st.vregs[vd.idx][i] = (st.vregs[vn.idx][i] & st.vregs[vm.idx][i]) | 0;
      }
      st.vregChg.add(vd.idx);
      return `V${vd.idx}=V${vn.idx}&V${vm.idx}`;
    }

    case 'ORR': {
      const vd = parseVR(toks[1]), vn = parseVR(toks[2]), vm = parseVR(toks[3]);
      if (!vd || !vn || !vm) throw new Error('ORR(V): missing operands');
      for (let i = 0; i < 4; i++) {
        st.vregs[vd.idx][i] = (st.vregs[vn.idx][i] | st.vregs[vm.idx][i]) | 0;
      }
      st.vregChg.add(vd.idx);
      return `V${vd.idx}=V${vn.idx}|V${vm.idx}`;
    }

    case 'EOR': {
      const vd = parseVR(toks[1]), vn = parseVR(toks[2]), vm = parseVR(toks[3]);
      if (!vd || !vn || !vm) throw new Error('EOR(V): missing operands');
      for (let i = 0; i < 4; i++) {
        st.vregs[vd.idx][i] = (st.vregs[vn.idx][i] ^ st.vregs[vm.idx][i]) | 0;
      }
      st.vregChg.add(vd.idx);
      return `V${vd.idx}=V${vn.idx}^V${vm.idx}`;
    }

    case 'MOV': {
      const vd = parseVR(toks[1]), vn = parseVR(toks[2]);
      if (!vd || !vn) throw new Error('MOV(V): missing operands');
      st.vregs[vd.idx].set(st.vregs[vn.idx]);
      st.vregChg.add(vd.idx);
      return `V${vd.idx}=V${vn.idx}`;
    }

    case 'NEG': {
      const vd = parseVR(toks[1]), vn = parseVR(toks[2]);
      if (!vd || !vn) throw new Error('NEG(V): missing operands');
      for (let i = 0; i < 4; i++) {
        st.vregs[vd.idx][i] = (-st.vregs[vn.idx][i]) | 0;
      }
      st.vregChg.add(vd.idx);
      return `V${vd.idx}=-V${vn.idx}`;
    }

    default:
      throw new Error(`Unknown AArch64 NEON instruction: ${n0}`);
  }
}
