// node frontend/scripts/downstream-insertion-check.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

// Load the real store in Node without adding a test runner or contacting the backend.
require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  });
  module._compile(outputText, filename);
};
global.window = {};
global.localStorage = { getItem: () => null };
const { useLabStore } = require('../src/store/useLabStore.ts');
const base = { status: 'Planning', priority: 'Med', paper: '', blocks: [] };
const projects = [
  { id: 'p', name: 'Insertion project', exps: [
    { ...base, id: 'a', name: 'Parent', deps: [] },
    { ...base, id: 'other', name: 'Other prerequisite', deps: [] },
    { ...base, id: 'c', name: 'First child', deps: ['a', 'other'] },
    { ...base, id: 'd', name: 'Second child', deps: ['a'] },
    { ...base, id: 'e', name: 'Grandchild', deps: ['c'] },
  ] },
  { id: 'q', name: 'Other project', exps: [{ ...base, id: 'q1', name: 'Untouched', deps: ['a'] }] },
];
const saves = [];
useLabStore.setState({ projects, papers: [], saveState: async () => { saves.push(useLabStore.getState().projects); } });
const id = useLabStore.getState().addExperiment('p', 'Inserted', ['a'], '', 'Planning', 'Med', ['dataAnalysis'], true);
const updated = useLabStore.getState().projects;
const find = (expId) => useLabStore.getState().projects[0].exps.find((e) => e.id === expId);
assert.deepEqual(find(id).deps, ['a']);
assert.deepEqual(find(id).phases, ['dataAnalysis']);
assert.deepEqual(find('c').deps, [id, 'other']);
assert.deepEqual(find('d').deps, [id]);
assert.deepEqual(find('e').deps, ['c'], 'Indirect descendants keep their dependencies');
assert.deepEqual(find('a').deps, []);
assert.equal(updated[1], projects[1], 'Other projects are untouched');
assert.equal(saves.length, 1, 'Creation and rewiring save atomically');
assert.equal(saves[0], updated);
assert.equal(useLabStore.getState().activeModalExpId, id);
const leafId = useLabStore.getState().addExperiment('p', 'Leaf child', ['e'], '', 'Planning', 'Med', undefined, true);
assert.deepEqual(find(leafId).deps, ['e']);
const ordinaryId = useLabStore.getState().addExperiment('p', 'Ordinary child', ['a']);
assert.deepEqual(find(ordinaryId).deps, ['a']);
assert.deepEqual(find(id).deps, ['a'], 'Ordinary creation does not rewire existing children');
useLabStore.getState().deleteExperiment('p', id);
assert.equal(find(id), undefined);
assert.deepEqual(find('c').deps, ['a', 'other']);
assert.deepEqual(find('d').deps, ['a']);
assert.deepEqual(find('e').deps, ['c']);
assert.equal(useLabStore.getState().projects[1], projects[1]);

// Multiple surviving prerequisites are inherited once; missing prerequisites are not propagated.
useLabStore.setState({
  projects: [{ ...projects[0], exps: [
    ...projects[0].exps,
    { ...base, id: 'b', name: 'Middle', deps: ['a', 'other', 'missing'] },
    { ...base, id: 'child', name: 'Child', deps: ['b', 'a'] },
  ] }, projects[1]],
  activeModalExpId: 'b',
});
const savesBeforeDelete = saves.length;
useLabStore.getState().deleteExperiment('p', 'b');
assert.deepEqual(find('child').deps, ['a', 'other']);
assert.equal(useLabStore.getState().activeModalExpId, null);
assert.equal(saves.length, savesBeforeDelete + 1, 'Deletion and reconnection save atomically');
useLabStore.getState().deleteExperiment('p', 'a');
assert.deepEqual(find('d').deps, [], 'Deleting a root just removes its dependency');
assert.deepEqual(find('c').deps, ['other']);
assert.deepEqual(find('child').deps, ['other']);
useLabStore.setState({ projects: [{ ...projects[0], exps: [
  { ...base, id: 'b', name: 'Orphaned middle', deps: ['missing'] },
  { ...base, id: 'child', name: 'Child', deps: ['b'] },
] }] });
useLabStore.getState().deleteExperiment('p', 'b');
assert.deepEqual(find('child').deps, [], 'Missing upstream nodes are not reintroduced');
console.log('PASS: downstream insertion and deletion, branching, prerequisite inheritance, deduplication, missing parents, root deletion, project isolation, atomic saves, and ordinary creation');
