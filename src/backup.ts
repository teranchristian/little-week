import { calendarSettingsKey, type CalendarSettings } from './calendarView.ts';
import { customIconsStorageKey, type CustomIcon } from './customIcons.ts';
import { familyStorageKey, partIndex, parts, storageKey, type Family, type WeekPlan } from './planner.ts';

export interface PlannerBackup {
  format: 'little-week-backup';
  version: 1;
  family: Family;
  week: WeekPlan;
  calendarSettings: CalendarSettings;
  customIcons: CustomIcon[];
}

export function createBackup(family: Family, week: WeekPlan, calendarSettings: CalendarSettings, customIcons: CustomIcon[]): PlannerBackup {
  return { format: 'little-week-backup', version: 1, family, week, calendarSettings, customIcons };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseBackup(text: string): PlannerBackup {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('This is not a valid JSON backup file.'); }
  if (!record(value) || value.format !== 'little-week-backup' || value.version !== 1) {
    throw new Error('This is not a Little Week backup version this app can import.');
  }
  const { family, week, calendarSettings, customIcons } = value;
  if (!record(family) || typeof family.name !== 'string' || !family.name.trim() ||
    !Array.isArray(family.members) || family.members.length === 0 ||
    !family.members.every(member => record(member) && typeof member.id === 'string' && !!member.id &&
      typeof member.name === 'string' && !!member.name.trim() && typeof member.emoji === 'string' && !!member.emoji.trim())) {
    throw new Error('The backup has invalid family details.');
  }
  const memberIds = new Set(family.members.map(member => member.id));
  if (memberIds.size !== family.members.length) throw new Error('The backup has duplicate family members.');
  const groupIcons = family.groupIcons;
  if (family.members.some(member => member.role !== undefined && !['dad', 'mum', 'child'].includes(member.role as string)) ||
    (groupIcons !== undefined && (!record(groupIcons) ||
      !['family', 'kids', 'parents'].every(group => typeof groupIcons[group] === 'string' && !!(groupIcons[group] as string).trim())))) {
    throw new Error('The backup has invalid family roles or group icons.');
  }
  if (!record(calendarSettings) || !['monday', 'sunday', 'today'].includes(calendarSettings.start as string) ||
    !Number.isInteger(calendarSettings.daysToShow) || (calendarSettings.daysToShow as number) < 1 ||
    (calendarSettings.daysToShow as number) > 7) {
    throw new Error('The backup has invalid calendar settings.');
  }
  if (!Array.isArray(customIcons) || !customIcons.every(icon => record(icon) && typeof icon.id === 'string' &&
    icon.id.startsWith('custom:') && typeof icon.name === 'string' && typeof icon.tag === 'string' &&
    (icon.scope === 'family' || icon.scope === 'activity') && typeof icon.image === 'string' &&
    /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(icon.image))) {
    throw new Error('The backup has invalid custom icons.');
  }
  const iconIds = new Set(customIcons.map(icon => icon.id));
  if (iconIds.size !== customIcons.length) throw new Error('The backup has duplicate custom icons.');
  if (family.members.some(member => member.emoji.startsWith('custom:') && !customIcons.some(icon => icon.id === member.emoji && icon.scope === 'family'))) {
    throw new Error('The backup is missing a family icon.');
  }
  if (groupIcons && Object.values(groupIcons).some(icon => typeof icon === 'string' && icon.startsWith('custom:') &&
    !customIcons.some(custom => custom.id === icon && custom.scope === 'family'))) {
    throw new Error('The backup is missing a family group icon.');
  }
  if (!Array.isArray(week) || week.length !== 7 || !week.every(day => record(day) && parts.every(part => {
    const activities = day[part.id];
    return Array.isArray(activities) && activities.every((activity: unknown) => record(activity) &&
      typeof activity.id === 'string' && !!activity.id && typeof activity.icon === 'string' &&
      typeof activity.label === 'string' && Array.isArray(activity.who) &&
      activity.who.every((id: unknown) => typeof id === 'string' && memberIds.has(id)) &&
      (activity.endPart === undefined || (parts.some(candidate => candidate.id === activity.endPart) &&
        partIndex(activity.endPart as typeof part.id) >= partIndex(part.id))) &&
      (activity.excludedParts === undefined || (Array.isArray(activity.excludedParts) &&
        new Set(activity.excludedParts).size === activity.excludedParts.length &&
        activity.excludedParts.every((excluded: unknown) => typeof excluded === 'string' &&
          parts.some(candidate => candidate.id === excluded) && activity.endPart !== undefined &&
          partIndex(excluded as typeof part.id) > partIndex(part.id) &&
          partIndex(excluded as typeof part.id) < partIndex(activity.endPart as typeof part.id)))) &&
      (!activity.icon.startsWith('custom:') || customIcons.some(icon => icon.id === activity.icon && icon.scope === 'activity')));
  }))) {
    throw new Error('The backup has invalid activities or missing activity icons.');
  }
  const activityIds = (week as WeekPlan).flatMap(day => parts.flatMap(part => day[part.id].map(activity => activity.id)));
  if (new Set(activityIds).size !== activityIds.length) throw new Error('The backup has duplicate activities.');
  return value as unknown as PlannerBackup;
}

export function saveBackup(backup: PlannerBackup, storage: Storage): void {
  const entries: [string, unknown][] = [
    [familyStorageKey, backup.family], [storageKey, backup.week],
    [calendarSettingsKey, backup.calendarSettings], [customIconsStorageKey, backup.customIcons],
  ];
  const previous = entries.map(([key]) => [key, storage.getItem(key)] as const);
  try {
    for (const [key, value] of entries) storage.setItem(key, JSON.stringify(value));
  } catch {
    for (const [key, value] of previous) {
      try { if (value === null) storage.removeItem(key); else storage.setItem(key, value); } catch { /* Storage may be unavailable. */ }
    }
    throw new Error('Could not save the backup on this device. Free up browser storage and try again.');
  }
}
