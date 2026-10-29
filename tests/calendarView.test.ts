import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarSettingsKey, readCalendarSettings, visibleDays } from '../src/calendarView.ts';

test('Monday remains the default seven-day order', () => {
  const shown = visibleDays({ start: 'monday', daysToShow: 3 }, new Date(2026, 9, 30));
  assert.deepEqual(shown.map(day => day.label), ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
  assert.ok(shown.every(day => day.date === undefined));
});

test('Sunday starts with Sunday and keeps all weekday activities in place', () => {
  const shown = visibleDays({ start: 'sunday', daysToShow: 1 }, new Date(2026, 9, 30));
  assert.deepEqual(shown.map(day => day.index), [6, 0, 1, 2, 3, 4, 5]);
});

test('Today shows the selected number of days across a week and month boundary', () => {
  const shown = visibleDays({ start: 'today', daysToShow: 4 }, new Date(2026, 9, 30)); // Friday
  assert.deepEqual(shown.map(day => day.label), ['FRI', 'SAT', 'SUN', 'MON']);
  assert.deepEqual(shown.map(day => day.date?.getDate()), [30, 31, 1, 2]);
});

test('Today accepts the one-day and seven-day limits', () => {
  const now = new Date(2026, 9, 30);
  assert.deepEqual(visibleDays({ start: 'today', daysToShow: 1 }, now).map(day => day.label), ['FRI']);
  assert.equal(visibleDays({ start: 'today', daysToShow: 7 }, now).length, 7);
});

test('saved settings fall back to Monday when invalid or unavailable', () => {
  const original = globalThis.localStorage;
  let saved: string | null = null;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => key === calendarSettingsKey ? saved : null },
  });
  try {
    assert.deepEqual(readCalendarSettings(), { start: 'monday', daysToShow: 7 });
    saved = JSON.stringify({ start: 'today', daysToShow: 0 });
    assert.deepEqual(readCalendarSettings(), { start: 'monday', daysToShow: 7 });
    saved = JSON.stringify({ start: 'today', daysToShow: 8 });
    assert.deepEqual(readCalendarSettings(), { start: 'monday', daysToShow: 7 });
    saved = JSON.stringify({ start: 'sunday', daysToShow: 4 });
    assert.deepEqual(readCalendarSettings(), { start: 'sunday', daysToShow: 4 });
    saved = '{broken json';
    assert.deepEqual(readCalendarSettings(), { start: 'monday', daysToShow: 7 });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => { throw new Error('blocked'); } } });
    assert.deepEqual(readCalendarSettings(), { start: 'monday', daysToShow: 7 });
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: original });
  }
});
