import type { InstrInfo } from '../types';

export const INSTR_REF: Record<string, InstrInfo> = {
  MOV:  { name: 'Move',                    desc: 'Rd = op2. Copies a value or immediate into a register.',                                   syn: 'MOV Rd, <op2>',          note: 'MOVS updates N and Z flags.' },
  MVN:  { name: 'Move Negative',           desc: 'Rd = ~op2. Bitwise NOT of the operand.',                                                   syn: 'MVN Rd, <op2>' },
  ADD:  { name: 'Add',                     desc: 'Rd = Rn + op2.',                                                                           syn: 'ADD Rd, Rn, <op2>',      note: 'ADDS updates N, Z, C, V.' },
  SUB:  { name: 'Subtract',                desc: 'Rd = Rn − op2.',                                                                           syn: 'SUB Rd, Rn, <op2>',      note: 'SUBS updates N, Z, C, V.' },
  RSB:  { name: 'Reverse Subtract',        desc: 'Rd = op2 − Rn.  Useful to negate (RSB Rd, Rn, #0).',                                      syn: 'RSB Rd, Rn, <op2>' },
  MUL:  { name: 'Multiply',                desc: 'Rd = Rm × Rs  (lower 32 bits of 64-bit product).',                                         syn: 'MUL Rd, Rm, Rs' },
  MLA:  { name: 'Multiply Accumulate',     desc: 'Rd = Rm × Rs + Ra.',                                                                       syn: 'MLA Rd, Rm, Rs, Ra' },
  AND:  { name: 'Bitwise AND',             desc: 'Rd = Rn & op2.',                                                                           syn: 'AND Rd, Rn, <op2>' },
  ORR:  { name: 'Bitwise OR',              desc: 'Rd = Rn | op2.',                                                                           syn: 'ORR Rd, Rn, <op2>' },
  EOR:  { name: 'Bitwise XOR',             desc: 'Rd = Rn ^ op2  (exclusive OR).',                                                           syn: 'EOR Rd, Rn, <op2>' },
  BIC:  { name: 'Bit Clear',               desc: 'Rd = Rn & ~op2.  Clears bits where op2 is 1.',                                             syn: 'BIC Rd, Rn, <op2>' },
  LSL:  { name: 'Logical Shift Left',      desc: 'Rd = Rm << #sa.  Zeros fill from right.  Each shift = ×2.',                               syn: 'LSL Rd, Rm, #sa' },
  LSR:  { name: 'Logical Shift Right',     desc: 'Rd = Rm >> #sa (unsigned).  Zeros fill from left.  Each shift = ÷2.',                     syn: 'LSR Rd, Rm, #sa' },
  ASR:  { name: 'Arithmetic Shift Right',  desc: 'Rd = Rm >> #sa (signed).  Sign bit replicates.  Each shift = signed ÷2.',                 syn: 'ASR Rd, Rm, #sa' },
  ROR:  { name: 'Rotate Right',            desc: 'Rd = Rm rotated right #sa bits.  Bits shifted out wrap to the left.',                      syn: 'ROR Rd, Rm, #sa' },
  CMP:  { name: 'Compare',                 desc: 'Computes Rn − op2 and sets flags. Result is discarded.',                                   syn: 'CMP Rn, <op2>',          note: 'Sets N, Z, C, V.' },
  CMN:  { name: 'Compare Negative',        desc: 'Computes Rn + op2 and sets flags. Result is discarded.',                                   syn: 'CMN Rn, <op2>' },
  TST:  { name: 'Test Bits',               desc: 'Computes Rn & op2 and sets flags. Result is discarded.',                                   syn: 'TST Rn, <op2>' },
  LDR:  { name: 'Load Register',           desc: 'Loads a 32-bit word from memory into Rd.',                                                  syn: 'LDR Rd, [Rn, #off]',    note: 'Effective address = Rn + offset.' },
  STR:  { name: 'Store Register',          desc: 'Stores Rd as a 32-bit word to memory.',                                                    syn: 'STR Rd, [Rn, #off]' },
  LDRB: { name: 'Load Byte (unsigned)',    desc: 'Loads 1 byte from memory, zero-extended to 32 bits.',                                      syn: 'LDRB Rd, [Rn, #off]' },
  STRB: { name: 'Store Byte',              desc: 'Stores the lowest byte of Rd to memory.',                                                  syn: 'STRB Rd, [Rn, #off]' },
  PUSH: { name: 'Push Registers',          desc: 'Pushes a register list onto the stack (SP decrements by 4 per register).',                 syn: 'PUSH {R0, R1, LR}' },
  POP:  { name: 'Pop Registers',           desc: 'Pops registers from the stack (SP increments by 4 per register).',                         syn: 'POP {R0, R1, PC}' },
  NOP:  { name: 'No Operation',            desc: 'Does nothing for one cycle. Used for alignment or pipeline padding.',                       syn: 'NOP' },
  B:    { name: 'Branch',                  desc: 'Unconditional jump to label.',                                                              syn: 'B label' },
  BL:   { name: 'Branch with Link',        desc: 'Jump to label and save the return address in LR (R14).',                                    syn: 'BL label' },
  BX:   { name: 'Branch and Exchange',     desc: 'Jump to address in Rm. If Rm[0]=1, switches to Thumb mode.',                               syn: 'BX Rm' },
  BEQ:  { name: 'Branch if Equal',         desc: 'Branch if Z = 1  (previous result was zero / equal).',                                     syn: 'BEQ label' },
  BNE:  { name: 'Branch if Not Equal',     desc: 'Branch if Z = 0  (previous result was non-zero / not equal).',                             syn: 'BNE label' },
  BLT:  { name: 'Branch if Less Than',     desc: 'Branch if N ≠ V  (signed less than).',                                                     syn: 'BLT label' },
  BLE:  { name: 'Branch if Less/Equal',    desc: 'Branch if Z = 1 or N ≠ V  (signed ≤).',                                                   syn: 'BLE label' },
  BGT:  { name: 'Branch if Greater Than',  desc: 'Branch if Z = 0 and N = V  (signed greater than).',                                        syn: 'BGT label' },
  BGE:  { name: 'Branch if Greater/Equal', desc: 'Branch if N = V  (signed ≥).',                                                             syn: 'BGE label' },
  BCS:  { name: 'Branch if Carry Set',     desc: 'Branch if C = 1  (unsigned ≥, or addition produced a carry).',                             syn: 'BCS label' },
  BCC:  { name: 'Branch if Carry Clear',   desc: 'Branch if C = 0  (unsigned <).',                                                           syn: 'BCC label' },
  BMI:  { name: 'Branch if Minus',         desc: 'Branch if N = 1  (result was negative).',                                                  syn: 'BMI label' },
  BPL:  { name: 'Branch if Plus',          desc: 'Branch if N = 0  (result was non-negative).',                                              syn: 'BPL label' },
  BHI:  { name: 'Branch if Higher',        desc: 'Branch if C = 1 and Z = 0  (unsigned >).',                                                 syn: 'BHI label' },
  BLS:  { name: 'Branch if Lower/Same',    desc: 'Branch if C = 0 or Z = 1  (unsigned ≤).',                                                 syn: 'BLS label' },
  VMOV: { name: 'NEON Move / Transfer',    desc: 'Copy a Q/D register, broadcast an immediate, or transfer between ARM and NEON registers.', syn: 'VMOV Qd, Qn  |  VMOV Rd, Sn' },
  VADD: { name: 'NEON Vector Add',         desc: 'Adds corresponding lanes: Qd[i] = Qn[i] + Qm[i].',                                        syn: 'VADD.I32 Qd, Qn, Qm',   note: 'Type suffix: I8 I16 I32 F32' },
  VSUB: { name: 'NEON Vector Subtract',    desc: 'Subtracts lanes: Qd[i] = Qn[i] − Qm[i].',                                                 syn: 'VSUB.I32 Qd, Qn, Qm' },
  VMUL: { name: 'NEON Vector Multiply',    desc: 'Multiplies lanes: Qd[i] = Qn[i] × Qm[i].',                                                syn: 'VMUL.I32 Qd, Qn, Qm' },
  VMLA: { name: 'NEON Multiply-Accumulate',desc: 'Qd[i] += Qn[i] × Qm[i].  Accumulates into Qd.',                                         syn: 'VMLA.I32 Qd, Qn, Qm' },
  VAND: { name: 'NEON Bitwise AND',        desc: 'Qd = Qn & Qm  (bitwise, all lanes).',                                                     syn: 'VAND Qd, Qn, Qm' },
  VORR: { name: 'NEON Bitwise OR',         desc: 'Qd = Qn | Qm  (bitwise, all lanes).',                                                     syn: 'VORR Qd, Qn, Qm' },
  VEOR: { name: 'NEON Bitwise XOR',        desc: 'Qd = Qn ^ Qm  (bitwise, all lanes).',                                                     syn: 'VEOR Qd, Qn, Qm' },
  VMAX: { name: 'NEON Lane Maximum',       desc: 'Qd[i] = max(Qn[i], Qm[i]).',                                                              syn: 'VMAX.S32 Qd, Qn, Qm' },
  VMIN: { name: 'NEON Lane Minimum',       desc: 'Qd[i] = min(Qn[i], Qm[i]).',                                                              syn: 'VMIN.S32 Qd, Qn, Qm' },
  VSHL: { name: 'NEON Shift Left',         desc: 'Qd[i] = Qm[i] << #imm  (logical left shift per lane).',                                   syn: 'VSHL.I32 Qd, Qm, #imm' },
  VSHR: { name: 'NEON Shift Right',        desc: 'Qd[i] = Qm[i] >> #imm.  U = unsigned (zero-fill), S = signed (sign-fill).',               syn: 'VSHR.U32 Qd, Qm, #imm' },
  VDUP: { name: 'NEON Duplicate / Broadcast', desc: 'Copies an ARM register or scalar into every lane of Qd.',                              syn: 'VDUP.32 Qd, Rm' },
  VLD1: { name: 'NEON Load (1 struct)',    desc: 'Loads consecutive 32-bit elements from memory into one Q register (4 lanes).',             syn: 'VLD1.32 {Qd}, [Rn]',    note: 'Rn is byte address. No auto-increment.' },
  VST1: { name: 'NEON Store (1 struct)',   desc: 'Stores 4 consecutive 32-bit elements from Qd to memory.',                                  syn: 'VST1.32 {Qd}, [Rn]' },
  VLD2: { name: 'NEON Load (2 interleaved)', desc: 'Loads interleaved pairs from memory: even elements → Qd, odd elements → Qd+1.',         syn: 'VLD2.32 {Qd, Qd+1}, [Rn]' },
  VST2: { name: 'NEON Store (2 interleaved)', desc: 'Stores two Q registers interleaved to memory.',                                          syn: 'VST2.32 {Qd, Qd+1}, [Rn]' },
  VPADD: { name: 'NEON Pairwise Add',      desc: 'Adds adjacent pairs within each D register.\nDd[0]=Dn[0]+Dn[1],  Dd[1]=Dm[0]+Dm[1].',    syn: 'VPADD.I32 Dd, Dn, Dm',  note: 'Operates on D (64-bit) registers, not Q.' },
  VNEG: { name: 'NEON Negate',             desc: 'Qd[i] = −Qm[i] for each lane.',                                                            syn: 'VNEG.S32 Qd, Qm' },
  VABS: { name: 'NEON Absolute Value',     desc: 'Qd[i] = |Qm[i]| for each lane.',                                                           syn: 'VABS.S32 Qd, Qm' },
  VCEQ: { name: 'NEON Compare Equal',      desc: 'Qd[i] = 0xFFFFFFFF if Qn[i] == Qm[i], else 0.',                                           syn: 'VCEQ.I32 Qd, Qn, Qm' },
  VCGT: { name: 'NEON Compare Greater',    desc: 'Qd[i] = 0xFFFFFFFF if Qn[i] > Qm[i], else 0.',                                            syn: 'VCGT.S32 Qd, Qn, Qm' },
  VCLT: { name: 'NEON Compare Less',       desc: 'Qd[i] = 0xFFFFFFFF if Qn[i] < Qm[i], else 0.',                                            syn: 'VCLT.S32 Qd, Qn, Qm' },
  SUBS: { name: 'Subtract + Set Flags',    desc: 'Rd = Rn − op2, then updates N, Z, C, V.  Often used as loop counter decrement.',           syn: 'SUBS Rd, Rn, <op2>' },
  ADDS: { name: 'Add + Set Flags',         desc: 'Rd = Rn + op2, then updates N, Z, C, V.',                                                   syn: 'ADDS Rd, Rn, <op2>' },

  // ── AArch64 ALU ──────────────────────────────────────────────────────────────
  MOVZ: { name: 'Move with Zero',          desc: 'Rd = imm16 << shift.  Zeroes the rest of the register.  Use MOVK for wide constants.',      syn: 'MOVZ Xd, #imm{, LSL #shift}' },
  MOVK: { name: 'Move with Keep',          desc: 'Writes imm16 into a 16-bit slice of Xd, leaving other bits unchanged.  Used after MOVZ.',   syn: 'MOVK Xd, #imm{, LSL #shift}' },
  NEG:  { name: 'Negate',                  desc: 'Rd = 0 − Rm  (two\'s complement negation).',                                               syn: 'NEG Rd, Rm' },
  RET:  { name: 'Return',                  desc: 'Branch to the address in LR (X30).  Equivalent to BR X30.  Ends a subroutine.',             syn: 'RET{, Xn}',                    note: 'AArch64 calling convention: X0–X7 for args, X0 for return.' },
  LDP:  { name: 'Load Pair',               desc: 'Loads two registers from consecutive memory addresses.  SP must be 16-byte aligned.',       syn: 'LDP Xt1, Xt2, [Xn, #off]' },
  STP:  { name: 'Store Pair',              desc: 'Stores two registers to consecutive memory addresses.  Often used to save frame registers.', syn: 'STP Xt1, Xt2, [Xn, #off]' },
  UMULL:{ name: 'Unsigned Multiply Long',  desc: 'Xd = Wn × Wm  (unsigned 32×32→64 bit multiply).',                                          syn: 'UMULL Xd, Wn, Wm' },
  SMULL:{ name: 'Signed Multiply Long',    desc: 'Xd = Wn × Wm  (signed 32×32→64 bit multiply).',                                            syn: 'SMULL Xd, Wn, Wm' },
  CBZ:  { name: 'Compare and Branch Zero', desc: 'Branch to label if Xn == 0.  Does not affect flags.',                                       syn: 'CBZ Xn, label' },
  CBNZ: { name: 'Compare and Branch NZ',   desc: 'Branch to label if Xn != 0.  Does not affect flags.',                                       syn: 'CBNZ Xn, label' },

  // ── AArch64 / Advanced SIMD (V registers) ───────────────────────────────────
  DUP:  { name: 'SIMD Duplicate / Broadcast', desc: 'Copies a scalar (Wn/Xn or a lane) into every lane of Vd.\nVd.4S means 4×32-bit lanes.', syn: 'DUP Vd.<T>, Wn',               note: 'AArch64 equivalent of ARMv7 VDUP.' },
  LD1:  { name: 'SIMD Load (1 register)',  desc: 'Loads one SIMD register from consecutive memory lanes.\n{V2.4S} means 4×32-bit elements.',  syn: 'LD1 {Vd.<T>}, [Xn]',          note: 'AArch64 equivalent of VLD1. Optional post-index: [Xn], #16.' },
  ST1:  { name: 'SIMD Store (1 register)', desc: 'Stores one SIMD register to consecutive memory lanes.',                                      syn: 'ST1 {Vd.<T>}, [Xn]',          note: 'AArch64 equivalent of VST1.' },
  USHR: { name: 'SIMD Unsigned Shift Right',desc: 'Vd[i] = Vn[i] >> #imm  (zero-fill per lane).',                                            syn: 'USHR Vd.<T>, Vn.<T>, #imm',   note: 'AArch64 equivalent of VSHR.U32.' },
  SSHR: { name: 'SIMD Signed Shift Right', desc: 'Vd[i] = Vn[i] >> #imm  (sign-fill per lane).',                                             syn: 'SSHR Vd.<T>, Vn.<T>, #imm' },
  SHL:  { name: 'SIMD Shift Left',         desc: 'Vd[i] = Vn[i] << #imm  (logical left shift per lane).',                                    syn: 'SHL Vd.<T>, Vn.<T>, #imm',    note: 'AArch64 equivalent of VSHL.' },
};

