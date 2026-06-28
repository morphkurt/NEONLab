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

const overlayScalar = `\
// Scalar overlay blend — one uint8 pixel per iteration
// int overlay_row_44(uint8_t* dst, uint8_t* da, uint8_t* s, uint8_t* a, int w)
// R0=dst  R1=da(unused)  R2=s  R3=a  R4=w
// result[i] = (s[i]*a[i] + d[i]*(255-a[i]) + 128) >> 8
MOV  R5, #0              // x = 0
loop:
  CMP  R5, R4
  BGE  done
  LDRB R6, [R2, R5]     // R6 = s[x]
  LDRB R7, [R3, R5]     // R7 = a[x]
  MUL  R8, R6, R7       // R8 = s * a
  RSB  R6, R7, #255     // R6 = 255 - a
  LDRB R7, [R0, R5]     // R7 = dst[x]
  MUL  R6, R7, R6       // R6 = d * (255 - a)
  ADD  R8, R8, R6       // R8 = s*a + d*(255-a)
  ADD  R8, R8, #128     // + 128 rounding bias
  LSR  R8, R8, #8       // >> 8  (approx /255)
  STRB R8, [R0, R5]     // dst[x] = result
  ADD  R5, R5, #1       // x++
  B    loop
done:
  MOV  R0, R4           // return w (all pixels processed, no SIMD)
`;

const overlayNeon = `\
// NEON overlay blend — 4 pixels per iteration (32-bit lane mode)
// int overlay_row_44(uint8_t* dst, uint8_t* da, uint8_t* s, uint8_t* a, int w)
// R0=dst  R1=da(unused)  R2=s  R3=a  R4=w
// Note: uses .I32 lanes; real impl uses .8H (UXTL/UMULL) — see AArch64 tab
MOV  R10, R0
VDUP.32 Q7, R4         // Q7 = [w x4] keep a copy of width
MOV  R5, #0            // x = 0
loop:
  VLD1.32 {Q2}, [R2]   // load 4 src pixels
  VLD1.32 {Q3}, [R3]   // load 4 alpha values
  VLD1.32 {Q1}, [R0]   // load 4 dst pixels
  VMUL.I32 Q4, Q2, Q3  // Q4 = s * a
  RSB  R6, R4, #255    // 255 - a  (scalar, reuse for broadcast)
  VDUP.32 Q5, R6       // Q5 = [255-a x4]  (single alpha broadcast)
  VMUL.I32 Q5, Q1, Q5  // Q5 = d * (255-a)
  VADD.I32 Q4, Q4, Q5  // Q4 = s*a + d*(255-a)
  MOV  R6, #128
  VDUP.32 Q6, R6
  VADD.I32 Q4, Q4, Q6  // + 128
  VSHR.U32 Q4, Q4, #8  // >> 8
  VST1.32 {Q4}, [R0]   // store 4 blended pixels
  ADD  R0, R0, #16     // dst += 4 words
  ADD  R2, R2, #16     // s   += 4 words
  ADD  R3, R3, #16     // a   += 4 words
  ADD  R5, R5, #4      // x   += 4
  CMP  R5, R4
  BLT  loop
LDR  R0, [R10]         // return dst[0]
`;

