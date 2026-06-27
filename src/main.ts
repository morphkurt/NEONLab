import './style.css';

import { S } from './simulator/state';
import { firstPass } from './simulator/core';
import { firstPass64, execInstr64 } from './simulator/aarch64/core';
import {
  fnRegistry, activeFnIdx, activeFn, addFunction, selectFunction, deleteFunction,
  getFnTabNames, setVecParam, addVectorRow, deleteVectorRow, clearVecResults,
  wireCallbacks,
} from './registry/functions';
import { parseSig } from './parser/signature';
import { applyVector, readReturn, readOutputPtrs } from './binding/vector';
import type { VecRow, VecResult } from './types';
import { renderAll, renderCompare } from './ui/render';
import { renderVecTable } from './ui/vector-table';
import { renderFnTabs, switchEditor, switchState } from './ui/tabs';
import { renderSigParsed } from './ui/sig-ui';
import {
  setupLN, syncLN, getCodeValue, setCodeValue, getSigValue, setSigValue,
} from './ui/editor';
import { buildTransGrid, setupTransHighlight } from './ui/trans';
import { hideTooltip, setupInstrHover } from './ui/tooltips';
import { lookupInstrRef } from './data/instr-ref';
import { execInstr } from './simulator/core';
import {
  loadCode, runSim, stepSim, pauseSim, resetSim, runBothAndCompare,
  loadCode64, stepSim64, runSim64, pauseSim64, resetSim64,
  setButtons, clearTimer,
} from './ui/controls';
import { setStatus } from './ui/log';
import { saveToStorage, loadFromStorage, scheduleAutoSave } from './storage/persistence';
import { exportASM } from './export/asm';
import { setEngines, enginesReady, runWithUnicorn } from './engine/runner';

// ── Save current editor → active fn ─────────────────────────
function flushEditorToFn(): void {
  const fn = activeFn();
  if (fn && activeFnIdx >= 0) {
    fn.scalarCode  = getCodeValue('scalar');
    fn.neonCode    = getCodeValue('neon');
    fn.aarch64Code = getCodeValue('aarch64');
    fn.sig         = getSigValue();
    fn.parsed      = parseSig(fn.sig);
  }
}

// ── Wire registry callbacks ──────────────────────────────────
wireCallbacks(
  (idx) => {
    flushEditorToFn();
    const fn = fnRegistry[idx];
    if (!fn) return;
    setCodeValue('scalar',  fn.scalarCode);
    setCodeValue('neon',    fn.neonCode);
    setCodeValue('aarch64', fn.aarch64Code);
    setSigValue(fn.sig);
    syncLN('code-scalar', 'ln-scalar');
    syncLN('code-neon',   'ln-neon');
    syncLN('code-aarch64', 'ln-aarch64');
    onSigChange(fn.sig);
    refreshVecTable();
    renderAll('both', S, fn);
  },
  () => {
    renderFnTabs(
      getFnTabNames(),
      activeFnIdx,
      (i) => selectFunction(i),
      (i) => { deleteFunction(i); scheduleAutoSave(); },
      () => { addFunction(); scheduleAutoSave(); },
    );
  },
);

// ── Sig change ───────────────────────────────────────────────
function onSigChange(val: string): void {
  const fn = activeFn();
  if (!fn) return;
  fn.sig    = val;
  fn.parsed = parseSig(val);
  const el = document.getElementById('sig-parsed');
  if (el) renderSigParsed(el, val, fn.parsed);
  refreshVecTable();
}

// ── Vec table ────────────────────────────────────────────────
function refreshVecTable(): void {
  renderVecTable(
    activeFn(),
    (vi, key, val) => { setVecParam(vi, key, val); scheduleAutoSave(); },
    (vi) => { deleteVectorRow(vi); refreshVecTable(); scheduleAutoSave(); },
  );
}

