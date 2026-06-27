export function evalCondition64(cc: string, flags: { N: boolean; Z: boolean; C: boolean; V: boolean }): boolean {
  const { N, Z, C, V } = flags;
  switch (cc.toUpperCase()) {
    case 'AL': case '':  return true;
    case 'EQ': return Z;
    case 'NE': return !Z;
    case 'LT': return N !== V;
    case 'LE': return Z || (N !== V);
    case 'GT': return !Z && (N === V);
    case 'GE': return N === V;
    case 'CS': case 'HS': return C;
    case 'CC': case 'LO': return !C;
    case 'MI': return N;
    case 'PL': return !N;
    case 'VS': return V;
    case 'VC': return !V;
    case 'HI': return C && !Z;
    case 'LS': return !C || Z;
    default: return true;
  }
}
