import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { calendarLimitError, printActivityWeight, findActivity, groupActivity, moveActivity, sortGroupedActivities, type WeekPlan } from '../src/planner.ts';

function week(): WeekPlan {
  const item = (id: string) => ({ id, icon: '🏠', label: id, who: [] });
  return Array.from({ length: 7 }, (_, day) => ({ morning: day ? [] : [item('a'), item('b'), item('c')], afternoon: [], night: [] }));
}

test('activities can be grouped, moved apart and grouped across day parts', () => {
  const initial = week();
  const grouped = groupActivity(initial, 'a', 'b');
  assert.equal(grouped[0].morning.find(item => item.id === 'a')?.simultaneousId, 'b');
  assert.equal(grouped[0].morning.find(item => item.id === 'b')?.simultaneousId, 'b');
  assert.equal(initial[0].morning[0].simultaneousId, undefined);
  const apart = moveActivity(grouped, findActivity(grouped, 'a')!, { day: 0, part: 'morning', index: 0 });
  assert.equal(apart[0].morning[0].id, 'a');
  assert.equal(apart[0].morning[0].simultaneousId, undefined);
  const moved = moveActivity(apart, findActivity(apart, 'c')!, { day: 1, part: 'afternoon', index: null });
  const joined = groupActivity(moved, 'a', 'c');
  assert.deepEqual(joined[1].afternoon.map(item => item.id), ['c', 'a']);
  assert.equal(joined[1].afternoon[1].simultaneousId, 'c');
});


test('group ordering prioritises family order for single people, then multiple people and unassigned', () => {
  const members = [{ id: 'dad', name: 'Dad', emoji: '👨' }, { id: 'child', name: 'Child', emoji: '👧' }];
  const item = (label: string, who: string[]) => ({ id: label, label, who, icon: '🏠' });
  const activities = [item('Zoo', []), item('Daycare', ['child']), item('Play', ['dad', 'child']), item('Work', ['dad']), item('Art', ['dad'])];
  assert.deepEqual(sortGroupedActivities(activities, members).map(activity => activity.label), ['Art', 'Work', 'Daycare', 'Play', 'Zoo']);
  assert.equal(activities[0].label, 'Zoo');
});


test('print row count treats a simultaneous group as one vertical slot', () => {
  const initial = week();
  const grouped = groupActivity(initial, 'a', 'b');
  assert.equal(printActivityWeight(initial[0].morning), 3);
  assert.equal(printActivityWeight(grouped[0].morning), 2);
  assert.equal(printActivityWeight([]), 0);
});

test('two activities fit a section, including when side by side', () => {
  const initial = week();
  initial[0].morning.pop();
  const paired = groupActivity(initial, 'a', 'b');
  assert.equal(calendarLimitError(initial, paired), null);
  const third = structuredClone(paired);
  third[0].morning.push({ id: 'c', icon: '🏠', label: 'c', who: [] });
  assert.match(calendarLimitError(paired, third)!, /Only 2 activities/);
  const moved = moveActivity(initial, findActivity(initial, 'a')!, { day: 1, part: 'morning', index: null });
  assert.equal(calendarLimitError(initial, moved), null);
});

test('four faces fit; a fifth is rejected while older entries can be edited', () => {
  const initial = week();
  initial[0].morning = [{ id: 'a', icon: '🏠', label: 'a', who: ['1', '2', '3', '4'] }];
  const five = structuredClone(initial);
  five[0].morning[0].who.push('5');
  assert.match(calendarLimitError(initial, five)!, /up to 4 people/);
  const edited = structuredClone(five);
  edited[0].morning[0].label = 'edited';
  assert.equal(calendarLimitError(five, edited), null);
});
