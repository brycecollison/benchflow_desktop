/** Local calendar date as YYYY-MM-DD, the format the notebook stores. */
export const isoDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** A stored date as YYYY-MM-DD, or '' when it is not a date. Older notebook imports hold
 * long-form dates ("Tuesday, June 23, 2026"), which calendar code would compare as text. */
export function toIsoDay(s: string): string {
  s = s.trim();
  if (/^\d{4}-\d\d-\d\d$/.test(s)) return s;
  const d = new Date(s);
  return s && !Number.isNaN(d.getTime()) ? isoDay(d) : '';
}

/** A phase date for display and scheduling: ISO when it parses, else as stored (never dropped). */
export const phaseDate = (s?: string) => toIsoDay(s || '') || (s || '').trim();

/** Durations shorter than a day still occupy one calendar day. */
export function parseDurationDays(durationStr?: string): number {
  if (!durationStr || !durationStr.trim()) return 1;
  const s = durationStr.toLowerCase().trim();
  if (s.includes('1/2')) return 1;
  const matchWeeks = s.match(/(\d+)\s*(?:week|weeks|w)/);
  if (matchWeeks) return Math.max(1, parseInt(matchWeeks[1], 10) * 7);
  const matchDays = s.match(/(\d+)\s*(?:day|days|d)/);
  if (matchDays) return Math.max(1, parseInt(matchDays[1], 10));
  return 1;
}
