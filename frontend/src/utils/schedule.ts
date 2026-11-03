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
