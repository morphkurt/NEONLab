import { TRANS } from '../data/trans-ref';

export function buildTransGrid(): void {
  const g = document.getElementById('trans-grid');
  if (!g) return;
  TRANS.forEach(([sc, ne, note], i) => {
    const row = document.createElement('div');
    row.className = 'tr-row';
    row.id = `tr-${i}`;
    row.innerHTML = `<div class="tc sc">${sc}</div><div class="tc ne">${ne}<span class="nt"> ${note}</span></div>`;
    g.appendChild(row);
  });
}

export function highlightTrans(instrName: string): void {
  const name = (instrName || '').toUpperCase().replace(/S$/, '').replace(/\..*$/, '');
  document.querySelectorAll('.tr-row').forEach((row, i) => {
    const sc = TRANS[i]?.[0].toUpperCase() ?? '';
    row.classList.toggle('hl', name.length >= 2 && sc.startsWith(name));
  });
}

export function setupTransHighlight(taId: string): void {
  const ta = document.getElementById(taId) as HTMLTextAreaElement | null;
  if (!ta) return;
  const handler = (): void => {
    const pos   = ta.selectionStart;
    const lines = ta.value.slice(0, pos).split('\n');
    const cur   = ta.value.split('\n')[lines.length - 1] ?? '';
    highlightTrans(cur.trim().split(/[\s,]+/)[0] ?? '');
  };
  ['keyup', 'click', 'focus'].forEach(ev => ta.addEventListener(ev, handler));
}
