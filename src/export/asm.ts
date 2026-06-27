import { activeFn } from '../registry/functions';
import { getCodeValue, getSigValue } from '../ui/editor';
import { parseSig } from '../parser/signature';
import type { ParsedSig, VecRow } from '../types';

// Convert NEONLab asm to GCC inline asm string literals, prefixing labels to avoid conflicts
function convertAsm(code: string, prefix: string, isAarch64 = false): string {
  const lines = code
    .split('\n')
    .map(l => isAarch64
      ? l.replace(/\/\/.*/g, '').trimEnd()   // strip: @ is not a comment char in AArch64
      : l.replace(/\/\/(.*)/g, '@ $1').trimEnd())
    .filter(l => l.trim());

  const labels = new Set<string>();
  for (const line of lines) {
    const m = line.trim().match(/^(\w+)\s*:/);
    if (m) labels.add(m[1].toUpperCase());
  }

  const out: string[] = [];
  for (const line of lines) {
    let l = line.trim();
    for (const lbl of labels) {
      l = l.replace(new RegExp(`\\b${lbl}\\s*:`, 'gi'), `.L${prefix}_${lbl.toLowerCase()}:`);
      l = l.replace(new RegExp(`\\b${lbl}\\b(?!\\s*:)`, 'gi'), `.L${prefix}_${lbl.toLowerCase()}`);
    }
    out.push(`        "${l}\\n"`);
  }

  const last = out[out.length - 1] ?? '';
  if (isAarch64) {
    if (!/\bRET\b/i.test(last)) out.push('        "RET\\n"');
  } else {
    if (!/BX\s+LR|MOV\s+PC,\s*LR|POP\s*\{[^}]*PC/i.test(last)) {
      out.push('        "BX LR\\n"');
    }
  }
  return out.join('\n');
}

function cDecl(parsed: ParsedSig, suffix: string): string {
  const params = parsed.params
    .map(p => `${p.type.includes('*') ? p.type.replace('*', ' *') : p.type} ${p.name}`)
    .join(', ') || 'void';
  return `${parsed.returnType} ${parsed.name}_${suffix}(${params})`;
}

function parseArrStr(s: string): number[] {
  const inner = s.trim().startsWith('[') ? s.trim().slice(1, s.trim().lastIndexOf(']')) : s;
  return inner.split(',').map(x => parseFloat(x.trim())).filter(x => !isNaN(x));
}

function declareParams(parsed: ParsedSig, vec: VecRow, suffix: string): string {
  let s = '';
  parsed.params.forEach(p => {
    if (p.kind.base === 'ptr') {
      const vals = parseArrStr(vec[p.name] ?? '');
      const elem = p.type.replace(/\*/g, '').trim();
      s += `        ${elem} ${p.name}_${suffix}[] = {${vals.join(', ')}};\n`;
    } else {
      const v = parseInt(vec[p.name] ?? '0') || 0;
      s += `        ${p.type} ${p.name} = ${v};\n`;
    }
  });
  return s;
}

function callArgs(parsed: ParsedSig, suffix: string): string {
  return parsed.params.map(p => p.kind.base === 'ptr' ? `${p.name}_${suffix}` : p.name).join(', ');
}

function buildTimingBlock(name: string, parsed: ParsedSig, vec: VecRow,
                          entries: Array<{ suffix: string; fn: string }>, N: number): string {
  let s = `    /* timing: ${N} iterations on vector 1 */\n    {\n`;
  entries.forEach(({ suffix, fn }) => {
    parsed.params.forEach(p => {
      if (p.kind.base === 'ptr') {
        const vals = parseArrStr(vec[p.name] ?? '');
        const elem = p.type.replace(/\*/g, '').trim();
        s += `        ${elem} _t${suffix}_${p.name}[] = {${vals.join(', ')}};\n`;
      } else {
        const v = parseInt(vec[p.name] ?? '0') || 0;
        s += `        ${p.type} _t_${p.name} = ${v};\n`;
      }
    });
    const args = parsed.params.map(p => p.kind.base === 'ptr' ? `_t${suffix}_${p.name}` : `_t_${p.name}`).join(', ');
    s += `        struct timespec _t0_${suffix}, _t1_${suffix};\n`;
    s += `        clock_gettime(CLOCK_MONOTONIC, &_t0_${suffix});\n`;
    s += `        for (int _i = 0; _i < ${N}; _i++) ${name}_${fn}(${args});\n`;
    s += `        clock_gettime(CLOCK_MONOTONIC, &_t1_${suffix});\n`;
    s += `        double ${suffix}_ms = (_t1_${suffix}.tv_sec-_t0_${suffix}.tv_sec)*1000.0`
       + ` + (_t1_${suffix}.tv_nsec-_t0_${suffix}.tv_nsec)/1e6;\n`;
  });
  return s;
}

