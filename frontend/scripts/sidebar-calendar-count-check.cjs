// Run: node frontend/scripts/sidebar-calendar-count-check.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/components/Layout/Sidebar.tsx'), 'utf8');
const block = source.slice(source.indexOf('  const now = new Date();'), source.indexOf('  const handleAddProject'));
const count = new Function('activeProjects', 'Date', `${block}\nreturn scheduledCount;`);
class LocalDate extends Date {
  constructor() { super('2026-10-28T00:30:00+09:00'); }
  getFullYear() { return 2026; }
  getMonth() { return 9; }
  getDate() { return 28; }
}
const project = (exps) => [{ exps }];
assert.equal(count(project([
  { experimentalProtocolStartDate: '2026-10-27', dataAcquisitionStartDate: '2026-10-28', dataAnalysisStartDate: '2026-10-29' },
  { experimentalProtocolStartDate: '', dataAcquisitionStartDate: '   ' },
  { experimentalProtocolStartDate: ' 2026-10-28 ', dataAnalysisStartDate: '2027-01-01' },
]), LocalDate), 4);
assert.equal(count(project([
  { dataAcquisitionStartDate: 'Friday, January 12, 2024', dataAnalysisStartDate: 'Thursday, February 5, 2026' },
  { dataAnalysisStartDate: '2026-10-28' },
]), LocalDate), 1);
assert.equal(count([], LocalDate), 0);
console.log('PASS: local today/future count; past, empty, and imported long-form dates excluded');
