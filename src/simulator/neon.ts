import type { SimulatorState, ParsedInstruction } from '../types';
import { hex8 } from './state';
import { parseReg } from '../parser/registers';
import { rQ, memRn, parseNR } from '../parser/registers';

// ── NEON Q-register helpers (Int32Array of length 4) ──────────────────────

export function qGetU32(neon: Int32Array[], qi: number): number[] {
  return Array.from(neon[qi]).map(v => v >>> 0);
}

export function qSetU32(neon: Int32Array[], qi: number, vals: number[]): void {
  neon[qi].set(vals.map(v => v | 0));
}

export function qGetLanes(neon: Int32Array[], qi: number, bits: number): number[] {
  const u32 = qGetU32(neon, qi);
  if (bits === 32) return u32;
  if (bits === 16) return u32.flatMap(v => [v & 0xFFFF, (v >>> 16) & 0xFFFF]);
  if (bits === 8)  return u32.flatMap(v => [v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >> 24) & 0xFF]);
  return u32;
}

export function qSetLanes(neon: Int32Array[], qi: number, bits: number, vals: number[]): void {
  if (bits === 32) { qSetU32(neon, qi, vals); return; }
  if (bits === 16) {
    const u32 = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) u32[i] = ((vals[i * 2 + 1] & 0xFFFF) << 16) | (vals[i * 2] & 0xFFFF);
    qSetU32(neon, qi, u32);
  } else if (bits === 8) {
    const u32 = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      u32[i] = (vals[i * 4] & 0xFF) | ((vals[i * 4 + 1] & 0xFF) << 8) |
               ((vals[i * 4 + 2] & 0xFF) << 16) | ((vals[i * 4 + 3] & 0xFF) << 24);
    }
    qSetU32(neon, qi, u32);
  }
}

/** Get the two Int32 lanes from a D register */
function getDLanes(neon: Int32Array[], di: number): number[] {
  const qi = di >> 1, h = di & 1;
  const arr = qGetU32(neon, qi);
  return h ? [arr[2], arr[3]] : [arr[0], arr[1]];
}

/** Set the two Int32 lanes into a D register */
function setDLanes(neon: Int32Array[], di: number, vals: number[]): void {
  const qi = di >> 1, h = di & 1;
  const arr = Array.from(neon[qi]);
  if (h) { arr[2] = vals[0] | 0; arr[3] = vals[1] | 0; }
  else   { arr[0] = vals[0] | 0; arr[1] = vals[1] | 0; }
  neon[qi].set(arr);
}

// ── Lane-wise arithmetic ──────────────────────────────────────────────────

function nLaneOp(isF: boolean, isS: boolean, ls: number, a: number, b: number, op: string): number {
  if (isF && ls === 32) {
    const fa = new Float32Array(new Uint32Array([a >>> 0]).buffer)[0];
    const fb = new Float32Array(new Uint32Array([b >>> 0]).buffer)[0];
    let r: number;
    if      (op === 'ADD') r = fa + fb;
    else if (op === 'SUB') r = fa - fb;
    else if (op === 'MUL') r = fa * fb;
    else if (op === 'ABS') r = Math.abs(fa);
    else if (op === 'NEG') r = -fa;
    else if (op === 'MAX') r = Math.max(fa, fb);
    else if (op === 'MIN') r = Math.min(fa, fb);
    else r = fa;
    return new Uint32Array(new Float32Array([r]).buffer)[0];
  }
  const ua = a >>> 0, ub = b >>> 0;
  const mask = ls >= 32 ? 0xFFFFFFFF : (1 << ls) - 1;
  const sa = a | 0, sb = b | 0;
  switch (op) {
    case 'ADD': return (ua + ub) & mask;
    case 'SUB': return (ua - ub) & mask;
    case 'MUL': return (Math.imul(ua, ub) >>> 0) & mask;
    case 'AND': return (ua & ub) & mask;
    case 'ORR': return (ua | ub) & mask;
    case 'EOR': return (ua ^ ub) & mask;
    case 'ABS': return (isS ? Math.abs(sa) : ua) & mask;
    case 'NEG': return (-ua) & mask;
    case 'MAX': return (isS ? Math.max(sa, sb) : Math.max(ua, ub)) & mask;
    case 'MIN': return (isS ? Math.min(sa, sb) : Math.min(ua, ub)) & mask;
    case 'SHL': return (ua << (ub & 31)) & mask;
    case 'SHR': return isS ? (sa >> (ub & 31)) & mask : (ua >>> (ub & 31)) & mask;
    default: return ua & mask;
  }
}

