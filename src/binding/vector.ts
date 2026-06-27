import type { SimulatorState, ParsedSig, VecRow } from '../types';
import { toS32 } from '../simulator/state';

export const MEM_BASE = 0x10000;

export interface PtrInfo { addr: number; count: number; elemSize: number }

function parseArr(str: string | undefined): number[] {
  if (str === undefined || str === null) return [];
  const s = String(str).trim();
  const inner = s.startsWith('[') ? s.slice(1, s.lastIndexOf(']')) : s;
  return inner.split(',').map(x => { const n = parseFloat(x.trim()); return isNaN(n) ? 0 : n; });
}

export function applyVector(
  st: SimulatorState,
  parsed: ParsedSig,
  vector: VecRow,
): Record<string, PtrInfo> {
  let rIdx = 0;
  let memPtr = MEM_BASE;
  const ptrs: Record<string, PtrInfo> = {};

  parsed.params.forEach(p => {
    const raw = vector[p.name];
    const k   = p.kind;

    if (k.base === 'scalar') {
      st.regs[rIdx++] = (parseInt(raw ?? '0') || 0) | 0;

    } else if (k.base === 'scalar64') {
      if (rIdx & 1) rIdx++;
      const v = parseInt(raw ?? '0') || 0;
      st.regs[rIdx++] = v & 0xFFFFFFFF;
      st.regs[rIdx++] = Math.floor(v / 2 ** 32) | 0;

    } else if (k.base === 'float') {
      const f   = parseFloat(raw ?? '0') || 0;
      const buf = new Float32Array([f]);
      st.regs[rIdx++] = new Int32Array(buf.buffer)[0];

    } else if (k.base === 'ptr') {
      const arr = parseArr(raw);
      const es  = k.elemSize ?? 4;
      ptrs[p.name] = { addr: memPtr, count: arr.length, elemSize: es };
      arr.forEach((v, i) => {
        const a = (memPtr + i * es) >>> 0;
        if (es === 4)      st.memory[a] = v | 0;
        else if (es === 2) st.memory[a] = v & 0xFFFF;
        else               st.memory[a] = v & 0xFF;
      });
      st.regs[rIdx++] = memPtr;
      memPtr += Math.max(arr.length, 1) * es;
    }
  });

  return ptrs;
}

export function readReturn(st: SimulatorState, returnType: string): number | null {
  if (!returnType || returnType === 'void') return null;
  if (returnType === 'float') {
    const b = new Int32Array([st.regs[0]]);
    return new Float32Array(b.buffer)[0];
  }
  if (returnType === 'int64_t' || returnType === 'uint64_t') {
    return st.regs[0] + (st.regs[1] >>> 0) * 2 ** 32;
  }
  return toS32(st.regs[0]);
}

export function readOutputPtrs(
  st: SimulatorState,
  parsed: ParsedSig,
  ptrs: Record<string, PtrInfo>,
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  parsed.params.forEach(p => {
    if (p.kind.base === 'ptr' && ptrs[p.name]) {
      const { addr, count, elemSize } = ptrs[p.name];
      out[p.name] = Array.from({ length: count }, (_, i) => st.memory[(addr + i * elemSize) >>> 0] ?? 0);
    }
  });
  return out;
}

/** Apply a vector using the Unicorn engine's register write API */
export function applyVecToUnicorn(
  mu: { reg_write_i32: (reg: number, val: number) => void; mem_write: (addr: number, buf: Uint8Array) => void },
  uc: Record<string, number>,
  parsed: ParsedSig,
  vectorObj: VecRow,
): Record<string, PtrInfo> {
  const MEM_DATA = 0x100000;
  let rIdx = 0;
  let memPtr = MEM_DATA;
  const ptrs: Record<string, PtrInfo> = {};

  parsed.params.forEach(p => {
    const raw = vectorObj[p.name];
    const k   = p.kind;

    if (k.base === 'scalar') {
      mu.reg_write_i32(uc[`ARM_REG_R${rIdx++}`], (parseInt(raw ?? '0') || 0) | 0);

    } else if (k.base === 'scalar64') {
      if (rIdx & 1) rIdx++;
      const v = parseInt(raw ?? '0') || 0;
      mu.reg_write_i32(uc[`ARM_REG_R${rIdx++}`], v & 0xFFFFFFFF);
      mu.reg_write_i32(uc[`ARM_REG_R${rIdx++}`], Math.floor(v / 2 ** 32) | 0);

    } else if (k.base === 'float') {
      const f = parseFloat(raw ?? '0') || 0;
      mu.reg_write_i32(uc[`ARM_REG_R${rIdx++}`], new Int32Array(new Float32Array([f]).buffer)[0]);

    } else if (k.base === 'ptr') {
      const arr = parseArr(raw);
      const es  = k.elemSize ?? 4;
      ptrs[p.name] = { addr: memPtr, count: arr.length, elemSize: es };
      const buf = new Uint8Array(Math.max(arr.length, 1) * es);
      const view = new DataView(buf.buffer);
      arr.forEach((v, i) => view.setInt32(i * es, v | 0, true));
      mu.mem_write(memPtr, buf);
      mu.reg_write_i32(uc[`ARM_REG_R${rIdx++}`], memPtr);
      memPtr += buf.length;
    }
  });

  return ptrs;
}
