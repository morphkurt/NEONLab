import type { ParamKind, Param, ParsedSig } from '../types';

const SCALAR_TYPES = new Set([
  'int', 'int8_t', 'int16_t', 'int32_t', 'int64_t',
  'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t',
  'long', 'short', 'char', 'float', 'double', 'void',
]);

const ELEM_SIZES: Record<string, number> = {
  int: 4, int8_t: 1, int16_t: 2, int32_t: 4, int64_t: 8,
  uint8_t: 1, uint16_t: 2, uint32_t: 4, uint64_t: 8,
  float: 4, double: 8, long: 4, short: 2, char: 1,
};

export function inferKind(type: string): ParamKind {
  const isPtr = type.includes('*');
  const base  = type.replace(/\*/g, '').trim();
  if (isPtr) return { base: 'ptr', elemType: base, elemSize: ELEM_SIZES[base] ?? 4 };
  if (base === 'int64_t' || base === 'uint64_t' || base === 'long long') return { base: 'scalar64' };
  if (base === 'float' || base === 'double') return { base: 'float' };
  return { base: 'scalar' };
}

export function parseSig(sig: string): ParsedSig | null {
  sig = sig.trim();
  if (!sig) return null;
  // "rettype name(type param, ...)"  — type may contain * or spaces
  const m = sig.match(/^([\w\s*]+?)\s+(\w+)\s*\(([^)]*)\)\s*$/);
  if (!m) return null;
  const returnType = m[1].trim();
  const name       = m[2].trim();
  const paramStr   = m[3].trim();
  if (!name) return null;

  const params: Param[] = paramStr
    ? paramStr.split(',').map(p => {
        p = p.trim();
        const toks = p.split(/\s+/);
        let pname = (toks.pop() ?? '').replace(/^\*+/, '');
        let ptype = toks.join(' ');
        // pointer marker may be on the name side
        if (p.includes('*') && !ptype.includes('*')) ptype += '*';
        ptype = ptype.trim() || 'int';
        const validType = SCALAR_TYPES.has(ptype.replace(/\*/g, '').trim());
        if (!validType && !ptype.includes('*')) ptype = 'int';
        return { name: pname, type: ptype, kind: inferKind(ptype) };
      })
    : [];

  return { returnType, name, params };
}
