import { fnRegistry, activeFnIdx, activeFn, addFunction, selectFunction } from '../registry/functions';
import { parseSig } from '../parser/signature';
import { getCodeValue, getSigValue } from '../ui/editor';

function toB64url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad  = b64.length % 4 ? '='.repeat(4 - b64.length % 4) : '';
  const bin  = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function flushEditor(): void {
  const fn = activeFn();
  if (fn && activeFnIdx >= 0) {
    fn.scalarCode  = getCodeValue('scalar');
    fn.neonCode    = getCodeValue('neon');
    fn.aarch64Code = getCodeValue('aarch64');
    fn.sig         = getSigValue();
    fn.parsed      = parseSig(fn.sig);
  }
}

export function loadFromHash(): boolean {
  const hash = window.location.hash.slice(1);
  if (!hash) return false;
  try {
    const data = JSON.parse(fromB64url(hash)) as {
      v: number;
      fns: Array<{ sig: string; scalar: string; neon: string; aarch64: string;
                   vectors: Record<string, string>[] }>;
    };
    if (data.v !== 1 || !Array.isArray(data.fns) || data.fns.length === 0) return false;
    data.fns.forEach(f => {
      addFunction(f.sig ?? '', f.scalar ?? '', f.neon ?? '', f.aarch64 ?? '');
      const fn = activeFn();
      if (fn) {
        fn.vectors = Array.isArray(f.vectors)
          ? (f.vectors as import('../types').VecRow[])
          : [];
        fn.results = fn.vectors.map(() => null);
      }
    });
    selectFunction(0);
    return true;
  } catch (_) {
    return false;
  }
}

export function share(): void {
  flushEditor();
  const fns = fnRegistry.map(f => ({
    sig: f.sig, scalar: f.scalarCode, neon: f.neonCode,
    aarch64: f.aarch64Code, vectors: f.vectors,
  }));
  const url = window.location.href.split('#')[0] + '#' + toB64url(JSON.stringify({ v: 1, fns }));
  window.history.replaceState(null, '', url);
  void navigator.clipboard.writeText(url).catch(() => {});
  const btn = document.getElementById('share-btn');
  if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = '⬡ Share'; }, 1500); }
}