// ── Run all vectors (AArch64 JS sim) ─────────────────────────
function runToEnd64(vec: VecRow): { retVal: number | null; outPtrs: Record<string, number[]> } {
  const fn = activeFn();
  const st = S.aarch64;
  st.xregs.fill(0);
  st.pstate = { N: false, Z: false, C: false, V: false };
  st.vregs.forEach(v => v.fill(0));
  st.memory = {}; st.pc = 0; st.cycles = 0;
  st.changed.clear(); st.vregChg.clear(); st.flagChg.clear();

  // Apply vector params to xregs using tmp SimulatorState
  if (fn?.parsed) {
    const tmp = {
      regs: st.xregs,
      cpsr: { N: false, Z: false, C: false, V: false },
      neon: [] as Int32Array[],
      memory: st.memory,
      pc: 0, cycles: 0,
      instructions: [] as import('./types').ParsedInstruction[],
      labels: {} as Record<string, number>,
      changed: new Set<number>(),
      neonChg: new Set<number>(),
      flagChg: new Set<string>(),
      timer: null,
    };
    applyVector(tmp, fn.parsed, vec);
    st.memory = tmp.memory;
  }

  let guard = 0;
  while (st.pc < st.instructions.length && guard++ < 100000) {
    const instr = st.instructions[st.pc];
    if (!instr) break;
    st.pc++; st.cycles++;
    try { execInstr64(st, instr); } catch (_) { break; }
  }

  // Read return value from X0
  const retVal = fn?.parsed ? (st.xregs[0] | 0) : null;
  // Read output pointers
  const outPtrs: Record<string, number[]> = {};
  if (fn?.parsed) {
    let memPtr = 0x10000;
    fn.parsed.params.forEach(p => {
      if (p.kind.base === 'ptr') {
        const raw = vec[p.name];
        const arr = raw ? JSON.parse(raw) as number[] : [];
        const es = p.kind.elemSize ?? 4;
        outPtrs[p.name] = Array.from({ length: arr.length }, (_, i) => st.memory[(memPtr + i * es) >>> 0] ?? 0);
        memPtr += Math.max(arr.length, 1) * es;
      }
    });
  }
  return { retVal, outPtrs };
}

// ── Run all vectors (JS sim) ─────────────────────────────────
function runToEnd(which: 'scalar' | 'neon', vec: VecRow): { retVal: number | null; outPtrs: Record<string, number[]> } {
  const fn = activeFn();
  const st = S[which];
  st.regs.fill(0);
  st.cpsr = { N: false, Z: false, C: false, V: false };
  st.neon.forEach(q => q.fill(0));
  st.memory = {}; st.pc = 0; st.cycles = 0;
  st.changed.clear(); st.neonChg.clear(); st.flagChg.clear();

  let ptrs: Record<string, import('./binding/vector').PtrInfo> = {};
  if (fn?.parsed) ptrs = applyVector(st, fn.parsed, vec);

  let guard = 0;
  while (st.pc < st.instructions.length && guard++ < 100000) {
    const instr = st.instructions[st.pc];
    if (!instr) break;
    st.pc++; st.cycles++;
    try {
      execInstr(st, instr);
      st.regs[15] = st.pc;
    } catch (_) { break; }
  }

  const retVal = fn?.parsed ? readReturn(st, fn.parsed.returnType) : null;
  const outPtrs = fn?.parsed ? readOutputPtrs(st, fn.parsed, ptrs) : {};
  return { retVal, outPtrs };
}

