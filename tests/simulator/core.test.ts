import { describe, it, expect } from 'vitest';
import { firstPass, execInstr } from '../../src/simulator/core';
import { createState } from '../../src/simulator/state';

describe('firstPass', () => {
  it('strips comments and builds instructions', () => {
    const s = createState();
    firstPass(['MOV R0, #1  // comment', 'ADD R0, R0, #2'], s);
    expect(s.instructions).toHaveLength(2);
    expect(s.instructions[0].tokens[0]).toBe('MOV');
    expect(s.instructions[1].tokens[0]).toBe('ADD');
  });

  it('parses standalone label', () => {
    const s = createState();
    firstPass(['loop:', 'ADD R0, R0, #1'], s);
    expect(s.labels['LOOP']).toBe(0);
    expect(s.instructions).toHaveLength(1);
  });

  it('parses inline label', () => {
    const s = createState();
    firstPass(['loop: ADD R0, R0, #1'], s);
    expect(s.labels['LOOP']).toBe(0);
    expect(s.instructions).toHaveLength(1);
  });

  it('skips blank lines', () => {
    const s = createState();
    firstPass(['', '  ', 'MOV R0, #1', ''], s);
    expect(s.instructions).toHaveLength(1);
  });

  it('records correct lineNum', () => {
    const s = createState();
    firstPass(['MOV R0, #1', 'ADD R1, R0, #2'], s);
    expect(s.instructions[0].lineNum).toBe(1);
    expect(s.instructions[1].lineNum).toBe(2);
  });

  it('handles semicolon comments', () => {
    const s = createState();
    firstPass(['MOV R0, #5 ; set R0'], s);
    expect(s.instructions).toHaveLength(1);
    expect(s.instructions[0].tokens[2]).toBe('#5');
  });
});

describe('execInstr — branch', () => {
  it('B branches to label', () => {
    const s = createState();
    firstPass(['MOV R0, #0', 'done:', 'MOV R1, #1'], s);
    s.pc = 0;
    // manually set pc past first instr, then branch
    s.pc = 1;
    execInstr(s, s.instructions[0]); // MOV R0, #0
    // set up for branch to 'done' (label idx 1)
    const brInstr = { raw: 'B done', lineNum: 99, tokens: ['B', 'DONE'] };
    execInstr(s, brInstr);
    expect(s.pc).toBe(1); // label DONE = instruction index 1
  });

  it('BLT branches when N != V', () => {
    const s = createState();
    firstPass(['loop:', 'ADD R0, R0, #1'], s);
    s.cpsr.N = true; s.cpsr.V = false;
    const brInstr = { raw: 'BLT loop', lineNum: 1, tokens: ['BLT', 'LOOP'] };
    execInstr(s, brInstr);
    expect(s.pc).toBe(0);
  });

  it('BLT not taken when condition false', () => {
    const s = createState();
    firstPass(['loop:', 'ADD R0, R0, #1'], s);
    s.pc = 1;
    s.cpsr.N = false; s.cpsr.V = false;
    const brInstr = { raw: 'BLT loop', lineNum: 1, tokens: ['BLT', 'LOOP'] };
    execInstr(s, brInstr);
    expect(s.pc).toBe(1); // unchanged
  });

  it('throws on unknown label', () => {
    const s = createState();
    firstPass(['MOV R0, #0'], s);
    const brInstr = { raw: 'B nosuchlabel', lineNum: 1, tokens: ['B', 'NOSUCHLABEL'] };
    expect(() => execInstr(s, brInstr)).toThrow();
  });
});

describe('integration — simple loop', () => {
  it('sums 1..5 using a BLT loop', () => {
    // R0 = 0 (accumulator), R1 = 1 (counter), R2 = 5 (limit)
    const code = [
      'MOV R0, #0',
      'MOV R1, #1',
      'MOV R2, #5',
      'loop:',
      '  ADD R0, R0, R1',
      '  ADD R1, R1, #1',
      '  CMP R1, R2',
      '  BLE loop',
    ];
    const s = createState();
    firstPass(code, s);
    s.pc = 0;
    let guard = 0;
    while (s.pc < s.instructions.length && guard++ < 1000) {
      const instr = s.instructions[s.pc];
      if (!instr) break;
      s.pc++;
      execInstr(s, instr);
      s.regs[15] = s.pc;
    }
    // 1+2+3+4+5 = 15
    expect(s.regs[0]).toBe(15);
  });
});
