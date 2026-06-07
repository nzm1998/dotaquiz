// Verify all 4 fixes
const { chromium } = require('playwright');
const BASE = 'http://localhost:8765';
const TIMEOUT_MS = 120000;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext({ viewport: { width: 1280, height: 1800 } }).then(c => c.newPage());
  let pageErrors = 0;
  page.on('pageerror', e => { console.log('PAGEERR:', e.message); pageErrors++; });

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#nav-replay');
  await page.click('#nav-replay');
  await page.waitForSelector('#teamChips .team-chip');

  // Test with Team Spirit (the team the user mentioned)
  const spirit = await page.$('#teamChips .team-chip[data-team-id="7119388"]');
  if (spirit) {
    console.log('=== Testing with Team Spirit (7119388) ===');
    await spirit.click();
  } else {
    console.log('Spirit chip not found, using Team Liquid');
    await (await page.$('#teamChips .team-chip[data-team-id="2163"]')).click();
  }
  await page.click('#teamAnalyzeBtn');
  await page.waitForSelector('#teamResultCard', { state: 'visible', timeout: TIMEOUT_MS });
  await page.waitForTimeout(800);

  // 1. Per-position table - should be max 20 per position
  const posRows = await page.$$eval('.team-pos-tbl tbody tr', rows => rows.map(r => {
    const tds = r.querySelectorAll('td');
    return Array.from(tds).map(td => td.textContent.trim().replace(/\s+/g, ' '));
  }));
  console.log('\n=== Position table (should max 20 per pos) ===');
  for (const r of posRows) console.log('  ' + JSON.stringify(r));
  const totalPos = posRows.reduce((s, r) => {
    const games = r[1].match(/\d+/);
    return s + (games ? parseInt(games[0]) : 0);
  }, 0);
  console.log(`  TOTAL across positions: ${totalPos}`);

  // 2. Counter recommendations - check new format "覆盖 X/10 英雄 · Y 场"
  const counters = await page.$$eval('.team-counter-card', cards => cards.map(c => ({
    name: c.querySelector('.team-counter-card-name')?.textContent.trim(),
    score: c.querySelector('.team-counter-card-score')?.textContent.trim(),
    hits: c.querySelector('.team-counter-card-hits')?.textContent.trim(),
  })));
  console.log('\n=== Counter recommendations (new format) ===');
  for (const c of counters.slice(0, 5)) console.log('  ' + JSON.stringify(c));

  // 3. Ward coordinates - check that drawn positions are within content area
  const wardData = await page.evaluate(() => {
    const ws = window.Team._lastWardSplit;
    if (!ws) return null;
    return {
      radWardsTotal: ws.radWardsTotal,
      direWardsTotal: ws.direWardsTotal,
    };
  });
  console.log('\n=== Ward split ===');
  console.log('  ' + JSON.stringify(wardData));

  // 4. KPM - just check the new label
  const kpmTile = await page.$('.team-stat-tile:nth-child(6)');
  if (kpmTile) {
    const kpmText = await kpmTile.evaluate(el => el.textContent.replace(/\s+/g, ' ').trim());
    console.log('\n=== KPM tile ===');
    console.log('  ' + kpmText);
  }

  // Screenshot
  await page.screenshot({ path: '/tmp/spirit_full.png', fullPage: true });
  const wardCard = await page.$('#teamWardmapCard');
  if (wardCard) await wardCard.screenshot({ path: '/tmp/spirit_wardmap.png' });
  console.log('\nScreenshots: /tmp/spirit_full.png, /tmp/spirit_wardmap.png');

  console.log('\n=== ERRORS ===');
  console.log('  page errors:', pageErrors);

  await browser.close();
  process.exit(pageErrors > 0 ? 1 : 0);
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