// ── Main NEON dispatcher ──────────────────────────────────────────────────

export function execNeon(st: SimulatorState, instr: ParsedInstruction): string {
  const toks = instr.tokens;
  const n0 = (toks[0] || '').toUpperCase();
  const opMatch = n0.match(/^([A-Z][A-Z0-9]*)(?:\.([UuIiSsFf]?)(\d+))?$/);
  const op    = opMatch ? opMatch[1] : n0;
  const kind  = ((opMatch && opMatch[2]) || 'I').toUpperCase();
  const ls    = opMatch && opMatch[3] ? +opMatch[3] : 32;
  const isF   = kind === 'F';
  const isS   = kind === 'S' || kind === 'I';
  const lpq   = 128 / ls;  // lanes per Q register
  const { neon } = st;

  function parseImm(t: string | undefined): number {
    if (!t) return NaN;
    t = t.trim();
    if (t.startsWith('#')) t = t.slice(1);
    return parseInt(t, 10);
  }

  switch (op) {
    case 'VLD1': {
      const dq = rQ(toks[1]); const rn = memRn(toks[2]);
      const addr = st.regs[rn] >>> 0; const es = ls >> 3;
      const vals = Array.from({ length: lpq }, (_, i) => st.memory[(addr + i * es) >>> 0] ?? 0);
      qSetLanes(neon, dq, ls, vals); st.neonChg.add(dq);
      return `VLD1 Q${dq}←[${hex8(addr)}]`;
    }

    case 'VST1': {
      const dq = rQ(toks[1]); const rn = memRn(toks[2]);
      const addr = st.regs[rn] >>> 0; const es = ls >> 3;
      qGetLanes(neon, dq, ls).forEach((v, i) => { st.memory[(addr + i * es) >>> 0] = v; });
      return `VST1 [${hex8(addr)}]←Q${dq}`;
    }

    case 'VLD2': {
      const dq = rQ(toks[1]); const rn = memRn(toks[2]);
      const addr = st.regs[rn] >>> 0; const es = ls >> 3;
      const vals = Array.from({ length: lpq * 2 }, (_, i) => st.memory[(addr + i * es) >>> 0] ?? 0);
      qSetLanes(neon, dq,     ls, vals.filter((_, i) => i % 2 === 0));
      qSetLanes(neon, dq + 1, ls, vals.filter((_, i) => i % 2 === 1));
      st.neonChg.add(dq); st.neonChg.add(dq + 1);
      return `VLD2 Q${dq},Q${dq + 1}`;
    }

    case 'VST2': {
      const dq = rQ(toks[1]); const rn = memRn(toks[2]);
      const addr = st.regs[rn] >>> 0; const es = ls >> 3;
      const a = qGetLanes(neon, dq, ls), b = qGetLanes(neon, dq + 1, ls);
      a.forEach((v, i) => {
        st.memory[(addr + i * 2 * es) >>> 0] = v;
        st.memory[(addr + (i * 2 + 1) * es) >>> 0] = b[i];
      });
      return `VST2`;
    }

    case 'VMOV': {
      const rd = parseReg(toks[1]);
      if (rd >= 0) {
        const nr = parseNR((toks[2] ?? '').trim());
        if (nr && nr.t === 'S') {
          const qi = nr.i >> 2, lane = nr.i & 3;
          const v = new DataView(neon[qi].buffer).getUint32(lane * 4, true);
          st.regs[rd] = v | 0;
          st.changed.add(rd);
          return `VMOV R${rd}=S${nr.i}`;
        }
      }
      const dq = rQ(toks[1]);
      const imm = parseImm(toks[2]);
      if (!isNaN(imm)) {
        qSetLanes(neon, dq, ls, new Array(lpq).fill(imm >>> 0));
        st.neonChg.add(dq);
      } else {
        const sq = rQ(toks[2]);
        neon[dq].set(neon[sq]);
        st.neonChg.add(dq);
      }
      return `VMOV Q${dq}`;
    }

    case 'VADD': case 'VSUB': case 'VMUL': case 'VAND': case 'VORR':
    case 'VEOR': case 'VMAX': case 'VMIN': {
      const on = op.slice(1);
      const dq = rQ(toks[1]), sq1 = rQ(toks[2]), sq2 = rQ(toks[3]);
      const a = qGetLanes(neon, sq1, ls), b = qGetLanes(neon, sq2, ls);
      qSetLanes(neon, dq, ls, a.map((v, i) => nLaneOp(isF, isS, ls, v, b[i], on)));
      st.neonChg.add(dq);
      return `${op} Q${dq}`;
    }

    case 'VSHL': case 'VSHR': {
      const on = op.slice(1);
      const dq = rQ(toks[1]), sq = rQ(toks[2]);
      const sa = parseImm(toks[3]) || 0;
      const a = qGetLanes(neon, sq, ls);
      qSetLanes(neon, dq, ls, a.map(v => nLaneOp(isF, isS, ls, v, sa, on)));
      st.neonChg.add(dq);
      return `${op} Q${dq}#${sa}`;
    }

    case 'VMLA': {
      const dq = rQ(toks[1]), sq1 = rQ(toks[2]), sq2 = rQ(toks[3]);
      const a = qGetLanes(neon, sq1, ls), b = qGetLanes(neon, sq2, ls);
      const ac = qGetLanes(neon, dq, ls);
      qSetLanes(neon, dq, ls, a.map((v, i) => (nLaneOp(isF, isS, ls, v, b[i], 'MUL') + ac[i]) & 0xFFFFFFFF));
      st.neonChg.add(dq);
      return `VMLA Q${dq}`;
    }

    case 'VNEG': case 'VABS': {
      const on = op.slice(1);
      const dq = rQ(toks[1]), sq = rQ(toks[2]);
      const a = qGetLanes(neon, sq, ls);
      qSetLanes(neon, dq, ls, a.map(v => nLaneOp(isF, isS, ls, v, 0, on)));
      st.neonChg.add(dq);
      return `${op} Q${dq}`;
    }

    case 'VDUP': {
      const dq = rQ(toks[1]);
      const ri = parseReg(toks[2]);
      const val = ri >= 0 ? st.regs[ri] : (parseImm(toks[2]) || 0);
      qSetLanes(neon, dq, ls, new Array(lpq).fill(val >>> 0));
      st.neonChg.add(dq);
      return `VDUP Q${dq}←${ri >= 0 ? `R${ri}` : val}`;
    }

    case 'VPADD': {
      // VPADD Dd, Dn, Dm — pairwise add on D (64-bit) registers
      const ddNr = parseNR((toks[1] ?? '').trim());
      const dnNr = parseNR((toks[2] ?? '').trim());
      const dmNr = parseNR((toks[3] ?? '').trim());
      const dd = ddNr?.i ?? 0, dn = dnNr?.i ?? 0, dm = dmNr?.i ?? 0;
      const la = getDLanes(neon, dn), lb = getDLanes(neon, dm);
      setDLanes(neon, dd, [(la[0] + la[1]) >>> 0, (lb[0] + lb[1]) >>> 0]);
      st.neonChg.add(dd >> 1);
      return `VPADD D${dd}`;
    }

    case 'VCEQ': case 'VCGT': case 'VCLT': {
      const ct = op.slice(2);
      const dq = rQ(toks[1]), sq1 = rQ(toks[2]), sq2 = rQ(toks[3]);
      const a = qGetLanes(neon, sq1, ls), b = qGetLanes(neon, sq2, ls);
      const mask = ls >= 32 ? 0xFFFFFFFF : (1 << ls) - 1;
      qSetLanes(neon, dq, ls, a.map((v, i) =>
        (ct === 'EQ' ? v === b[i] : ct === 'GT' ? v > b[i] : v < b[i]) ? mask : 0
      ));
      st.neonChg.add(dq);
      return `${op} Q${dq}`;
    }

    default:
      throw new Error(`Unknown NEON instruction: ${op}`);
  }
}
