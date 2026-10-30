import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const css = readFileSync(join(root, 'src/styles.css'), 'utf8');
const chrome = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find(path => path && existsSync(path));
if (!chrome) throw new Error('Chrome is required for the calendar layout check. Set CHROME_PATH to its executable.');

const card = '<div class="activity"><button class="activity-open"><span class="activity-emoji">🍽️</span><span class="activity-details"><span class="activity-name">Activity</span><span class="people"><span class="face">🙂</span></span></span></button></div>';
const part = (name, count) => `<div class="part ${name}"><div class="part-head">${name}</div><div class="activities">${card.repeat(count)}</div><button class="add">+ Add</button></div>`;
const day = count => `<article class="day"><div class="day-head">Day</div>${part('morning', count)}${part('afternoon', 0)}${part('night', 0)}</article>`;
const html = `<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><main class="shell"><div class="calendar short-view" style="--calendar-columns:4">${[1, 2, 3, 1].map(day).join('')}</div></main><pre id="result"></pre><script>document.getElementById('result').textContent=JSON.stringify([...document.querySelectorAll('.part.morning')].map(part=>{const activities=part.querySelector('.activities');return{part:part.getBoundingClientRect().height,space:activities.getBoundingClientRect().height,gap:parseFloat(getComputedStyle(activities).gap),cards:[...activities.querySelectorAll('.activity')].map(card=>card.getBoundingClientRect().height)}}));</script>`;

const directory = mkdtempSync(join(tmpdir(), 'little-week-layout-'));
try {
  const fixture = join(directory, 'calendar.html');
  writeFileSync(fixture, html);
  const browser = spawnSync(chrome, [
    '--headless', '--no-sandbox', '--disable-gpu',
    `--user-data-dir=${join(directory, 'chrome-profile')}`,
    '--window-size=1700,1000', '--dump-dom', `file://${fixture}`,
  ], { encoding: 'utf8', timeout: 20000 });
  if (browser.error || browser.status !== 0) {
    throw new Error(`Chrome layout check failed: ${browser.error ?? browser.stderr}`);
  }
  const result = browser.stdout.match(/<pre id="result">([^<]+)<\/pre>/)?.[1];
  assert.ok(result, 'Chrome did not return layout measurements');
  const rows = JSON.parse(result);
  for (const row of rows) {
    assert.ok(Math.abs(row.part - rows[0].part) < 2, 'Day parts must share a row height');
    const used = row.cards.reduce((sum, height) => sum + height, 0) + row.gap * (row.cards.length - 1);
    assert.ok(Math.abs(used - row.space) < 2, `${row.cards.length} card(s) must fill the available height`);
    assert.ok(row.cards.every(height => Math.abs(height - row.cards[0]) < 2), 'Cards in one day part must have equal height');
  }
  console.log('Calendar cards fill the row with one, two, or three activities.');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
