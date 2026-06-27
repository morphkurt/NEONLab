import type { Fn, VecRow, ParsedSig } from '../types';

function parseExpected(s: string | undefined): number | number[] | undefined {
  if (s === undefined || s === null || s === '') return undefined;
  const str = String(s).trim();
  if (str.startsWith('[')) {
    const inner = str.slice(1, str.lastIndexOf(']'));
    return inner.split(',').map(x => parseFloat(x.trim())).filter(x => !isNaN(x));
  }
  const n = parseFloat(str);
  return isNaN(n) ? undefined : n;
}

function firstOutPtr(parsed: ParsedSig | null): { name: string } | null {
  if (!parsed) return null;
  return parsed.params.find(p => p.kind.base === 'ptr') ?? null;
}

function renderArrCell(actual: number[] | null | undefined, other: number[] | null | undefined): string {
  if (!actual) return `<span style="color:#484f58">—</span>`;
  const parts = actual.map((v, i) => {
    const ok = other ? Math.round(v) === Math.round(other[i]) : null;
    const col = ok === null ? '#e6edf3' : ok ? '#3fb950' : '#f85149';
    return `<span style="color:${col}">${v}</span>`;
  });
  return `<span style="font-family:monospace;font-size:10px">[${parts.join('<span style="color:#484f58">,</span>')}]</span>`;
}

export function renderVecTable(
  fn: Fn | undefined,
  onParamChange: (vi: number, key: string, val: string) => void,
  onDelete: (vi: number) => void,
): void {
  if (!fn) return;
  const parsed = fn.parsed;
  const outP = firstOutPtr(parsed);

  const thead = document.getElementById('vec-thead');
  if (thead) {
    let thHtml = '<tr><th>#</th>';
    if (parsed) {
      parsed.params.forEach(p => {
        thHtml += `<th>${p.name}<span style="color:#30363d;font-weight:400"> :${p.type}</span></th>`;
      });
    }
    thHtml += `<th style="color:#f0883e">expected</th>`;
    thHtml += `<th style="color:#3fb950">scalar ${outP ? `<span style="color:#30363d;font-size:9px">${outP.name}[]</span>` : 'ret'}</th>`;
    thHtml += `<th style="color:#a371f7">neon ${outP ? `<span style="color:#30363d;font-size:9px">${outP.name}[]</span>` : 'ret'}</th>`;
    thHtml += `<th style="color:#58a6ff">aarch64 ${outP ? `<span style="color:#30363d;font-size:9px">${outP.name}[]</span>` : 'ret'}</th>`;
    thHtml += `<th></th></tr>`;
    thead.innerHTML = thHtml;
  }

  const tbody = document.getElementById('vec-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  fn.vectors.forEach((vec: VecRow, vi: number) => {
    const res = fn.results[vi];
    const expNum = parseExpected(vec['expected']);
    const sOut  = outP ? res?.scalar?.outPtrs?.[outP.name]   ?? null : null;
    const nOut  = outP ? res?.neon?.outPtrs?.[outP.name]     ?? null : null;
    const aOut  = outP ? res?.aarch64?.outPtrs?.[outP.name]  ?? null : null;
    const sVal  = res?.scalar?.retVal  ?? null;
    const nVal  = res?.neon?.retVal    ?? null;
    const aVal  = res?.aarch64?.retVal ?? null;

    let pass = false;
    if (res) {
      if (outP && sOut && nOut && aOut) {
        pass = sOut.every((v, i) => Math.round(v) === Math.round(nOut[i] ?? 0) && Math.round(v) === Math.round(aOut[i] ?? 0));
      } else if (outP && sOut && nOut) {
        pass = sOut.every((v, i) => Math.round(v) === Math.round(nOut[i] ?? 0));
      } else if (typeof expNum === 'number' && sVal != null && nVal != null) {
        pass = Math.round(sVal) === Math.round(expNum) && Math.round(nVal) === Math.round(expNum);
      }
    }
    const rowCls = res ? (pass ? 'vt-pass' : 'vt-fail') : '';

    let tdHtml = `<td class="vt-num">${vi + 1}</td>`;
    if (parsed) {
      parsed.params.forEach(p => {
        const v = vec[p.name] !== undefined ? vec[p.name] : '';
        tdHtml += `<td><input class="vt-input" value="${v}" data-vi="${vi}" data-key="${p.name}"></td>`;
      });
    }
    tdHtml += `<td><input class="vt-expected" value="${vec['expected'] ?? ''}" data-vi="${vi}" data-key="expected" title="Optional scalar return check"></td>`;

    if (outP) {
      tdHtml += `<td class="vt-result" style="min-width:110px">${res ? renderArrCell(sOut, nOut) : ''}</td>`;
      tdHtml += `<td class="vt-result" style="min-width:110px">${res ? renderArrCell(nOut, sOut) : ''}</td>`;
      tdHtml += `<td class="vt-result" style="min-width:110px">${res?.aarch64 ? renderArrCell(aOut, sOut) : ''}</td>`;
    } else {
      const sOk = typeof expNum === 'number' && sVal != null && Math.round(sVal) === Math.round(expNum);
      const nOk = typeof expNum === 'number' && nVal != null && Math.round(nVal) === Math.round(expNum);
      const aOk = typeof expNum === 'number' && aVal != null && Math.round(aVal) === Math.round(expNum);
      tdHtml += `<td class="vt-result ${sOk ? 'ok' : res ? 'fail' : ''}">${res ? `${sVal ?? '—'}` : ''}</td>`;
      tdHtml += `<td class="vt-result ${nOk ? 'ok' : res ? 'fail' : ''}">${res ? `${nVal ?? '—'}` : ''}</td>`;
      tdHtml += `<td class="vt-result ${aOk ? 'ok' : res?.aarch64 ? 'fail' : ''}">${res?.aarch64 ? `${aVal ?? '—'}` : ''}</td>`;
    }
    tdHtml += `<td><button class="vt-del" data-vi="${vi}" title="Remove">×</button></td>`;

    const tr = document.createElement('tr');
    tr.className = rowCls;
    tr.innerHTML = tdHtml;

    // Wire inputs
    tr.querySelectorAll('.vt-input, .vt-expected').forEach(el => {
      (el as HTMLInputElement).addEventListener('change', function(this: HTMLInputElement) {
        onParamChange(+(this.dataset['vi'] ?? 0), this.dataset['key'] ?? '', this.value);
      });
    });
    tr.querySelector('.vt-del')?.addEventListener('click', function(this: HTMLElement) {
      onDelete(+(this.dataset['vi'] ?? 0));
    });

    tbody.appendChild(tr);
  });
}
