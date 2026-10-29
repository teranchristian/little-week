import catalog from './openmoji-catalog.json';
import { familyIcon, icons, previousFamilyIcon } from './planner';

export interface OpenMojiIcon {
  emoji: string;
  hexcode: string;
  name: string;
  group: string;
  tags: string[];
}

export const openMojiIcons = catalog as OpenMojiIcon[];
const normalize = (emoji: string) => emoji.replaceAll('\uFE0F', '');
const byEmoji = new Map(openMojiIcons.map(icon => [normalize(icon.emoji), icon]));
const pickerNames = new Map<string, string>(icons.map(([emoji, name]) => [normalize(emoji), name.toLowerCase()]));
const family = byEmoji.get(normalize(familyIcon));
if (family) byEmoji.set(normalize(previousFamilyIcon), family);

export function findOpenMoji(emoji: string): OpenMojiIcon | undefined {
  return byEmoji.get(normalize(emoji));
}

export function openMojiUrl(emoji: string): string | undefined {
  const icon = findOpenMoji(emoji);
  return icon ? `${import.meta.env.BASE_URL}openmoji/${icon.hexcode}.svg` : undefined;
}

export function searchOpenMoji(query: string): OpenMojiIcon[] {
  const terms = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!terms.length) return [];
  return openMojiIcons
    .map(icon => {
      const name = icon.name.toLowerCase();
      const nameWords = name.match(/[\p{L}\p{N}]+/gu) ?? [];
      const tagWords = icon.tags.flatMap(tag => tag.match(/[\p{L}\p{N}]+/gu) ?? []);
      const pickerName = pickerNames.get(normalize(icon.emoji)) ?? '';
      const pickerWords = pickerName.match(/[\p{L}\p{N}]+/gu) ?? [];
      if (!terms.every(term => [...nameWords, ...tagWords, ...pickerWords].some(word => word.startsWith(term)))) return null;
      const score = terms.reduce((total, term) => total +
        (name === term ? 12 : nameWords[0]?.startsWith(term) ? 8 : nameWords.some(word => word.startsWith(term)) ? 5 : 0) +
        (pickerName === term ? 16 : pickerWords[0]?.startsWith(term) ? 10 : pickerWords.some(word => word.startsWith(term)) ? 6 : 0) +
        (tagWords.includes(term) ? 3 : tagWords.some(word => word.startsWith(term)) ? 1 : 0) +
        (icon.group === 'smileys-emotion' && (term.startsWith('happ') || term.startsWith('smil')) ? 4 : 0), 0);
      return { icon, score };
    })
    .filter((result): result is { icon: OpenMojiIcon; score: number } => result !== null)
    .sort((a, b) => b.score - a.score || a.icon.name.localeCompare(b.icon.name))
    .slice(0, 60)
    .map(result => result.icon.emoji === previousFamilyIcon && family ? family : result.icon)
    .filter((icon, index, results) => results.findIndex(result => result.hexcode === icon.hexcode) === index);
}
