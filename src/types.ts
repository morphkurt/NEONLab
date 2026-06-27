export interface CpsrFlags { N: boolean; Z: boolean; C: boolean; V: boolean }

export interface SimulatorState {
  regs: number[];
  cpsr: CpsrFlags;
  neon: Int32Array[];           // Q0-Q15, each [lane0,lane1,lane2,lane3]
  memory: Record<number, number>;
  pc: number;
  cycles: number;
  instructions: ParsedInstruction[];
  labels: Record<string, number>;
  changed: Set<number>;
  neonChg: Set<number>;
  flagChg: Set<string>;
  timer: ReturnType<typeof setInterval> | null;
}

export interface ParsedInstruction {
  lineNum: number;
  raw: string;
  tokens: string[];
}

export interface ParamKind {
  base: 'scalar' | 'scalar64' | 'float' | 'ptr';
  elemType?: string;
  elemSize?: number;
}

export interface Param { name: string; type: string; kind: ParamKind }
export interface ParsedSig { returnType: string; name: string; params: Param[] }

export interface VecRow extends Record<string, string> { expected: string }

export interface VecSideResult {
  retVal: number | null;
  outPtrs: Record<string, number[]>;
  error?: string;
}

export interface VecResult {
  scalar: VecSideResult | null;
  neon:   VecSideResult | null;
  engine: 'js' | 'qemu';
}

export interface Fn {
  id: number;
  sig: string;
  parsed: ParsedSig | null;
  scalarCode: string;
  neonCode: string;
  vectors: VecRow[];
  results: (VecResult | null)[];
  labels: { regs: Record<number, string>; lanes: Record<string, string> };
}

export interface InstrInfo {
  name: string;
  desc: string;
  syn: string;
  note?: string;
}