async function doRunAllVectors(): Promise<void> {
  const fn = activeFn();
  if (!fn) return;

  if (enginesReady) {
    setStatus('scalar',  'run', 'QEMU running…');
    setStatus('neon',    'run', 'QEMU running…');
    setStatus('aarch64', 'run', 'JS running…');
    fn.results = [];
    try {
      for (const vec of fn.vectors) {
        const result: VecResult = { scalar: null, neon: null, aarch64: null, engine: 'qemu' };
        for (const which of ['scalar', 'neon'] as const) {
          try {
            const srcCode = getCodeValue(which);
            const { st, retVal, outPtrs } = await runWithUnicorn(srcCode, fn.parsed, vec);
            Object.assign(S[which], {
              regs: st.regs, neon: st.neon, cpsr: st.cpsr,
              changed: st.changed, neonChg: st.neonChg, flagChg: st.flagChg,
            });
            result[which] = { retVal, outPtrs };
          } catch (e) {
            result[which] = { retVal: null, outPtrs: {}, error: String(e) };
          }
        }
        // AArch64 always uses JS sim
        try {
          firstPass64(getCodeValue('aarch64').split('\n'), S.aarch64);
          const { retVal, outPtrs } = runToEnd64(vec);
          result.aarch64 = { retVal, outPtrs };
        } catch (e) {
          result.aarch64 = { retVal: null, outPtrs: {}, error: String(e) };
        }
        fn.results.push(result);
      }
    } catch (e) {
      setStatus('scalar', 'err', `QEMU error: ${e}`);
      setStatus('neon',   'err', `QEMU error: ${e}`);
      return;
    }
  } else {
    // JS simulator
    (['scalar', 'neon'] as const).forEach(which => {
      clearTimer(S[which]);
      const lines = getCodeValue(which).split('\n');
      firstPass(lines, S[which]);
    });
    firstPass64(getCodeValue('aarch64').split('\n'), S.aarch64);

    fn.results = fn.vectors.map(vec => {
      const result: VecResult = { scalar: null, neon: null, aarch64: null, engine: 'js' };
      (['scalar', 'neon'] as const).forEach(which => {
        const { retVal, outPtrs } = runToEnd(which, vec);
        result[which] = { retVal, outPtrs };
      });
      try {
        const { retVal, outPtrs } = runToEnd64(vec);
        result.aarch64 = { retVal, outPtrs };
      } catch (e) {
        result.aarch64 = { retVal: null, outPtrs: {}, error: String(e) };
      }
      return result;
    });

    for (let i = 0; i < 16; i++) { S.scalar.changed.add(i); S.neon.changed.add(i); }
    S.neon.neon.forEach((_, qi) => S.neon.neonChg.add(qi));
  }

  renderAll('both', S, fn);
  renderAll('aarch64', S, fn);
  refreshVecTable();
  renderCompare(S, fn);
  setStatus('scalar',  'done', `${fn.vectors.length} vectors done`);
  setStatus('neon',    'done', `${fn.vectors.length} vectors done`);
  setStatus('aarch64', 'done', `${fn.vectors.length} vectors done`);
}

// ── Engine init ──────────────────────────────────────────────
function setEngBadge(state: 'loading' | 'ready' | 'error', text: string): void {
  const el = document.getElementById('eng-badge');
  if (!el) return;
  el.textContent = text;
  el.className   = `badge qemu ${state}`;
}

async function initEngines(): Promise<void> {
  setEngBadge('loading', 'Engine: loading…');
  try {
    type G = Record<string, () => Promise<unknown>>;
    const g = globalThis as unknown as G;
    const [uc, ks] = await Promise.all([g['MUnicorn'](), g['MKeystone']()]);
    setEngines(
      uc as import('./engine/types').UnicornModule,
      ks as import('./engine/types').KeystoneModule,
    );
    setEngBadge('ready', 'Engine: QEMU ready');
  } catch (_) {
    setEngBadge('error', 'Engine: failed');
  }
}

// ── DOM setup ────────────────────────────────────────────────
buildTransGrid();
setupLN('code-scalar',  'ln-scalar');
setupLN('code-neon',    'ln-neon');
setupLN('code-aarch64', 'ln-aarch64');
setupTransHighlight('code-scalar');
setupTransHighlight('code-neon');
setupInstrHover('code-scalar',  lookupInstrRef);
setupInstrHover('code-neon',    lookupInstrRef);
setupInstrHover('code-aarch64', lookupInstrRef);

(['scalar', 'neon', 'aarch64'] as const).forEach(w => {
  const ta = document.getElementById(`code-${w}`) as HTMLTextAreaElement | null;
  const hl = document.getElementById(`hl-${w}`);
  ta?.addEventListener('scroll', () => {
    const hlLine = (ta as HTMLTextAreaElement & { _hlLine?: number })._hlLine;
    if (hl && hlLine) hl.style.top = (6 + (hlLine - 1) * 18 - ta.scrollTop) + 'px';
  });
});

