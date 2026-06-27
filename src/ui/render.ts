import type { SimulatorState, Fn, AArch64State } from '../types';
import { toS32, hex8 } from '../simulator/state';
import { hex8_64 } from '../simulator/aarch64/state';
import { qGetU32, qGetLanes } from '../simulator/neon';
import { showTooltip } from './tooltips';

const GP_ALIAS: Record<number, string> = { 13: 'SP', 14: 'LR', 15: 'PC' };

/** Global register labels (shared with the active fn's labels) */
export const labels: { regs: Record<number, string>; lanes: Record<string, string> } = {
  regs: {}, lanes: {},
};

export function setRegLabel(i: number, val: string): void {
  labels.regs[i] = val.trim();
}
export function setLaneLabel(qi: number, li: number, val: string): void {
  labels.lanes[`${qi}_${li}`] = val.trim();
}

function getF32(neon: Int32Array[], qi: number): number[] {
  return Array.from(neon[qi]).map(v =>
    new Float32Array(new Uint32Array([v >>> 0]).buffer)[0]
  );
}

function getU16(neon: Int32Array[], qi: number): number[] {
  return qGetLanes(neon, qi, 16);
}

function getU8(neon: Int32Array[], qi: number): number[] {
  return qGetLanes(neon, qi, 8);
}

export function renderGP(st: SimulatorState, cid: string, fn?: Fn): void {
  const g = document.getElementById(cid);
  if (!g) return;
  g.innerHTML = '';
  for (let i = 0; i < 16; i++) {
    const v    = st.regs[i];
    const chg  = st.changed.has(i);
    const alias = GP_ALIAS[i] ?? '';
    const lbl  = labels.regs[i] ?? fn?.labels?.regs?.[i] ?? '';
    const c = document.createElement('div');
    c.className = 'rc' + (chg ? ' changed' : '');
    c.innerHTML = `<div class="rc-head"><span class="rc-name">R${i}</span><span class="rc-alias">${alias}</span></div>
<input class="rc-lbl" placeholder="name…" value="${lbl}" data-reg="${i}">
<div class="rc-hex">${hex8(v)}</div><div class="rc-dec">${toS32(v)}</div>`;
    c.addEventListener('click', ev => showTooltip(ev as MouseEvent, `R${i}${lbl ? ` — ${lbl}` : ''}`, v));
    const input = c.querySelector('.rc-lbl') as HTMLInputElement | null;
    if (input) input.addEventListener('change', () => setRegLabel(i, input.value));
    g.appendChild(c);
  }
}

export function renderCPSR(st: SimulatorState, cid: string): void {
  const row = document.getElementById(cid);
  if (!row) return;
  row.innerHTML = '';
  (['N', 'Z', 'C', 'V'] as const).forEach(k => {
    const v   = st.cpsr[k];
    const chg = st.flagChg.has(k);
    const titles: Record<string, string> = { N: 'Negative', Z: 'Zero', C: 'Carry', V: 'oVerflow' };
    const c = document.createElement('div');
    c.className = 'fc' + (chg ? ' changed' : '');
    c.title = titles[k] ?? k;
    c.innerHTML = `<div class="fn">${k}</div><div class="fv ${v ? 'set' : 'clr'}">${v ? 1 : 0}</div>`;
    row.appendChild(c);
  });
  const mc = document.createElement('div');
  mc.className = 'fc mode';
  mc.innerHTML = `<div class="fn">MODE</div><div class="fv">SVC</div>`;
  row.appendChild(mc);
}