function buildMain(parsed: ParsedSig, vectors: VecRow[]): string {
  const name     = parsed.name;
  const hasRet   = parsed.returnType !== 'void';
  const firstPtr = parsed.params.find(p => p.kind.base === 'ptr');
  const N_ITER   = 10000;

  let s = `    int pass = 0, fail = 0;\n\n`;

  // ── AArch64 branch ──────────────────────────────────────────────────────────
  s += `#ifdef __aarch64__\n`;
  vectors.forEach((vec, vi) => {
    s += `    /* vector ${vi + 1} */\n    {\n`;
    s += declareParams(parsed, vec, 'a');
    if (hasRet) s += `        ${parsed.returnType} ret_a = ${name}_aarch64(${callArgs(parsed, 'a')});\n`;
    else        s += `        ${name}_aarch64(${callArgs(parsed, 'a')});\n`;

    if (firstPtr) {
      const vals = parseArrStr(vec[firstPtr.name] ?? '');
      const n    = vals.length;
      s += `        printf("Vector ${vi + 1}: [");\n`;
      s += `        for (int i = 0; i < ${n}; i++) printf("%d%s", ${firstPtr.name}_a[i], i<${n}-1?", ":"");\n`;
      s += `        printf("]  ret=%d\\n", ${hasRet ? '(int)ret_a' : '0'});\n`;
      s += `        int ok = 1;\n`;  // no reference to compare against in single-impl branch
    } else if (hasRet) {
      const exp = vec['expected'] ? parseInt(vec['expected']) : NaN;
      if (!isNaN(exp)) {
        s += `        int ok = (ret_a == ${exp});\n`;
        s += `        printf("Vector ${vi + 1}: %s  aarch64=%d\\n", ok?"PASS":"FAIL", (int)ret_a);\n`;
      } else {
        s += `        int ok = 1;\n`;
        s += `        printf("Vector ${vi + 1}: aarch64=%d\\n", (int)ret_a);\n`;
      }
    } else {
      s += `        int ok = 1;\n`;
      s += `        printf("Vector ${vi + 1}: ran\\n");\n`;
    }
    s += `        pass += ok; fail += !ok;\n`;
    s += `    }\n\n`;
  });
  if (vectors.length > 0) {
    s += buildTimingBlock(name, parsed, vectors[0], [{ suffix: 'a', fn: 'aarch64' }], N_ITER);
    s += `        printf("\\nTiming (${N_ITER} iters): aarch64=%.3f ms\\n", a_ms);\n    }\n\n`;
  }

  // ── ARMv7 branch: scalar vs NEON via memcmp ─────────────────────────────────
  s += `#else\n`;
  vectors.forEach((vec, vi) => {
    s += `    /* vector ${vi + 1} */\n    {\n`;
    s += declareParams(parsed, vec, 's');
    s += declareParams(parsed, vec, 'n');
    if (hasRet) {
      s += `        ${parsed.returnType} ret_s = ${name}_scalar(${callArgs(parsed, 's')});\n`;
      s += `        ${parsed.returnType} ret_n = ${name}_neon(${callArgs(parsed, 'n')});\n`;
    } else {
      s += `        ${name}_scalar(${callArgs(parsed, 's')});\n`;
      s += `        ${name}_neon(${callArgs(parsed, 'n')});\n`;
    }

    if (firstPtr) {
      const vals = parseArrStr(vec[firstPtr.name] ?? '');
      const n    = vals.length;
      const elem = firstPtr.type.replace(/\*/g, '').trim();
      s += `        int ok = (memcmp(${firstPtr.name}_s, ${firstPtr.name}_n, ${n}*sizeof(${elem}))==0);\n`;
      s += `        if (!ok) {\n`;
      s += `            printf("Vector ${vi + 1}: FAIL\\n  scalar: [");\n`;
      s += `            for (int i=0;i<${n};i++) printf("%d%s",${firstPtr.name}_s[i],i<${n}-1?", ":"");\n`;
      s += `            printf("]\\n  neon:   [");\n`;
      s += `            for (int i=0;i<${n};i++) printf("%d%s",${firstPtr.name}_n[i],i<${n}-1?", ":"");\n`;
      s += `            printf("]\\n");\n`;
      s += `        } else {\n`;
      s += `            printf("Vector ${vi + 1}: PASS  [");\n`;
      s += `            for (int i=0;i<${n};i++) printf("%d%s",${firstPtr.name}_s[i],i<${n}-1?", ":"");\n`;
      s += `            printf("]\\n");\n        }\n`;
    } else if (hasRet) {
      const exp   = vec['expected'] ? parseInt(vec['expected']) : NaN;
      const check = !isNaN(exp) ? `ret_s==${exp} && ret_n==${exp}` : `ret_s==ret_n`;
      s += `        int ok = (${check});\n`;
      s += `        printf("Vector ${vi + 1}: %s  scalar=%d  neon=%d\\n", ok?"PASS":"FAIL", (int)ret_s, (int)ret_n);\n`;
    } else {
      s += `        int ok = 1;\n`;
      s += `        printf("Vector ${vi + 1}: ran\\n");\n`;
    }
    s += `        pass += ok; fail += !ok;\n`;
    s += `    }\n\n`;
  });
  if (vectors.length > 0) {
    s += buildTimingBlock(name, parsed, vectors[0],
                          [{ suffix: 's', fn: 'scalar' }, { suffix: 'n', fn: 'neon' }], N_ITER);
    s += `        printf("\\nTiming (${N_ITER} iters): scalar=%.3f ms  neon=%.3f ms  speedup=%.2fx\\n",\n`;
    s += `               s_ms, n_ms, s_ms/n_ms);\n    }\n\n`;
  }
  s += `#endif\n\n`;

  s += `    printf("\\nResult: %d/%d passed\\n", pass, pass+fail);\n`;
  s += `    return fail ? 1 : 0;\n`;
  return s;
}