document.getElementById('code-scalar')?.addEventListener('input', scheduleAutoSave);
document.getElementById('code-neon')?.addEventListener('input', scheduleAutoSave);
document.getElementById('code-aarch64')?.addEventListener('input', scheduleAutoSave);
document.getElementById('sig-input')?.addEventListener('input', e => {
  onSigChange((e.target as HTMLInputElement).value);
  scheduleAutoSave();
});
document.addEventListener('click', () => hideTooltip());

// ── Button wiring (via NL global for onclick attrs) ──────────
declare global { interface Window { NL: typeof NL } }
const NL = {
  switchEditor,
  switchState,
  addFunction:         () => { addFunction(); scheduleAutoSave(); },
  addVector:           () => { addVectorRow(); refreshVecTable(); scheduleAutoSave(); },
  clearResults:        () => { clearVecResults(); refreshVecTable(); },
  saveToStorage,
  exportASM,
  runAllVectors:       () => { void doRunAllVectors(); },
  runBothAndCompare:   () => runBothAndCompare(S, activeFn()),
  loadCode:  (w: string) => {
    if (w === 'aarch64') loadCode64(S.aarch64, S, activeFn());
    else loadCode(w, S[w as 'scalar'|'neon'], S, activeFn());
  },
  step:      (w: string) => {
    if (w === 'aarch64') stepSim64(S.aarch64, S, activeFn());
    else stepSim(w, S[w as 'scalar'|'neon'], S, activeFn());
  },
  run:       (w: string) => {
    if (w === 'aarch64') runSim64(S.aarch64, S, activeFn());
    else runSim(w, S[w as 'scalar'|'neon'], S, activeFn());
  },
  pause:     (w: string) => {
    if (w === 'aarch64') pauseSim64(S.aarch64);
    else pauseSim(w, S[w as 'scalar'|'neon']);
  },
  reset:     (w: string) => {
    if (w === 'aarch64') resetSim64(S.aarch64, S, activeFn());
    else resetSim(w, S[w as 'scalar'|'neon'], S, activeFn());
  },
};
window.NL = NL;

// ── Load initial state ───────────────────────────────────────
const defaultVectors: VecRow[] = [
  { dst: '[200, 100, 50, 255]',  src: '[0, 200, 100, 0]',    alpha: '128', n: '4', expected: '' },
  { dst: '[0, 0, 0, 0]',         src: '[200, 200, 200, 200]', alpha: '255', n: '4', expected: '' },
  { dst: '[128, 128, 128, 128]', src: '[0, 0, 0, 0]',         alpha: '64',  n: '4', expected: '' },
];

const restored = loadFromStorage();
if (!restored) {
  const scalarDefault  = (document.getElementById('code-scalar')  as HTMLTextAreaElement).value;
  const neonDefault    = (document.getElementById('code-neon')    as HTMLTextAreaElement).value;
  const aarch64Default = (document.getElementById('code-aarch64') as HTMLTextAreaElement).value;
  addFunction(
    'int32_t alpha_blend_row(int32_t* dst, int32_t* src, int32_t alpha, int32_t n)',
    scalarDefault,
    neonDefault,
    aarch64Default,
  );
  const fn0 = activeFn()!;
  fn0.vectors = defaultVectors.map(v => ({ ...v }));
  fn0.results = fn0.vectors.map(() => null);
}

// Migrate: if stored data had no vectors, seed with defaults
const fn0 = activeFn();
if (fn0 && fn0.vectors.length === 0 && fn0.sig.includes('alpha_blend')) {
  fn0.vectors = defaultVectors.map(v => ({ ...v }));
  fn0.results = fn0.vectors.map(() => null);
}

renderAll('both', S, activeFn());
renderAll('aarch64', S, activeFn());
refreshVecTable();
setButtons('scalar',  false);
setButtons('neon',    false);
setButtons('aarch64', false);

const g = globalThis as Record<string, unknown>;
if (typeof g['MUnicorn'] === 'function' && typeof g['MKeystone'] === 'function') {
  void initEngines();
} else {
  setEngBadge('error', 'Engine: not loaded');
}
