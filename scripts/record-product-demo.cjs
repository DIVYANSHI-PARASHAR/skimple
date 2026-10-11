// Records a deterministic walkthrough of the real Skimple UI with local demo API responses.
// Product ingredients: https://www.neutrogena.com/products/skincare/neutrogena-hydro-boost-water-cream-fragrance-free-1.7-oz/6806486
// Ingredient research: https://pubmed.ncbi.nlm.nih.gov/28860834/
//                      https://pubmed.ncbi.nlm.nih.gov/18025807/
//                      https://pubmed.ncbi.nlm.nih.gov/31585489/
const {chromium} = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'demo-output');
const face = process.env.FACE_JPG || '/tmp/skimpledemo.jpg';
const quick = process.env.QUICK === '1';
const productName = 'Hydro Boost Hyaluronic Acid Water Cream Fragrance Free Facial Moisturizer';
const productTitle = `Neutrogena ${productName} 1.7 Fl. Oz`;
const productUrl = 'https://www.neutrogena.com/products/skincare/neutrogena-hydro-boost-water-cream-fragrance-free-1.7-oz/6806486';
const ingredients = 'Water, Glycerin, Isopropyl Palmitate, Cetyl Alcohol, Cetearyl Olivate, Sorbitan Olivate, C10-30 Cholesterol/Lanosterol Esters, Ceramide NP, Stearic Acid, Palmitic Acid, Sodium Hyaluronate, Serine, Glycine, Alanine, Threonine, Arginine, Proline, Lysine HCl, Glutamic Acid, Sodium PCA, PCA, Sodium Lactate, Urea, Sodium Chloride, Citric Acid, Betaine, Allantoin, Fructose, Maltose, Trehalose, Glucose, Pentylene Glycol, Dimethicone, Polyacrylate Crosspolymer-6, Ethylhexylglycerin, Caprylyl Glycol, 1,2-Hexanediol, Tropolone, Sodium Hydroxide';
const finding = (ingredient, synthesis, title, year, pmid, outcome = 'hydration') => ({
  ingredient, outcome, effect:'potential_benefit', evidence_confidence:'moderate', synthesis,
  paper_ids:[pmid], papers:[{id:pmid,title,year,pmid,url:`https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,relation:'ingredient-level context'}],
});
const report = {
  compatibility:{classification:'uncertain',benefit_fit_score:null,irritation_concern:'uncertain',confidence:'limited',known_reaction_ingredients:[],limitations:['The cited studies tested other formulations. This product’s finished formula and individual tolerance are not established by ingredient studies.']},
  ingredient_findings:[
    finding('Glycerin','A trial of a glycerol-containing cream found improved skin hydration versus its vehicle. The Neutrogena formula was not tested.','Placebo-controlled, double-blind, randomized, prospective study of a glycerol-based emollient on eczematous skin in atopic dermatitis: biophysical and clinical evaluation',2008,'18025807'),
    finding('Sodium Hyaluronate','A randomized study of a fluid containing hyaluronic acid, glycerin, and Centella measured 24-hour hydration. Effects cannot be assigned to this product alone.','The 24-hour skin hydration and barrier function effects of a hyaluronic 1%, glycerin 5%, and Centella asiatica stem cells extract moisturizing fluid: an intra-subject, randomized, assessor-blinded study',2017,'28860834'),
    finding('Ceramide NP','A study of a different ceramide-containing moisturizer reported improved hydration and barrier measures in people with dry skin.','The 24-hr, 28-day, and 7-day post-moisturizing efficacy of ceramides 1, 3, 6-II containing moisturizing cream compared with hydrophilic cream on skin dryness and barrier disruption in senile xerosis treatment',2019,'31585489','barrier support'),
  ],
  review_signal:{observation_count:0,source_count:0,aspects:[],note:'No permitted review observations are included in this scripted walkthrough.'},
  disclaimer:'Illustrative report with verified product ingredients and linked ingredient studies. It is not a clinical test of this Neutrogena formula or a medical assessment.',
};

async function main() {
  if (!process.env.FACE_JPG) {
    const source = ['assets/skimpledemo.HEIC','assets/skimpledemo.png'].map(p=>path.join(root,p)).find(p=>fs.existsSync(p));
    if (!source) throw new Error('The attached face image is missing from assets.');
    execFileSync('heif-convert',[source,face],{stdio:'ignore'});
  }
  if (!fs.existsSync(face)) throw new Error(`Converted face image missing: ${face}`);
  fs.mkdirSync(output,{recursive:true});
  const browser = await chromium.launch({headless:true});
  const context = await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,recordVideo:{dir:output,size:{width:1440,height:900}}});
  const page = await context.newPage();
  const errors = [];
  const calls = [];
  const owned = new Set();
  let profile = null;
  let faceUploaded = false;
  let analysisRequested = false;
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {if(m.type()==='error') errors.push(m.text());});
  await page.route('http://127.0.0.1:3000/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!/^(index\.html|app\.js|live\.js|profile\.js|styles\.css|profile\.css|assets\/[a-z0-9-]+\.svg)$/.test(relative)) {
      await route.fulfill({status:404,body:'Not found'}); return;
    }
    const contentType = relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : relative.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
    let body = fs.readFileSync(path.join(root,relative));
    if (relative === 'index.html') body = Buffer.from(body.toString().replace('<script src="app.js" defer></script>', '<script>window.SKIMPLE_API_URL="http://localhost:8000"</script><script src="app.js" defer></script><script src="live.js" defer></script>'));
    await route.fulfill({status:200,contentType,body});
  });
  await page.route('http://localhost:8000/**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    calls.push(`${req.method()} ${p}`);
    let body = {};
    if (p === '/v1/me/reports') body = {reports:[]};
    else if (p === '/v1/me/saved') body = {product_keys:[]};
    else if (p === '/v1/me/owned' && req.method()==='GET') body = {product_keys:[...owned]};
    else if (p.startsWith('/v1/me/owned/')) {
      const key = decodeURIComponent(p.slice('/v1/me/owned/'.length));
      if(req.method()==='PUT') owned.add(key); else owned.delete(key);
      body = {owned:req.method()==='PUT'};
    } else if (p === '/v1/me/skin-profile' && req.method()==='GET') body={questionnaire:profile,derived:null};
    else if (p === '/v1/me/skin-profile' && req.method()==='PUT') {profile=req.postDataJSON();body={profile_version:'demo-v1',derived:{basis:'questionnaire'}};}
    else if (p === '/v1/me/skin-photo' && req.method()==='POST') {
      if(!req.postDataBuffer()?.includes(Buffer.from('skimpledemo.jpg'))) throw new Error('Expected converted face JPG in photo upload');
      faceUploaded=true;
      body={observations:{observations:[{description:'Mild visible forehead shine and subtle cheek color variation in this image. Lighting and one photo limit interpretation; skin type and sensitivities come from the questionnaire.'}]}};
    } else if (p === '/v1/me/skin-photo' && req.method()==='DELETE') body={deleted:true};
    else if (p === '/v1/products/search') body={products:[{title:productTitle,source_url:productUrl,image_url:''},{title:'Neutrogena Hydro Boost Water Gel with Signature Fragrance',source_url:'https://www.neutrogena.com/',image_url:''}]};
    else if (p === '/v1/scans/from-search') body={scan_id:'demo-scan-1',status:'CREATED'};
    else if (p === '/v1/scans/demo-scan-1' && req.method()==='GET') body={scan_id:'demo-scan-1',status:'NEEDS_CONFIRMATION',extraction:{brand:'Neutrogena',product_name:productName,variant:'Fragrance Free · 1.7 fl oz',raw_ingredient_text:ingredients,ingredients_in_order:ingredients.split(', ').map(x=>x.trim())}};
    else if (p === '/v1/scans/demo-scan-1/confirm') body={scan_id:'demo-scan-1',status:'CONFIRMED'};
    else if (p === '/v1/analyses' && req.method()==='POST') {analysisRequested=true;body={analysis_id:'demo-analysis-1',status:'CREATED'};}
    else if (p === '/v1/analyses/demo-analysis-1') body={analysis_id:'demo-analysis-1',status:'COMPLETED',report_id:'demo-neutrogena-1'};
    else if (p === '/v1/reports/demo-neutrogena-1' && req.method()==='GET') body=report;
    else if (p === '/v1/reports/demo-neutrogena-1/chat') {
      const q=req.postDataJSON().question.toLowerCase();
      body=q.includes('safe')
        ? {answer:'The listed formula is fragrance-free and includes glycerin, sodium hyaluronate, and Ceramide NP. An ingredient list cannot guarantee safety for an individual. Your demo profile reports fragrance sensitivity; check the exact package, introduce one new product at a time, and stop if irritation occurs.',source:'Brand ingredient list + linked ingredient studies + demo questionnaire'}
        : {answer:'Your demo answers mention combination-feeling skin, hydration and barrier goals, and fragrance sensitivity. This fragrance-free moisturizer may align with those preferences, but the linked papers studied other formulas. The photo only shows mild visible shine and color variation; it cannot confirm skin type or predict your response.',source:'Brand ingredient list + demo questionnaire + limited photo observation'};
    }
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto('http://127.0.0.1:3000');
  await page.waitForSelector('.product-card');
  const start=Date.now();
  const wait = async ms => {if(!quick) await page.waitForTimeout(Math.max(0,ms-(Date.now()-start)));else await page.waitForTimeout(150);};
  const label = async (chapter) => page.evaluate(text => {document.querySelector('#demo-chapter')?.replaceChildren(document.createTextNode(text));},chapter);
  await page.addStyleTag({content:`#demo-strip{position:fixed;z-index:2147483646;left:18px;bottom:16px;background:rgba(32,48,43,.91);color:#fff;padding:8px 13px;border-radius:12px;font:600 13px/1.3 Arial,sans-serif;box-shadow:0 5px 20px #0002;pointer-events:none}#demo-chapter{position:fixed;z-index:2147483646;right:20px;top:78px;background:rgba(255,255,255,.94);color:#263d32;border:1px solid #abc4ae;border-radius:16px;padding:10px 17px;font:700 15px Arial,sans-serif;pointer-events:none;box-shadow:0 4px 16px #0002}`});
  await page.evaluate(() => {document.body.insertAdjacentHTML('beforeend','<div id="demo-strip">Scripted product demo · Verified ingredient page and published studies · Illustrative analysis and chat</div><div id="demo-chapter">Explore the shelf</div>');});
  await wait(3000);
  for (const [i, t] of [[0,4500],[1,6100],[2,7700]]) {await wait(t);await page.locator('.product-card').nth(i).hover();}
  await wait(9000); await label('Add a Neutrogena product'); await page.locator('.scan-tile[data-action="scan"]').click();
  await wait(11500); await page.locator('#new-product-search').pressSequentially('Neutrogena',{delay:110});
  await page.locator('[data-product-suggestion="0"]').waitFor();
  await wait(17000); await page.locator('[data-product-suggestion="0"]').click();
  await wait(19500); await page.locator('[data-action="extract"]').click();
  await page.waitForURL(/#product\/report-demo-neutrogena-1/);
  await wait(24000); await label('Analysis complete: product report');
  await wait(28500); await page.locator('[data-tab="ingredients"]').click(); await page.locator('.inci').scrollIntoViewIfNeeded();
  await wait(32000); await page.locator('[data-tab="overview"]').click(); await label('Product analysis');
  await wait(36500); await page.locator('[data-tab="ingredients"]').click(); await label('Ingredients and linked findings');
  await wait(40000); await page.locator('.ingredient-row').nth(2).scrollIntoViewIfNeeded();
  await wait(43500); await page.locator('[data-tab="sources"]').click(); await label('The exact published research');
  await wait(47000); await page.locator('.source-card').nth(1).scrollIntoViewIfNeeded();
  await wait(50000); await page.locator('.profile-button').click(); await label('Build My Profile');
  await page.locator('#skin-page-form').waitFor();
  await wait(52500); await page.locator('input[name="feel"][value="Combination"] + span').click();
  await wait(54000); await page.locator('input[name="sensitivities"][value="Fragrance"] + span').click();
  await wait(55500); await page.locator('input[name="goals"][value="Hydration"] + span').click();
  await wait(57000); await page.locator('input[name="goals"][value="Barrier support"] + span').click();
  await wait(58500); await page.locator('input[name="routine"][value="Cleanser"] + span').click();
  await wait(60000); await page.locator('input[name="routine"][value="Sunscreen"] + span').click();
  await wait(61500); await page.locator('#page-extra-context').fill('Demo preference: a simple routine and lightweight moisturizers.');
  await wait(64500); await page.locator('#skin-page-form button[type="submit"]').click();
  await page.locator('#my-products').waitFor();
  await wait(67500); await label('Add face-photo context'); await page.locator('.skin-sidebar [data-action="update-skin"]').click();
  await page.locator('#skin-form').waitFor(); await page.locator('#skin-form [data-action="face"]').click();
  await wait(70500); await page.locator('[data-upload="face"]').setInputFiles(face);
  await wait(74500); await page.locator('#face-form input[name="consent"]').check();
  await wait(77000); await page.locator('#face-form button[type="submit"]').click();
  await page.locator('.saved-profile').getByText(/Mild visible forehead shine/).waitFor();
  await wait(81500); await label('My Products: four products'); await page.locator('[data-action="return"]').click();
  await page.locator('#my-products').waitFor();
  for (const [t,query,id] of [[84000,'CeraVe','cerave'],[89000,'BYOMA','byoma'],[94000,'Beauty of Joseon','joseon']]) {
    await wait(t); await page.locator('.add-product-tile').click(); await page.locator('#owned-search').fill(query);
    await page.locator(`.lookup-option[data-id="${id}"]`).click();
  }
  await wait(99000); await page.locator('#my-products').scrollIntoViewIfNeeded();
  await wait(102000); await label('Your AM and PM routine'); await page.locator('#my-routine').scrollIntoViewIfNeeded();
  await wait(106000); await page.locator('.routine-panel.evening').scrollIntoViewIfNeeded();
  await wait(109000); await page.goto('http://127.0.0.1:3000/#product/report-demo-neutrogena-1');
  await page.locator('.detail-intro [data-action="chat"]').waitFor();
  await label('Ask more about this product'); await wait(111000); await page.locator('.detail-intro [data-action="chat"]').click();
  await wait(113000); await page.locator('[data-question="Would this suit my skin?"]').click();
  await page.locator('.message-source').first().waitFor();
  await wait(116000); await page.locator('#chat-input').fill('Are its ingredients safe for me?'); await page.locator('#chat-form button[type="submit"]').click();
  await page.locator('.message-source').nth(1).waitFor();
  await wait(120000);
  if(!quick) await page.screenshot({path:path.join(output,'final-chat.png')});
  const video = page.video();
  await context.close(); await browser.close();
  const raw = await video.path();
  fs.copyFileSync(raw,path.join(output,quick?'product-demo-quick.webm':'product-demo-raw.webm'));
  const summary={durationMs:Date.now()-start,analysisRequested,faceUploaded,owned:[...owned],calls,errors};
  fs.writeFileSync(path.join(output,quick?'quick-run.json':'recording-run.json'),JSON.stringify(summary,null,2));
  if(!analysisRequested||!faceUploaded||owned.size!==4||errors.length) throw new Error(`Journey verification failed: ${JSON.stringify(summary)}`);
  console.log(JSON.stringify({rawVideo:path.join(output,quick?'product-demo-quick.webm':'product-demo-raw.webm'),durationMs:summary.durationMs,owned:[...owned],errors}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
