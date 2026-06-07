const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => logs.push(`[ERROR] ${e.message}`));

  await page.goto('http://localhost:8765/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('http://localhost:8765/#bp', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#myTeam .hero-dropdown-input', { timeout: 10000 });
  await page.waitForTimeout(800);

  console.log('--- select Axe for enemy 1号位 ---');
  const enemySlot1 = page.locator('#enemyTeam .hero-dropdown[data-position="1"] input');
  await enemySlot1.click();
  await enemySlot1.fill('斧王');
  await page.waitForTimeout(300);
  const firstItem = page.locator('#enemyTeam .hero-dropdown[data-position="1"] .hero-dropdown-item').first();
  const axeName = await firstItem.textContent();
  console.log('Selected:', axeName);
  await firstItem.click();
  await page.waitForTimeout(300);

  console.log('--- click BP advice 1号位 ---');
  const adviceBtn1 = page.locator('.bp-advice-slot-btn[data-pos="1"]');
  await adviceBtn1.click();
  await page.waitForTimeout(500);
  const hasRec1 = await page.locator('.bp-advice-result').count();
  console.log('After click 1号位, recommendation count:', hasRec1);

  console.log('--- click BP advice 2号位 ---');
  const adviceBtn2 = page.locator('.bp-advice-slot-btn[data-pos="2"]');
  await adviceBtn2.click();
  await page.waitForTimeout(500);
  const hasRec2 = await page.locator('.bp-advice-result').count();
  const label2 = await page.locator('.bp-advice-result-label').textContent().catch(() => 'none');
  console.log('After click 2号位, recommendation count:', hasRec2, 'label:', label2);

  console.log('--- click BP advice 3号位 ---');
  const adviceBtn3 = page.locator('.bp-advice-slot-btn[data-pos="3"]');
  await adviceBtn3.click();
  await page.waitForTimeout(500);
  const hasRec3 = await page.locator('.bp-advice-result').count();
  const label3 = await page.locator('.bp-advice-result-label').textContent().catch(() => 'none');
  console.log('After click 3号位, recommendation count:', hasRec3, 'label:', label3);

  console.log('--- apply 1号位 recommendation ---');
  await adviceBtn1.click();
  await page.waitForTimeout(500);
  const dataInfo = await page.evaluate(() => {
    const btn = document.querySelector('.bp-advice-apply');
    const slot = document.querySelector('#myTeam .hero-dropdown[data-position="1"]');
    return {
      applyPos: btn?.dataset.pos,
      applyHero: btn?.dataset.heroId,
      slotPos: slot?.dataset.position,
    };
  });
  console.log('Before apply:', JSON.stringify(dataInfo));

  await page.locator('.bp-advice-apply').click();
  await page.waitForTimeout(500);

  const lineupState = await page.evaluate(() => {
    const slots = Array.from(document.querySelectorAll('#myTeam .hero-dropdown'));
    return slots.map(s => ({ pos: s.dataset.position, selected: s.querySelector('input').dataset.selected || '' }));
  });
  console.log('Lineup after apply:', JSON.stringify(lineupState));

  console.log('--- Console logs ---');
  logs.slice(-20).forEach(l => console.log(' ', l));

  await browser.close();
})();
