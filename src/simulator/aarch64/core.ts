import type { AArch64State, ParsedInstruction } from '../../types';
import { execALU64, parseXR } from './alu';
import { execMemory64 } from './memory';
import { execNeon64 } from './neon';
import { evalCondition64 } from './conditions';

function tokenize64(raw: string): string[] {
  // Strip // and ; comments
  let line = raw.replace(/\/\/.*$/, '').replace(/;.*$/, '').trim();
  if (!line) return [];

  const tokens: string[] = [];
  let i = 0;
  while (i < line.length) {
    // Skip whitespace and commas
    while (i < line.length && /[\s,]/.test(line[i])) i++;
    if (i >= line.length) break;

    if (line[i] === '[') {
      const start = i;
      while (i < line.length && line[i] !== ']') i++;
      i++; // consume ']'
      if (i < line.length && line[i] === '!') i++; // consume '!'
      tokens.push(line.slice(start, i).toUpperCase());
    } else if (line[i] === '{') {
      const start = i;
      while (i < line.length && line[i] !== '}') i++;
      i++; // consume '}'
      tokens.push(line.slice(start, i).toUpperCase());
    } else {
      const start = i;
      while (i < line.length && !/[\s,\[{]/.test(line[i])) i++;
      const tok = line.slice(start, i).toUpperCase();
      if (tok) tokens.push(tok);
    }
  }
  return tokens;
}

export function firstPass64(lines: string[], st: AArch64State): void {
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
    // inline label: "loop: ADD X0, X0, #1"
    const ci = line.indexOf(':');
    if (ci > 0 && !/\[/.test(line.slice(0, ci))) {
      st.labels[line.slice(0, ci).trim().toUpperCase()] = idx;
      line = line.slice(ci + 1).trim();
      if (!line) return;
    }
    const tokens = tokenize64(line);
    if (tokens.length === 0) return;
    st.instructions.push({ raw: line, lineNum: li + 1, tokens });
    idx++;
  });
}

function parseXRLocal(t: string | undefined): number {
  if (!t) return -1;
  const { idx } = parseXR(t);
  return idx;
}

export function execInstr64(st: AArch64State, instr: ParsedInstruction): string {
  st.changed.clear();
  st.vregChg.clear();
  st.flagChg.clear();

  const toks = instr.tokens;
  const n0 = (toks[0] || '').toUpperCase();

  // Detect NEON instructions
  // In AArch64, NEON instructions: dest is V register, or specific mnemonics
  const dest = (toks[1] || '');
  const isNeonDest = dest.startsWith('V') || dest.startsWith('{V');
  const isNeonMnemonic = ['DUP', 'LD1', 'ST1'].includes(n0);
  // For add/sub/mul/shift/logic on V regs — check dest
  if (isNeonDest || isNeonMnemonic) return execNeon64(st, instr);

  // Memory instructions
  if (['LDR', 'STR', 'LDRB', 'STRB', 'LDP', 'STP'].includes(n0)) return execMemory64(st, instr);

  // Branch instructions
  if (n0.startsWith('B') || n0 === 'CBZ' || n0 === 'CBNZ' || n0 === 'TBZ' || n0 === 'TBNZ') {
    // B.cc LABEL: n0 = 'B.GT' etc.
    if (n0.startsWith('B.')) {
      const cc = n0.slice(2);
      const taken = evalCondition64(cc, st.pstate);
      if (taken) {
        const lb = (toks[1] || '').toUpperCase();
        if (!(lb in st.labels)) throw new Error(`Unknown label: ${toks[1]}`);
        st.pc = st.labels[lb];
        st.changed.add(15);
      }
      return `${n0} ${taken ? ('→' + toks[1]) : 'not taken'}`;
    }
    // B LABEL
    if (n0 === 'B') {
      const lb = (toks[1] || '').toUpperCase();
      if (!(lb in st.labels)) throw new Error(`Unknown label: ${toks[1]}`);
      st.pc = st.labels[lb];
      return `B→${toks[1]}`;
    }
    // BL LABEL
    if (n0 === 'BL') {
      st.xregs[30] = st.pc;
      const lb = (toks[1] || '').toUpperCase();
      if (!(lb in st.labels)) throw new Error(`Unknown label: ${toks[1]}`);
      st.pc = st.labels[lb];
      st.changed.add(30);
      return `BL→${toks[1]}`;
    }
    // BLR Xn
    if (n0 === 'BLR') {
      const r = parseXRLocal(toks[1]);
      st.xregs[30] = st.pc;
      st.pc = r >= 0 ? st.xregs[r] : 0;
      st.changed.add(30);
      return `BLR`;
    }
    // BR Xn
    if (n0 === 'BR') {
      const r = parseXRLocal(toks[1]);
      st.pc = r >= 0 ? st.xregs[r] : 0;
      return `BR`;
    }
    // CBZ/CBNZ
    if (n0 === 'CBZ' || n0 === 'CBNZ') {
      const r = parseXRLocal(toks[1]);
      const val = r >= 0 ? st.xregs[r] : 0;
      const taken = n0 === 'CBZ' ? val === 0 : val !== 0;
      if (taken) {
        const lb = (toks[2] || '').toUpperCase();
        if (!(lb in st.labels)) throw new Error(`Unknown label: ${toks[2]}`);
        st.pc = st.labels[lb];
      }
      return `${n0} ${taken ? 'taken' : 'not taken'}`;
    }
    // TBZ/TBNZ — test bit and branch
    if (n0 === 'TBZ' || n0 === 'TBNZ') {
      const r = parseXRLocal(toks[1]);
      const bit = toks[2] ? parseInt((toks[2].startsWith('#') ? toks[2].slice(1) : toks[2]), 10) : 0;
      const val = r >= 0 ? st.xregs[r] : 0;
      const bitSet = ((val >>> bit) & 1) === 1;
      const taken = n0 === 'TBZ' ? !bitSet : bitSet;
      if (taken) {
        const lb = (toks[3] || '').toUpperCase();
        if (!(lb in st.labels)) throw new Error(`Unknown label: ${toks[3]}`);
        st.pc = st.labels[lb];
      }
      return `${n0} ${taken ? 'taken' : 'not taken'}`;
    }
  }

  // RET means end-of-function — signal halt by advancing PC past all instructions
  if (n0 === 'RET') {
    st.pc = st.instructions.length;
    return 'RET';
  }

  // ALU (includes NOP, MOV, ADD, SUB, etc.)
  return execALU64(st, instr);
}
