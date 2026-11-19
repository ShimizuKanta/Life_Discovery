import test from 'node:test';
import assert from 'node:assert/strict';
import { anniversary, createDiscovery, decide, filterDeck, parseBackup, weeklyDue, yearlyDue } from '../dist/assets/core.js';
const at = '2024-02-29T12:30:00.000Z';
const item = () => createDiscovery('A discovery', at, new Date(at));
const backup = () => ({ schemaVersion: 1, exportedAt: at, settings: { language: 'ja' }, discoveries: [item()] });

test('weekly boundary is seven elapsed days from discovery, not creation', () => {
  const record = createDiscovery('test', at, new Date('2026-11-18T00:00:00.000Z'));
  assert.equal(weeklyDue(record, new Date('2024-03-07T12:29:59.999Z')), false);
  assert.equal(weeklyDue(record, new Date('2024-03-07T12:30:00.000Z')), true);
  assert.equal(weeklyDue(decide(record, 'archived'), new Date()), false);
  assert.equal(weeklyDue(createDiscovery('future', '2099-01-01T00:00:00.000Z')), false);
});
test('anniversary clamps leap day and preserves local time', () => {
  const leap = new Date(2024, 1, 29, 18, 45);
  const result = anniversary(leap.toISOString());
  assert.equal(result.getFullYear(), 2025);
  assert.equal(result.getMonth(), 1);
  assert.equal(result.getDate(), 28);
  assert.equal(result.getHours(), 18);
  assert.equal(result.getMinutes(), 45);
  assert.equal(anniversary(new Date(2023, 2, 1, 9).toISOString()).getDate(), 1);
});
test('annual queue requires kept, due, and no prior review', () => {
  const record = item();
  const due = anniversary(record.discoveredAt);
  assert.equal(yearlyDue(record, due), false);
  const kept = decide(record, 'kept');
  assert.equal(yearlyDue(kept, new Date(due.getTime() - 1)), false);
  assert.equal(yearlyDue(kept, due), true);
  assert.equal(yearlyDue(decide(kept, 'archived'), due), false);
  assert.equal(yearlyDue({ ...kept, review: { score: 0, comment: '', reviewedAt: due.toISOString() } }, due), false);
  assert.equal(yearlyDue({ ...kept, discoveredAt: '2099-01-01T00:00:00.000Z' }, due), false);
});
test('backup round-trip includes archives, decisions, reviews, settings and empty data', () => {
  const data = backup();
  data.discoveries.push({ ...decide(item(), 'archived'), review: { score: 100, comment: 'Still matters', reviewedAt: at } });
  assert.deepEqual(parseBackup(JSON.stringify(data)), data);
  data.discoveries = [];
  assert.deepEqual(parseBackup(JSON.stringify(data)), data);
});
test('backup rejects malformed or inconsistent data before replacement', () => {
  const invalid = [
    data => { data.schemaVersion = 2; },
    data => { data.settings.language = 'fr'; },
    data => { data.discoveries.push(data.discoveries[0]); },
    data => { data.discoveries[0].discoveredAt = '2025-02-30T12:30:00.000Z'; },
    data => { data.discoveries[0].content = ' '; },
    data => { data.discoveries[0].decision = 'kept'; },
    data => { data.discoveries[0].review = { score: 40, comment: '', reviewedAt: at }; },
    data => { data.discoveries[0] = { ...decide(data.discoveries[0], 'kept'), review: { score: 101, comment: '', reviewedAt: at } }; },
    data => { delete data.discoveries[0].review; }
  ];
  for (const mutate of invalid) { const data = backup(); mutate(data); assert.throws(() => parseBackup(JSON.stringify(data))); }
  assert.throws(() => parseBackup('not json'));
});
test('deck respects archive visibility, inclusive local date filters and sort', () => {
  const one = createDiscovery('older', new Date(2025, 0, 1, 0, 1).toISOString());
  const two = createDiscovery('newer', new Date(2025, 0, 2, 23, 59).toISOString());
  const archived = decide(createDiscovery('archive', new Date(2025, 0, 3).toISOString()), 'archived');
  assert.deepEqual(filterDeck([one, two, archived], 'newest', false, '', '').map(item => item.content), ['newer', 'older']);
  assert.equal(filterDeck([one, two, archived], 'oldest', true, '', '').length, 3);
  assert.deepEqual(filterDeck([one, two], 'oldest', false, '2025-01-02', '2025-01-02'), [two]);
});

test('v2 validates categories and photo data while v1 remains readable', () => {
  const old = backup();
  assert.deepEqual(parseBackup(JSON.stringify(old)), old);
  const data = { ...old, schemaVersion: 2, discoveries: old.discoveries.map(item => ({ ...item, category: 'insight', photo: null })) };
  assert.deepEqual(parseBackup(JSON.stringify(data)), data);
  for (const photo of ['https://example.com/photo.jpg', 'data:image/svg+xml;base64,AA==', 'not a photo', 42]) {
    assert.throws(() => parseBackup(JSON.stringify({ ...data, discoveries: [{ ...data.discoveries[0], photo }] })));
  }
  assert.throws(() => parseBackup(JSON.stringify({ ...data, discoveries: [{ ...data.discoveries[0], category: 'invalid' }] })));
  assert.equal(filterDeck(data.discoveries, 'newest', false, '', '', 'insight').length, 1);
  assert.equal(filterDeck(data.discoveries, 'newest', false, '', '', 'first').length, 0);
});
