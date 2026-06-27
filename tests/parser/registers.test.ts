import { describe, it, expect } from 'vitest';
import { parseReg, parseNR, rQ, memRn } from '../../src/parser/registers';

describe('parseReg', () => {
  it('parses R0–R15', () => {
    for (let i = 0; i <= 15; i++) expect(parseReg(`R${i}`)).toBe(i);
  });

  it('is case-insensitive', () => {
    expect(parseReg('r0')).toBe(0);
    expect(parseReg('R10')).toBe(10);
  });

  it('returns named aliases', () => {
    expect(parseReg('SP')).toBe(13);
    expect(parseReg('LR')).toBe(14);
    expect(parseReg('PC')).toBe(15);
    expect(parseReg('FP')).toBe(11);
  });

  it('returns -1 for invalid input', () => {
    expect(parseReg('R16')).toBe(-1);
    expect(parseReg('Q0')).toBe(-1);
    expect(parseReg('')).toBe(-1);
    expect(parseReg('foo')).toBe(-1);
  });
});

describe('parseNR', () => {
  it('parses Q registers', () => {
    expect(parseNR('Q0')).toEqual({ t: 'Q', i: 0 });
    expect(parseNR('Q15')).toEqual({ t: 'Q', i: 15 });
  });

  it('parses D registers', () => {
    expect(parseNR('D0')).toEqual({ t: 'D', i: 0 });
    expect(parseNR('D31')).toEqual({ t: 'D', i: 31 });
  });

  it('parses S registers', () => {
    expect(parseNR('S0')).toEqual({ t: 'S', i: 0 });
  });

  it('returns null for invalid', () => {
    expect(parseNR('')).toBeNull();
    expect(parseNR('R0')).toBeNull();
    expect(parseNR('Q16')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(parseNR('q0')).toEqual({ t: 'Q', i: 0 });
    expect(parseNR('d5')).toEqual({ t: 'D', i: 5 });
  });
});

describe('rQ', () => {
  it('returns Q index for Q register token', () => {
    expect(rQ('Q0')).toBe(0);
    expect(rQ('{Q2}')).toBe(2);
  });

  it('returns half D index for D register (D0→Q0, D2→Q1)', () => {
    expect(rQ('D0')).toBe(0);
    expect(rQ('D2')).toBe(1);
  });

  it('throws for invalid token', () => {
    expect(() => rQ('R0')).toThrow();
  });
});

describe('memRn', () => {
  it('extracts register number from [Rn]', () => {
    expect(memRn('[R0]')).toBe(0);
    expect(memRn('[R5, #4]')).toBe(5);
  });

  it('throws for bad operand', () => {
    expect(() => memRn('R0')).toThrow();
  });
});
