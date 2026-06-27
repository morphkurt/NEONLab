// Standalone generator — mirrors export/asm.ts logic, outputs to stdout

function convertAsm(code: string, prefix: string, isAarch64 = false): string {
  const lines = code
    .split('\n')
    .map(l => isAarch64
      ? l.replace(/\/\/.*/g, '').trimEnd()
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
    if (!/BX\s+LR|MOV\s+PC,\s*LR|POP\s*\{[^}]*PC/i.test(last))
      out.push('        "BX LR\\n"');
  }
  return out.join('\n');
}

const scalarCode = `\
// Scalar alpha blend
// R0=dst(ptr) R1=src(ptr) R2=alpha R3=n
MOV R10, R0
RSB R4, R2, #256
MOV R5, #0
loop:
  LDR R6, [R0]
  LDR R7, [R1]
  MUL R8, R7, R2
  MUL R9, R6, R4
  ADD R8, R8, R9
  LSR R8, R8, #8
  STR R8, [R0]
  ADD R0, R0, #4
  ADD R1, R1, #4
  ADD R5, R5, #1
  CMP R5, R3
  BLT loop
LDR R0, [R10]`;

const neonCode = `\
// NEON alpha blend
// R0=dst R1=src R2=alpha R3=n
MOV R10, R0
VDUP.32 Q0, R2
RSB R4, R2, #256
VDUP.32 Q1, R4
loop:
  VLD1.32 {Q2}, [R0]
  VLD1.32 {Q3}, [R1]
  VMUL.I32 Q4, Q3, Q0
  VMUL.I32 Q5, Q2, Q1
  VADD.I32 Q4, Q4, Q5
  VSHR.U32 Q4, Q4, #8
  VST1.32 {Q4}, [R0]
  ADD R0, R0, #16
  ADD R1, R1, #16
  SUBS R3, R3, #4
  BGT loop
LDR R0, [R10]`;

const aarch64Code = `\
// AArch64 alpha blend
// X0=dst X1=src W2=alpha W3=n
MOV X10, X0
DUP V0.4S, W2
MOV W4, #256
SUB W4, W4, W2
DUP V1.4S, W4
loop:
  LD1 {V2.4S}, [X0]
  LD1 {V3.4S}, [X1]
  MUL V4.4S, V3.4S, V0.4S
  MUL V5.4S, V2.4S, V1.4S
  ADD V4.4S, V4.4S, V5.4S
  USHR V4.4S, V4.4S, #8
  ST1 {V4.4S}, [X0]
  ADD X0, X0, #16
  ADD X1, X1, #16
  SUBS W3, W3, #4
  B.GT loop
LDR W0, [X10]
RET`;

const name = 'alpha_blend_row';
const sig  = 'int32_t alpha_blend_row(int32_t* dst, int32_t* src, int32_t alpha, int32_t n)';

type Param = { name: string; type: string; kind: { base: string } };
type ParsedSig = { name: string; returnType: string; params: Param[] };
type VecRow = Record<string, string>;

const parsed: ParsedSig = {
  name, returnType: 'int32_t',
  params: [
    { name: 'dst',   type: 'int32_t*', kind: { base: 'ptr' } },
    { name: 'src',   type: 'int32_t*', kind: { base: 'ptr' } },
    { name: 'alpha', type: 'int32_t',  kind: { base: 'scalar' } },
    { name: 'n',     type: 'int32_t',  kind: { base: 'scalar' } },
  ],
};

const vectors: VecRow[] = [
  { dst: '[200, 100, 50, 255]',  src: '[0, 200, 100, 0]',    alpha: '128', n: '4', expected: '' },
  { dst: '[0, 0, 0, 0]',         src: '[200, 200, 200, 200]', alpha: '255', n: '4', expected: '' },
  { dst: '[128, 128, 128, 128]', src: '[0, 0, 0, 0]',         alpha: '64',  n: '4', expected: '' },
];

function parseArrStr(s: string): number[] {
  const inner = s.trim().startsWith('[') ? s.trim().slice(1, s.trim().lastIndexOf(']')) : s;
  return inner.split(',').map(x => parseFloat(x.trim())).filter(x => !isNaN(x));
}

