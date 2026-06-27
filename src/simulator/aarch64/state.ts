import type { ParsedInstruction } from '../../types';

export interface AArch64State {
  xregs: number[];        // [0..31]: X0-X30 at 0-30, SP at 31
  vregs: Int32Array[];    // V0-V31, each Int32Array(4) = 128 bits
  pstate: { N: boolean; Z: boolean; C: boolean; V: boolean };
  memory: Record<number, number>;
  pc: number;
  cycles: number;
  instructions: ParsedInstruction[];
  labels: Record<string, number>;
  changed: Set<number>;
  vregChg: Set<number>;
  flagChg: Set<string>;
  timer: ReturnType<typeof setInterval> | null;
}

export function createAArch64State(): AArch64State {
  return {
    xregs: new Array(32).fill(0),
    vregs: Array.from({ length: 32 }, () => new Int32Array(4)),
    pstate: { N: false, Z: false, C: false, V: false },
    memory: {},
    pc: 0, cycles: 0,
    instructions: [], labels: {},
    changed: new Set(), vregChg: new Set(), flagChg: new Set(),
    timer: null,
  };
}

export function toS32_64(v: number): number { return v | 0; }
export function toU32_64(v: number): number { return v >>> 0; }
export function hex8_64(v: number): string {
  return (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
}
