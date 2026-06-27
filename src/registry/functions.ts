import type { Fn, VecRow } from '../types';
import { parseSig } from '../parser/signature';

export const fnRegistry: Fn[] = [];
export let activeFnIdx = -1;

export function activeFn(): Fn | undefined {
  return fnRegistry[activeFnIdx];
}

export function createFn(sig: string, scalarCode: string, neonCode: string): Fn {
  return {
    id: Date.now(),
    sig,
    parsed: parseSig(sig),
    scalarCode,
    neonCode,
    vectors: [],
    results: [],
    labels: { regs: {}, lanes: {} },
  };
}

// Callbacks wired up by main.ts after UI is ready
let _onSelect: (idx: number) => void = () => { /* no-op until wired */ };
let _onTabsChanged: () => void = () => { /* no-op until wired */ };

export function wireCallbacks(
  onSelect: (idx: number) => void,
  onTabsChanged: () => void,
): void {
  _onSelect = onSelect;
  _onTabsChanged = onTabsChanged;
}

export function addFunction(
  sig = '',
  scalarCode = '// scalar ARM code\n',
  neonCode   = '// NEON code\n',
): void {
  const fn = createFn(sig, scalarCode, neonCode);
  fnRegistry.push(fn);
  activeFnIdx = fnRegistry.length - 1;
  _onSelect(activeFnIdx);
  _onTabsChanged();
}

export function selectFunction(idx: number): void {
  if (idx < 0 || idx >= fnRegistry.length) return;
  activeFnIdx = idx;
  _onSelect(idx);
  _onTabsChanged();
}

export function deleteFunction(idx: number): void {
  fnRegistry.splice(idx, 1);
  if (fnRegistry.length === 0) {
    addFunction();
    return;
  }
  selectFunction(Math.min(idx, fnRegistry.length - 1));
}

export function setVecParam(vi: number, key: string, val: string): void {
  const fn = activeFn();
  if (!fn) return;
  (fn.vectors[vi] as Record<string, string>)[key] = val;
  fn.results[vi] = null;
}

export function addVectorRow(): void {
  const fn = activeFn();
  if (!fn) return;
  const vec: VecRow = { expected: '' };
  if (fn.parsed) fn.parsed.params.forEach(p => {
    (vec as Record<string, string>)[p.name] = p.kind.base === 'ptr' ? '[0, 0, 0, 0]' : '0';
  });
  fn.vectors.push(vec);
  fn.results.push(null);
}

export function deleteVectorRow(vi: number): void {
  const fn = activeFn();
  if (!fn) return;
  fn.vectors.splice(vi, 1);
  fn.results.splice(vi, 1);
}

export function clearVecResults(): void {
  const fn = activeFn();
  if (!fn) return;
  fn.results = fn.vectors.map(() => null);
}

export function getFnTabNames(): string[] {
  return fnRegistry.map(fn =>
    fn.parsed?.name ??
    fn.sig.match(/\w+\s*\(/)?.[0]?.replace('(', '') ??
    `fn${fnRegistry.indexOf(fn) + 1}`
  );
}