const overlayAarch64 = `\
// AArch64 overlay blend — 8 uint8 pixels per iteration
// int overlay_row_44(uint8_t* dst, uint8_t* da, uint8_t* s, uint8_t* a, int w)
// X0=dst  X1=da(unused)  X2=s  X3=a  W4=w
// Returns: number of pixels processed by the SIMD loop
//
// Instructions marked (*) need a real assembler; the basic simulator
// does not implement MOVI/UXTL/UMULL2/UZP2/SQXTUN but will show data flow.
        mov     x6, #0                  // x = 0
        sxtw    x5, w4                  // sign-extend width to 64-bit
        and     x7, x5, #7             // r = w & 7  (leftover pixels)
        cmp     x5, #8
        b.lt    epilogue
        sub     x5, x5, x7             // x5 = last vectorizable offset (multiple of 8)
        movi    v3.8h, #0xFF            // (*) v3 = pw_255  [0x00FF per lane]
        movi    v4.8h, #0x80            // (*) v4 = pw_128  rounding bias
        movi    v5.8h, #0x01, lsl #8    // (*) v5 = 0x0100 ...
        orr     v5.8h, #0x01            // (*) v5 |= 0x01 -> 0x0101 = pw_257
mainloop:
        add     x8, x2, x6             // src ptr  = s + x
        ld1     {v0.8b}, [x8]          // (*) load 8 source bytes
        uxtl    v0.8h, v0.8b           // (*) widen u8 → u16  (v0 = s)

        add     x8, x3, x6             // alpha ptr = a + x
        ld1     {v2.8b}, [x8]          // (*) load 8 alpha bytes
        uxtl    v2.8h, v2.8b           // (*) widen u8 → u16  (v2 = a)

        add     x8, x0, x6             // dst ptr  = dst + x
        ld1     {v1.8b}, [x8]          // (*) load 8 dst bytes
        uxtl    v1.8h, v1.8b           // (*) widen u8 → u16  (v1 = d)

        // blend: result = (s*a + d*(255-a) + 128) * 257 >> 16
        mul     v0.8h, v0.8h, v2.8h   // (*) v0 = s * a
        eor     v2.16b, v2.16b, v3.16b// (*) v2 = a ^ 255  (inverse alpha)
        mul     v1.8h, v1.8h, v2.8h   // (*) v1 = d * (255-a)
        add     v0.8h, v0.8h, v4.8h   // (*) v0 += 128  (rounding)
        add     v0.8h, v0.8h, v1.8h   // (*) v0 = s*a + d*ia + 128
        // multiply by 257 and take high 16 bits = exact divide-by-255
        umull   v16.4s, v0.4h, v5.4h  // (*) low  4 lanes: u32 = u16 * 257
        umull2  v17.4s, v0.8h, v5.8h  // (*) high 4 lanes: u32 = u16 * 257
        uzp2    v0.8h, v16.8h, v17.8h // (*) extract high 16 bits of each product
        sqxtun  v0.8b, v0.8h          // (*) saturate u16 → u8

        add     x8, x0, x6            // dst ptr = dst + x
        st1     {v0.8b}, [x8]         // (*) store 8 blended bytes

        add     x6, x6, #8            // x += 8
        cmp     x6, x5
        b.lt    mainloop
epilogue:
        mov     w0, w6                // return pixels processed
        ret
`;

const overlayVectors: VecRow[] = [
  { dst: '[200, 100, 50, 128]', da: '[0, 0, 0, 0]', s: '[0, 200, 255, 64]', a: '[128, 128, 128, 128]', w: '4', expected: '' },
  { dst: '[0, 0, 0, 0]',       da: '[0, 0, 0, 0]', s: '[200, 200, 200, 200]', a: '[255, 255, 255, 255]', w: '4', expected: '' },
  { dst: '[128, 128, 128, 128]', da: '[0, 0, 0, 0]', s: '[0, 0, 0, 0]', a: '[0, 0, 0, 0]', w: '4', expected: '' },
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

  addFunction(
    'int overlay_row_44(uint8_t* dst, uint8_t* da, uint8_t* s, uint8_t* a, int w)',
    overlayScalar,
    overlayNeon,
    overlayAarch64,
  );
  const fn1 = activeFn()!;
  fn1.vectors = overlayVectors.map(v => ({ ...v }));
  fn1.results = fn1.vectors.map(() => null);

  // Switch back to alpha_blend tab
  selectFunction(0);
}

// Migrate: restore defaults when stored data has no usable signature or vectors
const fn0 = activeFn();
if (fn0 && !fn0.parsed) {
  fn0.sig    = 'int32_t alpha_blend_row(int32_t* dst, int32_t* src, int32_t alpha, int32_t n)';
  fn0.parsed = parseSig(fn0.sig);
  setSigValue(fn0.sig);
  onSigChange(fn0.sig);
}
if (fn0 && fn0.vectors.length === 0) {
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
