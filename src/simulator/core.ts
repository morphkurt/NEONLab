import type { SimulatorState, ParsedInstruction } from '../types';
import { parseReg } from '../parser/registers';
import { execALU } from './alu';
import { execMemory } from './memory-ops';
import { execNeon } from './neon';
import { evalCondition } from './conditions';

/** Tokenize a raw instruction line, handling [Rn, #off] as a single token */
function tokenizeLine(raw: string): string[] {
  const mm = raw.match(/\[([^\]]+)\]/);
  let prep = raw;
  if (mm) prep = raw.replace(/\[([^\]]+)\]/, '__MEM__');
  const toks = prep.split(/[\s,]+/).filter(Boolean);
  if (mm) {
    const mi = toks.indexOf('__MEM__');
    if (mi >= 0) toks[mi] = '[' + mm[1] + ']';
  }
  return toks.map(t => t.toUpperCase());
}

export function firstPass(lines: string[], st: SimulatorState): void {
  st.labels = {};
  st.instructions = [];
  let idx = 0;
  lines.forEach((raw, li) => {
    let line = raw.trim().replace(/\/\/.*$/, '').replace(/;.*$/, '').trim();
    if (!line) return;
    // standalone label: "loop:"
    if (line.endsWith(':')) {
      st.labels[line.slice(0, -1).trim().toUpperCase()] = idx;
      return;
    }
    // inline label: "loop: ADD R0, R0, #1"
    const ci = line.indexOf(':');
    if (ci > 0 && !/\[/.test(line.slice(0, ci))) {
      st.labels[line.slice(0, ci).trim().toUpperCase()] = idx;
      line = line.slice(ci + 1).trim();
      if (!line) return;
    }
    const tokens = tokenizeLine(line);
    st.instructions.push({ raw: line, lineNum: li + 1, tokens });
    idx++;
  });
}

export function execInstr(st: SimulatorState, instr: ParsedInstruction): string {
  st.changed.clear();
  st.neonChg.clear();
  st.flagChg.clear();

  const toks = instr.tokens;
  const n0 = (toks[0] || '').toUpperCase();

  // NEON instructions start with V
  if (n0.startsWith('V')) return execNeon(st, instr);

  // Memory instructions
  if (['LDR', 'STR', 'LDRB', 'STRB', 'PUSH', 'POP'].includes(n0)) {
    return execMemory(st, instr);
  }

  // Branch instructions
  if (n0.startsWith('B') && !['BIC', 'BIC'].includes(n0)) {
    // BL = branch-and-link; BLcc = 4-char (BL + 2-letter cond). BLT/BLE/BLS are Bcc, not BL.
    const BL_CONDS = new Set(['EQ','NE','LT','LE','GT','GE','CS','CC','HS','LO','MI','PL','VS','VC','HI','LS','AL']);
    const isBL = n0 === 'BL' || (n0.startsWith('BL') && BL_CONDS.has(n0.slice(2)));
    const isBX = n0 === 'BX';

    if (isBX) {
      const rm = parseReg(toks[1]);
      if (rm < 0) throw new Error('Bad reg');
      st.pc = st.regs[rm];
      st.changed.add(15);
      return `BX R${rm}`;
    }

    if (isBL) {
      const cc = n0.slice(2) || 'AL';
      if (evalCondition(cc, st.cpsr)) {
        const lb = (toks[1] || '').toUpperCase();
        if (!(lb in st.labels)) throw new Error(`Unknown label: ${toks[1]}`);
        st.regs[14] = st.pc;
        st.pc = st.labels[lb];
        st.changed.add(14);
        st.changed.add(15);
        return `${n0}→${toks[1]}`;
      }
      return `${n0} not taken`;
    }

    // Plain B / Bcc
    const cc = n0.slice(1) || 'AL';
    if (evalCondition(cc, st.cpsr)) {
      const lb = (toks[1] || '').toUpperCase();
      if (!(lb in st.labels)) throw new Error(`Unknown label: ${toks[1]}`);
      st.pc = st.labels[lb];
      st.changed.add(15);
      return `${n0}→${toks[1]}`;
    }
    return `${n0} not taken`;
  }

  // ALU instructions
  return execALU(st, instr);
}
