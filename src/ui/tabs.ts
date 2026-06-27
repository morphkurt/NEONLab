export function switchEditor(which: string): void {
  (['scalar', 'neon'] as const).forEach(w => {
    document.getElementById(`etab-${w}`)?.classList.toggle('active', w === which);
    document.getElementById(`ep-${w}`)?.classList.toggle('active', w === which);
  });
}

export function switchState(which: string): void {
  (['scalar', 'neon', 'cmp'] as const).forEach(w => {
    document.getElementById(`stab-${w}`)?.classList.toggle('active', w === which);
    document.getElementById(`sp-${w}`)?.classList.toggle('active', w === which);
  });
}

export function renderFnTabs(
  names: string[],
  activeFnIdx: number,
  onSelect: (i: number) => void,
  onDelete: (i: number, ev: Event) => void,
  onAdd: () => void,
): void {
  const bar = document.getElementById('fn-tabs');
  if (!bar) return;
  bar.innerHTML = '';
  names.forEach((name, i) => {
    const btn = document.createElement('button');
    btn.className = 'fn-tab' + (i === activeFnIdx ? ' active' : '');
    btn.innerHTML = `${name} <span class="fn-close" data-idx="${i}">×</span>`;
    btn.addEventListener('click', () => onSelect(i));
    const closeBtn = btn.querySelector('.fn-close');
    closeBtn?.addEventListener('click', (ev) => { ev.stopPropagation(); onDelete(i, ev); });
    bar.appendChild(btn);
  });
  const add = document.createElement('button');
  add.className = 'fn-add'; add.title = 'New function'; add.textContent = '+';
  add.addEventListener('click', onAdd);
  bar.appendChild(add);
}
