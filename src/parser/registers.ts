const GP_NAMES: Record<string, number> = { SP: 13, LR: 14, PC: 15, FP: 11, IP: 12, SL: 10 };

export function parseReg(t: string): number {
  if (!t) return -1;
  const u = t.toUpperCase().trim();
  if (u in GP_NAMES) return GP_NAMES[u];
  const m = u.match(/^R(\d+)$/);
  if (m && +m[1] < 16) return +m[1];
  return -1;
}

export type NeonRegType = { t: 'Q'; i: number } | { t: 'D'; i: number } | { t: 'S'; i: number };

export function parseNR(t: string): NeonRegType | null {
  if (!t) return null;
  const u = t.toUpperCase().trim();
  const q = u.match(/^Q(\d+)$/); if (q && +q[1] < 16) return { t: 'Q', i: +q[1] };
  const d = u.match(/^D(\d+)$/); if (d && +d[1] < 32) return { t: 'D', i: +d[1] };
  const s = u.match(/^S(\d+)$/); if (s && +s[1] < 32) return { t: 'S', i: +s[1] };
  return null;
}

export function rQ(tok: string): number {
  const nr = parseNR(tok.replace(/[{}]/g, '').trim());
  if (!nr) throw new Error(`Bad NEON reg: ${tok}`);
  return nr.t === 'Q' ? nr.i : nr.i >> 1;
}

export function memRn(tok: string): number {
  const m = (tok || '').match(/\[(\w+)/);
  if (!m) throw new Error(`Bad mem operand: ${tok}`);
  const r = parseReg(m[1]);
  if (r < 0) throw new Error(`Bad reg in mem: ${m[1]}`);
  return r;
}
