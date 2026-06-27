import { describe, it, expect } from 'vitest';
import { execNeon, qGetU32, qSetU32, qGetLanes, qSetLanes } from '../../src/simulator/neon';
import { createState } from '../../src/simulator/state';

function makeInstr(raw: string) {
  const upper = raw.toUpperCase();
  // preserve bracket groups for memory operands
  const mm = upper.match(/\[([^\]]+)\]/);
  let prep = upper;
  if (mm) prep = upper.replace(/\[([^\]]+)\]/, '__MEM__');
  const tokens = prep.split(/[\s,]+/).filter(Boolean);
  if (mm) {
    const mi = tokens.indexOf('__MEM__');
    if (mi >= 0) tokens[mi] = '[' + mm[1] + ']';
  }
  return { raw, lineNum: 1, tokens };
}

function st() {
  return createState();
}

// ── Q-register helpers ──────────────────────────────────────────────────────

describe('qGetU32 / qSetU32', () => {
  it('round-trips unsigned values', () => {
    const s = st();
    qSetU32(s.neon, 0, [1, 2, 3, 4]);
    expect(qGetU32(s.neon, 0)).toEqual([1, 2, 3, 4]);
  });

  it('treats values as unsigned (negative int → large uint)', () => {
    const s = st();
    qSetU32(s.neon, 0, [-1, 0, 0, 0]);
    expect(qGetU32(s.neon, 0)[0]).toBe(0xFFFFFFFF);
  });
});

describe('qGetLanes / qSetLanes', () => {
  it('32-bit lane round-trip', () => {
    const s = st();
    qSetLanes(s.neon, 0, 32, [10, 20, 30, 40]);
    expect(qGetLanes(s.neon, 0, 32)).toEqual([10, 20, 30, 40]);
  });

  it('16-bit lanes pack into 32-bit words', () => {
    const s = st();
    // 8 x 16-bit lanes
    qSetLanes(s.neon, 0, 16, [1, 2, 3, 4, 5, 6, 7, 8]);
    const lanes = qGetLanes(s.neon, 0, 16);
    expect(lanes).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

// ── NEON instructions ───────────────────────────────────────────────────────

describe('VDUP', () => {
  it('VDUP.32 broadcasts a GP register to all 4 lanes of a Q register', () => {
    const s = st();
    s.regs[2] = 128;
    execNeon(s, makeInstr('VDUP.32 Q0, R2'));
    expect(qGetU32(s.neon, 0)).toEqual([128, 128, 128, 128]);
    expect(s.neonChg.has(0)).toBe(true);
  });
});

describe('VADD', () => {
  it('VADD.I32 adds four lanes element-wise', () => {
    const s = st();
    qSetU32(s.neon, 0, [1, 2, 3, 4]);
    qSetU32(s.neon, 1, [10, 20, 30, 40]);
    execNeon(s, makeInstr('VADD.I32 Q2, Q0, Q1'));
    expect(qGetU32(s.neon, 2)).toEqual([11, 22, 33, 44]);
  });
});

describe('VSUB', () => {
  it('VSUB.I32 subtracts element-wise', () => {
    const s = st();
    qSetU32(s.neon, 0, [10, 20, 30, 40]);
    qSetU32(s.neon, 1, [1, 2, 3, 4]);
    execNeon(s, makeInstr('VSUB.I32 Q2, Q0, Q1'));
    expect(qGetU32(s.neon, 2)).toEqual([9, 18, 27, 36]);
  });
});

describe('VMUL', () => {
  it('VMUL.I32 multiplies element-wise', () => {
    const s = st();
    qSetU32(s.neon, 0, [2, 3, 4, 5]);
    qSetU32(s.neon, 1, [10, 10, 10, 10]);
    execNeon(s, makeInstr('VMUL.I32 Q2, Q0, Q1'));
    expect(qGetU32(s.neon, 2)).toEqual([20, 30, 40, 50]);
  });
});

describe('VSHR', () => {
  it('VSHR.U32 shifts right by immediate', () => {
    const s = st();
    qSetU32(s.neon, 0, [256, 512, 1024, 2048]);
    execNeon(s, makeInstr('VSHR.U32 Q1, Q0, #8'));
    expect(qGetU32(s.neon, 1)).toEqual([1, 2, 4, 8]);
  });
});

describe('VSHL', () => {
  it('VSHL.I32 shifts left by immediate', () => {
    const s = st();
    qSetU32(s.neon, 0, [1, 2, 3, 4]);
    execNeon(s, makeInstr('VSHL.I32 Q1, Q0, #2'));
    expect(qGetU32(s.neon, 1)).toEqual([4, 8, 12, 16]);
  });
});

describe('VLD1 / VST1', () => {
  it('VLD1.32 loads 4 words from memory into Q register', () => {
    const s = st();
    const base = 0x1000;
    s.memory[base]      = 10;
    s.memory[base + 4]  = 20;
    s.memory[base + 8]  = 30;
    s.memory[base + 12] = 40;
    s.regs[0] = base;
    execNeon(s, makeInstr('VLD1.32 {Q0}, [R0]'));
    expect(qGetU32(s.neon, 0)).toEqual([10, 20, 30, 40]);
  });

  it('VST1.32 stores 4 words from Q register to memory', () => {
    const s = st();
    qSetU32(s.neon, 0, [5, 6, 7, 8]);
    const base = 0x2000;
    s.regs[0] = base;
    execNeon(s, makeInstr('VST1.32 {Q0}, [R0]'));
    expect(s.memory[base]).toBe(5);
    expect(s.memory[base + 4]).toBe(6);
    expect(s.memory[base + 8]).toBe(7);
    expect(s.memory[base + 12]).toBe(8);
  });
});

describe('VMOV', () => {
  it('VMOV copies one Q register to another', () => {
    const s = st();
    qSetU32(s.neon, 0, [1, 2, 3, 4]);
    execNeon(s, makeInstr('VMOV Q1, Q0'));
    expect(qGetU32(s.neon, 1)).toEqual([1, 2, 3, 4]);
  });
});

describe('VAND / VORR / VEOR', () => {
  it('VAND performs bitwise AND', () => {
    const s = st();
    qSetU32(s.neon, 0, [0xFF, 0xFF, 0xFF, 0xFF]);
    qSetU32(s.neon, 1, [0x0F, 0x0F, 0x0F, 0x0F]);
    execNeon(s, makeInstr('VAND Q2, Q0, Q1'));
    expect(qGetU32(s.neon, 2)).toEqual([0x0F, 0x0F, 0x0F, 0x0F]);
  });

  it('VORR performs bitwise OR', () => {
    const s = st();
    qSetU32(s.neon, 0, [0xF0, 0xF0, 0xF0, 0xF0]);
    qSetU32(s.neon, 1, [0x0F, 0x0F, 0x0F, 0x0F]);
    execNeon(s, makeInstr('VORR Q2, Q0, Q1'));
    expect(qGetU32(s.neon, 2)).toEqual([0xFF, 0xFF, 0xFF, 0xFF]);
  });

  it('VEOR performs bitwise XOR', () => {
    const s = st();
    qSetU32(s.neon, 0, [0xFF, 0xFF, 0xFF, 0xFF]);
    qSetU32(s.neon, 1, [0x0F, 0x0F, 0x0F, 0x0F]);
    execNeon(s, makeInstr('VEOR Q2, Q0, Q1'));
    expect(qGetU32(s.neon, 2)).toEqual([0xF0, 0xF0, 0xF0, 0xF0]);
  });
});
