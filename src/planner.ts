export const people = {
  dad: { name: 'Dad', emoji: '👨' },
  mum: { name: 'Mum', emoji: '👩' },
  ema: { name: 'Ema', emoji: '👧' },
  haru: { name: 'Haru', emoji: '👶' },
} as const;

export type PersonId = keyof typeof people;
export const personIds = Object.keys(people) as PersonId[];
export const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
export const parts = [
  { id: 'morning', name: 'Morning', emoji: '🌅' },
  { id: 'afternoon', name: 'Afternoon', emoji: '☀️' },
  { id: 'night', name: 'Night', emoji: '🌙' },
] as const;
export type PartId = typeof parts[number]['id'];

export const familyIcon = '👨‍👩‍👧‍👦';
export const previousFamilyIcon = '🧑‍🧑‍🧒‍🧒';

export const icons = [
  ['🏫', 'Daycare'], ['💻', 'Work'], ['🏥', 'Nurse work'], ['🏠', 'Home'],
  ['🛝', 'Playground'], ['🌳', 'Park'], ['👫', 'Friends'], ['🏊', 'Swimming'],
  ['📖', 'Stories'], ['🍽️', 'Dinner'], ['🚗', 'Outing'], ['🎨', 'Art'],
  ['🧸', 'Play'], ['🛒', 'Shopping'], ['🩺', 'Doctor'], ['🎂', 'Birthday'],
  ['⚽', 'Sport'], ['🎵', 'Music'], ['🍿', 'Movie'], ['😴', 'Nap'],
  ['📚', 'Library'], ['🏖️', 'Beach'], ['🍦', 'Treat'], [familyIcon, 'Family'],
] as const;

export interface Activity {
  id: string;
  icon: string;
  label: string;
  who: PersonId[];
}
export type DayPlan = Record<PartId, Activity[]>;
export type WeekPlan = DayPlan[];
export interface ActivityPosition { day: number; part: PartId; index: number }
export interface ActivityDestination { day: number; part: PartId; index: number | null }

export function findActivity(week: WeekPlan, id: string): ActivityPosition | undefined {
  for (let day = 0; day < week.length; day++) {
    for (const part of parts) {
      const index = week[day][part.id].findIndex(activity => activity.id === id);
      if (index !== -1) return { day, part: part.id, index };
    }
  }
}

export function moveActivity(week: WeekPlan, from: ActivityPosition, to: ActivityDestination): WeekPlan {
  const source = week[from.day]?.[from.part];
  const destination = week[to.day]?.[to.part];
  if (!source?.[from.index] || !destination) return week;
  const sameSlot = from.day === to.day && from.part === to.part;
  const targetIndex = to.index === null ? destination.length - (sameSlot ? 1 : 0) : to.index;
  if (sameSlot && from.index === targetIndex) return week;

  const next = structuredClone(week);
  const [activity] = next[from.day][from.part].splice(from.index, 1);
  next[to.day][to.part].splice(targetIndex, 0, activity);
  return next;
}

export function newActivityId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `activity-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const activity = (icon: string, label: string, who: PersonId[]): Activity => ({ id: newActivityId(), icon, label, who });
const all = [...personIds];
export const sampleWeek: WeekPlan = [
  { morning: [activity('🏫', 'Daycare', ['ema']), activity('💻', 'Work', ['dad'])], afternoon: [activity('🛝', 'Playground', ['mum', 'ema', 'haru'])], night: [activity('📖', 'Stories', ['dad', 'ema', 'haru'])] },
  { morning: [activity('🏫', 'Daycare', ['ema', 'haru']), activity('💻', 'Work', ['dad'])], afternoon: [activity('🌳', 'Park', ['mum', 'ema', 'haru'])], night: [activity('🍽️', 'Dinner', all)] },
  { morning: [activity('🧸', 'Play at home', ['dad', 'ema', 'haru'])], afternoon: [activity('👫', 'Friends', ['ema', 'haru', 'mum'])], night: [activity('📖', 'Stories', ['dad', 'ema', 'haru'])] },
  { morning: [activity('🏫', 'Daycare', ['ema']), activity('🏥', 'Work', ['mum'])], afternoon: [activity('🏠', 'Home', ['dad', 'ema', 'haru'])], night: [activity('🍽️', 'Dinner', all)] },
  { morning: [activity('🏫', 'Daycare', ['ema']), activity('💻', 'Work', ['dad'])], afternoon: [activity('🏊', 'Swim', ['ema', 'dad'])], night: [activity('🍿', 'Movie', all)] },
  { morning: [activity('🛒', 'Shopping', ['dad', 'haru'])], afternoon: [activity('🛝', 'Playground', all)], night: [activity('🎵', 'Music', all)] },
  { morning: [activity('🚗', 'Outing', all)], afternoon: [activity('🏖️', 'Beach', all)], night: [activity('🏠', 'Home', all)] },
];

export const storageKey = 'our-week-emoji-v1';
export const wordsStorageKey = 'our-week-show-words-v1';

function isActivity(value: unknown): value is Activity {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<Activity>;
  return typeof item.icon === 'string' && typeof item.label === 'string' &&
    Array.isArray(item.who) && item.who.every(id => personIds.includes(id));
}

export function readWeek(): WeekPlan {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (Array.isArray(saved) && saved.length === 7 && saved.every(day =>
      day && parts.every(part => Array.isArray(day[part.id]) && day[part.id].every(isActivity)))) {
      const seen = new Set<string>();
      return (saved as WeekPlan).map(day => Object.fromEntries(parts.map(part => [part.id, day[part.id].map(item => {
        const id = typeof item.id === 'string' && item.id && !seen.has(item.id) ? item.id : newActivityId();
        seen.add(id);
        return { ...item, id };
      })])) as DayPlan);
    }
  } catch { /* Storage can be unavailable or contain older data. */ }
  return structuredClone(sampleWeek);
}

export function readHideWords(): boolean {
  try { return localStorage.getItem(wordsStorageKey) === 'true'; }
  catch { return false; }
}
