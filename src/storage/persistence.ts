import { fnRegistry, activeFnIdx, addFunction, selectFunction, activeFn } from '../registry/functions';
import { parseSig } from '../parser/signature';
import { getCodeValue, getSigValue } from '../ui/editor';

const LS_KEY = 'neonforge_fns';
let _saveTimer: ReturnType<typeof setTimeout> | null = null;

export function saveToStorage(): void {
  // Flush current editor content before saving
  const fn = activeFn();
  if (fn && activeFnIdx >= 0) {
    fn.scalarCode  = getCodeValue('scalar');
    fn.neonCode    = getCodeValue('neon');
    fn.aarch64Code = getCodeValue('aarch64');
    fn.sig         = getSigValue();
    fn.parsed      = parseSig(fn.sig);
  }

  const data = fnRegistry.map(f => ({
    sig: f.sig,
    scalarCode: f.scalarCode,
    neonCode: f.neonCode,
    aarch64Code: f.aarch64Code,
    vectors: f.vectors,
  }));

  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
    const btn = document.getElementById('save-btn');
    if (btn) {
      const orig = btn.textContent ?? 'Save';
      btn.textContent = 'Saved!';
      setTimeout(() => { btn.textContent = orig; }, 1200);
    }
  } catch (e) {
    console.error('localStorage save failed:', e);
  }
}

export function loadFromStorage(): boolean {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw) as Array<{
      sig: string;
      scalarCode: string;
      neonCode: string;
      aarch64Code?: string;
      vectors: import('../types').VecRow[];
    }>;
    if (!Array.isArray(data) || data.length === 0) return false;
    data.forEach(d => {
      addFunction(d.sig ?? '', d.scalarCode ?? '', d.neonCode ?? '', d.aarch64Code ?? '');
      const fn = activeFn();
      if (fn) {
        fn.vectors = Array.isArray(d.vectors) ? d.vectors : [];
        fn.results = fn.vectors.map(() => null);
      }
    });
    selectFunction(0);
    return true;
  } catch (_) {
    return false;
  }
}

export function scheduleAutoSave(): void {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveToStorage, 1500);
}
