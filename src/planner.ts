export type FamilyRole = 'dad' | 'mum' | 'child';
export type FamilyGroup = 'family' | 'kids' | 'parents';
export interface Person { id: string; name: string; emoji: string; role?: FamilyRole }
export interface Family { name: string; members: Person[]; groupIcons?: Record<FamilyGroup, string> }
export const defaultGroupIcons: Record<FamilyGroup, string> = { family: 'auto', kids: 'auto', parents: 'auto' };
export function memberRole(member: Person): FamilyRole {
  if (member.role) return member.role;
  if (member.id === 'dad' || /^(dad|father|papa)$/i.test(member.name)) return 'dad';
  if (member.id === 'mum' || /^(mum|mom|mother|mama)$/i.test(member.name)) return 'mum';
  return 'child';
}
export type ParticipantToken = { kind: 'person'; id: string } | { kind: 'group'; group: FamilyGroup };
export function participantTokens(who: string[], members: Person[]): ParticipantToken[] {
  const selected = new Set(who);
  if (members.length > 1 && members.every(member => selected.has(member.id))) return [{ kind: 'group', group: 'family' }];
  const kids = members.filter(member => memberRole(member) === 'child');
  const parents = members.filter(member => memberRole(member) !== 'child');
  const groups: FamilyGroup[] = [];
  if (kids.length > 1 && kids.every(member => selected.has(member.id))) groups.push('kids');
  if (parents.length > 1 && parents.every(member => selected.has(member.id))) groups.push('parents');
  const emitted = new Set<FamilyGroup>();
  return members.flatMap(member => {
    if (!selected.has(member.id)) return [];
    const group = groups.find(value => value === 'kids' ? memberRole(member) === 'child' : memberRole(member) !== 'child');
    if (!group) return [{ kind: 'person', id: member.id } as ParticipantToken];
    if (emitted.has(group)) return [];
    emitted.add(group);
    return [{ kind: 'group', group } as ParticipantToken];
  });
}
export type PersonId = string;
export const defaultFamily: Family = {
  name: 'Little Week',
  members: [
    { id: 'dad', name: 'Dad', emoji: '👨', role: 'dad' },
    { id: 'mum', name: 'Mum', emoji: '👩', role: 'mum' },
    { id: 'child-1', name: 'Child 1', emoji: '👧', role: 'child' },
    { id: 'child-2', name: 'Child 2', emoji: '👶', role: 'child' },
  ],
  groupIcons: { ...defaultGroupIcons },
};
export const familyStorageKey = 'our-week-family-v1';

export function readFamily(): Family {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(familyStorageKey) ?? 'null');
    if (saved && typeof saved === 'object') {
      const family = saved as Partial<Family>;
      if (typeof family.name === 'string' && family.name.trim() && Array.isArray(family.members) &&
        family.members.length > 0 && family.members.every(member =>
          member && typeof member.id === 'string' && member.id && typeof member.name === 'string' &&
          member.name.trim() && typeof member.emoji === 'string' && member.emoji.trim()) &&
        new Set(family.members.map(member => member.id)).size === family.members.length) {
        return { name: family.name === 'Our Week' ? defaultFamily.name : family.name,
          members: family.members.map(member => ({ ...member, role: ['dad', 'mum', 'child'].includes(member.role ?? '') ? member.role : memberRole({ ...member, role: undefined }) })),
          groupIcons: { ...defaultGroupIcons, ...Object.fromEntries(Object.entries(family.groupIcons ?? {}).filter(([key, value]) =>
            ['family', 'kids', 'parents'].includes(key) && typeof value === 'string' && value.trim())) } };
      }
    }
  } catch { /* Storage can be unavailable or contain older data. */ }
  return structuredClone(defaultFamily);
}