export interface LookupResult extends InstrInfo { mn: string }

const CC_NAMES: Record<string, string> = {
  EQ: 'Equal (Z=1)', NE: 'Not Equal (Z=0)',
  LT: 'Less Than (signed)', LE: 'Less or Equal (signed)',
  GT: 'Greater Than (signed)', GE: 'Greater or Equal (signed)',
  CS: 'Carry Set (unsigned ≥)', CC: 'Carry Clear (unsigned <)',
  MI: 'Minus / Negative', PL: 'Plus / Non-negative',
  HI: 'Higher (unsigned >)', LS: 'Lower or Same (unsigned ≤)',
  VS: 'Overflow Set', VC: 'Overflow Clear', AL: 'Always',
};

export function lookupInstrRef(tok: string): LookupResult | null {
  const upper = tok.toUpperCase();
  const mn    = upper.replace(/\..*$/, '');  // strip type suffix (.32, .I32, .4S, .GT …)

  if (INSTR_REF[mn]) return { mn, ...INSTR_REF[mn] };

  // AArch64 conditional branch: B.GT, B.EQ, B.NE …
  const bcc = upper.match(/^B\.([A-Z]{2})$/);
  if (bcc) {
    const cc   = bcc[1];
    const desc = CC_NAMES[cc] ?? cc;
    const base = INSTR_REF['B']!;
    return { mn: upper, ...base, name: `Branch if ${desc}`, syn: `B.${cc} label` };
  }

  // ARMv7 conditional data-processing: ADDEQ, SUBNE, MOVGT …
  const condMov = mn.match(/^(MOV|ADD|SUB|AND|ORR|EOR|RSB|MUL|LDR|STR|MVN)(S?)(EQ|NE|LT|LE|GT|GE|CS|CC|MI|PL|HI|LS|AL)$/);
  if (condMov && INSTR_REF[condMov[1]]) {
    const cc = condMov[3];
    return { mn, ...INSTR_REF[condMov[1]], name: INSTR_REF[condMov[1]].name + ` (if ${cc})` };
  }

  return null;
}
