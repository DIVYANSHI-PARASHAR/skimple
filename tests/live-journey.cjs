const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

const bundle = JSON.parse(fs.readFileSync(path.join(__dirname, '../db/seeds/products.json'), 'utf8'));
const papers = JSON.parse(fs.readFileSync(path.join(__dirname, '../db/research/papers.json'), 'utf8'));
const catalogRows = bundle.products.map(product => ({
  catalog_key:product.key,brand:product.brand,product_name:product.name,category:product.category,
  variant:product.variant,region:product.region,source_url:product.source_url,source_metadata:product,
  raw_ingredient_text:product.ingredients.join(', '),
  ingredients:product.ingredients.map((raw_name, i) => ({raw_name,inci_name:raw_name,position:i+1,disclosed_concentration:product.concentrations[raw_name] || null})),
  literature:papers.papers.flatMap(paper => paper.findings.filter(f => product.ingredients.includes(f.ingredient)).map(f => ({...f.study,title:paper.title,ingredient:f.ingredient,year:paper.year,pmid:paper.pmid,url:paper.source_url,status:'awaiting_scientific_review'}))),
  result:{ingredient_findings:[],compatibility:{classification:'uncertain',confidence:'limited',limitations:[]},review_signal:{observation_count:0,source_count:0,aspects:[]}},
}));

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
    page.on('console', entry => {if (entry.type() === 'warning') console.warn(entry.text());});
    await page.route('http://localhost:8000/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      calls.push(`${request.method()} ${path}`);
      let body = {};
      let status = 200;
      if (path === '/v1/me/reports') body = {reports:[{report_id:'report-one',brand:'Acme',product_name:'Daily Lotion',category:'moisturizer',variant:'',raw_ingredient_text:'Aqua, Glycerin',result:report}]};
      else if (path === '/v1/catalog') body = {products:catalogRows};
      else if (path === '/v1/catalog/byoma/chat') body = {answer:catalogRows.find(p => p.catalog_key === 'byoma').source_metadata.usage,source:'Published product directions'};
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
    await page.waitForFunction(() => document.querySelectorAll('.product-card').length === 11, null, {timeout:5000})
      .catch(error => {console.error({errors,calls});throw error;});
    assert.equal(await page.locator('.product-card').count(),11);
    assert.equal(await page.locator('script[src="live.js"]').count(),1);
    assert.equal(calls.filter(call => call === 'GET /v1/catalog').length,1);
    assert.doesNotMatch(await page.locator('#app').innerText(), /fictional|illustrative|dummy|demo research/i);
    await page.locator('a[href="#product/byoma"]').click();
    await page.locator('[data-tab="ingredients"]').click();
    assert.match(await page.locator('.inci').innerText(), /Caprylhydroxamic Acid/);
    await page.locator('[data-tab="reviews"]').click();
    assert.match(await page.locator('#report-content').innerText(), /No permitted review themes/);
    assert.doesNotMatch(await page.locator('#report-content').innerText(), /fictional|% positive/);
    await page.locator('[data-tab="sources"]').click();
    assert.match(await page.locator('#report-content').innerText(), /Awaiting scientific review/);
    assert.ok(await page.locator('a[href="https://pubmed.ncbi.nlm.nih.gov/16766489/"]').count() > 0);
    await page.locator('[data-action="chat"]').click();
    await page.locator('[data-question="How could I use it?"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.message-source').length === 1);
    assert.ok(calls.includes('POST /v1/catalog/byoma/chat'));
    await page.locator('.close-button').click();
    await page.locator('a.back-link').click();
    await page.locator('[data-filter="Exfoliants"]').click();
    assert.equal(await page.locator('.product-card').count(),1);
    await page.locator('[data-filter="All products"]').click();
    await page.locator('#product-search').fill('Squalane');
    assert.equal(await page.locator('.product-card').count(),1);
    await page.locator('#product-search').fill('no matching product');
    assert.equal(await page.locator('.product-card').count(),0);
    await page.locator('#product-search').fill('');
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
    const retryPage = await browser.newPage();
    let available = false;
    await retryPage.route('http://localhost:8000/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/v1/catalog' && !available) {
        await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'Temporarily unavailable'})});
        return;
      }
      const body = path === '/v1/catalog' ? {products:catalogRows} : path.endsWith('/reports') ? {reports:[]} : path.endsWith('/skin-profile') ? {questionnaire:null,derived:null} : {product_keys:[]};
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
    });
    await retryPage.goto(base);
    await retryPage.getByRole('button',{name:'Try again ↗'}).waitFor();
    assert.match(await retryPage.locator('#product-grid').innerText(), /couldn’t load/);
    available = true;
    await retryPage.getByRole('button',{name:'Try again ↗'}).click();
    await retryPage.waitForFunction(() => document.querySelectorAll('.product-card').length === 10);
    await retryPage.close();
    await page.route('http://localhost:8000/v1/scans/scan-failed', route => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({scan_id:'scan-failed',status:'FAILED',error_code:'MODEL_UNAVAILABLE'})}));
    await page.route('http://localhost:8000/v1/scans', route => route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({scan_id:'scan-failed',status:'CREATED'})}));
    await page.goto(base);
    await page.locator('[data-action="scan"]').first().click();
    await page.locator('[data-upload="front"]').setInputFiles(picture);
    await page.locator('[data-upload="back"]').setInputFiles(picture);
    await page.locator('[data-action="extract"]').click();
    await page.locator('.scan-progress').waitFor();
    await page.locator('.scan-error').waitFor();
    assert.match(await page.locator('.scan-error').innerText(), /temporarily unavailable/);
    assert.equal(await page.locator('.upload-zone img').count(), 2);
    console.log('PASS sourced catalog, complete formulas, staged papers, chats, favorites, profile sync, scan-to-report, failure recovery, mobile layout');
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
