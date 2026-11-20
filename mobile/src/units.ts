import type { Experiment } from '../../frontend/src/types/lab.ts';

// Merge units, the phone half of backend/app/mobile_sync/merge.py (flatten/unflatten/phone_may_edit).
// An op changes one unit; the desktop merges each unit against its own copy.

export type Units = Record<string, unknown>;

const ORDER_UNITS = new Set(['blocks:order', 'customPhases:order']);
const TEXT = ['purpose', 'expectedResults', 'experimentalDesign', 'experimentalProtocol', 'dataAcquisition', 'dataAnalysis', 'results', 'figures', 'futureDirections', 'notes'];
const PHONE_FIELDS = new Set([
  ...TEXT, 'name', 'status',
  ...['experimentalProtocol', 'dataAcquisition', 'dataAnalysis'].flatMap((p) => ['Duration', 'Completed', 'StartDate', 'EndDate'].map((m) => p + m)),
]);
const PHONE_CUSTOM = /^customPhases\/[^/]+\/(content|duration|completed|startDate|endDate)$/;

export const phoneMayEdit = (unit: string) =>
  PHONE_FIELDS.has(unit) || PHONE_CUSTOM.test(unit) || /^blocks\/.+/.test(unit) || /^deviations\/.+/.test(unit);

/** JSON with sorted keys: equal content compares equal whatever order the keys were built in. */
export function stable(value: unknown): string {
  return JSON.stringify(value ?? null, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v);
}

export function flatten(exp: Experiment): Units {
  const units: Units = {};
  for (const [key, value] of Object.entries(exp) as [string, any][]) {
    if (key === 'blocks') {
      for (const b of value || []) units[`blocks/${b.id}`] = b;
      units['blocks:order'] = (value || []).map((b: any) => b.id);
    } else if (key === 'customPhases') {
      if (value == null) { units['customPhases:order'] = null; continue; }
      for (const cp of value) for (const [prop, v] of Object.entries(cp)) if (prop !== 'id') units[`customPhases/${cp.id}/${prop}`] = v;
      units['customPhases:order'] = value.map((cp: any) => cp.id);
    } else if (key === 'deviations') {
      for (const [phase, entries] of Object.entries(value || {}) as [string, any[]][]) if (entries?.length) units[`deviations/${phase}`] = entries;
    } else {
      units[key] = value;
    }
  }
  return units;
}

const ordered = <T,>(items: Map<string, T>, order: unknown) => {
  const ids = ((order as string[]) || []).filter((id) => items.has(id));
  return [...ids.map((id) => items.get(id)!), ...[...items].filter(([id]) => !ids.includes(id)).map(([, v]) => v)];
};

export function unflatten(units: Units): Experiment {
  const exp: any = {};
  const blocks = new Map<string, unknown>();
  const phases = new Map<string, any>();
  const deviations: Record<string, unknown> = {};
  for (const [unit, value] of Object.entries(units)) {
    if (unit.startsWith('blocks/')) { if (value != null) blocks.set(unit.slice(7), value); }
    else if (unit.startsWith('customPhases/')) {
      const [, id, prop] = unit.split('/');
      if (value != null) { if (!phases.has(id)) phases.set(id, { id }); phases.get(id)[prop] = value; }
    } else if (unit.startsWith('deviations/')) { if (Array.isArray(value) && value.length) deviations[unit.slice(11)] = value; }
    else if (!ORDER_UNITS.has(unit)) exp[unit] = value;
  }
  exp.blocks = ordered(blocks, units['blocks:order']);
  exp.customPhases = units['customPhases:order'] == null && !phases.size ? null : ordered(phases, units['customPhases:order']);
  exp.deviations = Object.keys(deviations).length ? deviations : null;
  return exp as Experiment;
}

/** The units an edit changed, as (unit, value before, value after). Order units are left out: the
 * desktop appends new blocks itself. */
export function diffUnits(before: Experiment, after: Experiment) {
  const a = flatten(before);
  const b = flatten(after);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((u) => !ORDER_UNITS.has(u) && u !== 'id' && stable(a[u]) !== stable(b[u]))
    .map((unit) => ({ unit, before: a[unit] ?? null, after: b[unit] ?? null }));
}

/** Apply (unit, value) changes to an experiment. */
export function withUnits(exp: Experiment, changes: { unit: string; value: unknown }[]): Experiment {
  if (!changes.length) return exp;
  const units = flatten(exp);
  for (const c of changes) units[c.unit] = c.value;
  return { ...unflatten(units), id: exp.id };
}