function cDecl(p: ParsedSig, suffix: string): string {
  const params = p.params.map(pr =>
    `${pr.type.includes('*') ? pr.type.replace('*', ' *') : pr.type} ${pr.name}`).join(', ');
  return `${p.returnType} ${p.name}_${suffix}(${params})`;
}

function declareParams(p: ParsedSig, vec: VecRow, suffix: string): string {
  return p.params.map(pr => {
    if (pr.kind.base === 'ptr') {
      const vals = parseArrStr(vec[pr.name] ?? '');
      return `        int32_t ${pr.name}_${suffix}[] = {${vals.join(', ')}};\n`;
    }
    return `        int32_t ${pr.name} = ${parseInt(vec[pr.name] ?? '0') || 0};\n`;
  }).join('');
}

function callArgs(p: ParsedSig, suffix: string): string {
  return p.params.map(pr => pr.kind.base === 'ptr' ? `${pr.name}_${suffix}` : pr.name).join(', ');
}

const N_ITER = 10000;
const firstPtr = parsed.params.find(p => p.kind.base === 'ptr')!;

// ── AArch64 test vectors ──────────────────────────────────────────────────────
let aa = '';
vectors.forEach((vec, vi) => {
  const vals = parseArrStr(vec[firstPtr.name] ?? '');
  const n = vals.length;
  aa += `    /* vector ${vi + 1} */\n    {\n`;
  aa += declareParams(parsed, vec, 'a');
  aa += `        int32_t ret_a = ${name}_aarch64(${callArgs(parsed, 'a')});\n`;
  aa += `        printf("Vector ${vi + 1}: [");\n`;
  aa += `        for (int i=0;i<${n};i++) printf("%d%s", dst_a[i], i<${n}-1?", ":"");\n`;
  aa += `        printf("]  ret=%d\\n", (int)ret_a);\n`;
  aa += `        int ok = 1; pass += ok; fail += !ok;\n`;
  aa += `    }\n\n`;
});
aa += `    {\n`;
parsed.params.forEach(p => {
  const vec = vectors[0];
  if (p.kind.base === 'ptr') {
    const vals = parseArrStr(vec[p.name] ?? '');
    aa += `        int32_t _ta_${p.name}[] = {${vals.join(', ')}};\n`;
  } else {
    aa += `        int32_t _t_${p.name} = ${parseInt(vec[p.name] ?? '0') || 0};\n`;
  }
});
const taArgs = parsed.params.map(p => p.kind.base === 'ptr' ? `_ta_${p.name}` : `_t_${p.name}`).join(', ');
aa += `        struct timespec _t0, _t1;\n`;
aa += `        clock_gettime(CLOCK_MONOTONIC, &_t0);\n`;
aa += `        for (int _i=0;_i<${N_ITER};_i++) ${name}_aarch64(${taArgs});\n`;
aa += `        clock_gettime(CLOCK_MONOTONIC, &_t1);\n`;
aa += `        double a_ms = (_t1.tv_sec-_t0.tv_sec)*1000.0+(_t1.tv_nsec-_t0.tv_nsec)/1e6;\n`;
aa += `        printf("\\nTiming (${N_ITER} iters): aarch64=%.3f ms\\n", a_ms);\n`;
aa += `    }\n\n`;

