import { toU32, toS32 } from '../simulator/state';
import type { LookupResult } from '../data/instr-ref';

export function showTooltip(ev: MouseEvent, name: string, val: number): void {
  const tt    = document.getElementById('tooltip');
  const title = document.getElementById('tt-title');
  const hex   = document.getElementById('tt-hex');
  const dec   = document.getElementById('tt-dec');
  const udec  = document.getElementById('tt-udec');
  const bin   = document.getElementById('tt-bin');
  if (!tt || !title || !hex || !dec || !udec || !bin) return;

  const u = toU32(val), s = toS32(val);
  title.textContent = name;
  hex.textContent   = '0x' + u.toString(16).toUpperCase().padStart(8, '0');
  dec.textContent   = String(s);
  udec.textContent  = String(u);
  bin.textContent   = u.toString(2).padStart(32, '0').replace(/(.{4})/g, '$1 ').trim();

  let x = ev.clientX + 12, y = ev.clientY - 10;
  if (x + 210 > innerWidth)  x = ev.clientX - 218;
  if (y + 110 > innerHeight) y = ev.clientY - 110;
  tt.style.left = x + 'px';
  tt.style.top  = y + 'px';
  tt.style.display = 'block';
  ev.stopPropagation();
}

export function hideTooltip(): void {
  const tt = document.getElementById('tooltip');
  if (tt) tt.style.display = 'none';
}

export function showInstrTT(x: number, y: number, info: LookupResult): void {
  const tt = document.getElementById('instr-tt');
  if (!tt) return;
  tt.innerHTML = `<div class="it-mn">${info.mn}</div>
<div class="it-name">${info.name}</div>
<div class="it-desc">${info.desc.replace(/\n/g, '<br>')}</div>
<code class="it-syn">${info.syn}</code>
${info.note ? `<div class="it-note">⚑ ${info.note}</div>` : ''}`;
  tt.style.display = 'block';
  tt.style.left = (x + 18) + 'px';
  tt.style.top  = (y + 14) + 'px';
  const r = tt.getBoundingClientRect();
  if (r.right  > window.innerWidth  - 8) tt.style.left = (x - r.width  - 8) + 'px';
  if (r.bottom > window.innerHeight - 8) tt.style.top  = (y - r.height - 8) + 'px';
}

export function hideInstrTT(): void {
  const tt = document.getElementById('instr-tt');
  if (tt) tt.style.display = 'none';
}

export function setupInstrHover(taId: string, lookupFn: (tok: string) => LookupResult | null): void {
  const ta = document.getElementById(taId) as HTMLTextAreaElement | null;
  if (!ta) return;
  let lastLineIdx = -1;

  ta.addEventListener('mousemove', e => {
    const cs    = getComputedStyle(ta);
    const lineH = parseFloat(cs.lineHeight) || 18;
    const pad   = parseFloat(cs.paddingTop)  || 6;
    const rect  = ta.getBoundingClientRect();
    const y     = e.clientY - rect.top + ta.scrollTop - pad;
    const lineIdx = Math.floor(y / lineH);
    if (lineIdx === lastLineIdx) return;
    lastLineIdx = lineIdx;
    const lines = ta.value.split('\n');
    if (lineIdx < 0 || lineIdx >= lines.length) { hideInstrTT(); return; }
    const line = (lines[lineIdx] ?? '').trim().replace(/\/\/.*$/, '').replace(/;.*$/, '').trim();
    if (!line || line.endsWith(':')) { hideInstrTT(); return; }
    const tok = line.split(/[\s,]+/)[0] ?? '';
    const info = lookupFn(tok);
    if (info) showInstrTT(e.clientX, e.clientY, info);
    else hideInstrTT();
  });
  ta.addEventListener('scroll',    () => { lastLineIdx = -1; });
  ta.addEventListener('mouseleave', () => { hideInstrTT(); lastLineIdx = -1; });
}
