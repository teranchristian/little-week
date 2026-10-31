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
  const faceCard = count => `<div class="activity" style="--people-count:${count};--face-columns:${Math.min(2, count)};--face-rows:${Math.ceil(count / Math.min(2, count))}"><button class="activity-open"><span class="activity-emoji">🍽️</span><span class="activity-details"><span class="activity-name">Activity</span><span class="people">${'<span class="face">🙂</span>'.repeat(count)}</span></span></button></div>`;
  const faceDay = (count, extra = false) => `<article class="day"><div class="day-head">Day</div><div class="part morning"><div class="part-head">Morning</div><div class="activities">${faceCard(count)}${extra ? `<div class="simultaneous-group"><div class="simultaneous-cards">${faceCard(1)}${faceCard(1)}</div></div>` : ''}</div></div>${part('afternoon', 0)}${part('night', 0)}</article>`;
  const faceFixture = join(directory, 'faces.html');
  writeFileSync(faceFixture, `<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><main class="shell fullscreen-calendar"><div class="scroll"><div class="calendar" style="--calendar-columns:3">${faceDay(1)}${faceDay(4)}${faceDay(1, true)}</div></div></main><pre id="result"></pre><script>document.getElementById('result').textContent=JSON.stringify({cards:[...document.querySelectorAll('.part.morning')].map(part=>{const card=part.querySelector('.activity');return{card:card.getBoundingClientRect().height,faces:[...card.querySelectorAll('.face')].map(face=>({size:face.getBoundingClientRect().width,top:face.getBoundingClientRect().top}))}}),groupIconTop:document.querySelector('.simultaneous-cards .activity-emoji').getBoundingClientRect().top,groupFaceTop:document.querySelector('.simultaneous-cards .face').getBoundingClientRect().top});</script>`);
  const faceBrowser = spawnSync(chrome, [
    '--headless', '--no-sandbox', '--disable-gpu',
    `--user-data-dir=${join(directory, 'face-chrome-profile')}`,
    '--window-size=1700,1000', '--dump-dom', `file://${faceFixture}`,
  ], { encoding: 'utf8', timeout: 20000 });
  if (faceBrowser.error || faceBrowser.status !== 0) throw new Error(`Chrome face layout check failed: ${faceBrowser.error ?? faceBrowser.stderr}`);
  const faceResult = faceBrowser.stdout.match(/<pre id="result">([^<]+)<\/pre>/)?.[1];
  assert.ok(faceResult, 'Chrome did not return face measurements');
  const { cards: [single, four, shared], groupIconTop, groupFaceTop } = JSON.parse(faceResult);
  assert.ok(Math.abs(single.faces[0].size - 45) < 2 && Math.abs(four.faces[0].size - 45) < 2, `Full-screen faces should be 45px (got ${single.faces[0].size}px and ${four.faces[0].size}px)`);
  assert.ok(Math.abs(single.faces[0].size - four.faces[0].size) < 2, 'One and four faces should have balanced sizes in roomy cards');
  assert.ok(Math.abs(shared.faces[0].size - 45) < 2, `A face in a shared section should be 45px (got ${shared.faces[0].size}px)`);
  assert.ok(groupIconTop < groupFaceTop, 'Grouped card icons must remain above their faces');
  assert.ok(four.faces[0].top === four.faces[1].top && four.faces[2].top > four.faces[0].top, 'Four faces should form two rows');
  const mixedCard = '<div class="activity" style="--people-count:2"><button class="activity-open"><span class="activity-emoji">🍽️</span><span class="activity-details"><span class="activity-name">Activity</span><span class="people"><span class="face group-face">👨‍👩</span><span class="face">🙂</span></span></span></button></div>';
  const groupedDay = (extra, mixed = false) => `<article class="day"><div class="day-head">Day</div><div class="part morning"><div class="activities">${extra ? faceCard(1) : ''}<div class="simultaneous-group"><div class="simultaneous-cards">${mixed ? mixedCard : faceCard(3)}${faceCard(1)}</div></div></div></div>${part('afternoon', 0)}${part('night', 0)}</article>`;
  const overlapFixture = join(directory, 'overlap.html');
  writeFileSync(overlapFixture, `<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><main class="shell"><div class="calendar many-days short-view" style="--calendar-columns:4">${groupedDay(true)}</div><div class="calendar many-days short-view" style="--calendar-columns:4">${groupedDay(false)}</div><div class="calendar short-view" style="--calendar-columns:3">${groupedDay(true)}</div><div class="calendar many-days short-view" style="--calendar-columns:7">${groupedDay(true, true)}</div><div class="calendar many-days short-view" style="--calendar-columns:4">${groupedDay(false, true)}</div><div class="calendar short-view" style="--calendar-columns:3">${groupedDay(true, true)}</div></main><pre id="result"></pre><script>document.getElementById('result').textContent=JSON.stringify([...document.querySelectorAll('.calendar')].map(calendar=>{const card=calendar.querySelector('.simultaneous-cards .activity:first-child');return{right:card.getBoundingClientRect().right,faces:[...card.querySelectorAll('.face')].map(face=>({left:face.getBoundingClientRect().left,right:face.getBoundingClientRect().right,top:face.getBoundingClientRect().top,width:face.getBoundingClientRect().width}))}}));</script>`);
  const overlapBrowser = spawnSync(chrome, [
    '--headless', '--no-sandbox', '--disable-gpu',
    `--user-data-dir=${join(directory, 'overlap-chrome-profile')}`,
    '--window-size=1700,1000', '--dump-dom', `file://${overlapFixture}`,
  ], { encoding: 'utf8', timeout: 20000 });
  if (overlapBrowser.error || overlapBrowser.status !== 0) throw new Error(`Chrome overlap check failed: ${overlapBrowser.error ?? overlapBrowser.stderr}`);
  const overlapResult = overlapBrowser.stdout.match(/<pre id="result">([^<]+)<\/pre>/)?.[1];
  assert.ok(overlapResult, 'Chrome did not return group face measurements');
  const [sharedCase, aloneCase, shortViewCase, mixedShared, mixedAlone, mixedShortView] = JSON.parse(overlapResult);
  const [sharedGroup, aloneGroup, shortViewGroup] = [sharedCase.faces, aloneCase.faces, shortViewCase.faces];
  assert.ok(sharedGroup.every(face => Math.abs(face.top - sharedGroup[0].top) < 2), 'Shared group faces should sit on one row');
  assert.ok(sharedGroup[1].left - sharedGroup[0].left < sharedGroup[0].width, 'Shared group faces should overlap');
  assert.ok(aloneGroup[1].top > aloneGroup[0].top, 'A group alone in its section should keep its face stack');
  assert.ok(shortViewGroup[1].top > shortViewGroup[0].top, 'Three visible days should keep the existing face stack');
  assert.ok(Math.abs(mixedShared.faces[0].top - mixedShared.faces[1].top) < 2, 'A group face and individual face should sit on one row');
  assert.ok(mixedShared.faces[1].left < mixedShared.faces[0].right, 'A group face and individual face should overlap');
  assert.ok(mixedShared.faces[1].right <= mixedShared.right + 1, 'Both faces should fit inside a narrow group card');
  assert.ok(mixedAlone.faces[1].top > mixedAlone.faces[0].top, 'A group face alone in its section should keep its face stack');
  assert.ok(mixedShortView.faces[1].top > mixedShortView.faces[0].top, 'Three visible days should keep the group face stack');
  const phoneBrowser = spawnSync(chrome, [
    '--headless', '--no-sandbox', '--disable-gpu',
    `--user-data-dir=${join(directory, 'phone-chrome-profile')}`,
    '--window-size=420,900', '--dump-dom', `file://${overlapFixture}`,
  ], { encoding: 'utf8', timeout: 20000 });
  if (phoneBrowser.error || phoneBrowser.status !== 0) throw new Error(`Chrome phone overlap check failed: ${phoneBrowser.error ?? phoneBrowser.stderr}`);
  const phoneResult = phoneBrowser.stdout.match(/<pre id="result">([^<]+)<\/pre>/)?.[1];
  assert.ok(phoneResult, 'Chrome did not return phone face measurements');
  const [, , , phoneMixedShared] = JSON.parse(phoneResult);
  assert.ok(Math.abs(phoneMixedShared.faces[0].top - phoneMixedShared.faces[1].top) < 3, 'Phone group faces should sit on one row');
  assert.ok(phoneMixedShared.faces[1].left < phoneMixedShared.faces[0].right, 'Phone group faces should overlap');
  assert.ok(phoneMixedShared.faces[1].right <= phoneMixedShared.right + 1, 'Phone group faces should fit inside the card');
  const fullscreenFixture = join(directory, 'fullscreen-overlap.html');
  writeFileSync(fullscreenFixture, `<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><main class="shell fullscreen-calendar"><div class="scroll"><div class="calendar many-days short-view" style="--calendar-columns:4"><div class="calendar-corner"></div><div class="day-part-label morning"></div><div class="day-part-label afternoon"></div><div class="day-part-label night"></div>${groupedDay(true, true)}${groupedDay(false, true)}${groupedDay(true, true)}${groupedDay(true, true)}</div></div></main><pre id="result"></pre><script>document.getElementById('result').textContent=JSON.stringify([...document.querySelectorAll('.part.morning')].slice(0,2).map(part=>{const card=part.querySelector('.simultaneous-cards .activity:first-child');return[...card.querySelectorAll('.face')].map(face=>({left:face.getBoundingClientRect().left,right:face.getBoundingClientRect().right,top:face.getBoundingClientRect().top,width:face.getBoundingClientRect().width}))}));</script>`);
  const fullscreenBrowser = spawnSync(chrome, [
    '--headless', '--no-sandbox', '--disable-gpu',
    `--user-data-dir=${join(directory, 'fullscreen-overlap-chrome-profile')}`,
    '--window-size=1700,1000', '--dump-dom', `file://${fullscreenFixture}`,
  ], { encoding: 'utf8', timeout: 20000 });
  if (fullscreenBrowser.error || fullscreenBrowser.status !== 0) throw new Error(`Chrome full-screen overlap check failed: ${fullscreenBrowser.error ?? fullscreenBrowser.stderr}`);
  const fullscreenResult = fullscreenBrowser.stdout.match(/<pre id="result">([^<]+)<\/pre>/)?.[1];
  assert.ok(fullscreenResult, 'Chrome did not return full-screen face measurements');
  const [fullscreenShared, fullscreenAlone] = JSON.parse(fullscreenResult);
  assert.ok(Math.abs(fullscreenShared[0].top - fullscreenShared[1].top) < 3, 'Full-screen group faces should sit on one row');
  assert.ok(fullscreenShared[1].left < fullscreenShared[0].right, 'Full-screen group faces should overlap');
  assert.ok(Math.abs(fullscreenShared[0].width - 45) < 2 && Math.abs(fullscreenShared[1].width - 40) < 2, `Full-screen group and individual faces should use 45px and 40px: ${JSON.stringify(fullscreenShared)}`);
  assert.ok(fullscreenAlone[1].top > fullscreenAlone[0].top, 'A group alone in full screen should keep its face stack');
  console.log('Calendar cards fill the row with one, two, or three activities.');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
