/* Connect the illustrated UI to Skimple's API. The six original shelf items remain demos. */
'use strict';

const apiBase = window.SKIMPLE_API_URL || 'http://localhost:8000';
const original = {receiveUpload, productCard, renderScan, renderFace, renderQuestionnaire, renderProfileSummary, openChat, renderDetail, renderReportTab, renderConfirmation, startAnalysis, saveProfile, persistProfile, processFace, sendChat, showHow};
let profileSync = Promise.resolve();
let liveReady = false;
let advancedProfile = {knownReactions:[], dryAreas:[], oilyAreas:[], daytimeOiliness:null, sensitivity:null, goals:[], routine:[]};

function visitorKey() {
  const storageKey = 'skimple.visitor-key.v1';
  let key = localStorage.getItem(storageKey);
  if (!key || !/^[0-9a-f]{64}$/.test(key)) {
    key = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(storageKey, key);
  }
  return key;
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set('X-Visitor-Key', visitorKey());
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${apiBase}${path}`, {...options, headers, cache: 'no-store'});
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      detail = typeof body.detail === 'string' ? body.detail : detail;
    } catch { /* An unavailable service may return an empty response. */ }
    throw new Error(detail);
  }
  return response.json();
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const idempotency = () => crypto.randomUUID();
const categoryName = value => ({cleanser:'Cleansers',serum:'Serums',moisturizer:'Moisturizers',sunscreen:'Sunscreens'}[String(value).toLowerCase()] || value || 'Other');
const inferredCategory = name => /cleanser|wash/i.test(name) ? 'Cleansers' : /serum/i.test(name) ? 'Serums' : /sunscreen|spf|sun cream/i.test(name) ? 'Sunscreens' : /moistur|cream|lotion|balm/i.test(name) ? 'Moisturizers' : 'Other';
const safeLink = url => /^https?:\/\//i.test(url || '') ? escapeHTML(url) : '#';
const list = value => Array.isArray(value) ? value : [];
const message = error => error instanceof Error ? error.message : String(error);
function isLive(p) { return !!p?.reportId; }
const productKey = id => id.startsWith('report-') ? `report:${id.slice(7)}` : `demo:${id}`;
const productId = key => key.startsWith('report:') ? `report-${key.slice(7)}` : key.slice(5);

productCard = function(p, index) {
  const card = original.productCard(p, index);
  return isLive(p) ? card.replace(' reviews <span>·</span> ', ' observations <span>·</span> ').replace(' papers</span>', ' linked papers</span>') : card;
};

function profileForApi(p) {
  const feel = p.feel?.[0] || 'Not sure';
  const after = {'Dry & tight':'tight',Oily:'oily',Combination:'varies',Comfortable:'comfortable','Not sure':'unsure'}[feel] || 'unsure';
  const goals = [...new Set([...list(p.goals).map(x => ({Hydration:'hydration',Blemishes:'blemishes','Uneven tone':'tone','Barrier support':'barrier','Sun protection':'sun_protection'}[x])).filter(Boolean), ...advancedProfile.goals])];
  return {
    after_cleansing: after,
    daytime_oiliness: advancedProfile.daytimeOiliness || (feel === 'Oily' ? 'high' : feel === 'Combination' ? 'some' : feel === 'Not sure' ? 'unsure' : 'none'),
    dry_areas: advancedProfile.dryAreas, oily_areas: advancedProfile.oilyAreas,
    sensitivity: advancedProfile.sensitivity || (list(p.sensitivities).some(x => x !== 'Nothing I know of') ? 'medium' : 'unsure'),
    known_reactions: advancedProfile.knownReactions,
    reported_sensitivities: list(p.sensitivities).filter(x => x !== 'Nothing I know of'),
    goals, routine: [...new Set([...list(p.routine), ...advancedProfile.routine])].join(', '), notes: String(p.extraContext || '').slice(0, 1500),
    photo_observations: p.hasPhoto ? String(p.observations || '').slice(0, 1000) : '',
    photo_is_demo: Boolean(p.hasPhoto && p.observations?.startsWith('Demo')),
  };
}

function profileFromApi(q) {
  const feel = {tight:'Dry & tight',oily:'Oily',varies:'Combination',comfortable:'Comfortable',unsure:'Not sure'}[q.after_cleansing] || 'Not sure';
  const goals = list(q.goals).map(x => ({hydration:'Hydration',blemishes:'Blemishes',tone:'Uneven tone',barrier:'Barrier support',sun_protection:'Sun protection'}[x])).filter(Boolean);
  return {feel:[feel], goals, sensitivities:list(q.reported_sensitivities || q.known_reactions), routine:q.routine ? q.routine.split(',').map(x => x.trim()).filter(Boolean) : [], extraContext:q.notes || '', hasPhoto:Boolean(q.photo_observations), observations:q.photo_observations || ''};
}

function reportProduct(row) {
  const report = row.result || {};
  const findings = list(report.ingredient_findings);
  const review = report.review_signal || {};
  const fit = report.compatibility || {};
  const count = review.observation_count || 0;
  const papers = new Set(findings.flatMap(f => list(f.paper_ids))).size;
  const category = row.category === 'other' ? inferredCategory(row.product_name) : categoryName(row.category);
  const name = row.product_name;
  const summary = fit.classification === 'known_reaction_warning'
    ? 'Your saved profile mentions an ingredient in this formula. Review the details before using it.'
    : findings.length ? `${findings.length} source-linked ingredient finding${findings.length === 1 ? '' : 's'} available for this formulation.`
      : 'This product has been scanned and confirmed. Reviewed ingredient evidence may still be limited.';
  return {
    id:`report-${row.report_id}`, reportId:row.report_id, report,
    brand:row.brand, name, category, kind:row.variant || 'Your scanned product',
    color:'#e6eadb', asset:'scanned', tag:'Your new shelf mate',
    reviews:count, papers, positive:0, skin:[], ingredients:[],
    summary, takeaway:fit.classification?.replaceAll('_', ' ') || 'Evidence is still limited',
    benefits:[], caution:list(fit.limitations).join(' '), themes:[], inci:row.raw_ingredient_text || '',
  };
}

async function loadLiveData() {
  try {
    const [reports, saved, profile, ownedProducts] = await Promise.all([
      request('/v1/me/reports'), request('/v1/me/saved'), request('/v1/me/skin-profile'), request('/v1/me/owned'),
    ]);
    const live = list(reports.reports).map(reportProduct);
    state.products = [...catalog, ...state.products.filter(p => p.id.startsWith('demo-')), ...live];
    const remoteSaved = new Set(list(saved.product_keys).map(key => key.startsWith('report:') ? `report-${key.slice(7)}` : key.slice(5)));
    for (const id of state.saved) {
      if (remoteSaved.has(id)) continue;
      if (id.startsWith('demo-') || catalog.some(p => p.id === id)) {
        remoteSaved.add(id);
        void request(`/v1/me/saved/demo:${id}`, {method:'PUT'}).catch(() => {});
      }
    }
    state.saved = remoteSaved;
    const remoteOwned = new Set(list(ownedProducts.product_keys).map(productId));
    for (const id of state.owned) {
      if (remoteOwned.has(id) || !state.products.some(p => p.id === id)) continue;
      remoteOwned.add(id);
      void request(`/v1/me/owned/${productKey(id)}`, {method:'PUT'}).catch(error => console.warn('Owned product migration failed:', message(error)));
    }
    state.owned = remoteOwned;
    persistOwnedProducts();
    if (profile.questionnaire) {
      const q = profile.questionnaire;
      advancedProfile = {
        knownReactions:list(q.known_reactions), dryAreas:list(q.dry_areas), oilyAreas:list(q.oily_areas), daytimeOiliness:q.daytime_oiliness || null,
        sensitivity:q.sensitivity || null, goals:list(q.goals).filter(goal => !['hydration','blemishes','tone','barrier','sun_protection'].includes(goal)),
        routine:String(q.routine || '').split(',').map(x => x.trim()).filter(x => x && !['Cleanser','Moisturizer','Sunscreen','Retinoid','Exfoliating acids','Keeping it simple'].includes(x)),
      };
      const fromApi = profileFromApi(q);
      state.profile = {...fromApi, hasPhoto:fromApi.hasPhoto || state.profile?.hasPhoto || false, observations:fromApi.observations || state.profile?.observations || ''};
    }
    else if (state.profile) profileSync = request('/v1/me/skin-profile', {method:'PUT', body:JSON.stringify(profileForApi(state.profile))}).catch(error => console.warn('Profile migration failed:', message(error)));
    liveReady = true;
    route();
  } catch (error) {
    console.warn('Skimple API unavailable:', message(error));
    toast('The live service is unavailable. You can still explore the sample shelf.');
  }
}

receiveUpload = function(file, target) {
  if (!validateFile(file)) return;
  if (target === 'face') {
    state.faceFile = file;
  } else if (state.scan) {
    state.scan.files ||= {};
    state.scan.files[target] = file;
  }
  original.receiveUpload(file, target);
};

renderScan = function() {
  original.renderScan();
  const note = $('.privacy-note', modal);
  if (note && !state.scan.demo) note.innerHTML = `${icon('shield')}Product photos are sent privately for label reading and expire from storage.`;
};

renderFace = function() {
  original.renderFace();
  const note = $('.saved-profile', modal);
  if (note && state.faceUrl !== 'assets/demo-face.svg') note.innerHTML = '<h3>A face photo is a passing hello.</h3><p>With your consent, the image is sent privately for visible observations and kept only for the configured short retention period. It is not a diagnosis.</p>';
  const consent = $('.check-label', modal);
  if (consent && state.faceUrl !== 'assets/demo-face.svg') consent.lastChild.textContent = 'I consent to temporary processing for visible observations. I understand this is not a diagnosis.';
};

renderQuestionnaire = function() {
  original.renderQuestionnaire();
  const note = $('.privacy-note', modal);
  if (note) note.innerHTML = `${icon('shield')}Your answers are saved privately with your visitor key. You can edit or clear them anytime.`;
};

renderProfileSummary = function() {
  original.renderProfileSummary();
  const note = $('.privacy-note', modal);
  if (note) note.innerHTML = `${icon('shield')}Your questionnaire is saved with your private visitor key. You can edit or clear it anytime.`;
  const photo = $('.saved-profile strong', modal);
  if (photo && state.profile?.hasPhoto && !state.profile.observations?.startsWith('Demo')) photo.textContent = 'Your photo was deleted after observation; only the text shown above remains.';
};

openChat = function() {
  original.openChat();
  if (!isLive(state.currentProduct)) return;
  const p = state.currentProduct;
  state.messages[p.id][0] = {role:'assistant',text:`Let’s talk about ${p.name}. I can use its report, source-linked ingredient findings, permitted review themes, and your saved questionnaire.`};
  renderMessages();
  const disclaimer = $('.chat-disclaimer', modal);
  if (disclaimer) disclaimer.textContent = 'Report-grounded replies · Educational content, not medical advice';
};

function activeScan(scan) { return state.scan === scan && modal.open; }
async function waitForScan(scan) {
  for (let attempt = 0; attempt < 90; attempt++) {
    if (!activeScan(scan)) return null;
    const status = await request(`/v1/scans/${scan.id}`);
    if (status.status === 'NEEDS_CONFIRMATION') return status;
    if (status.status === 'FAILED') throw new Error('We could not read the label. Please try clearer photos.');
    await pause(2000);
  }
  throw new Error('The label is taking longer than expected. Please try again shortly.');
}

extractProduct = async function() {
  const scan = state.scan;
  if (!scan) return;
  if (scan.demo) { original.renderConfirmation(); return; }
  if (!scan.files?.front || !scan.files?.back) { toast('Please add both front and back photos.'); return; }
  if (state.busy) return;
  state.busy = true;
  showModal(modalShell(`<div class="progress-view">${monster()}<div class="step-label" style="justify-content:center">Reading your label</div><h2 style="margin-top:12px">Meeting your new product…</h2><p>Reading the photos and checking the ingredient list.<br>You’ll confirm the details next.</p></div>`));
  try {
    const body = new FormData();
    body.append('front', scan.files.front);
    body.append('back', scan.files.back);
    const created = await request('/v1/scans', {method:'POST', headers:{'Idempotency-Key':idempotency()}, body});
    scan.id = created.scan_id;
    const result = await waitForScan(scan);
    if (result && activeScan(scan)) {
      scan.extraction = result.extraction;
      renderConfirmation();
    }
  } catch (error) {
    if (activeScan(scan)) { renderScan(); toast(message(error)); }
  } finally { state.busy = false; }
};

renderConfirmation = function(draft) {
  const scan = state.scan;
  if (!scan) return;
  if (scan.demo) return original.renderConfirmation(draft);
  const x = scan.extraction || {};
  const data = draft || scan.draft || {brand:x.brand || '', name:x.product_name || '', inci:x.raw_ingredient_text || list(x.ingredients_in_order).join(', ')};
  scan.draft = data;
  showModal(modalShell(`<div class="step-label"><i></i> Check the little details · 2 of 3</div><h2>Is this your new shelf mate?</h2><p class="intro">Please check these details against your package. You can edit every field before the research starts.</p><div class="extracted-product"><img src="assets/scanned.svg" alt="Scanned product illustration"/><div><h3>Label reading result</h3><p>Identity & ingredient confirmation</p></div></div><form id="confirm-product"><div class="form-field"><label for="product-brand">Brand</label><input id="product-brand" name="brand" required maxlength="200" value="${escapeHTML(data.brand)}"/></div><div class="form-field"><label for="product-name">Product name</label><input id="product-name" name="name" required maxlength="255" value="${escapeHTML(data.name)}"/></div><div class="form-field"><label for="product-inci">Ingredient list</label><textarea id="product-inci" name="inci" required maxlength="20000">${escapeHTML(data.inci)}</textarea></div><p class="small-copy">Your corrections define the formula we analyze. Ingredient evidence and review coverage may be limited.</p><div class="modal-actions"><button type="button" class="secondary" data-action="scan-back">← Photos</button><button class="primary" type="submit">Looks right. Let’s explore →</button></div></form>`));
};

async function waitForAnalysis(scan, analysisId) {
  for (let attempt = 0; attempt < 90; attempt++) {
    if (!activeScan(scan)) return null;
    const status = await request(`/v1/analyses/${analysisId}`);
    if (status.report_id) return status.report_id;
    if (status.status === 'FAILED') throw new Error('The analysis could not finish. Please try again.');
    await pause(2500);
  }
  throw new Error('The analysis is taking longer than expected. Please try again shortly.');
}

startAnalysis = async function(data) {
  const scan = state.scan;
  if (!scan) return;
  if (scan.demo) return original.startAnalysis(data);
  if (state.busy) return;
  state.busy = true;
  scan.draft = data;
  showModal(modalShell(`<div class="progress-view">${monster()}<div class="step-label" style="justify-content:center">A little digging · 3 of 3</div><h2 style="margin-top:12px">Good things take a little curiosity.</h2><p>Unpacking the story of ${escapeHTML(data.name)}.</p><ol class="progress-list"><li class="current"><span class="progress-dot"></span>Getting to know the ingredients</li><li><span class="progress-dot"></span>Looking through the review themes</li><li><span class="progress-dot"></span>${state.profile?'Adding your skin context':'Putting the little pieces together'}</li></ol><div class="progress-track"><i id="analysis-progress"></i></div><p class="small-copy" style="margin-top:15px">Live analysis may take a minute. Evidence and review coverage vary.</p></div>`));
  try {
    await profileSync;
    const names = data.inci.split(/[,;\n]+/).map(x => x.trim()).filter(Boolean);
    if (!names.length) throw new Error('Please enter a complete ingredient list.');
    await request(`/v1/scans/${scan.id}/confirm`, {method:'POST', body:JSON.stringify({
      brand:data.brand, product_name:data.name, variant:scan.extraction?.variant || '',
      region:'unknown', category:inferredCategory(data.name), barcode:scan.extraction?.barcode_if_visible || '',
      raw_ingredient_text:data.inci, ingredients_in_order:names,
    })});
    const created = await request('/v1/analyses', {method:'POST', headers:{'Idempotency-Key':idempotency()}, body:JSON.stringify({scan_id:scan.id})});
    const reportId = created.report_id || await waitForAnalysis(scan, created.analysis_id);
    if (!reportId || !activeScan(scan)) return;
    const report = await request(`/v1/reports/${reportId}`);
    const p = reportProduct({report_id:reportId,brand:data.brand,product_name:data.name,category:inferredCategory(data.name),variant:scan.extraction?.variant || '',raw_ingredient_text:data.inci,result:report});
    state.products.push(p);
    closeModal();
    location.hash = `product/${p.id}`;
    toast('Your product report is ready.');
  } catch (error) {
    if (activeScan(scan)) { renderConfirmation(data); toast(message(error)); }
  } finally { state.busy = false; }
};

persistProfile = function() {
  original.persistProfile();
  if (state.profile) profileSync = request('/v1/me/skin-profile', {method:'PUT', body:JSON.stringify(profileForApi(state.profile))})
    .catch(error => { toast(`Skin profile could not sync: ${message(error)}`); throw error; });
  void profileSync.catch(() => {});
};

processFace = async function() {
  if (state.faceUrl === 'assets/demo-face.svg') return original.processFace();
  if (!state.faceFile) { toast('Please choose a face photo first.'); return; }
  const file = state.faceFile;
  const body = new FormData(); body.append('photo', file); body.append('consent', 'true');
  showModal(modalShell(`<div class="progress-view">${monster()}<h2>A little hello, then goodbye.</h2><p>Checking visible details in your photo.</p></div>`));
  try {
    const result = await request('/v1/me/skin-photo', {method:'POST', body});
    await request('/v1/me/skin-photo', {method:'DELETE'});
    releaseURL(state.faceUrl); state.faceUrl = null; state.faceFile = null;
    const observations = list(result.observations?.observations).map(x => x.description).join(' ');
    state.profile = {...(state.profile || {feel:[],goals:[],sensitivities:[],routine:[]}),hasPhoto:true,observations:observations || 'No reliable visible observations were available.'};
    persistProfile(); renderProfileSummary();
  } catch (error) {
    renderFace();
    toast(message(error));
  }
};

renderDetail = function(p) {
  original.renderDetail(p);
  if (!isLive(p)) return;
  $('.detail-intro .small-copy').textContent = `${p.kind} · Confirmed formula`;
  $('.detail-intro .research-summary').innerHTML = `${icon('flask')}${p.reviews.toLocaleString()} permitted review observations · ${p.papers} linked papers`;
  const tag = $('.detail-intro .tags .pill');
  if (tag) tag.innerHTML = `${icon('check')} Your report`;
  const category = $('.detail-intro .tags .pill.coral');
  if (category) category.textContent = p.category === 'Other' ? 'Product' : p.category.slice(0,-1);
};

renderReportTab = function() {
  const p = state.currentProduct;
  if (!isLive(p)) return original.renderReportTab();
  $$('.report-tab').forEach(button => {button.classList.toggle('active', button.dataset.tab === state.tab);button.setAttribute('aria-current',button.dataset.tab === state.tab ? 'page':'false');});
  const report = p.report;
  const fit = report.compatibility || {};
  const findings = list(report.ingredient_findings);
  const review = report.review_signal || {};
  let html = '';
  if (state.tab === 'overview') {
    html = `${state.profile ? `<div class="personal-summary">${monster()}<div><h3>A little more you.</h3><p>${escapeHTML(profileSummary())}.</p></div><button class="text-button" data-action="profile">Update my skin ↗</button></div>` : ''}<div class="report-overview"><div><div class="section-label" style="margin-bottom:12px">The short & sweet</div><h2>${escapeHTML(p.takeaway)}</h2><p>${escapeHTML(p.summary)}</p><ul class="finding-list">${findings.slice(0,3).map(f => `<li><span class="finding-icon">✓</span><span>${escapeHTML(`${f.ingredient}: ${f.synthesis}`)}</span></li>`).join('')}<li><span class="finding-icon caution">!</span><span>${escapeHTML(p.caution || 'Ingredient concentrations and finished-formula performance may be unknown.')}</span></li></ul></div><aside class="fit-panel">${monster()}<h3>Let’s put your skin in the picture.</h3><p>Your report uses your saved questionnaire when available.</p><div class="skin-tags"><span class="pill">${escapeHTML(fit.confidence || 'limited')} confidence</span></div><p>${escapeHTML(list(fit.known_reaction_ingredients).length ? `Known reaction ingredients: ${fit.known_reaction_ingredients.join(', ')}.` : p.summary)}</p><button class="secondary" data-action="profile">${state.profile ? 'Edit my skin profile' : 'Customize for my skin'} ↗</button></aside></div><div class="research-metrics"><div class="metric"><strong>${p.reviews}</strong><span>permitted review observations</span></div><div class="metric"><strong>${p.papers}</strong><span>linked research papers</span></div><div class="metric"><strong>${escapeHTML(fit.confidence || 'limited')}</strong><span>evidence confidence</span></div></div><p class="report-note">${escapeHTML(report.disclaimer || 'Educational information only.')}</p>`;
  } else if (state.tab === 'ingredients') {
    html = `<h2>Inside the bottle.</h2><p>A closer look at the ingredients, the evidence, and the little unknowns.</p>${findings.length ? findings.map((f, i) => `<article class="ingredient-row"><div><h3>${escapeHTML(f.ingredient)}</h3><p>${escapeHTML(f.outcome.replaceAll('_',' '))}</p><button class="text-button" data-action="live-study" data-finding="${i}">Explore research note ↗</button></div><div><p>${escapeHTML(f.synthesis)}</p><p class="small-copy" style="margin-top:8px">${escapeHTML(p.caution)}</p></div><span class="pill">${escapeHTML(f.evidence_confidence)} evidence</span></article>`).join('') : '<div class="source-notice">No reviewed, source-linked ingredient claims are available for this formula yet.</div>'}<div class="inci"><div class="section-label">Confirmed ingredient list</div><p>${escapeHTML(p.inci)}</p></div><p class="report-note">Ingredient findings depend on reviewed claims linked to real papers.</p>`;
  } else if (state.tab === 'reviews') {
    const aspects = list(review.aspects);
    html = `<h2>The word on the shelf.</h2><p>Experiences from people, kept separate from scientific evidence.</p><div class="review-layout" style="margin-top:30px"><div><div class="section-label">Permitted observations</div><div class="sentiment-big">${p.reviews}<span>observations</span></div><p>Across ${review.source_count || 0} approved sources.</p><div class="source-notice">${escapeHTML(review.note || 'Reviews describe experiences, not clinical proof.')}</div></div><div><h3>The recurring themes</h3>${aspects.length ? aspects.map(a => `<div class="review-theme"><span>${escapeHTML(a.aspect)}</span><strong>${escapeHTML(`${a.sentiment} · ${a.count}`)}</strong></div>`).join('') : '<p>No permitted review themes are available yet.</p>'}${state.profile ? `<div class="saved-profile"><h3>A note for your skin</h3><p>${escapeHTML(p.summary)}</p></div>` : ''}</div></div><p class="report-note">Review experiences are anecdotal and do not establish efficacy, safety, or causation.</p>`;
  } else {
    const papers = findings.flatMap((f, i) => list(f.papers).map(paper => ({...paper,ingredient:f.ingredient,finding:i})));
    html = `<h2>A peek behind the claims.</h2><p>Source-linked findings from reviewed ingredient research.</p>${papers.length ? papers.map(paper => `<article class="source-card"><span class="pill">${escapeHTML(paper.relation || 'Linked paper')}</span><h3 style="margin-top:12px">${escapeHTML(paper.title)}</h3><div class="source-meta">${escapeHTML(paper.ingredient)} · ${escapeHTML(paper.year || 'Year unavailable')} · ${escapeHTML(paper.doi || paper.pmid || 'Source record')}</div><a class="text-button" href="${safeLink(paper.url)}" target="_blank" rel="noopener noreferrer">Read the paper ↗</a></article>`).join('') : '<div class="source-notice">No reviewed, source-linked papers are available for this formula yet.</div>'}`;
  }
  $('#report-content').innerHTML = html;
};

sendChat = async function(question) {
  const p = state.currentProduct;
  if (!isLive(p)) return original.sendChat(question);
  const text = String(question).trim();
  if (!text || state.busy) return;
  state.messages[p.id].push({role:'user',text});
  $('#chat-input').value = '';
  state.busy = true; renderMessages();
  try {
    const reply = await request(`/v1/reports/${p.reportId}/chat`, {method:'POST',body:JSON.stringify({question:text})});
    state.messages[p.id].push({role:'assistant',text:reply.answer,source:reply.source});
  } catch (error) {state.messages[p.id].push({role:'assistant',text:`I could not load this answer: ${message(error)}`});}
  finally {state.busy = false; renderMessages();}
};

showHow = function() {
  original.showHow();
  const notice = $('.source-notice', modal);
  if (notice) notice.textContent = 'The six illustrated shelf products are interactive examples. Scanned products use the live label, analysis, review, and research services; coverage varies by product.';
  const photoStep = $('.how-step:nth-child(3) p', modal);
  if (photoStep) photoStep.textContent = 'Share skin preferences or, when available, consent to a face photo for visible observations. Photos expire.';
};

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (['select-owned', 'remove-owned', 'toggle-owned'].includes(action)) {
    event.preventDefault(); event.stopImmediatePropagation();
    const id = button.dataset.id;
    if (!state.products.some(p => p.id === id)) return;
    const removing = action === 'remove-owned' || (action === 'toggle-owned' && state.owned.has(id));
    try {
      await request(`/v1/me/owned/${productKey(id)}`, {method:removing ? 'DELETE' : 'PUT'});
      if (removing) {
        state.owned.delete(id);
        persistOwnedProducts();
        if (location.hash === '#skin') renderPersonalSections();
        else if (state.currentProduct) renderDetail(state.currentProduct);
        toast('Removed from your products. Your research stays on the main shelf.');
      } else addOwnedProduct(id);
    } catch (error) { toast(`My products could not sync: ${message(error)}`); }
    return;
  }
  if (button.dataset.action === 'save') {
    const id = button.dataset.id;
    const key = id.startsWith('report-') ? `report:${id.slice(7)}` : `demo:${id}`;
    const wasSaved = state.saved.has(id);
    try { await request(`/v1/me/saved/${key}`, {method:wasSaved ? 'DELETE' : 'PUT'}); }
    catch (error) { toast(`Favorite could not sync: ${message(error)}`); }
  }
  if (button.dataset.action === 'forget-profile') {
    try { await request('/v1/me/skin-profile', {method:'DELETE'}); advancedProfile = {knownReactions:[], dryAreas:[], oilyAreas:[], daytimeOiliness:null, sensitivity:null, goals:[], routine:[]}; }
    catch (error) { toast(`Profile could not be cleared from the service: ${message(error)}`); }
    try { await request('/v1/me/skin-photo', {method:'DELETE'}); }
    catch { /* The face-photo pilot may be disabled. */ }
  }
  if (button.dataset.action === 'live-study') {
    event.preventDefault(); event.stopImmediatePropagation();
    const p = state.currentProduct;
    const finding = p?.report?.ingredient_findings?.[Number(button.dataset.finding)];
    if (!finding) return;
    showModal(modalShell(`<div class="step-label"><i></i> A source-linked evidence note</div><h2>${escapeHTML(finding.ingredient)}</h2><p class="intro">${escapeHTML(finding.outcome.replaceAll('_',' '))}</p><span class="pill">${escapeHTML(finding.evidence_confidence)} confidence</span><div class="saved-profile"><h3>What the finding says</h3><p>${escapeHTML(finding.synthesis)}</p></div><div class="source-notice" style="margin-top:20px">${list(finding.papers).map(paper => `<p><a href="${safeLink(paper.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(paper.title)} ↗</a></p>`).join('')}</div><button class="primary full-width" data-action="close">Back to the product →</button>`));
  }
}, true);

document.addEventListener('submit', event => {
  if (event.target.id !== 'confirm-product' || !state.scan || state.scan.demo) return;
  event.preventDefault(); event.stopImmediatePropagation();
  const data = Object.fromEntries(new FormData(event.target));
  Object.keys(data).forEach(key => data[key] = String(data[key]).trim());
  if (!data.brand || !data.name || !data.inci) {toast('Please add a brand, product name, and ingredient list.');return;}
  startAnalysis(data);
}, true);

loadLiveData();
modal.addEventListener('close', () => { state.faceFile = null; });
