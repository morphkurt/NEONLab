import { describe, it, expect } from 'vitest';
import { applyVector, readReturn, readOutputPtrs, MEM_BASE } from '../../src/binding/vector';
import { createState } from '../../src/simulator/state';
import { parseSig } from '../../src/parser/signature';

describe('applyVector — scalar params', () => {
  it('loads scalar params into R0, R1, ...', () => {
    const s = createState();
    const parsed = parseSig('int32_t add(int32_t a, int32_t b)')!;
    applyVector(s, parsed, { a: '3', b: '7', expected: '' });
    expect(s.regs[0]).toBe(3);
    expect(s.regs[1]).toBe(7);
  });

  it('handles negative scalar values', () => {
    const s = createState();
    const parsed = parseSig('int32_t sub(int32_t a, int32_t b)')!;
    applyVector(s, parsed, { a: '-5', b: '3', expected: '' });
    expect(s.regs[0]).toBe(-5);
    expect(s.regs[1]).toBe(3);
  });
});

describe('applyVector — pointer params', () => {
  it('writes array to memory and loads base address into register', () => {
    const s = createState();
    const parsed = parseSig('void fill(int32_t* dst, int32_t n)')!;
    const ptrs = applyVector(s, parsed, { dst: '[10, 20, 30]', n: '3', expected: '' });

    expect(s.regs[0]).toBe(MEM_BASE);
    expect(ptrs['dst']).toMatchObject({ addr: MEM_BASE, count: 3, elemSize: 4 });
    expect(s.memory[MEM_BASE]).toBe(10);
    expect(s.memory[MEM_BASE + 4]).toBe(20);
    expect(s.memory[MEM_BASE + 8]).toBe(30);
  });

  it('places second ptr after first in memory', () => {
    const s = createState();
    const parsed = parseSig('void copy(int32_t* dst, int32_t* src, int32_t n)')!;
    const ptrs = applyVector(s, parsed, { dst: '[0, 0, 0, 0]', src: '[1, 2, 3, 4]', n: '4', expected: '' });

    const dstAddr = ptrs['dst'].addr;
    const srcAddr = ptrs['src'].addr;
    expect(srcAddr).toBeGreaterThan(dstAddr);
    expect(s.regs[0]).toBe(dstAddr);
    expect(s.regs[1]).toBe(srcAddr);
  });

  it('respects elemSize for uint8_t*', () => {
    const s = createState();
    const parsed = parseSig('void fill8(uint8_t* buf, int32_t n)')!;
    const ptrs = applyVector(s, parsed, { buf: '[1, 2, 3]', n: '3', expected: '' });
    expect(ptrs['buf'].elemSize).toBe(1);
  });
});

describe('readReturn', () => {
  it('returns null for void return type', () => {
    const s = createState();
    expect(readReturn(s, 'void')).toBeNull();
  });

  it('reads signed int32 from R0', () => {
    const s = createState();
    s.regs[0] = -1;
    expect(readReturn(s, 'int32_t')).toBe(-1);
  });

  it('reads unsigned value as signed int32', () => {
    const s = createState();
    s.regs[0] = 42;
    expect(readReturn(s, 'int32_t')).toBe(42);
  });
});

describe('readOutputPtrs', () => {
  it('reads back modified memory for a pointer param', () => {
    const s = createState();
    const parsed = parseSig('void fill(int32_t* dst, int32_t n)')!;
    const ptrs = applyVector(s, parsed, { dst: '[0, 0, 0]', n: '3', expected: '' });

    // Simulate the function writing to dst
    s.memory[ptrs['dst'].addr]      = 100;
    s.memory[ptrs['dst'].addr + 4]  = 200;
    s.memory[ptrs['dst'].addr + 8]  = 300;

    const out = readOutputPtrs(s, parsed, ptrs);
    expect(out['dst']).toEqual([100, 200, 300]);
  });

  it('returns empty record when there are no ptr params', () => {
    const s = createState();
    const parsed = parseSig('int32_t square(int32_t x)')!;
    const ptrs = applyVector(s, parsed, { x: '5', expected: '' });
    const out = readOutputPtrs(s, parsed, ptrs);
    expect(Object.keys(out)).toHaveLength(0);
  });

  it('full round-trip with alpha blend scenario', () => {
    const s = createState();
    const parsed = parseSig('int32_t alpha_blend_row(int32_t* dst, int32_t* src, int32_t alpha, int32_t n)')!;
    const vec = { dst: '[200, 100, 50, 255]', src: '[0, 200, 100, 0]', alpha: '128', n: '4', expected: '' };
    const ptrs = applyVector(s, parsed, vec);

    expect(s.regs[0]).toBe(ptrs['dst'].addr);
    expect(s.regs[1]).toBe(ptrs['src'].addr);
    expect(s.regs[2]).toBe(128);
    expect(s.regs[3]).toBe(4);
    expect(ptrs['dst'].count).toBe(4);
    expect(ptrs['src'].count).toBe(4);
  });
});
