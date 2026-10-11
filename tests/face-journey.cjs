const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const base = process.env.BASE_URL || 'http://127.0.0.1:4173';
const observations = {
  image_quality:'limited',
  observations:[{feature:'apparent_shine',confidence:'medium',description:'Visible shine on the forehead.'}],
  limitations:['Lighting may affect appearance.'],
};
const context = 'Photo observations (limited image quality): Visible shine on the forehead. (medium confidence) Limitations: Lighting may affect appearance.';

(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
    const errors = [];
    const calls = [];
    let saved = null;
    let attempts = 0;
    let mode = 'unavailable';
    let releaseResponse;
    let signalDelayed;
    const delayed = new Promise(resolve => {signalDelayed = resolve;});
    let submittedProfile;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://localhost:8000/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      calls.push(`${request.method()} ${path}`);
      let body = {};
      let status = 200;
      if (path === '/v1/catalog') body = {products:[]};
      else if (path === '/v1/me/reports') body = {reports:[]};
      else if (path === '/v1/me/saved' || path === '/v1/me/owned') body = {product_keys:[]};
      else if (path === '/v1/me/skin-profile' && request.method() === 'GET') body = {questionnaire:saved,derived:null};
      else if (path === '/v1/me/skin-profile' && request.method() === 'PUT') {saved = request.postDataJSON();body = {derived:{basis:'questionnaire'}};}
      else if (path === '/v1/me/skin-photo' && request.method() === 'POST') {
        attempts++;
        const raw = request.postDataBuffer().toString();
        assert.match(raw, /name="consent"\r\n\r\ntrue/);
        assert.match(raw, /name="photo"; filename="face\.(png|heic)"/);
        submittedProfile = JSON.parse(raw.match(/name="profile"\r\n\r\n([^\r]+)/)[1]);
        if (mode === 'unavailable') {status = 503;body = {detail:'Photo observation is temporarily unavailable. Please try again.'};}
        else if (mode === 'unusable') {status = 422;body = {detail:'No reliable visible observations could be extracted. Try a clearer, well-lit face photo.'};}
        else {
          body = {observations,questionnaire:{...submittedProfile,photo_observations:context,photo_is_demo:false},derived:{basis:'questionnaire'},media_retained:false};
          if (mode === 'delayed') await new Promise(resolve => {releaseResponse = resolve;signalDelayed();});
          else saved = body.questionnaire;
        }
      } else throw new Error(`Unexpected request: ${request.method()} ${path}`);
      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)}).catch(error => {
        if (mode !== 'delayed') throw error;
      });
    });
    await page.goto(`${base}/#skin`);
    await page.waitForFunction(() => state.catalogStatus === 'ready');
    const picture = {name:'face.png',mimeType:'image/png',buffer:Buffer.from(await page.evaluate(() => {
      const canvas = document.createElement('canvas');canvas.width=canvas.height=500;
      return canvas.toDataURL('image/png').split(',')[1];
    }), 'base64')};
    await page.locator('input[name="feel"][value="Combination"] + span').click();
    await page.locator('input[name="goals"][value="Hydration"] + span').click();
    await page.locator('#page-extra-context').fill('Keep these unsaved answers.');
    await page.locator('[data-action="face"]').click();
    await page.locator('[data-upload="face"]').setInputFiles(picture);
    assert.equal(attempts, 0, 'No upload before consent and submission');
    await page.locator('#face-form input[name="consent"]').check();
    await page.locator('#face-form button[type="submit"]').click();
    await page.locator('#face-form .scan-error').waitFor();
    assert.match(await page.locator('.scan-error').innerText(), /temporarily unavailable/);
    assert.equal(await page.locator('.face-preview').count(), 1, 'Failed extraction retains the preview for retry');
    assert.equal(saved, null, 'Failed extraction must not replace the saved profile');
    mode = 'success';
    await page.locator('#face-form input[name="consent"]').check();
    await page.evaluate(() => {
      const form = document.querySelector('#face-form');
      form.dispatchEvent(new Event('submit', {bubbles:true,cancelable:true}));
      processFace();
    });
    await page.waitForFunction(() => state.profile?.hasPhoto && !state.busy);
    assert.equal(attempts, 2, 'Repeated submit must not duplicate extraction');
    assert.equal(submittedProfile.after_cleansing, 'varies');
    assert.deepEqual(submittedProfile.goals, ['hydration']);
    assert.equal(submittedProfile.notes, 'Keep these unsaved answers.');
    assert.equal(saved.notes, 'Keep these unsaved answers.');
    assert.equal(saved.photo_observations, context);
    assert.match(await page.locator('.face-retention-note').innerText(), /not stored/);
    assert.match(await page.locator('.saved-profile').innerText(), /Lighting may affect appearance/);
    assert.match(await page.locator('.saved-profile').innerText(), /Tell me more: Keep these unsaved answers/);
    assert.equal(await page.evaluate(() => state.faceFile === null && state.faceUrl === null && state.urls.size === 0), true);
    assert.equal(calls.filter(call => call === 'DELETE /v1/me/skin-photo').length, 0);
    assert.equal(calls.filter(call => call === 'PUT /v1/me/skin-profile').length, 0);
    await page.locator('.close-button').click();
    await page.reload();
    await page.locator('.skin-photo-context').waitFor();
    assert.match(await page.locator('.skin-photo-context').innerText(), /Visible shine/);
    assert.match(await page.locator('.skin-extra-note').innerText(), /unsaved answers/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

    // A failed replacement must leave previously saved context intact.
    mode = 'unusable';
    await page.locator('.skin-sidebar [data-action="update-skin"]').click();
    await page.locator('[data-action="face"]').click();
    await page.locator('[data-upload="face"]').setInputFiles(picture);
    await page.locator('#face-form input[name="consent"]').check();
    await page.locator('#face-form button[type="submit"]').click();
    await page.locator('#face-form .scan-error').waitFor();
    assert.match(await page.locator('.scan-error').innerText(), /clearer, well-lit/);
    assert.equal(await page.evaluate(() => state.profile.observations), context);
    await page.locator('[data-action="replace-face"]').click();
    assert.equal(await page.evaluate(() => state.faceFile), null);
    assert.equal(await page.locator('.scan-error').count(), 0);
    await page.locator('[data-upload="face"]').setInputFiles(picture);

    // Closing an in-flight extraction must not reopen the dialog or apply its response.
    await page.locator('[data-action="replace-face"]').click();
    await page.locator('[data-upload="face"]').setInputFiles({name:'face.heic',mimeType:'',buffer:fs.readFileSync(path.join(__dirname, '../assets/skimpledemo.HEIC'))});
    assert.match(await page.locator('.saved-profile').first().innerText(), /face.heic/);
    mode = 'delayed';
    await page.locator('#face-form input[name="consent"]').check();
    await page.locator('#face-form button[type="submit"]').click();
    await delayed;
    assert.equal(typeof releaseResponse, 'function');
    await page.locator('.close-button').click();
    releaseResponse();
    await page.waitForFunction(() => !state.busy && faceRequest === null);
    assert.equal(await page.locator('dialog[open]').count(), 0);
    assert.equal(await page.evaluate(() => state.faceFile), null);
    assert.equal(await page.evaluate(() => state.profile.observations), context);

    // Server removal is authoritative even when the browser has older observations.
    saved = {...saved,photo_observations:''};
    await page.reload();
    await page.waitForFunction(() => state.catalogStatus === 'ready');
    assert.equal(await page.locator('.skin-photo-context').count(), 0);
    assert.equal(await page.evaluate(() => state.profile.hasPhoto), false);
    assert.deepEqual(errors, []);
    console.log('PASS face upload consent, draft preservation, extraction retry, durable text context, photo release, cancellation, remote removal');
  } finally {await browser.close();}
})().catch(error => {console.error(error);process.exitCode=1;});
