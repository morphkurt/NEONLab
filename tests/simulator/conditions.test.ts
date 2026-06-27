import { describe, it, expect } from 'vitest';
import { evalCondition } from '../../src/simulator/conditions';

const F = { N: false, Z: false, C: false, V: false };
const flags = (overrides: Partial<typeof F>) => ({ ...F, ...overrides });

describe('evalCondition', () => {
  it('AL and empty string always true', () => {
    expect(evalCondition('AL', F)).toBe(true);
    expect(evalCondition('', F)).toBe(true);
  });

  it('EQ: Z set', () => {
    expect(evalCondition('EQ', flags({ Z: true }))).toBe(true);
    expect(evalCondition('EQ', F)).toBe(false);
  });

  it('NE: Z clear', () => {
    expect(evalCondition('NE', F)).toBe(true);
    expect(evalCondition('NE', flags({ Z: true }))).toBe(false);
  });

  it('LT: N != V', () => {
    expect(evalCondition('LT', flags({ N: true, V: false }))).toBe(true);
    expect(evalCondition('LT', flags({ N: false, V: false }))).toBe(false);
  });

  it('LE: Z or N != V', () => {
    expect(evalCondition('LE', flags({ Z: true }))).toBe(true);
    expect(evalCondition('LE', flags({ N: true }))).toBe(true);
    expect(evalCondition('LE', F)).toBe(false);
  });

  it('GT: !Z and N == V', () => {
    expect(evalCondition('GT', flags({ Z: false, N: false, V: false }))).toBe(true);
    expect(evalCondition('GT', flags({ Z: true }))).toBe(false);
    expect(evalCondition('GT', flags({ N: true, V: false }))).toBe(false);
  });

  it('GE: N == V', () => {
    expect(evalCondition('GE', F)).toBe(true);
    expect(evalCondition('GE', flags({ N: true, V: true }))).toBe(true);
    expect(evalCondition('GE', flags({ N: true, V: false }))).toBe(false);
  });

  it('CS/HS: C set', () => {
    expect(evalCondition('CS', flags({ C: true }))).toBe(true);
    expect(evalCondition('HS', flags({ C: true }))).toBe(true);
    expect(evalCondition('CS', F)).toBe(false);
  });

  it('CC/LO: C clear', () => {
    expect(evalCondition('CC', F)).toBe(true);
    expect(evalCondition('LO', F)).toBe(true);
    expect(evalCondition('CC', flags({ C: true }))).toBe(false);
  });

  it('MI: N set', () => {
    expect(evalCondition('MI', flags({ N: true }))).toBe(true);
    expect(evalCondition('MI', F)).toBe(false);
  });

  it('PL: N clear', () => {
    expect(evalCondition('PL', F)).toBe(true);
    expect(evalCondition('PL', flags({ N: true }))).toBe(false);
  });

  it('VS: V set', () => {
    expect(evalCondition('VS', flags({ V: true }))).toBe(true);
    expect(evalCondition('VS', F)).toBe(false);
  });

  it('VC: V clear', () => {
    expect(evalCondition('VC', F)).toBe(true);
    expect(evalCondition('VC', flags({ V: true }))).toBe(false);
  });

  it('HI: C and !Z', () => {
    expect(evalCondition('HI', flags({ C: true, Z: false }))).toBe(true);
    expect(evalCondition('HI', flags({ C: true, Z: true }))).toBe(false);
    expect(evalCondition('HI', F)).toBe(false);
  });

  it('LS: !C or Z', () => {
    expect(evalCondition('LS', F)).toBe(true);
    expect(evalCondition('LS', flags({ Z: true, C: true }))).toBe(true);
    expect(evalCondition('LS', flags({ C: true, Z: false }))).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(evalCondition('eq', flags({ Z: true }))).toBe(true);
    expect(evalCondition('ne', F)).toBe(true);
  });
});
