/* Opt-in check against a running API and the real seeded database, without API mocks. */
const assert = require('node:assert/strict');
const {chromium} = require('playwright');

if (process.env.SKIMPLE_TEST_LIVE !== '1') {
  throw new Error('Set SKIMPLE_TEST_LIVE=1 to create and remove a temporary verification visitor.');
}
const base = process.env.BASE_URL || 'http://localhost:3000';

(async () => {
  const browser = await chromium.launch({headless:true});
  const context = await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  const errors = [];
  let visitor, apiUrl;
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(base);
    visitor = await page.evaluate(() => localStorage.getItem('skimple.visitor-key.v1'));
    apiUrl = await page.evaluate(() => window.SKIMPLE_API_URL || 'http://localhost:8000');
    await page.waitForFunction(() => document.querySelectorAll('.product-card').length === 10, null, {timeout:30000});
    await page.locator('#product-search').fill('Squalane');
    assert.equal(await page.locator('.product-card').count(),1);
    await page.locator('#product-search').fill('no matching product');
    assert.equal(await page.locator('.product-card').count(),0);
    await page.locator('#product-search').fill('');
    await page.locator('a[href="#product/byoma"]').click();
    await page.locator('[data-tab="ingredients"]').click();
    assert.match(await page.locator('.inci').innerText(), /Caprylhydroxamic Acid/);
    await page.locator('[data-tab="sources"]').click();
    assert.ok(await page.locator('a[href="https://pubmed.ncbi.nlm.nih.gov/16766489/"]').count());
    await page.locator('[data-action="chat"]').click();
    await page.locator('[data-question="How could I use it?"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.message-source').length === 1);
    await page.locator('.close-button').click();
    const saved = page.waitForResponse(response => response.url().includes('/v1/me/saved/catalog:byoma') && response.request().method() === 'PUT');
    await page.locator('[data-action="save"][data-id="byoma"]').click();
    assert.equal((await saved).status(),200);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('[data-action="save"][data-id="byoma"]')?.getAttribute('aria-pressed') === 'true');
    await page.locator('.profile-button').click();
    await page.waitForSelector('#skin-page-form');
    await page.locator('input[name="feel"][value="Combination"] + span').click();
    await page.locator('input[name="goals"][value="Hydration"] + span').click();
    await page.locator('#page-extra-context').fill('TigerDB browser verification');
    const profile = page.waitForResponse(response => response.url().endsWith('/v1/me/skin-profile') && response.request().method() === 'PUT');
    await page.locator('#skin-page-form button[type="submit"]').click();
    assert.equal((await profile).status(),200);
    await page.waitForSelector('#my-products');
    await page.locator('.add-product-tile').click();
    await page.locator('#owned-search').fill('Squalane');
    await page.locator('.lookup-option[data-id="ordinary-squalane"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.owned-product').length === 1);
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('.owned-product').length === 1);
    assert.match(await page.locator('.skin-extra-note').innerText(), /TigerDB browser verification/);
    for (const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:844});
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    assert.deepEqual(errors,[]);
    console.log('PASS real database: shelf search, formulas, papers, chat, favorites, profile and owned-product persistence, responsive layout');
  } finally {
    await page.close();
    try {
      if (visitor && apiUrl) {
        const deleted = await context.request.delete(`${apiUrl}/v1/me/data`, {headers:{'X-Visitor-Key':visitor}});
        assert.equal(deleted.status(),200);
      }
    } finally {await browser.close();}
  }
})().catch(error => {console.error(error);process.exitCode = 1;});