export function exportASM(): void {
  const fn = activeFn();
  if (!fn) return;

  fn.scalarCode  = getCodeValue('scalar');
  fn.neonCode    = getCodeValue('neon');
  fn.aarch64Code = getCodeValue('aarch64');
  fn.sig         = getSigValue();
  fn.parsed      = parseSig(fn.sig);

  const parsed = fn.parsed;
  const name   = parsed?.name ?? 'fn';
  const sig    = fn.sig || '(no signature)';

  const scalarAsm   = convertAsm(fn.scalarCode,  'sc');
  const neonAsm     = convertAsm(fn.neonCode,     'ne');
  const aarch64Asm  = convertAsm(fn.aarch64Code,  'aa', true);
  const scalarDecl  = parsed ? cDecl(parsed, 'scalar')  : `void ${name}_scalar(void)`;
  const neonDecl    = parsed ? cDecl(parsed, 'neon')    : `void ${name}_neon(void)`;
  const aarch64Decl = parsed ? cDecl(parsed, 'aarch64') : `void ${name}_aarch64(void)`;
  const mainBody    = parsed ? buildMain(parsed, fn.vectors) : '    return 0;\n';

  const text = `\
/*
 * NEONLab Export — ${name}
 * Signature: ${sig}
 * Generated by NEONLab  https://morphkurt.github.io/NEONLab/
 *
 * ─── ARMv7 cross-compile (x86/x64 host) ────────────────────────────────────
 *
 *   sudo apt install gcc-arm-linux-gnueabihf qemu-user
 *
 *   arm-linux-gnueabihf-gcc -O2 -mfpu=neon -mfloat-abi=hard \\
 *       -march=armv7-a -o ${name}_armv7 ${name}.c
 *
 *   qemu-arm -L /usr/arm-linux-gnueabihf ./${name}_armv7
 *
 * ─── AArch64 cross-compile (x86/x64 host) ──────────────────────────────────
 *
 *   sudo apt install gcc-aarch64-linux-gnu qemu-user
 *
 *   aarch64-linux-gnu-gcc -O2 -march=armv8-a \\
 *       -D__aarch64__ -o ${name}_aarch64 ${name}.c
 *
 *   qemu-aarch64 -L /usr/aarch64-linux-gnu ./${name}_aarch64
 *
 * ─── On-device ARMv7 (Raspberry Pi 2/3 32-bit) ──────────────────────────────
 *
 *   gcc -O2 -mfpu=neon -mfloat-abi=hard -march=armv7-a -o ${name} ${name}.c
 *
 * ─── On-device AArch64 (Raspberry Pi 4/5, Apple Silicon, Graviton) ──────────
 *
 *   gcc -O2 -march=armv8-a -D__aarch64__ -o ${name} ${name}.c
 */

#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

#ifndef __aarch64__

/* ── ARMv7 Scalar implementation ────────────────────────────────────────────── */
__attribute__((naked))
${scalarDecl}
{
    __asm__(
${scalarAsm}
    );
}

/* ── ARMv7 NEON implementation ──────────────────────────────────────────────── */
__attribute__((naked))
${neonDecl}
{
    __asm__(
${neonAsm}
    );
}

#else /* __aarch64__ */

/* ── AArch64 implementation ─────────────────────────────────────────────────── */
__attribute__((naked))
${aarch64Decl}
{
    __asm__(
${aarch64Asm}
    );
}

#endif /* __aarch64__ */

/* ── Test harness ───────────────────────────────────────────────────────────── */
int main(void)
{
${mainBody}}
`;

  const blob = new Blob([text], { type: 'text/x-csrc' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = name + '.c';
  a.click();
  URL.revokeObjectURL(url);
}
