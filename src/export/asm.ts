import { activeFn } from '../registry/functions';
import { getCodeValue, getSigValue } from '../ui/editor';
import { parseSig } from '../parser/signature';
import type { ParsedSig, VecRow } from '../types';

// Convert NEONLab asm to GCC inline asm string literals, prefixing labels to avoid conflicts
function convertAsm(code: string, prefix: string): string {
  const lines = code
    .split('\n')
    .map(l => l.replace(/\/\/(.*)/g, '@ $1').trimEnd())
    .filter(l => l.trim());

  // Collect all label names defined in this block
  const labels = new Set<string>();
  for (const line of lines) {
    const m = line.trim().match(/^(\w+)\s*:/);
    if (m) labels.add(m[1].toUpperCase());
  }

  const out: string[] = [];
  for (const line of lines) {
    let l = line.trim();
    for (const lbl of labels) {
      // Rewrite label definition: "loop:" → ".Lsc_loop:"
      l = l.replace(new RegExp(`\\b${lbl}\\s*:`, 'gi'), `.L${prefix}_${lbl.toLowerCase()}:`);
      // Rewrite branch targets: "BLT loop" → "BLT .Lsc_loop"
      l = l.replace(new RegExp(`\\b${lbl}\\b(?!\\s*:)`, 'gi'), `.L${prefix}_${lbl.toLowerCase()}`);
    }
    out.push(`        "${l}\\n"`);
  }

  // Append BX LR if the asm doesn't already return
  const last = out[out.length - 1] ?? '';
  if (!/BX\s+LR|MOV\s+PC,\s*LR|POP\s*\{[^}]*PC/i.test(last)) {
    out.push('        "BX LR\\n"');
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

function buildMain(parsed: ParsedSig, vectors: VecRow[]): string {
  const name = parsed.name;
  const hasReturn = parsed.returnType !== 'void';
  const firstPtr = parsed.params.find(p => p.kind.base === 'ptr');
  const N_ITER = 10000;

  let s = '';
  s += `    int pass = 0, fail = 0;\n`;
  s += `    struct timespec _t0, _t1;\n\n`;

  // Test vectors
  vectors.forEach((vec, vi) => {
    s += `    /* vector ${vi + 1} */\n    {\n`;

    parsed.params.forEach(p => {
      if (p.kind.base === 'ptr') {
        const vals = parseArrStr(vec[p.name] ?? '');
        const elem = p.type.replace(/\*/g, '').trim();
        s += `        ${elem} ${p.name}_s[] = {${vals.join(', ')}};\n`;
        s += `        ${elem} ${p.name}_n[] = {${vals.join(', ')}};\n`;
      } else {
        const v = parseInt(vec[p.name] ?? '0') || 0;
        s += `        ${p.type} ${p.name} = ${v};\n`;
      }
    });

    const argsS = parsed.params.map(p => p.kind.base === 'ptr' ? `${p.name}_s` : p.name).join(', ');
    const argsN = parsed.params.map(p => p.kind.base === 'ptr' ? `${p.name}_n` : p.name).join(', ');

    if (hasReturn) {
      s += `        ${parsed.returnType} ret_s = ${name}_scalar(${argsS});\n`;
      s += `        ${parsed.returnType} ret_n = ${name}_neon(${argsN});\n`;
    } else {
      s += `        ${name}_scalar(${argsS});\n`;
      s += `        ${name}_neon(${argsN});\n`;
    }

    if (firstPtr) {
      const vals = parseArrStr(vec[firstPtr.name] ?? '');
      const n = vals.length;
      const elem = firstPtr.type.replace(/\*/g, '').trim();
      s += `        int ok = (memcmp(${firstPtr.name}_s, ${firstPtr.name}_n, ${n} * sizeof(${elem})) == 0);\n`;
      s += `        if (!ok) {\n`;
      s += `            printf("Vector ${vi + 1}: FAIL\\n  scalar: [");\n`;
      s += `            for (int i = 0; i < ${n}; i++) printf("%d%s", ${firstPtr.name}_s[i], i < ${n}-1 ? ", " : "");\n`;
      s += `            printf("]\\n  neon:   [");\n`;
      s += `            for (int i = 0; i < ${n}; i++) printf("%d%s", ${firstPtr.name}_n[i], i < ${n}-1 ? ", " : "");\n`;
      s += `            printf("]\\n");\n`;
      s += `        } else { printf("Vector ${vi + 1}: PASS\\n"); }\n`;
    } else if (hasReturn) {
      const exp = vec['expected'] ? parseInt(vec['expected']) : NaN;
      const check = !isNaN(exp) ? `ret_s == ret_n && ret_s == ${exp}` : `ret_s == ret_n`;
      s += `        int ok = (${check});\n`;
      s += `        printf("Vector ${vi + 1}: %s  scalar=%d  neon=%d\\n", ok ? "PASS" : "FAIL", (int)ret_s, (int)ret_n);\n`;
    } else {
      s += `        int ok = 1;\n`;
      s += `        printf("Vector ${vi + 1}: ran\\n");\n`;
    }
    s += `        pass += ok; fail += !ok;\n`;
    s += `    }\n\n`;
  });

  // Timing block using first vector
  if (vectors.length > 0) {
    const vec = vectors[0];
    s += `    /* timing: ${N_ITER} iterations on vector 1 */\n    {\n`;
    parsed.params.forEach(p => {
      if (p.kind.base === 'ptr') {
        const vals = parseArrStr(vec[p.name] ?? '');
        const elem = p.type.replace(/\*/g, '').trim();
        s += `        ${elem} _ts_${p.name}[] = {${vals.join(', ')}};\n`;
        s += `        ${elem} _tn_${p.name}[] = {${vals.join(', ')}};\n`;
      } else {
        const v = parseInt(vec[p.name] ?? '0') || 0;
        s += `        ${p.type} _t_${p.name} = ${v};\n`;
      }
    });
    const tS = parsed.params.map(p => p.kind.base === 'ptr' ? `_ts_${p.name}` : `_t_${p.name}`).join(', ');
    const tN = parsed.params.map(p => p.kind.base === 'ptr' ? `_tn_${p.name}` : `_t_${p.name}`).join(', ');

    s += `        clock_gettime(CLOCK_MONOTONIC, &_t0);\n`;
    s += `        for (int _i = 0; _i < ${N_ITER}; _i++) ${name}_scalar(${tS});\n`;
    s += `        clock_gettime(CLOCK_MONOTONIC, &_t1);\n`;
    s += `        double sc_ms = (_t1.tv_sec-_t0.tv_sec)*1000.0 + (_t1.tv_nsec-_t0.tv_nsec)/1e6;\n\n`;

    s += `        clock_gettime(CLOCK_MONOTONIC, &_t0);\n`;
    s += `        for (int _i = 0; _i < ${N_ITER}; _i++) ${name}_neon(${tN});\n`;
    s += `        clock_gettime(CLOCK_MONOTONIC, &_t1);\n`;
    s += `        double ne_ms = (_t1.tv_sec-_t0.tv_sec)*1000.0 + (_t1.tv_nsec-_t0.tv_nsec)/1e6;\n\n`;

    s += `        printf("\\nTiming (${N_ITER} iters): scalar=%.3f ms  neon=%.3f ms  speedup=%.2fx\\n",\n`;
    s += `               sc_ms, ne_ms, sc_ms / ne_ms);\n`;
    s += `    }\n\n`;
  }

  s += `    printf("\\nResult: %d/%d passed\\n", pass, pass + fail);\n`;
  s += `    return fail ? 1 : 0;\n`;
  return s;
}

export function exportASM(): void {
  const fn = activeFn();
  if (!fn) return;

  fn.scalarCode = getCodeValue('scalar');
  fn.neonCode   = getCodeValue('neon');
  fn.sig        = getSigValue();
  fn.parsed     = parseSig(fn.sig);

  const parsed = fn.parsed;
  const name   = parsed?.name ?? 'fn';
  const sig    = fn.sig || '(no signature)';

  const scalarAsm  = convertAsm(fn.scalarCode, 'sc');
  const neonAsm    = convertAsm(fn.neonCode,   'ne');
  const scalarDecl = parsed ? cDecl(parsed, 'scalar') : `void ${name}_scalar(void)`;
  const neonDecl   = parsed ? cDecl(parsed, 'neon')   : `void ${name}_neon(void)`;
  const mainBody   = parsed ? buildMain(parsed, fn.vectors) : '    return 0;\n';

  const text = `\
/*
 * NEONLab Export — ${name}
 * Signature: ${sig}
 * Generated by NEONLab  https://morphkurt.github.io/NEONLab/
 *
 * ─── Cross-compile (x86/x64 host → ARMv7) ──────────────────────────────
 *
 *   # Install toolchain + QEMU (Debian/Ubuntu):
 *   sudo apt install gcc-arm-linux-gnueabihf qemu-user
 *
 *   # Compile:
 *   arm-linux-gnueabihf-gcc -O2 -mfpu=neon -mfloat-abi=hard \\
 *       -march=armv7-a -o ${name} ${name}.c
 *
 *   # Run under QEMU:
 *   qemu-arm -L /usr/arm-linux-gnueabihf ./${name}
 *
 * ─── On-device (Raspberry Pi / ARMv7 board) ─────────────────────────────
 *
 *   gcc -O2 -mfpu=neon -mfloat-abi=hard -march=armv7-a -o ${name} ${name}.c
 *   ./${name}
 *
 * ─── CMakeLists.txt snippet ─────────────────────────────────────────────
 *
 *   cmake_minimum_required(VERSION 3.16)
 *   project(${name} C)
 *   add_executable(${name} ${name}.c)
 *   target_compile_options(${name} PRIVATE
 *       -O2 -mfpu=neon -mfloat-abi=hard -march=armv7-a)
 */

#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

/* ── Scalar implementation ──────────────────────────────────────────────── */
__attribute__((naked))
${scalarDecl}
{
    __asm__(
${scalarAsm}
    );
}

/* ── NEON implementation ────────────────────────────────────────────────── */
__attribute__((naked))
${neonDecl}
{
    __asm__(
${neonAsm}
    );
}

/* ── Test harness ───────────────────────────────────────────────────────── */
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
