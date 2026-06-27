import type { SimulatorState, Fn } from '../types';
import { addLog, clearLog, setStatus } from './log';
import { renderAll, renderCompare } from './render';
import { showCurLine, hideCurLine, getSpeedValue, getCodeValue } from './editor';
import { switchState } from './tabs';
import { firstPass, execInstr } from '../simulator/core';
import { applyVector } from '../binding/vector';

export function clearTimer(st: SimulatorState): void {
  if (st.timer) { clearInterval(st.timer); st.timer = null; }
}

export function setButtons(which: string, enabled: boolean, errored = false): void {
  const p = which[0];
  const step  = document.getElementById(`${p}-step`)  as HTMLButtonElement | null;
  const run   = document.getElementById(`${p}-run`)   as HTMLButtonElement | null;
  const pause = document.getElementById(`${p}-pause`) as HTMLButtonElement | null;
  const reset = document.getElementById(`${p}-reset`) as HTMLButtonElement | null;
  if (step)  step.disabled  = !enabled || errored;
  if (run)   run.disabled   = !enabled || errored;
  if (pause) pause.disabled = true;
  if (reset) reset.disabled = false;
}

function doneSim(
  which: string,
  st: SimulatorState,
  S: { scalar: SimulatorState; neon: SimulatorState },
  fn: Fn | undefined,
): void {
  clearTimer(st);
  hideCurLine(which);
  setButtons(which, false);
  setStatus(which, 'done', 'Done');
  renderAll(which as 'scalar' | 'neon' | 'both', S, fn);
}

export function applyFromInputBar(st: SimulatorState, fn: Fn | undefined): void {
  st.regs.fill(0);
  st.cpsr = { N: false, Z: false, C: false, V: false };
  st.neon.forEach(q => q.fill(0));
  st.memory = {};
  st.pc = 0; st.cycles = 0;
  st.changed.clear(); st.neonChg.clear(); st.flagChg.clear();
  if (fn?.parsed && fn.vectors.length > 0) {
    applyVector(st, fn.parsed, fn.vectors[0]);
  }
}

export function stepSim(
  which: string,
  st: SimulatorState,
  S: { scalar: SimulatorState; neon: SimulatorState },
  fn: Fn | undefined,
): boolean {
  if (st.pc >= st.instructions.length) { doneSim(which, st, S, fn); return false; }
  const instr = st.instructions[st.pc];
  if (!instr) { doneSim(which, st, S, fn); return false; }
  const prev = st.pc;
  st.pc++; st.cycles++;
  try {
    const detail = execInstr(st, instr);
    st.regs[15] = st.pc;
    renderAll(which as 'scalar' | 'neon' | 'both', S, fn);
    addLog(which, prev, instr.raw.trim(), detail);
    setStatus(which, 'run', instr.raw.trim());
    const cycEl = document.getElementById('scyc');
    if (cycEl) cycEl.textContent = `Cycles: ${st.cycles}`;
    showCurLine(which, instr.lineNum);
    if (st.pc >= st.instructions.length) doneSim(which, st, S, fn);
    return true;
  } catch (e) {
    renderAll(which as 'scalar' | 'neon' | 'both', S, fn);
    addLog(which, prev, instr.raw.trim(), String(e), true);
    setStatus(which, 'err', `Error: ${e}`);
    setButtons(which, false, true);
    return false;
  }
}

export function loadCode(
  which: string,
  st: SimulatorState,
  S: { scalar: SimulatorState; neon: SimulatorState },
  fn: Fn | undefined,
): void {
  clearTimer(st);
  applyFromInputBar(st, fn);
  const lines = getCodeValue(which).split('\n');
  try {
    firstPass(lines, st);
    renderAll(which as 'scalar' | 'neon' | 'both', S, fn);
    clearLog(which);
    addLog(which, 0, 'LOAD', `${st.instructions.length} instrs`);
    setStatus(which, 'ready', 'Loaded');
    setButtons(which, true);
  } catch (e) {
    setStatus(which, 'err', `Parse: ${e}`);
    addLog(which, 0, 'ERR', String(e), true);
  }
}

export function runSim(
  which: string,
  st: SimulatorState,
  S: { scalar: SimulatorState; neon: SimulatorState },
  fn: Fn | undefined,
): void {
  if (st.timer) return;
  const p = which[0];
  (document.getElementById(`${p}-run`)   as HTMLButtonElement | null)!.disabled = true;
  (document.getElementById(`${p}-pause`) as HTMLButtonElement | null)!.disabled = false;
  (document.getElementById(`${p}-step`)  as HTMLButtonElement | null)!.disabled = true;
  const delay = Math.max(40, 1050 - getSpeedValue(which) * 100);
  st.timer = setInterval(() => {
    if (!stepSim(which, st, S, fn)) clearTimer(st);
  }, delay);
}

export function pauseSim(which: string, st: SimulatorState): void {
  hideCurLine(which);
  clearTimer(st);
  const done = st.pc >= st.instructions.length || st.instructions.length === 0;
  setButtons(which, !done);
  if (!done) setStatus(which, 'ready', 'Paused');
}

export function resetSim(
  which: string,
  st: SimulatorState,
  S: { scalar: SimulatorState; neon: SimulatorState },
  fn: Fn | undefined,
): void {
  clearTimer(st);
  hideCurLine(which);
  applyFromInputBar(st, fn);
  st.instructions = [];
  st.labels = {};
  renderAll(which as 'scalar' | 'neon' | 'both', S, fn);
  clearLog(which);
  setButtons(which, false);
  setStatus(which, '', 'Reset');
}

export function runBothAndCompare(
  S: { scalar: SimulatorState; neon: SimulatorState },
  fn: Fn | undefined,
): void {
  (['scalar', 'neon'] as const).forEach(which => {
    const st = S[which];
    clearTimer(st);
    applyFromInputBar(st, fn);
    const lines = getCodeValue(which).split('\n');
    firstPass(lines, st);
    let guard = 0;
    while (st.pc < st.instructions.length && guard++ < 50000) {
      const instr = st.instructions[st.pc];
      if (!instr) break;
      st.pc++; st.cycles++;
      try { execInstr(st, instr); st.regs[15] = st.pc; } catch (_) { break; }
    }
    for (let i = 0; i < 16; i++) st.changed.add(i);
    st.neon.forEach((_, qi) => st.neonChg.add(qi));
  });
  renderAll('both', S, fn);
  renderCompare(S, fn);
  switchState('cmp');
  setStatus('scalar', 'done', 'Done');
  setStatus('neon', 'done', 'Done');
}