export function renderNEON(st: SimulatorState, cid: string): void {
  const cont = document.getElementById(cid);
  if (!cont) return;
  cont.innerHTML = '';
  const { neon } = st;
  for (let qi = 0; qi < 16; qi++) {
    const chg  = st.neonChg.has(qi);
    const u8   = getU8(neon, qi);
    if (u8.every(b => b === 0) && !chg && qi >= 8) continue;
    const u32  = qGetU32(neon, qi);
    const u16  = getU16(neon, qi);
    const f32  = getF32(neon, qi);
    const d0   = qi * 2, d1 = qi * 2 + 1, s0 = qi * 4;
    const rawHex = u8.map(b => b.toString(16).padStart(2, '0')).join(' ');

    const lanesHtml = (vals: number[], cls: string, fmt: (v: number) => string): string =>
      `<div class="lanes">${vals.map((v, li) => {
        const lk = `${qi}_${li}`;
        const lv = labels.lanes[lk] ?? '';
        return `<div class="lane"><span class="lv ${cls}">${fmt(v)}</span>` +
               `<input class="ll" placeholder="…" value="${lv}" data-qi="${qi}" data-li="${li}"></div>`;
      }).join('')}</div>`;

    const nr = document.createElement('div');
    nr.className = 'nr' + (chg ? ' changed' : '');
    nr.innerHTML = `<div class="nr-hdr"><span class="nr-q">Q${qi}</span><span class="nr-d">D${d1}:D${d0}</span><span class="nr-raw">${rawHex}</span></div>
<div class="nr-lanes">
<div class="lane-row"><span class="lane-type">.U32</span>${lanesHtml(u32, 'u32', v => '0x' + v.toString(16).toUpperCase().padStart(8, '0'))}</div>
<div class="lane-row"><span class="lane-type">.F32</span><div class="lanes">${f32.map(v => `<div class="lane"><span class="lv f32">${isFinite(v) ? v.toPrecision(5) : v}</span></div>`).join('')}</div></div>
<div class="lane-row"><span class="lane-type">.U16</span><div class="lanes">${u16.map(v => `<div class="lane"><span class="lv u16">${v.toString(16).toUpperCase().padStart(4, '0')}</span></div>`).join('')}</div></div>
<div class="lane-row"><span class="lane-type">.U8</span><div class="lanes">${u8.map(v => `<div class="lane"><span class="lv u8">${v.toString(16).padStart(2, '0')}</span></div>`).join('')}</div></div>
</div><div class="nr-ds"><span class="dc d-c">D${d0}</span><span class="dc d-c">D${d1}</span>${[0, 1, 2, 3].map(i => `<span class="dc s-c">S${s0 + i}</span>`).join('')}</div>`;

    // Wire up lane label inputs
    nr.querySelectorAll('.ll').forEach(inp => {
      (inp as HTMLInputElement).addEventListener('change', function(this: HTMLInputElement) {
        const qi2 = +(this.dataset['qi'] ?? 0);
        const li2 = +(this.dataset['li'] ?? 0);
        setLaneLabel(qi2, li2, this.value);
      });
    });
    cont.appendChild(nr);
  }
}

const A64_ALIAS: Record<number, string> = { 28: 'X28', 29: 'FP', 30: 'LR', 31: 'SP' };

export function renderGP64(st: AArch64State, cid: string): void {
  const g = document.getElementById(cid);
  if (!g) return;
  g.innerHTML = '';
  for (let i = 0; i <= 31; i++) {
    const v = st.xregs[i] ?? 0;
    const chg = st.changed.has(i);
    // Show X0-X15 always, X16-X30 only if non-zero or changed, always show SP (index 31)
    if (i >= 16 && i <= 30 && v === 0 && !chg) continue;
    const name = i === 31 ? 'SP' : `X${i}`;
    const alias = A64_ALIAS[i] ?? '';
    const c = document.createElement('div');
    c.className = 'rc' + (chg ? ' changed' : '');
    c.innerHTML = `<div class="rc-head"><span class="rc-name">${name}</span><span class="rc-alias">${alias}</span></div>
<div class="rc-hex">${hex8_64(v)}</div><div class="rc-dec">${v | 0}</div>`;
    c.addEventListener('click', ev => showTooltip(ev as MouseEvent, `${name}${alias ? ` — ${alias}` : ''}`, v));
    g.appendChild(c);
  }
}

export function renderPSTATE(st: AArch64State, cid: string): void {
  const row = document.getElementById(cid);
  if (!row) return;
  row.innerHTML = '';
  (['N', 'Z', 'C', 'V'] as const).forEach(k => {
    const v   = st.pstate[k];
    const chg = st.flagChg.has(k);
    const titles: Record<string, string> = { N: 'Negative', Z: 'Zero', C: 'Carry', V: 'oVerflow' };
    const c = document.createElement('div');
    c.className = 'fc' + (chg ? ' changed' : '');
    c.title = titles[k] ?? k;
    c.innerHTML = `<div class="fn">${k}</div><div class="fv ${v ? 'set' : 'clr'}">${v ? 1 : 0}</div>`;
    row.appendChild(c);
  });
  const mc = document.createElement('div');
  mc.className = 'fc mode';
  mc.innerHTML = `<div class="fn">MODE</div><div class="fv">EL0</div>`;
  row.appendChild(mc);
}

export function renderVRegs64(st: AArch64State, cid: string): void {
  const cont = document.getElementById(cid);
  if (!cont) return;
  cont.innerHTML = '';
  const { vregs } = st;
  for (let qi = 0; qi < 32; qi++) {
    const chg = st.vregChg.has(qi);
    const allZero = Array.from(vregs[qi]).every(v => v === 0);
    if (allZero && !chg && qi >= 8) continue;
    const u32 = Array.from(vregs[qi]).map(v => v >>> 0);
    const u8 = u32.flatMap(v => [v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >> 24) & 0xFF]);
    const rawHex = u8.map(b => b.toString(16).padStart(2, '0')).join(' ');
    const nr = document.createElement('div');
    nr.className = 'nr' + (chg ? ' changed' : '');
    nr.innerHTML = `<div class="nr-hdr"><span class="nr-q">V${qi}</span><span class="nr-raw">${rawHex}</span></div>
<div class="nr-lanes">
<div class="lane-row"><span class="lane-type">.U32</span><div class="lanes">${u32.map(v => `<div class="lane"><span class="lv u32">0x${v.toString(16).toUpperCase().padStart(8, '0')}</span></div>`).join('')}</div></div>
<div class="lane-row"><span class="lane-type">.U8</span><div class="lanes">${u8.map(v => `<div class="lane"><span class="lv u8">${v.toString(16).padStart(2, '0')}</span></div>`).join('')}</div></div>
</div>`;
    cont.appendChild(nr);
  }
}

