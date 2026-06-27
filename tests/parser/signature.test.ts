import { describe, it, expect } from 'vitest';
import { parseSig, inferKind } from '../../src/parser/signature';

describe('inferKind', () => {
  it('returns scalar for int32_t', () => {
    expect(inferKind('int32_t')).toEqual({ base: 'scalar' });
  });

  it('returns ptr for int32_t*', () => {
    expect(inferKind('int32_t*')).toEqual({ base: 'ptr', elemType: 'int32_t', elemSize: 4 });
  });

  it('returns scalar64 for int64_t', () => {
    expect(inferKind('int64_t')).toEqual({ base: 'scalar64' });
  });

  it('returns float for float', () => {
    expect(inferKind('float')).toEqual({ base: 'float' });
  });

  it('returns float for double', () => {
    expect(inferKind('double')).toEqual({ base: 'float' });
  });

  it('returns ptr with correct elemSize for uint8_t*', () => {
    expect(inferKind('uint8_t*')).toEqual({ base: 'ptr', elemType: 'uint8_t', elemSize: 1 });
  });
});

describe('parseSig', () => {
  it('returns null for empty string', () => {
    expect(parseSig('')).toBeNull();
  });

  it('returns null for invalid signature', () => {
    expect(parseSig('not a signature')).toBeNull();
  });

  it('parses a simple void function', () => {
    const r = parseSig('void foo()');
    expect(r).not.toBeNull();
    expect(r!.returnType).toBe('void');
    expect(r!.name).toBe('foo');
    expect(r!.params).toHaveLength(0);
  });

  it('parses scalar params', () => {
    const r = parseSig('int32_t add(int32_t a, int32_t b)');
    expect(r).not.toBeNull();
    expect(r!.returnType).toBe('int32_t');
    expect(r!.name).toBe('add');
    expect(r!.params).toHaveLength(2);
    expect(r!.params[0]).toMatchObject({ name: 'a', kind: { base: 'scalar' } });
    expect(r!.params[1]).toMatchObject({ name: 'b', kind: { base: 'scalar' } });
  });

  it('parses pointer params', () => {
    const r = parseSig('int32_t alpha_blend_row(int32_t* dst, int32_t* src, int32_t alpha, int32_t n)');
    expect(r).not.toBeNull();
    expect(r!.params).toHaveLength(4);
    expect(r!.params[0]).toMatchObject({ name: 'dst', kind: { base: 'ptr', elemSize: 4 } });
    expect(r!.params[1]).toMatchObject({ name: 'src', kind: { base: 'ptr', elemSize: 4 } });
    expect(r!.params[2]).toMatchObject({ name: 'alpha', kind: { base: 'scalar' } });
    expect(r!.params[3]).toMatchObject({ name: 'n', kind: { base: 'scalar' } });
  });

  it('parses uint8_t* pointer with elemSize 1', () => {
    const r = parseSig('void copy(uint8_t* out, uint8_t* in, int32_t n)');
    expect(r!.params[0]).toMatchObject({ kind: { base: 'ptr', elemSize: 1 } });
  });
});
