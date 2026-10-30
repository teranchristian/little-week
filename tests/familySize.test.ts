import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarLimitError, defaultFamily, participantTokens, sampleWeekForFamily } from '../src/planner.ts';

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

test('activity faces combine complete family and role groups', () => {
  const members = defaultFamily.members;
  assert.deepEqual(participantTokens(['dad', 'mum', 'child-1', 'child-2'], members), [{ kind: 'group', group: 'family' }]);
  assert.deepEqual(participantTokens(['dad', 'child-1', 'child-2'], members), [
    { kind: 'person', id: 'dad' }, { kind: 'group', group: 'kids' },
  ]);
  assert.deepEqual(participantTokens(['dad', 'mum'], members), [{ kind: 'group', group: 'parents' }]);
  assert.deepEqual(participantTokens(['dad', 'child-1'], members), [
    { kind: 'person', id: 'dad' }, { kind: 'person', id: 'child-1' },
  ]);
});

test('larger family groups fit within the four picture limit', () => {
  const family = structuredClone(defaultFamily);
  family.members.push({ id: 'child-3', name: 'Child 3', emoji: '👦', role: 'child' });
  const week = sampleWeekForFamily(family);
  const before = structuredClone(week);
  week[0].morning[0].who = family.members.map(member => member.id);
  assert.equal(calendarLimitError(before, week, family.members), null);
  assert.deepEqual(participantTokens(['dad', 'child-1', 'child-2', 'child-3'], family.members), [
    { kind: 'person', id: 'dad' }, { kind: 'group', group: 'kids' },
  ]);
});
