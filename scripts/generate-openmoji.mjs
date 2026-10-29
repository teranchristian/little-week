import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = join(root, 'node_modules', 'openmoji');
const output = join(root, 'public', 'openmoji');
const catalogPath = join(root, 'src', 'openmoji-catalog.json');
const entries = JSON.parse(readFileSync(join(packageRoot, 'data', 'openmoji.json'), 'utf8'));
const catalog = entries
  .filter(item => item.emoji && !item.skintone && item.unicode && !item.hexcode.startsWith('E'))
  .filter(item => existsSync(join(packageRoot, 'color', 'svg', `${item.hexcode}.svg`)))
  .map(({ emoji, hexcode, annotation, group, tags, openmoji_tags }) => ({
    emoji, hexcode, name: annotation, group,
    tags: [...new Set(`${tags}, ${openmoji_tags}`.split(',').map(tag => tag.trim().toLowerCase()).filter(Boolean))],
  }));

mkdirSync(output, { recursive: true });
for (const { hexcode } of catalog) {
  copyFileSync(join(packageRoot, 'color', 'svg', `${hexcode}.svg`), join(output, `${hexcode}.svg`));
}
writeFileSync(catalogPath, `${JSON.stringify(catalog)}\n`);
console.log(`Prepared ${catalog.length} OpenMoji icons`);
