import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultFamily, sampleWeekForFamily } from '../src/planner.ts';

test('sample week supports four children without treating every four-person activity as all family members', () => {
  const family = structuredClone(defaultFamily);
  family.members.push(
    { id: 'child-3', name: 'Child 3', emoji: '👦' },
    { id: 'child-4', name: 'Child 4', emoji: '🧒' },
  );
  const week = sampleWeekForFamily(family);
  const allIds = family.members.map(member => member.id);
  assert.deepEqual(week[1].night[0].who, allIds);
  assert.deepEqual(week[0].afternoon[0].who, ['mum', 'child-1', 'child-2']);
  assert.deepEqual(week[0].night[0].who, ['dad', 'child-1', 'child-2']);
});
