// node frontend/scripts/lab-sync-check.ts - the window's side of mobile sync (src/utils/labSync.ts)
import { foldChanges, markSent, pendingEdits, startFrom, sync } from '../src/utils/labSync.ts';

let failed = 0;
const t = (name: string, cond: boolean) => {
  if (!cond) { failed++; console.error('FAIL:', name); } else { console.log('ok:', name); }
};

const exp = (id: string, extra: object = {}): any => ({ id, name: id, status: 'Planned', priority: '', paper: '', deps: [], blocks: [], ...extra });
const change = (rev: number, experiments: any[] = [], deleted: any[] = [], projects: any[] = []) => ({ rev, experiments, deleted, projects });
const find = (projects: any[], id: string) => projects.flatMap((p) => p.exps).find((e: any) => e.id === id);

let projects: any[] = [{ id: 'p', name: 'P', paperIds: [], exps: [exp('e1'), exp('e2')] }];
startFrom(projects, 10);

// nothing edited: a save sends no bases and nothing to write
t('clean window sends nothing', pendingEdits(projects).sent.size === 0);

// the user edits e1
const e1Edited = { ...find(projects, 'e1'), notes: 'desk' };
projects = [{ ...projects[0], exps: [e1Edited, find(projects, 'e2')] }];
let { sent, bases } = pendingEdits(projects);
t('edited experiment is sent with its base', sent.has('e1') && bases.e1?.notes === undefined && !sent.has('e2'));

// a phone edit to e2 arrives by polling: e2 is clean, so the window takes it
projects = foldChanges(projects, change(11, [{ ...exp('e2', { notes: 'bench' }), projectId: 'p', rev: 11 }]));
t('clean experiment takes the phone edit', find(projects, 'e2').notes === 'bench');
t('rev advances', sync.rev === 11);

// a phone edit to e1 arrives while e1 has unsaved desktop edits: the window keeps its edits
projects = foldChanges(projects, change(12, [{ ...exp('e1', { purpose: 'phone' }), projectId: 'p', rev: 12 }]));
t('edited experiment keeps the desktop edit', find(projects, 'e1').notes === 'desk' && find(projects, 'e1').purpose === undefined);
t('and is still sent with the old base', pendingEdits(projects).bases.e1?.purpose === undefined);

// the save goes through; the server's merged e1 comes back
({ sent } = pendingEdits(projects));
markSent(sent);
projects = foldChanges(projects, change(13, [{ ...exp('e1', { notes: 'desk', purpose: 'phone' }), projectId: 'p', rev: 13 }]));
t('merged copy replaces the sent one', find(projects, 'e1').purpose === 'phone' && pendingEdits(projects).sent.size === 0);

// a late, older answer for e1 must not roll it back
projects = foldChanges(projects, change(13, [{ ...exp('e1', { notes: 'old' }), projectId: 'p', rev: 12 }]));
t('older answer ignored', find(projects, 'e1').notes === 'desk');

// edited again while a save was in flight: keep typing, next base is what was sent
const typed1 = { ...find(projects, 'e1'), notes: 'desk 2' };
projects = [{ ...projects[0], exps: projects[0].exps.map((e: any) => (e.id === 'e1' ? typed1 : e)) }];
({ sent } = pendingEdits(projects));
const typed2 = { ...typed1, notes: 'desk 23' };
projects = [{ ...projects[0], exps: projects[0].exps.map((e: any) => (e.id === 'e1' ? typed2 : e)) }];
markSent(sent);
projects = foldChanges(projects, change(14, [{ ...exp('e1', { notes: 'desk 2', purpose: 'phone' }), projectId: 'p', rev: 14 }]));
t('typing during a save is kept', find(projects, 'e1').notes === 'desk 23');
t('next save merges from what was sent', pendingEdits(projects).bases.e1?.notes === 'desk 2');

// deleted on the server: a clean copy goes, an edited one stays (the save re-creates it)
projects = foldChanges(projects, change(15, [], [{ kind: 'experiment', id: 'e2', rev: 15 }, { kind: 'experiment', id: 'e1', rev: 15 }]));
t('clean deleted experiment removed', !find(projects, 'e2'));
t('edited deleted experiment kept', Boolean(find(projects, 'e1')));

// restored on the server into a project this window does not have
projects = foldChanges(projects, change(16, [{ ...exp('e9'), projectId: 'p2', rev: 16 }], [], [{ id: 'p2', name: 'Restored', archived: false, paperIds: [], rev: 16 }]));
t('restored experiment and project appear', find(projects, 'e9') && projects.some((p) => p.id === 'p2'));

// deleted here, save pending: a server change to it must not bring it back
projects = projects.map((p) => ({ ...p, exps: p.exps.filter((e: any) => e.id !== 'e9') }));
projects = foldChanges(projects, change(17, [{ ...exp('e9', { notes: 'x' }), projectId: 'p2', rev: 17 }]));
t('locally deleted experiment stays deleted', !find(projects, 'e9'));

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log('lab-sync-check passed');
