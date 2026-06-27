export function addLog(which: string, pc: number, raw: string, detail: string, isErr = false): void {
  const log = document.getElementById(`log-${which}`);
  if (!log) return;
  const e = document.createElement('div');
  e.className = 'le' + (isErr ? ' err' : '');
  e.innerHTML = isErr
    ? `<span style="color:#f85149">✕[${pc}] ${raw}: ${detail}</span>`
    : `<span class="lpc">[${String(pc).padStart(3, ' ')}]</span><span class="li">${raw}</span><span class="ld">→ ${detail}</span>`;
  log.appendChild(e);
  log.scrollTop = log.scrollHeight;
}

export function clearLog(which: string): void {
  const el = document.getElementById(`log-${which}`);
  if (el) el.innerHTML = '';
}

export function setStatus(which: string, type: string, text: string): void {
  const dot = document.getElementById(`dot-${which}`);
  const txt = document.getElementById(`txt-${which}`);
  if (dot) dot.className = 'sdot ' + (
    type === 'ready' ? 'ready' :
    type === 'run'   ? 'run'   :
    type === 'err'   ? 'err'   :
    type === 'done'  ? 'done'  : ''
  );
  if (txt) txt.textContent = `${which[0].toUpperCase() + which.slice(1)}: ${text}`;
}
