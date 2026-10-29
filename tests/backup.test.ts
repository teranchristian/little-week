import assert from 'node:assert/strict';
import test from 'node:test';
import { createBackup, parseBackup, saveBackup } from '../src/backup.ts';
import { defaultFamily, sampleWeekForFamily } from '../src/planner.ts';

const icon = { id: 'custom:picture', name: 'Photo', tag: 'photo', scope: 'activity' as const, image: 'data:image/png;base64,aGVsbG8=' };

test('backup includes custom images and restores all planner fields', () => {
  const week = sampleWeekForFamily(defaultFamily);
  week[0].morning[0].icon = icon.id;
  const backup = createBackup(defaultFamily, week, { start: 'today', daysToShow: 3 }, [icon]);
  assert.deepEqual(parseBackup(JSON.stringify(backup)), backup);
});

test('import rejects invalid content before changing storage', () => {
  const backup = createBackup(defaultFamily, sampleWeekForFamily(defaultFamily), { start: 'monday', daysToShow: 7 }, []);
  assert.throws(() => parseBackup('{broken'), /JSON/);
  assert.throws(() => parseBackup(JSON.stringify({ ...backup, version: 2 })), /version/);
  assert.throws(() => parseBackup(JSON.stringify({ ...backup, week: [] })), /activities/);
  const week = structuredClone(backup.week);
  week[0].morning[0].icon = 'custom:missing';
  assert.throws(() => parseBackup(JSON.stringify({ ...backup, week })), /missing activity icons/);
});

test('failed import restores existing browser data', () => {
  const backup = createBackup(defaultFamily, sampleWeekForFamily(defaultFamily), { start: 'monday', daysToShow: 7 }, [icon]);
  const items = new Map([['our-week-family-v1', 'previous family'], ['our-week-emoji-v1', 'previous week']]);
  const original = new Map(items);
  let writes = 0;
  const storage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { if (++writes === 3) throw new Error('quota'); items.set(key, value); },
    removeItem: (key: string) => { items.delete(key); },
  } as Storage;
  assert.throws(() => saveBackup(backup, storage), /Could not save/);
  assert.deepEqual(items, original);
});
