// node frontend/scripts/flow-layout-check.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  });
  module._compile(outputText, filename);
};
const { calculateLayout, moveWithColumnCollapse, NODE_HEIGHT } = require('../src/utils/dag.ts');
const { calculateRoutedEdges } = require('../src/utils/edgeRouting.ts');

const exp = (id, deps = [], extra = {}) => ({ id, name: id, deps, status: 'Planning', priority: 'Med', paper: '', blocks: [], ...extra });

// Chain a→b→c→d, a branch b→e→f, a long skip a→d, a merge f→g←d, and an independent root.
const exps = [
  exp('a'), exp('b', ['a']), exp('c', ['b']), exp('d', ['c', 'a']),
  exp('e', ['b']), exp('f', ['e']), exp('g', ['d', 'f']), exp('solo'), exp('solo2', ['solo']),
];

function check(project, label) {
  const { positions, nodeWidths } = calculateLayout(project, {}, { canvasWidth: 1600 });
  const boxes = Object.entries(positions).map(([id, p]) => ({ id, left: p.x, right: p.x + nodeWidths[id], top: p.y, bottom: p.y + NODE_HEIGHT }));
  for (const a of boxes) for (const b of boxes) {
    if (a.id < b.id) assert(!(a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom), `${label}: ${a.id} overlaps ${b.id}`);
  }
  const edges = project.exps.flatMap((e) => e.deps.map((d) => ({ source: d, target: e.id })));
  for (const r of calculateRoutedEdges(edges, positions, nodeWidths)) {
    // Control polygon of the path: every coordinate pair in order.
    const nums = r.pathData.match(/-?\d+(\.\d+)?/g).map(Number);
    const pts = [];
    for (let i = 0; i < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
    for (let i = 1; i < pts.length; i++) {
      const [p, q] = [pts[i - 1], pts[i]];
      for (const b of boxes) {
        if (b.id === r.source || b.id === r.target) continue;
        const hit = Math.max(Math.min(p.x, q.x), b.left) <= Math.min(Math.max(p.x, q.x), b.right) &&
          Math.max(Math.min(p.y, q.y), b.top) <= Math.min(Math.max(p.y, q.y), b.bottom);
        assert(!hit, `${label}: edge ${r.source}->${r.target} crosses ${b.id}`);
      }
    }
  }
  return positions;
}

const pos = check({ id: 'p', name: 'p', exps }, 'auto');
for (const [a, b] of [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'g'], ['e', 'f'], ['solo', 'solo2']]) {
  assert.equal(pos[a].y, pos[b].y, `${a} and ${b} share a row`);
}
assert(pos.e.y > pos.b.y, 'branch drops to a new row');
assert(pos.solo.y > pos.f.y, 'independent chain sits below the first one');

// Hand-placed parent: its new child lands level with it.
const custom = check({ id: 'p', name: 'p', exps: [exp('x', [], { px: 300, py: 400 }), exp('y', ['x'])] }, 'custom');
assert.equal(custom.y.y, 400);
assert(custom.y.x > 300);

// Dragging a tile out of a column pulls the tiles below it up into its slot.
const col = { r: { x: 20, y: 20 }, s1: { x: 300, y: 20 }, s2: { x: 300, y: 120 }, s3: { x: 300, y: 220 }, far: { x: 580, y: 120 } };
const w = { r: 200, s1: 200, s2: 200, s3: 200, far: 200 };
let moves = moveWithColumnCollapse('s1', { x: 900, y: 500 }, col, w);
assert.deepEqual(moves, { s1: { x: 900, y: 500 }, s2: { x: 300, y: 20 }, s3: { x: 300, y: 120 } });
moves = moveWithColumnCollapse('s2', { x: 310, y: 130 }, col, w);
assert.deepEqual(moves, { s2: { x: 310, y: 130 } }, 'a nudge within its own slot moves nothing else');
moves = moveWithColumnCollapse('s3', { x: 900, y: 20 }, col, w);
assert.deepEqual(Object.keys(moves), ['s3'], 'nothing below the bottom tile to move');

// Dragging one tile in an auto-laid-out chart leaves every other tile where it was.
const autoPos = calculateLayout({ id: 'p', name: 'p', exps }, {}, { canvasWidth: 1600 }).positions;
const afterDrag = calculateLayout({ id: 'p', name: 'p', exps: exps.map((e) => e.id === 'solo2' ? { ...e, px: 1400, py: 400 } : e) }, {}, { canvasWidth: 1600 }).positions;
for (const id of Object.keys(autoPos)) if (id !== 'solo2') assert.deepEqual(afterDrag[id], autoPos[id], `${id} stays put`);

console.log('PASS: chains share rows, branches drop, no tile overlaps, no route crosses a tile, hand-placed parents keep children level, column gaps close, other tiles stay put');