export function newPersonId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `person-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
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
  simultaneousId?: string;
}
export const maxActivitiesPerSection = 2;
export const maxPeoplePerActivity = 4;

export function sectionLayout(activities: Activity[]) {
  const counts = new Map<string, number>();
  for (const activity of activities) if (activity.simultaneousId)
    counts.set(activity.simultaneousId, (counts.get(activity.simultaneousId) ?? 0) + 1);
  const groups = [...counts.values()].filter(count => count > 1);
  return {
    slots: activities.length - groups.reduce((extra, count) => extra + count - 1, 0),
    groupCount: groups.length,
    largestGroup: Math.max(0, ...groups),
  };
}

// Saved calendars may exceed newer limits; edits can repair them without losing data.
export function calendarLimitError(before: WeekPlan, after: WeekPlan, members?: Person[]): string | null {
  for (let day = 0; day < after.length; day++) for (const part of parts) {
    const oldItems = before[day][part.id];
    const items = after[day][part.id];
    const oldLayout = sectionLayout(oldItems);
    const layout = sectionLayout(items);
    if (layout.slots > Math.max(maxActivitiesPerSection, oldLayout.slots))
      return 'Only 2 activities or groups fit in each part of the day. A group counts as one.';
    if (layout.groupCount > Math.max(1, oldLayout.groupCount))
      return 'Only 1 side-by-side group fits in each part of the day.';
    if (layout.largestGroup > Math.max(2, oldLayout.largestGroup))
      return 'Only 2 activities can be side by side in a group.';
    for (const item of items) {
      const oldItem = before.flatMap(dayPlan => parts.flatMap(dayPart => dayPlan[dayPart.id])).find(old => old.id === item.id);
      const count = members ? participantTokens(item.who, members).length : item.who.length;
      const oldCount = oldItem ? (members ? participantTokens(oldItem.who, members).length : oldItem.who.length) : 0;
      if (count > Math.max(maxPeoplePerActivity, oldCount))
        return 'Choose up to 4 pictures for an activity.';
    }
  }
  return null;
}
export function sortGroupedActivities(activities: Activity[], members: Person[]): Activity[] {
  const rank = (activity: Activity) => {
    if (activity.who.length !== 1) return activity.who.length ? members.length : members.length + 1;
    const index = members.findIndex(member => member.id === activity.who[0]);
    return index < 0 ? members.length : index;
  };
  return [...activities].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}
export function printActivityWeight(activities: Activity[], members?: Person[]): number {
  const groups = new Map<string, number>();
  let weight = 0;
  for (const activity of activities) {
    if (!activity.simultaneousId) weight++;
    else groups.set(activity.simultaneousId, Math.max(groups.get(activity.simultaneousId) ?? 0, members ? participantTokens(activity.who, members).length : activity.who.length));
  }
  for (const people of groups.values()) weight += 1 + Math.max(0, people - 1) * 0.25;
  return weight;
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
  if (sameSlot && from.index === targetIndex && !source[from.index].simultaneousId) return week;

  const next = structuredClone(week);
  const [activity] = next[from.day][from.part].splice(from.index, 1);
  delete activity.simultaneousId;
  next[to.day][to.part].splice(targetIndex, 0, activity);
  return next;
}

// Add one activity to another's simultaneous group, leaving unrelated activities alone.
export function groupActivity(week: WeekPlan, sourceId: string, targetId: string): WeekPlan {
  const source = findActivity(week, sourceId);
  const target = findActivity(week, targetId);
  if (!source || !target || sourceId === targetId) return week;
  const next = structuredClone(week);
  const [item] = next[source.day][source.part].splice(source.index, 1);
  const targetItems = next[target.day][target.part];
  const targetIndex = targetItems.findIndex(activity => activity.id === targetId);
  const companion = targetItems[targetIndex];
  const groupId = companion.simultaneousId || companion.id;
  companion.simultaneousId = groupId;
  item.simultaneousId = groupId;
  const lastIndex = targetItems.reduce((last, activity, index) => activity.simultaneousId === groupId ? index : last, targetIndex);
  targetItems.splice(lastIndex + 1, 0, item);
  return next;
}

export function newActivityId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `activity-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const activity = (icon: string, label: string, who: PersonId[]): Activity => ({ id: newActivityId(), icon, label, who });
const all = defaultFamily.members.map(person => person.id);
export const sampleWeek: WeekPlan = [
  { morning: [activity('🏫', 'Daycare', ['child-1']), activity('💻', 'Work', ['dad'])], afternoon: [activity('🛝', 'Playground', ['mum', 'child-1', 'child-2'])], night: [activity('📖', 'Stories', ['dad', 'child-1', 'child-2'])] },
  { morning: [activity('🏫', 'Daycare', ['child-1', 'child-2']), activity('💻', 'Work', ['dad'])], afternoon: [activity('🌳', 'Park', ['mum', 'child-1', 'child-2'])], night: [activity('🍽️', 'Dinner', all)] },
  { morning: [activity('🧸', 'Play at home', ['dad', 'child-1', 'child-2'])], afternoon: [activity('👫', 'Friends', ['child-1', 'child-2', 'mum'])], night: [activity('📖', 'Stories', ['dad', 'child-1', 'child-2'])] },
  { morning: [activity('🏫', 'Daycare', ['child-1']), activity('🏥', 'Work', ['mum'])], afternoon: [activity('🏠', 'Home', ['dad', 'child-1', 'child-2'])], night: [activity('🍽️', 'Dinner', all)] },
  { morning: [activity('🏫', 'Daycare', ['child-1']), activity('💻', 'Work', ['dad'])], afternoon: [activity('🏊', 'Swim', ['child-1', 'dad'])], night: [activity('🍿', 'Movie', all)] },
  { morning: [activity('🛒', 'Shopping', ['dad', 'child-2'])], afternoon: [activity('🛝', 'Playground', all)], night: [activity('🎵', 'Music', all)] },
  { morning: [activity('🚗', 'Outing', all)], afternoon: [activity('🏖️', 'Beach', all)], night: [activity('🏠', 'Home', all)] },
];

export function sampleWeekForFamily(family: Family): WeekPlan {
  const ids = new Set(family.members.map(member => member.id));
  return sampleWeek.map(day => Object.fromEntries(parts.map(part => [part.id, day[part.id].map(item => ({
    ...item,
    who: item.who === all
      ? family.members.map(member => member.id)
      : item.who.filter(id => ids.has(id)),
  }))])) as DayPlan);
}

export const storageKey = 'our-week-emoji-v1';

function isActivity(value: unknown): value is Activity {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<Activity>;
  return typeof item.icon === 'string' && typeof item.label === 'string' &&
    Array.isArray(item.who) && item.who.every(id => typeof id === 'string');
}

export function readWeek(): WeekPlan {
  try {
    const memberIds = new Set(readFamily().members.map(member => member.id));
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (Array.isArray(saved) && saved.length === 7 && saved.every(day =>
      day && parts.every(part => Array.isArray(day[part.id]) && day[part.id].every(isActivity)))) {
      const seen = new Set<string>();
      const week = (saved as WeekPlan).map(day => Object.fromEntries(parts.map(part => [part.id, day[part.id].map(item => {
        const id = typeof item.id === 'string' && item.id && !seen.has(item.id) ? item.id : newActivityId();
        seen.add(id);
        return { ...item, id, who: item.who.filter(personId => memberIds.has(personId)) };
      })])) as DayPlan);
      return week;
    }
  } catch { /* Storage can be unavailable or contain older data. */ }
  return sampleWeekForFamily(readFamily());
}
