import { days } from './planner.ts';

export type WeekStart = 'monday' | 'sunday' | 'today';
export interface CalendarSettings { start: WeekStart; daysToShow: number }
export interface VisibleDay { index: number; label: string; date?: Date }

export const calendarSettingsKey = 'our-week-calendar-settings-v1';
export const defaultCalendarSettings: CalendarSettings = { start: 'monday', daysToShow: 7 };

export function readCalendarSettings(): CalendarSettings {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(calendarSettingsKey) ?? 'null');
    if (saved && typeof saved === 'object') {
      const setting = saved as Partial<CalendarSettings>;
      if ((setting.start === 'monday' || setting.start === 'sunday' || setting.start === 'today') &&
        Number.isInteger(setting.daysToShow) && setting.daysToShow! >= 1 && setting.daysToShow! <= 7) {
        return { start: setting.start, daysToShow: setting.daysToShow! };
      }
    }
  } catch { /* Storage can be unavailable or contain older data. */ }
  return { ...defaultCalendarSettings };
}

export function visibleDays(settings: CalendarSettings, now: Date): VisibleDay[] {
  const todayIndex = (now.getDay() + 6) % 7; // Planner data starts on Monday.
  const firstIndex = settings.start === 'today' ? todayIndex : settings.start === 'sunday' ? 6 : 0;
  const count = settings.start === 'today' ? Math.min(7, Math.max(1, settings.daysToShow)) : 7;
  return Array.from({ length: count }, (_, offset) => {
    const index = (firstIndex + offset) % 7;
    const date = settings.start === 'today' ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset) : undefined;
    return { index, label: days[index], date };
  });
}
