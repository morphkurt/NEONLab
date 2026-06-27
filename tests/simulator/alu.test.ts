import { describe, it, expect } from 'vitest';
import { execALU } from '../../src/simulator/alu';
import { createState } from '../../src/simulator/state';

function makeInstr(raw: string) {
  const tokens = raw.toUpperCase().split(/[\s,]+/).filter(Boolean);
  return { raw, lineNum: 1, tokens };
}

function st() {
  return createState();
}

describe('MOV', () => {
  it('moves an immediate into Rd', () => {
    const s = st();
    execALU(s, makeInstr('MOV R0, #42'));
    expect(s.regs[0]).toBe(42);
    expect(s.changed.has(0)).toBe(true);
  });

  it('moves a register value', () => {
    const s = st();
    s.regs[1] = 99;
    execALU(s, makeInstr('MOV R0, R1'));
    expect(s.regs[0]).toBe(99);
  });

  it('MOVS sets Z flag when result is 0', () => {
    const s = st();
    execALU(s, makeInstr('MOVS R0, #0'));
    expect(s.cpsr.Z).toBe(true);
    expect(s.cpsr.N).toBe(false);
  });

  it('conditional MOVEQ not taken when Z clear', () => {
    const s = st();
    s.regs[0] = 5;
    execALU(s, makeInstr('MOVEQ R0, #99'));
    expect(s.regs[0]).toBe(5);
  });

  it('conditional MOVNE taken when Z clear', () => {
    const s = st();
    execALU(s, makeInstr('MOVNE R0, #7'));
    expect(s.regs[0]).toBe(7);
  });
});

describe('ADD / ADDS', () => {
  it('adds immediate to register', () => {
    const s = st();
    s.regs[1] = 10;
    execALU(s, makeInstr('ADD R0, R1, #5'));
    expect(s.regs[0]).toBe(15);
  });

  it('two-operand form: ADD R0, #5 uses R0 as Rn', () => {
    const s = st();
    s.regs[0] = 3;
    execALU(s, makeInstr('ADD R0, #5'));
    expect(s.regs[0]).toBe(8);
  });

  it('ADDS sets C flag on overflow', () => {
    const s = st();
    s.regs[0] = 0xFFFFFFFF;
    execALU(s, makeInstr('ADDS R0, R0, #1'));
    expect(s.cpsr.C).toBe(true);
    expect(s.cpsr.Z).toBe(true);
  });
});

describe('SUB / SUBS', () => {
  it('subtracts immediate', () => {
    const s = st();
    s.regs[1] = 10;
    execALU(s, makeInstr('SUB R0, R1, #3'));
    expect(s.regs[0]).toBe(7);
  });

  it('SUBS sets Z flag when result is 0', () => {
    const s = st();
    s.regs[0] = 5;
    execALU(s, makeInstr('SUBS R0, R0, #5'));
    expect(s.cpsr.Z).toBe(true);
  });

  it('SUBS sets N flag when result is negative', () => {
    const s = st();
    s.regs[0] = 3;
    execALU(s, makeInstr('SUBS R0, R0, #5'));
    expect(s.cpsr.N).toBe(true);
  });
});

describe('RSB', () => {
  it('computes b - a (reverse subtract)', () => {
    const s = st();
    s.regs[1] = 3;
    execALU(s, makeInstr('RSB R0, R1, #10'));
    expect(s.regs[0]).toBe(7);
  });

  it('RSB R, R, #256 computes 256 - R', () => {
    const s = st();
    s.regs[2] = 128;
    execALU(s, makeInstr('RSB R4, R2, #256'));
    expect(s.regs[4]).toBe(128);
  });
});

describe('MUL', () => {
  it('multiplies two registers', () => {
    const s = st();
    s.regs[1] = 6;
    s.regs[2] = 7;
    execALU(s, makeInstr('MUL R0, R1, R2'));
    expect(s.regs[0]).toBe(42);
  });

  it('handles signed multiplication', () => {
    const s = st();
    s.regs[1] = -3;
    s.regs[2] = 4;
    execALU(s, makeInstr('MUL R0, R1, R2'));
    expect(s.regs[0]).toBe(-12);
  });
});

describe('LSR', () => {
  it('logical shifts right by immediate', () => {
    const s = st();
    s.regs[1] = 0xFF;
    execALU(s, makeInstr('LSR R0, R1, #4'));
    expect(s.regs[0]).toBe(0x0F);
  });

  it('does not sign-extend', () => {
    const s = st();
    s.regs[1] = -1; // 0xFFFFFFFF
    execALU(s, makeInstr('LSR R0, R1, #1'));
    expect(s.regs[0] >>> 0).toBe(0x7FFFFFFF);
  });
});

describe('LSL', () => {
  it('logical shifts left by immediate', () => {
    const s = st();
    s.regs[1] = 1;
    execALU(s, makeInstr('LSL R0, R1, #3'));
    expect(s.regs[0]).toBe(8);
  });
});

describe('CMP', () => {
  it('sets Z when values equal', () => {
    const s = st();
    s.regs[0] = 5;
    execALU(s, makeInstr('CMP R0, #5'));
    expect(s.cpsr.Z).toBe(true);
    expect(s.cpsr.N).toBe(false);
  });

  it('sets N when reg < immediate', () => {
    const s = st();
    s.regs[0] = 3;
    execALU(s, makeInstr('CMP R0, #5'));
    expect(s.cpsr.N).toBe(true);
    expect(s.cpsr.Z).toBe(false);
  });

  it('sets C when reg >= immediate (unsigned borrow)', () => {
    const s = st();
    s.regs[0] = 10;
    execALU(s, makeInstr('CMP R0, #5'));
    expect(s.cpsr.C).toBe(true);
  });
});

describe('AND / ORR / EOR / BIC', () => {
  it('AND masks bits', () => {
    const s = st();
    s.regs[1] = 0xFF;
    execALU(s, makeInstr('AND R0, R1, #0x0F'));
    expect(s.regs[0]).toBe(0x0F);
  });

  it('ORR sets bits', () => {
    const s = st();
    s.regs[1] = 0xF0;
    execALU(s, makeInstr('ORR R0, R1, #0x0F'));
    expect(s.regs[0]).toBe(0xFF);
  });

  it('EOR toggles bits', () => {
    const s = st();
    s.regs[1] = 0xFF;
    execALU(s, makeInstr('EOR R0, R1, #0x0F'));
    expect(s.regs[0]).toBe(0xF0);
  });

  it('BIC clears bits', () => {
    const s = st();
    s.regs[1] = 0xFF;
    execALU(s, makeInstr('BIC R0, R1, #0x0F'));
    expect(s.regs[0]).toBe(0xF0);
  });
});

describe('NOP', () => {
  it('does nothing', () => {
    const s = st();
    const before = [...s.regs];
    execALU(s, makeInstr('NOP'));
    expect(s.regs).toEqual(before);
    expect(s.changed.size).toBe(0);
  });
});

describe('unknown instruction', () => {
  it('throws for unknown mnemonic', () => {
    const s = st();
    expect(() => execALU(s, makeInstr('FOOBAR R0'))).toThrow();
  });
});
