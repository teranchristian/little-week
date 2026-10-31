import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { activityVisibleParts, calendarLimitError, continuingActivities, occupiedSection, removeActivityFromSection, sectionLayout, printActivityWeight, findActivity, groupActivity, moveActivity, sortGroupedActivities, type WeekPlan } from '../src/planner.ts';

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

test('one pair and one separate activity fill the two section slots', () => {
  const initial = week();
  initial[0].morning.pop();
  const paired = groupActivity(initial, 'a', 'b');
  assert.equal(calendarLimitError(initial, paired), null);
  const third = structuredClone(paired);
  third[0].morning.push({ id: 'c', icon: '🏠', label: 'c', who: [] });
  assert.equal(calendarLimitError(paired, third), null);
  assert.deepEqual(sectionLayout(third[0].morning), { slots: 2, groupCount: 1, largestGroup: 2 });
  const fourth = structuredClone(third);
  fourth[0].morning.push({ id: 'd', icon: '🏠', label: 'd', who: [] });
  assert.match(calendarLimitError(third, fourth)!, /Only 2 activities or groups/);
  assert.match(calendarLimitError(third, groupActivity(third, 'c', 'b'))!, /Only 2 activities can be side by side/);
  const moved = moveActivity(initial, findActivity(initial, 'a')!, { day: 1, part: 'morning', index: null });
  assert.equal(calendarLimitError(initial, moved), null);
});

test('only one side-by-side group is allowed in a section', () => {
  const initial = week();
  initial[0].morning.push({ id: 'd', icon: '🏠', label: 'd', who: [] });
  const firstPair = groupActivity(initial, 'a', 'b');
  const secondPair = groupActivity(firstPair, 'c', 'd');
  assert.match(calendarLimitError(firstPair, secondPair)!, /Only 1 side-by-side group/);
});

test('four faces fit; a fifth is rejected while older entries can be edited', () => {
  const initial = week();
  initial[0].morning = [{ id: 'a', icon: '🏠', label: 'a', who: ['1', '2', '3', '4'] }];
  const five = structuredClone(initial);
  five[0].morning[0].who.push('5');
  assert.match(calendarLimitError(initial, five)!, /up to 4 pictures/);
  const edited = structuredClone(five);
  edited[0].morning[0].label = 'edited';
  assert.equal(calendarLimitError(five, edited), null);
});

test('a spanning activity occupies each covered part and blocks a full destination', () => {
  const initial = week();
  initial[0].morning = [initial[0].morning[0]];
  initial[0].afternoon = [{ id: 'd', icon: '🏠', label: 'd', who: [] }, { id: 'e', icon: '🏠', label: 'e', who: [] }];
  const span = structuredClone(initial);
  span[0].morning[0].endPart = 'night';
  assert.deepEqual(continuingActivities(span[0], 'afternoon').map(item => item.id), ['a']);
  assert.deepEqual(continuingActivities(span[0], 'night').map(item => item.id), ['a']);
  assert.deepEqual(occupiedSection(span[0], 'afternoon').map(item => item.id), ['a', 'd', 'e']);
  assert.match(calendarLimitError(initial, span)!, /Only 2 activities or groups/);
  span[0].afternoon.pop();
  assert.equal(calendarLimitError(initial, span), null);
});

test('only the members of a group that continue occupy the next part', () => {
  const initial = week();
  initial[0].morning = initial[0].morning.slice(0, 2);
  const grouped = groupActivity(initial, 'a', 'b');
  grouped[0].morning[0].endPart = 'afternoon';
  assert.deepEqual(continuingActivities(grouped[0], 'afternoon').map(item => item.id), ['b']);
  assert.equal(sectionLayout(occupiedSection(grouped[0], 'afternoon')).slots, 1);
  grouped[0].morning[1].endPart = 'afternoon';
  assert.deepEqual(continuingActivities(grouped[0], 'afternoon').map(item => item.id), ['b', 'a']);
  assert.deepEqual(sectionLayout(occupiedSection(grouped[0], 'afternoon')), { slots: 1, groupCount: 1, largestGroup: 2 });
});

test('removing one linked section keeps the other cards', () => {
  const initial = week();
  initial[0].morning = [{ id: 'a', icon: '🏠', label: 'a', who: [], endPart: 'night' }];
  const withoutAfternoon = removeActivityFromSection(initial, 'a', 'afternoon');
  assert.deepEqual(activityVisibleParts('morning', withoutAfternoon[0].morning[0]), ['morning', 'night']);
  assert.deepEqual(occupiedSection(withoutAfternoon[0], 'afternoon'), []);
  assert.deepEqual(occupiedSection(withoutAfternoon[0], 'night').map(item => item.id), ['a']);
  const withoutMorning = removeActivityFromSection(initial, 'a', 'morning');
  assert.deepEqual(withoutMorning[0].morning, []);
  assert.deepEqual(activityVisibleParts('afternoon', withoutMorning[0].afternoon[0]), ['afternoon', 'night']);
  const withoutNight = removeActivityFromSection(initial, 'a', 'night');
  assert.deepEqual(activityVisibleParts('morning', withoutNight[0].morning[0]), ['morning', 'afternoon']);
  assert.equal(initial[0].morning[0].endPart, 'night');
});

test('removing the first section of a grouped span preserves the later group', () => {
  const initial = week();
  initial[0].morning = initial[0].morning.slice(0, 2);
  const grouped = groupActivity(initial, 'a', 'b');
  grouped[0].morning.forEach(item => { item.endPart = 'afternoon'; });
  const result = removeActivityFromSection(grouped, 'a', 'morning');
  assert.deepEqual(result[0].morning.map(item => item.id), ['b']);
  assert.deepEqual(result[0].afternoon.map(item => item.id), ['a']);
  assert.deepEqual(sectionLayout(occupiedSection(result[0], 'afternoon')), { slots: 1, groupCount: 1, largestGroup: 2 });
});
