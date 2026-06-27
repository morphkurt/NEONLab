import type { SimulatorState } from '../types';
import { createAArch64State } from './aarch64/state';
export type { AArch64State } from './aarch64/state';

export const toU32 = (v: number): number => v >>> 0;
export const toS32 = (v: number): number => v | 0;
export const hex8  = (v: number): string => '0x' + toU32(v).toString(16).toUpperCase().padStart(8, '0');

export function createState(): SimulatorState {
  return {
    regs: new Array(16).fill(0) as number[],
    cpsr: { N: false, Z: false, C: false, V: false },
    neon: Array.from({ length: 16 }, () => new Int32Array(4)),
    memory: {},
    labels: {},
    instructions: [],
    pc: 0,
    cycles: 0,
    timer: null,
    changed: new Set<number>(),
    neonChg: new Set<number>(),
    flagChg: new Set<string>(),
  };
}

/** The live simulator instances used by the app. */
export const S: { scalar: SimulatorState; neon: SimulatorState; aarch64: ReturnType<typeof createAArch64State> } = {
  scalar: createState(),
  neon:   createState(),
  aarch64: createAArch64State(),
};