// ── ARMv7 scalar vs NEON test vectors ────────────────────────────────────────
let arm = '';
vectors.forEach((vec, vi) => {
  const vals = parseArrStr(vec[firstPtr.name] ?? '');
  const n = vals.length;
  arm += `    /* vector ${vi + 1} */\n    {\n`;
  arm += declareParams(parsed, vec, 's');
  arm += declareParams(parsed, vec, 'n');
  arm += `        ${name}_scalar(${callArgs(parsed, 's')});\n`;
  arm += `        ${name}_neon(${callArgs(parsed, 'n')});\n`;
  arm += `        int ok = (memcmp(dst_s, dst_n, ${n}*sizeof(int32_t))==0);\n`;
  arm += `        if (!ok) {\n`;
  arm += `            printf("Vector ${vi + 1}: FAIL\\n  scalar: [");\n`;
  arm += `            for (int i=0;i<${n};i++) printf("%d%s",dst_s[i],i<${n}-1?", ":"");\n`;
  arm += `            printf("]\\n  neon:   [");\n`;
  arm += `            for (int i=0;i<${n};i++) printf("%d%s",dst_n[i],i<${n}-1?", ":"");\n`;
  arm += `            printf("]\\n");\n`;
  arm += `        } else {\n`;
  arm += `            printf("Vector ${vi + 1}: PASS  [");\n`;
  arm += `            for (int i=0;i<${n};i++) printf("%d%s",dst_s[i],i<${n}-1?", ":"");\n`;
  arm += `            printf("]\\n");\n        }\n`;
  arm += `        pass += ok; fail += !ok;\n`;
  arm += `    }\n\n`;
});
arm += `    {\n`;
parsed.params.forEach(p => {
  const vec = vectors[0];
  if (p.kind.base === 'ptr') {
    const vals = parseArrStr(vec[p.name] ?? '');
    arm += `        int32_t _ts_${p.name}[] = {${vals.join(', ')}};\n`;
    arm += `        int32_t _tn_${p.name}[] = {${vals.join(', ')}};\n`;
  } else {
    arm += `        int32_t _t_${p.name} = ${parseInt(vec[p.name] ?? '0') || 0};\n`;
  }
});
const tsArgs = parsed.params.map(p => p.kind.base === 'ptr' ? `_ts_${p.name}` : `_t_${p.name}`).join(', ');
const tnArgs = parsed.params.map(p => p.kind.base === 'ptr' ? `_tn_${p.name}` : `_t_${p.name}`).join(', ');
arm += `        struct timespec _t0, _t1;\n`;
arm += `        clock_gettime(CLOCK_MONOTONIC, &_t0);\n`;
arm += `        for (int _i=0;_i<${N_ITER};_i++) ${name}_scalar(${tsArgs});\n`;
arm += `        clock_gettime(CLOCK_MONOTONIC, &_t1);\n`;
arm += `        double s_ms = (_t1.tv_sec-_t0.tv_sec)*1000.0+(_t1.tv_nsec-_t0.tv_nsec)/1e6;\n`;
arm += `        clock_gettime(CLOCK_MONOTONIC, &_t0);\n`;
arm += `        for (int _i=0;_i<${N_ITER};_i++) ${name}_neon(${tnArgs});\n`;
arm += `        clock_gettime(CLOCK_MONOTONIC, &_t1);\n`;
arm += `        double n_ms = (_t1.tv_sec-_t0.tv_sec)*1000.0+(_t1.tv_nsec-_t0.tv_nsec)/1e6;\n`;
arm += `        printf("\\nTiming (${N_ITER} iters): scalar=%.3f ms  neon=%.3f ms  speedup=%.2fx\\n",\n`;
arm += `               s_ms, n_ms, s_ms/n_ms);\n`;
arm += `    }\n\n`;

const out = `\
/*
 * NEONLab Export — ${name}
 * Signature: ${sig}
 *
 * AArch64 (Apple Silicon / Graviton / RPi4+):
 *   gcc -O2 -march=armv8-a -D__aarch64__ -o ${name} ${name}.c && ./${name}
 *
 * ARMv7 cross-compile:
 *   arm-linux-gnueabihf-gcc -O2 -mfpu=neon -mfloat-abi=hard -march=armv7-a -o ${name} ${name}.c
 *   qemu-arm -L /usr/arm-linux-gnueabihf ./${name}
 */

#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

#ifndef __aarch64__

__attribute__((naked))
${cDecl(parsed, 'scalar')}
{
    __asm__(
${convertAsm(scalarCode, 'sc')}
    );
}

__attribute__((naked))
${cDecl(parsed, 'neon')}
{
    __asm__(
${convertAsm(neonCode, 'ne')}
    );
}

#else /* __aarch64__ */

__attribute__((naked))
${cDecl(parsed, 'aarch64')}
{
    __asm__(
${convertAsm(aarch64Code, 'aa', true)}
    );
}

#endif /* __aarch64__ */

int main(void)
{
    int pass = 0, fail = 0;

#ifdef __aarch64__
${aa}#else
${arm}#endif

    printf("\\nResult: %d/%d passed\\n", pass, pass+fail);
    return fail ? 1 : 0;
}
`;

process.stdout.write(out);
