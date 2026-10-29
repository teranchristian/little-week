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

export const icons = [
  ['🏫', 'Daycare'], ['💻', 'Work'], ['🏥', 'Nurse work'], ['🏠', 'Home'],
  ['🛝', 'Playground'], ['🌳', 'Park'], ['👫', 'Friends'], ['🏊', 'Swimming'],
  ['📖', 'Stories'], ['🍽️', 'Dinner'], ['🚗', 'Outing'], ['🎨', 'Art'],
  ['🧸', 'Play'], ['🛒', 'Shopping'], ['🩺', 'Doctor'], ['🎂', 'Birthday'],
  ['⚽', 'Sport'], ['🎵', 'Music'], ['🍿', 'Movie'], ['😴', 'Nap'],
  ['📚', 'Library'], ['🏖️', 'Beach'], ['🍦', 'Treat'], ['👨‍👩‍👧‍👦', 'Family'],
] as const;

export interface Activity {
  icon: string;
  label: string;
  who: PersonId[];
}
export type DayPlan = Record<PartId, Activity[]>;
export type WeekPlan = DayPlan[];

const activity = (icon: string, label: string, who: PersonId[]): Activity => ({ icon, label, who });
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
      return saved as WeekPlan;
    }
  } catch { /* Storage can be unavailable or contain older data. */ }
  return structuredClone(sampleWeek);
}

export function readHideWords(): boolean {
  try { return localStorage.getItem(wordsStorageKey) === 'true'; }
  catch { return false; }
}