export type WideS = { scalar: SimulatorState; neon: SimulatorState; aarch64: AArch64State };

export function renderAll(which: 'scalar' | 'neon' | 'aarch64' | 'both', S: WideS, fn?: Fn): void {
  if (which === 'scalar' || which === 'both') {
    renderGP(S.scalar, 'sgp', fn);
    renderCPSR(S.scalar, 'scpsr');
  }
  if (which === 'neon' || which === 'both') {
    renderGP(S.neon, 'ngp', fn);
    renderCPSR(S.neon, 'ncpsr');
    renderNEON(S.neon, 'nneon');
  }
  if (which === 'aarch64' || which === 'both') {
    renderGP64(S.aarch64, 'agp');
    renderPSTATE(S.aarch64, 'apstate');
    renderVRegs64(S.aarch64, 'avneon');
  }
}

export function renderCompare(S: WideS, _fn: Fn | undefined): void {
  let html = '';
  for (let i = 0; i < 16; i++) {
    const sv = S.scalar.regs[i], nv = S.neon.regs[i];
    const match = (sv >>> 0) === (nv >>> 0);
    const alias = GP_ALIAS[i] ? ` (${GP_ALIAS[i]})` : '';
    const regLbl = labels.regs[i] ?? '';
    html += `<tr class="${match ? 'match' : 'mis'}">
<td class="label-col" style="color:#6e7681;font-family:sans-serif;font-size:10px">R${i}${alias}<br><span style="color:#3fb950">${regLbl}</span></td>
<td style="color:#58a6ff;font-family:monospace">${hex8(sv)}<br><span style="color:#484f58;font-size:9px">${toS32(sv)}</span></td>
<td style="color:#a371f7;font-family:monospace">${hex8(nv)}<br><span style="color:#484f58;font-size:9px">${toS32(nv)}</span></td>
<td>${match ? '<span class="ok">✓</span>' : '<span class="bad">✗</span>'}</td></tr>`;
  }
  const el = document.getElementById('cmp-content');
  if (!el) return;
  el.innerHTML = `
<table class="cmp-table"><thead><tr><th>Reg</th><th>Scalar</th><th>NEON GP</th><th></th></tr></thead><tbody>${html}</tbody></table>
<div class="ar-wrap"><div class="ar-lbl">Assertions <span style="color:#484f58">(e.g. R0 = Q0[0])</span></div>
<textarea class="ar-ta" id="ar-ta" rows="3" placeholder="R0 = Q0[0]&#10;R2 = Q1[2]"></textarea>
<button class="primary" style="margin-top:4px" id="btn-assertions">Check</button>
<div class="ar-results" id="ar-results"></div></div>`;

  document.getElementById('btn-assertions')?.addEventListener('click', () => runAssertions(S));
}

function runAssertions(S: WideS): void {
  const ta  = document.getElementById('ar-ta') as HTMLTextAreaElement | null;
  const out = document.getElementById('ar-results');
  if (!out) return;
  out.innerHTML = '';
  (ta?.value ?? '').split('\n').forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('//')) return;
    const m = line.match(/^R(\d+)\s*=\s*Q(\d+)\[(\d+)\]$/i);
    if (!m) {
      const e = document.createElement('div'); e.className = 'ar err'; e.textContent = `? ${line}`; out.appendChild(e); return;
    }
    const ri = +m[1], qi = +m[2], li = +m[3];
    const sv = S.scalar.regs[ri] >>> 0;
    const u32 = qGetU32(S.neon.neon, qi);
    const nv  = li < u32.length ? u32[li] : undefined;
    const pass = nv !== undefined && sv === nv;
    const e = document.createElement('div');
    e.className = 'ar ' + (pass ? 'pass' : 'fail');
    e.textContent = pass
      ? `✓ R${ri}(${hex8(sv)}) == Q${qi}[${li}](${hex8(nv!)})`
      : `✗ R${ri}(${sv === undefined ? '?' : hex8(sv)}) ≠ Q${qi}[${li}](${nv === undefined ? '?' : hex8(nv)})`;
    out.appendChild(e);
  });
}
