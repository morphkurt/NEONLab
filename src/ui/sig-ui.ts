import type { ParsedSig } from '../types';
import { labels } from './render';

export function renderSigParsed(el: HTMLElement, sig: string, parsed: ParsedSig | null): void {
  if (!sig.trim()) { el.innerHTML = ''; return; }
  if (!parsed) { el.innerHTML = '<span class="sig-err">? unrecognised signature</span>'; return; }

  let rIdx = 0;
  const parts = parsed.params.map(p => {
    const k = p.kind;
    let regStr = '';
    if (k.base === 'scalar') {
      regStr = `<span class="sp-reg">R${rIdx++}</span>`;
    } else if (k.base === 'scalar64') {
      if (rIdx & 1) rIdx++;
      regStr = `<span class="sp-reg">R${rIdx}:R${rIdx + 1}</span>`; rIdx += 2;
    } else if (k.base === 'float') {
      regStr = `<span class="sp-reg">R${rIdx++}</span>`;
    } else if (k.base === 'ptr') {
      regStr = `<span class="sp-reg">R${rIdx++}</span>`;
    }
    return `${regStr}=<span class="sp-name">${p.name}</span>`;
  });

  el.innerHTML = parts.join('  ') + `  <span style="color:#484f58">→</span> <span class="sp-ret">R0:${parsed.returnType}</span>`;

  // Auto-label registers from param names
  parsed.params.forEach((p, i) => {
    let ri = 0;
    parsed.params.slice(0, i).forEach(pp => {
      if (pp.kind.base === 'scalar64') { if (ri & 1) ri++; ri += 2; }
      else ri++;
    });
    labels.regs[ri] = p.name;
  });
}
