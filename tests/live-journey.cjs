const assert = require('node:assert/strict');
const {chromium} = require('playwright');

const base = process.env.BASE_URL || 'http://127.0.0.1:4173';
const picture = {name:'product.png', mimeType:'image/png', buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')};
const report = {
  compatibility:{classification:'uncertain',benefit_fit_score:null,irritation_concern:'uncertain',confidence:'limited',known_reaction_ingredients:[],limitations:['Ingredient concentrations are unknown.']},
  ingredient_findings:[{ingredient:'Glycerin',outcome:'hydration',effect:'potential_benefit',evidence_confidence:'moderate',synthesis:'Glycerin can support surface hydration.',paper_ids:['paper-1'],papers:[{id:'paper-1',title:'A real hydration paper',year:2020,url:'https://example.org/paper',relation:'supports'}]}],
  review_signal:{observation_count:2,source_count:1,aspects:[{aspect:'hydration',sentiment:'positive',count:2}],note:'Experiences, not clinical proof.'},
  disclaimer:'Educational information only.',
};

(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
    const errors = [];
    const calls = [];
    const ownedKeys = new Set();
    let profilePayload;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://localhost:8000/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      calls.push(`${request.method()} ${path}`);
      let body = {};
      let status = 200;
      if (path === '/v1/me/reports') body = {reports:[{report_id:'report-one',brand:'Acme',product_name:'Daily Lotion',category:'moisturizer',variant:'',raw_ingredient_text:'Aqua, Glycerin',result:report}]};
      else if (path === '/v1/me/saved') body = {product_keys:[]};
      else if (path === '/v1/me/owned' && request.method() === 'GET') body = {product_keys:[...ownedKeys]};
      else if (path.startsWith('/v1/me/owned/') && request.method() === 'PUT') {ownedKeys.add(decodeURIComponent(path.slice('/v1/me/owned/'.length)));body = {owned:true};}
      else if (path.startsWith('/v1/me/owned/') && request.method() === 'DELETE') {ownedKeys.delete(decodeURIComponent(path.slice('/v1/me/owned/'.length)));body = {owned:false};}
      else if (path === '/v1/me/skin-profile' && request.method() === 'GET') body = {questionnaire:profilePayload || null,derived:null};
      else if (path === '/v1/me/skin-profile' && request.method() === 'PUT') {profilePayload = request.postDataJSON();body = {profile_version:'v1',derived:{basis:'questionnaire'}};}
      else if (path === '/v1/scans' && request.method() === 'POST') body = {scan_id:'scan-one',status:'CREATED'};
      else if (path === '/v1/scans/scan-one' && request.method() === 'GET') body = {scan_id:'scan-one',status:'NEEDS_CONFIRMATION',extraction:{brand:'Sample',product_name:'Fresh Gel',variant:'',raw_ingredient_text:'Aqua, Glycerin',ingredients_in_order:['Aqua','Glycerin']}};
      else if (path === '/v1/analyses' && request.method() === 'POST') body = {analysis_id:'analysis-one',status:'CREATED',report_id:null};
      else if (path === '/v1/analyses/analysis-one') body = {analysis_id:'analysis-one',status:'COMPLETED',report_id:'report-two'};
      else if (path === '/v1/reports/report-two') body = report;
      else if (path === '/v1/reports/report-one/chat') body = {answer:'Glycerin can support surface hydration.',source:'Reviewed ingredient claims'};
      else if (path === '/v1/me/skin-photo') {status = 503; body = {detail:'Facial image pilot is unavailable pending representative evaluation'};}
      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    });
    await page.goto(base);
    await page.waitForFunction(() => document.querySelectorAll('.product-card').length === 7);
    assert.equal(await page.locator('.product-card').count(),7);
    await page.locator('a[href="#product/report-report-one"]').click();
    await page.locator('[data-tab="ingredients"]').click();
    assert.match(await page.locator('#report-content').innerText(), /Glycerin can support surface hydration/);
    await page.locator('[data-tab="reviews"]').click();
    assert.match(await page.locator('#report-content').innerText(), /2\s*observations/);
    await page.locator('[data-tab="sources"]').click();
    assert.equal(await page.locator('a[href="https://example.org/paper"]').count(),1);
    await page.locator('[data-action="chat"]').click();
    assert.match(await page.locator('.chat-disclaimer').innerText(), /Report-grounded/);
    await page.locator('[data-question="What do the ingredients do?"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.message-source').length === 1);
    assert.ok(calls.includes('POST /v1/reports/report-one/chat'));
    await page.locator('.close-button').click();
    await page.locator('[data-action="save"][data-id="report-report-one"]').click();
    await page.waitForFunction(() => document.querySelector('[data-action="save"][data-id="report-report-one"]').getAttribute('aria-pressed') === 'true');
    assert.ok(calls.includes('PUT /v1/me/saved/report:report-one'));
    await page.locator('.profile-button').click();
    await page.waitForSelector('#skin-page-form');
    await page.locator('input[name="feel"][value="Combination"] + span').click();
    await page.locator('input[name="goals"][value="Hydration"] + span').click();
    await page.locator('#page-extra-context').fill('I like a soft finish.');
    await page.locator('#skin-page-form button[type="submit"]').click();
    await page.waitForFunction(() => !document.querySelector('dialog').open);
    assert.ok(calls.includes('PUT /v1/me/skin-profile'));
    assert.equal(profilePayload.notes, 'I like a soft finish.');
    await page.waitForSelector('#my-products');
    assert.match(await page.locator('.skin-extra-note').innerText(), /soft finish/);
    await page.locator('.add-product-tile').click();
    await page.locator('#owned-search').fill('Acme');
    await page.locator('.lookup-option[data-id="report-report-one"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.owned-product').length === 1);
    assert.ok(calls.includes('PUT /v1/me/owned/report:report-one'));
    for (const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:844});
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `skin page overflow at ${width}`);
    }
    profilePayload = {...profilePayload, dry_areas:['Cheeks'], daytime_oiliness:'high', known_reactions:['Linalool'], goals:[...profilePayload.goals, 'texture']};
    await page.evaluate(() => {localStorage.removeItem('skimple.profile');localStorage.removeItem('skimple.owned');});
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('.owned-product').length === 1);
    assert.match(await page.locator('.skin-extra-note').innerText(), /soft finish/);
    await page.locator('.skin-sidebar [data-action="update-skin"]').click();
    const updatedProfile = page.waitForResponse(response => response.url().endsWith('/v1/me/skin-profile') && response.request().method() === 'PUT');
    await page.locator('#skin-form button[type="submit"]').click();
    await updatedProfile;
    assert.deepEqual(profilePayload.dry_areas, ['Cheeks']);
    assert.deepEqual(profilePayload.known_reactions, ['Linalool']);
    assert.ok(profilePayload.goals.includes('texture'));
    assert.equal(profilePayload.daytime_oiliness, 'high');
    await page.locator('[data-action="remove-owned"][data-id="report-report-one"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.owned-product').length === 0);
    assert.ok(calls.includes('DELETE /v1/me/owned/report:report-one'));
    await page.locator('.header-back').click();
    await page.locator('[data-action="scan"]').first().click();
    await page.locator('[data-upload="front"]').setInputFiles(picture);
    await page.locator('[data-upload="back"]').setInputFiles(picture);
    await page.locator('[data-action="extract"]').click();
    await page.waitForSelector('#confirm-product');
    assert.equal(await page.locator('#product-brand').inputValue(),'Sample');
    await page.locator('#confirm-product button[type="submit"]').click();
    await page.waitForURL(/#product\/report-report-two/);
    assert.ok(calls.includes('POST /v1/scans'));
    assert.ok(calls.includes('POST /v1/scans/scan-one/confirm'));
    assert.ok(calls.includes('POST /v1/analyses'));
    assert.deepEqual(errors,[]);
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    console.log('PASS live shelf, report tabs, chat, favorites, profile sync, scan-to-report, mobile layout');
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
