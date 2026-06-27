export function syncLN(taId: string, lnId: string): void {
  const ta = document.getElementById(taId) as HTMLTextAreaElement | null;
  const ln = document.getElementById(lnId);
  if (!ta || !ln) return;
  const n = ta.value.split('\n').length;
  ln.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
  ln.scrollTop = ta.scrollTop;
}

export function setupLN(taId: string, lnId: string): void {
  const ta = document.getElementById(taId) as HTMLTextAreaElement | null;
  if (!ta) return;
  ta.addEventListener('input',  () => syncLN(taId, lnId));
  ta.addEventListener('scroll', () => {
    const ln = document.getElementById(lnId);
    if (ln) ln.scrollTop = ta.scrollTop;
  });
}

export function showCurLine(which: string, lineNum: number): void {
  const ta  = document.getElementById(`code-${which}`) as HTMLTextAreaElement | null;
  const hl  = document.getElementById(`hl-${which}`);
  if (!hl || !lineNum || !ta) return;
  const LINE_H = 18, PAD_TOP = 6;
  const lineTop = PAD_TOP + (lineNum - 1) * LINE_H;
  const vis = ta.clientHeight;
  if (lineTop < ta.scrollTop + PAD_TOP) ta.scrollTop = Math.max(0, lineTop - PAD_TOP);
  else if (lineTop + LINE_H > ta.scrollTop + vis) ta.scrollTop = lineTop + LINE_H - vis + PAD_TOP;
  hl.style.top     = (PAD_TOP + (lineNum - 1) * LINE_H - ta.scrollTop) + 'px';
  hl.style.display = 'block';
  (ta as HTMLTextAreaElement & { _hlLine?: number })._hlLine = lineNum;
}

export function hideCurLine(which: string): void {
  const hl = document.getElementById(`hl-${which}`);
  if (hl) hl.style.display = 'none';
  const ta = document.getElementById(`code-${which}`) as (HTMLTextAreaElement & { _hlLine?: number }) | null;
  if (ta) ta._hlLine = undefined;
}

export function getCodeValue(which: string): string {
  const ta = document.getElementById(`code-${which}`) as HTMLTextAreaElement | null;
  return ta?.value ?? '';
}

export function setCodeValue(which: string, val: string): void {
  const ta = document.getElementById(`code-${which}`) as HTMLTextAreaElement | null;
  if (ta) ta.value = val;
}

export function getSigValue(): string {
  const el = document.getElementById('sig-input') as HTMLInputElement | null;
  return el?.value ?? '';
}

export function setSigValue(val: string): void {
  const el = document.getElementById('sig-input') as HTMLInputElement | null;
  if (el) el.value = val;
}

export function getSpeedValue(which: string): number {
  const el = document.getElementById(`spd-${which}`) as HTMLInputElement | null;
  return el ? +el.value : 7;
}
