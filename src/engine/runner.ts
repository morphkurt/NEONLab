import type { SimulatorState, ParsedSig, VecRow, VecResult } from '../types';
import { createState, toS32 } from '../simulator/state';
import { applyVecToUnicorn } from '../binding/vector';
import type { PtrInfo } from '../binding/vector';
import type { UnicornModule, KeystoneModule } from './types';

let ucMod: UnicornModule | null = null;
let ksMod: KeystoneModule | null = null;
export let enginesReady = false;

export function setEngines(uc: UnicornModule, ks: KeystoneModule): void {
  ucMod = uc; ksMod = ks; enginesReady = true;
}

function mc2bytes(mc: Record<number, number>): Uint8Array {
  const b = new Uint8Array(Object.keys(mc).length);
  Object.keys(mc).forEach(k => { b[+k] = mc[+k]; });
  return b;
}

function stripComments(src: string): string {
  return src.split('\n').map(l => {
    const i = l.indexOf('//');
    return i >= 0 ? l.slice(0, i) : l;
  }).join('\n');
}

export async function runWithUnicorn(
  srcCode: string,
  parsed: ParsedSig | null,
  vectorObj: VecRow,
): Promise<{ st: SimulatorState; retVal: number | null; outPtrs: Record<string, number[]> }> {
  if (!ucMod || !ksMod) throw new Error('Engines not ready');
  const uc = ucMod, ks = ksMod;
  const ksh = new ks.Keystone(ks.ARCH_ARM, ks.MODE_ARM);
  const src = stripComments(srcCode);
  const asmResult = ksh.asm(src, 0x8000);
  ksh.close();
  if (asmResult.failed || !asmResult.mc || Object.keys(asmResult.mc).length === 0) {
    throw new Error('Assembly failed');
  }
  const codeBytes = mc2bytes(asmResult.mc);

  const mu = new uc.Unicorn(uc.ARCH_ARM, uc.MODE_ARM);
  mu.reg_write_i32(uc.ARM_REG_C1_C0_2, 0xF << 20);
  mu.reg_write_i32(uc.ARM_REG_FPEXC, 0x40000000);
  mu.mem_map(0x8000, 0x8000, uc.PROT_ALL);
  mu.mem_write(0x8000, codeBytes);
  mu.mem_map(0x100000, 0x100000, uc.PROT_ALL);
  mu.mem_map(0x200000, 0x10000, uc.PROT_ALL);
  mu.reg_write_i32(uc.ARM_REG_SP, 0x20FFFC);

  let ptrs: Record<string, PtrInfo> = {};
  if (parsed) {
    ptrs = applyVecToUnicorn(mu, uc as unknown as Record<string, number>, parsed, vectorObj);
  }
  mu.emu_start(0x8000, 0x8000 + codeBytes.length, 0, 1000000);

  const st = createState();
  const gpRegs = [
    uc.ARM_REG_R0, uc.ARM_REG_R1, uc.ARM_REG_R2,  uc.ARM_REG_R3,
    uc.ARM_REG_R4, uc.ARM_REG_R5, uc.ARM_REG_R6,  uc.ARM_REG_R7,
    uc.ARM_REG_R8, uc.ARM_REG_R9, uc.ARM_REG_R10, uc.ARM_REG_R11,
    uc.ARM_REG_R12, uc.ARM_REG_SP, uc.ARM_REG_LR,  uc.ARM_REG_PC,
  ];
  gpRegs.forEach((r, i) => { st.regs[i] = mu.reg_read_i32(r); st.changed.add(i); });

  for (let qi = 0; qi < 16; qi++) {
    const view = new DataView(st.neon[qi].buffer);
    for (let lane = 0; lane < 4; lane++) {
      const sRegKey = `ARM_REG_S${qi * 4 + lane}`;
      const sReg = (uc as unknown as Record<string, number>)[sRegKey];
      if (sReg !== undefined) {
        try { view.setInt32(lane * 4, mu.reg_read_i32(sReg), true); } catch (_) { /* ignore */ }
      }
    }
    st.neonChg.add(qi);
  }

  const outPtrs: Record<string, number[]> = {};
  if (parsed) {
    parsed.params.forEach(p => {
      if (p.kind.base === 'ptr' && ptrs[p.name]) {
        const { addr, count, elemSize } = ptrs[p.name];
        const rawBuf = mu.mem_read(addr, count * elemSize);
        const buf = rawBuf instanceof Uint8Array ? rawBuf : new Uint8Array(rawBuf);
        const view = new DataView(buf.buffer);
        outPtrs[p.name] = Array.from({ length: count }, (_, i) => {
          if (elemSize === 1) return view.getUint8(i);
          if (elemSize === 2) return view.getInt16(i * 2, true);
          return view.getInt32(i * 4, true);
        });
      }
    });
  }

  mu.close();

  const retVal = toS32(st.regs[0]);
  return { st, retVal, outPtrs };
}

export function makeVecResult(retVal: number | null, outPtrs: Record<string, number[]>, engine: 'js' | 'qemu'): VecResult {
  return { scalar: { retVal, outPtrs }, neon: null, aarch64: null, engine };
}
