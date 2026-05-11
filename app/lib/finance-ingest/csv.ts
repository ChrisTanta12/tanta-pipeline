/**
 * Minimal CSV parser. Handles quoted fields and "" escapes.
 * Ported from Tanta-Finance/inputs/analyze_kan.mjs (which is the more robust
 * of the two implementations we'd built up).
 */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let cell = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { inQ = false; }
      else cell += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { cur.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (cell !== '' || cur.length) { cur.push(cell); rows.push(cur); }
        cur = []; cell = '';
        if (c === '\r' && text[i + 1] === '\n') i++;
      } else cell += c;
    }
  }
  if (cell !== '' || cur.length) { cur.push(cell); rows.push(cur); }
  return rows;
}

/** Parse "DD/MM/YY" or "DD/MM/YYYY" or "YYYY-MM-DD". Returns Date or null. */
export function parseFlexibleDate(s: string | undefined | null): Date | null {
  if (!s) return null;
  const t = s.replace(/"/g, '').trim();
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (m) return new Date(2000 + +m[3], +m[2] - 1, +m[1]);
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);   // KAN format trailing time
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return null;
}

/** Strip $ and , then parseFloat. Returns 0 on garbage. */
export function parseDollar(s: string | number | undefined | null): number {
  if (s == null) return 0;
  if (typeof s === 'number') return Number.isFinite(s) ? s : 0;
  const cleaned = String(s).replace(/[$,]/g, '').trim();
  const v = parseFloat(cleaned);
  return Number.isFinite(v) ? v : 0;
}

/** ISO yyyy-mm-dd from a Date. */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
