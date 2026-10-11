/* Skimple's shared interface; live.js connects the catalog and personal data. */
'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons = {
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  bookmark:'<path d="M6 3h12v18l-6-4-6 4z"/>',
  leaf:'<path d="M20 3C7 2 2 8 5 15s15 5 15-12Z"/><path d="M5 20 15 9"/>',
  flask:'<path d="M9 3h6m-5 0v7L4 19q-1 2 2 2h12q3 0 2-2l-6-9V3M7 15h10"/>',
  camera:'<path d="M3 7h4l2-3h6l2 3h4v13H3z"/><circle cx="12" cy="13" r="4"/>',
  upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  shield:'<path d="m12 3 8 3v6q0 6-8 10-8-4-8-10V6z"/><path d="m8 12 3 3 5-6"/>',
  chat:'<path d="M4 4h16v12H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  face:'<circle cx="12" cy="12" r="9"/><path d="M8 9h.01M16 9h.01M8 15q4 4 8 0"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
};
const icon = (name, extra = '') => `<svg class="icon ${extra}" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.leaf}</svg>`;
function monster(className = '') {
  return `<svg class="monster ${className}" viewBox="0 0 120 115" aria-hidden="true"><path class="monster-body" d="M12 88C3 66 7 25 24 15Q35 2 48 11Q63 2 75 13Q90 5 100 23L108 76Q116 95 99 99Q92 114 79 101Q65 116 53 103Q39 116 28 103Q14 109 12 88Z"/><ellipse class="eye" cx="37" cy="49" rx="19" ry="21" transform="rotate(-12 37 49)"/><ellipse class="eye" cx="81" cy="43" rx="20" ry="23" transform="rotate(9 81 43)"/><circle class="pupil" cx="40" cy="49" r="8"/><circle class="pupil" cx="79" cy="44" r="8.5"/><circle cx="43" cy="46" r="2.7" fill="#fff"/><circle cx="82" cy="41" r="2.7" fill="#fff"/><path class="doodle-line" d="M50 78q8 11 18-2M47 24q-5-12 3-13t7 8q0 7-6 4"/><ellipse class="cheek" cx="25" cy="75" rx="8" ry="4"/><ellipse class="cheek" cx="94" cy="68" rx="8" ry="4"/><path class="doodle-line" d="m10 73-7 5m104-10 9 3"/></svg>`;
}
const ingredients = {};
// Populated from /v1/catalog by live.js.
const catalog = [];
function readStorage(key, fallback) {try {return JSON.parse(localStorage.getItem(key)) ?? fallback;} catch {return fallback;}}
function writeStorage(key, value) {try {localStorage.setItem(key, JSON.stringify(value));} catch {toast('Browser storage is unavailable. Your changes last for this visit.');}}
const savedProfile = readStorage('skimple.profile', null);
const safeProfile = savedProfile && typeof savedProfile === 'object' && Array.isArray(savedProfile.goals) ? savedProfile : null;
const savedIds = readStorage('skimple.saved', []);
const ownedIds = readStorage('skimple.owned', []);
const state = {products:[],profile:safeProfile,owned:new Set(Array.isArray(ownedIds)?ownedIds.filter(id=>typeof id==='string'):[]),saved:new Set(Array.isArray(savedIds)?savedIds:[]),filter:'All products',search:'',tab:'overview',scan:null,returnTo:null,currentProduct:null,messages:{},urls:new Set(),stream:null,timers:[],faceUrl:null,busy:false};
const modal = $('#modal');
let toastTimer;
function toast(message) {clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').classList.add('show');toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3200);}
function later(callback, delay) {const timer=setTimeout(callback,delay);state.timers.push(timer);return timer;}
function clearTimers() {state.timers.forEach(clearTimeout);state.timers=[];state.busy=false;}
function stopCamera() {if(state.stream)state.stream.getTracks().forEach(track=>track.stop());state.stream=null;}
function releaseURL(url) {if(url){URL.revokeObjectURL(url);state.urls.delete(url);}}
function resetMedia() {stopCamera();state.urls.forEach(url=>URL.revokeObjectURL(url));state.urls.clear();state.faceUrl=null;state.scan=null;}
function showModal(html, className='') {stopCamera();modal.className=className;$('#modal-content').innerHTML=html;const heading=$('h2',modal);if(heading)heading.id='modal-title';if(!modal.open){modal.showModal();document.body.classList.add('modal-open');}modal.scrollTop=0;requestAnimationFrame(()=>{const focusTarget=$('[autofocus]',modal)||$('.close-button',modal);focusTarget?.focus({preventScroll:true});});}
function closeModal() {clearTimers();stopCamera();if(modal.open)modal.close();}
modal.addEventListener('close',()=>{clearTimers();resetMedia();state.returnTo=null;state.profileDraft=null;document.body.classList.remove('modal-open');modal.className='';});
modal.addEventListener('click', event=>{if(event.target===modal){const rect=modal.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeModal();}});
modal.addEventListener('cancel',()=>clearTimers());
const closeButton='<button class="close-button" data-action="close" aria-label="Close dialog">×</button>';
const modalShell=(content)=>`<div class="modal-inner">${closeButton}${content}</div>`;

function updateProfileLabel() {$('#profile-label').textContent='My skin profile';const link=$('.profile-button');const skinPage=location.hash==='#skin';$('.header-back').classList.toggle('hidden',!skinPage);if(skinPage)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}
function productCard(p,index) {
  const saved=state.saved.has(p.id);
  return `<article class="product-card" style="--index:${index};--card-color:${p.color}"><a class="product-link" href="#product/${encodeURIComponent(p.id)}" aria-label="Explore ${escapeHTML(p.brand)} ${escapeHTML(p.name)}"><div class="product-visual"><span class="card-tag">${icon('leaf')}${escapeHTML(p.tag)}</span><img src="assets/${p.asset}.svg" alt="${escapeHTML(p.brand)} ${escapeHTML(p.name)} packaging" loading="${index<4?'eager':'lazy'}" width="400" height="400"/></div><div class="product-copy"><div class="product-brand">${escapeHTML(p.brand)}</div><h3>${escapeHTML(p.name)}</h3><p class="product-kind">${escapeHTML(p.kind)}</p><div class="product-bottom"><span class="research-summary">${icon('flask')}${p.reviews.toLocaleString()} reviews <span>·</span> ${p.papers} papers</span><span class="round-arrow" aria-hidden="true">↗</span></div></div></a><button class="save-button ${saved?'saved':''}" data-action="save" data-id="${escapeHTML(p.id)}" aria-label="${saved?'Unsave':'Save'} ${escapeHTML(p.name)}" aria-pressed="${saved}">${icon('bookmark')}</button></article>`;
}
function scanTile() {return `<button class="scan-tile" data-action="scan"><span class="tile-star" aria-hidden="true">✧</span><svg class="bottle-outline" viewBox="0 0 100 110" fill="none" aria-hidden="true"><path d="M39 11h23v17H39zM34 28h34v13H34zM36 41q-12 7-12 21v32q0 7 8 7h38q8 0 8-7V62q0-14-12-21" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 4"/><rect x="31" y="62" width="40" height="24" rx="3" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 4"/><path d="M45 74h12m-6-6v12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="m81 21 3-7 3 7 7 3-7 3-3 7-3-7-7-3z" fill="#d9ce91" stroke="none"/></svg><h3>Your next find<br>belongs here.</h3><p>Learn a little more about<br>another skincare product.</p><span class="scan-cta"><span>+</span> Add a product</span></button>`;}
function renderShelfGrid() {
  if (!state.products.length && state.catalogStatus !== 'ready') {
    const failed = state.catalogStatus === 'error';
    $('#product-grid').innerHTML = `<div class="empty-state" role="status"><h3>${failed ? 'The product shelf couldn’t load.' : 'Loading the product shelf…'}</h3><p>${failed ? 'Please try connecting again.' : 'Fetching products and their sources.'}</p>${failed ? '<button class="text-button" data-action="retry-catalog">Try again ↗</button>' : ''}</div>`;
    return;
  }
  const filtered=state.products.filter(p=>(state.filter==='All products'||p.category===state.filter)&&`${p.brand} ${p.name} ${p.kind}`.toLowerCase().includes(state.search.toLowerCase()));
  const cards=filtered.map((p,i)=>productCard(p,i));
  if(state.filter==='All products'&&!state.search)cards.splice(3,0,scanTile());
  $('#product-grid').innerHTML=cards.length?cards.join(''):`<div class="empty-state"><h3>No shelf mates just yet.</h3><p>Try a different search, or bring a new product along.</p><button class="text-button" data-action="scan">Scan another product ↗</button></div>`;
  $$('.filter').forEach(button=>{button.classList.toggle('active',button.dataset.filter===state.filter);button.setAttribute('aria-pressed',button.dataset.filter===state.filter);});
}
function renderHome() {
  state.currentProduct=null;
  $('.site-header .nav-link').classList.add('active');
  $('#app').innerHTML=`<section class="hero"><div><h1>A little science.<br>A lot of <em>skin love.</em></h1></div><div class="hero-art"><img src="assets/hero.svg" alt="Playful skimple skincare bottles with a curious little green monster" width="570" height="320"/><span class="hero-note">good skin days start with curiosity ♡</span></div></section><section class="shelf" aria-labelledby="shelf-title"><div class="shelf-heading"><div><h2 id="shelf-title">Meet your next skin crush.</h2></div><div class="hand-note">Already researched, just for you<svg viewBox="0 0 45 35" fill="none" aria-hidden="true"><path d="M3 4q23-1 29 23m-8-4 9 5 3-11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></div></div><div class="toolbar"><div class="filters" aria-label="Filter products">${['All products','Cleansers','Serums','Moisturizers','Sunscreens','Exfoliants'].map(name=>`<button class="filter" data-filter="${name}" aria-pressed="${name===state.filter}">${name}</button>`).join('')}</div><label class="search-wrap">${icon('search')}<input id="product-search" type="search" placeholder="Find a product or brand..." aria-label="Search products" value="${escapeHTML(state.search)}"/></label></div><div id="product-grid" class="product-grid" aria-live="polite"></div><p class="shelf-footnote">${icon('flask')} A little research goes a long way. Every product has a story.</p></section><section class="context-strip"><div class="wiggle">${monster()}</div><div><h3>${state.profile?'Your skin has entered the chat.':'Different skin. Different story.'}</h3><p>${state.profile?'Your saved skin preferences travel with you to every product.':'Give our context monster a few little details. Get a perspective that’s more you.'}</p></div><button class="text-button" data-action="profile">${state.profile?'Meet my skin profile':'Let’s make this personal'} <span>↗</span></button></section>`;
  renderShelfGrid();
}
function profileSummary() {
  if(!state.profile)return '';
  const p=state.profile;
  const parts=[p.feel?.length?`${p.feel.join(', ')} skin tendencies`:null,p.goals?.length?`focused on ${p.goals.join(' and ').toLowerCase()}`:null,p.sensitivities?.length?`reported sensitivities: ${p.sensitivities.join(', ').toLowerCase()}`:null,p.extraContext?`your extra context: “${p.extraContext}”`:null].filter(Boolean);
  return parts.join('; ')||'Photo observations saved; skin tendencies still unconfirmed';
}
function personalFinding(p) {
  const profile=state.profile;
  if(!profile)return '';
  const feel=profile.feel?.[0]||'';
  const sensitive=profile.sensitivities?.some(s=>s!=='Nothing I know of');
  const fit=p.skin.some(type=>feel.toLowerCase().includes(type.toLowerCase()));
  return `${fit?'This product’s example fit overlaps with your skin preferences.':'Your skin preferences help add context, but individual tolerance can vary.'} ${sensitive?'You mentioned sensitivity, so introduce one new product at a time and watch how your skin responds.':`Your focus on ${(profile.goals?.join(' and ')||'learning about your skin').toLowerCase()} is included in your product chats.`}`;
}
function renderDetail(p) {
  state.currentProduct=p;
  $('.site-header .nav-link').classList.remove('active');
  $('#app').innerHTML=`<a class="back-link" href="#">← Back to the shelf</a><section class="detail-hero"><div class="detail-art" style="--card-color:${p.color}"><span class="card-tag">${icon('leaf')}${escapeHTML(p.tag)}</span><span class="detail-spark" aria-hidden="true">✧</span><img src="assets/${p.asset}.svg" alt="${escapeHTML(p.brand)} ${escapeHTML(p.name)}" width="400" height="400"/></div><div class="detail-intro"><div class="product-brand">${escapeHTML(p.brand)}</div><h1>${escapeHTML(p.name)}</h1><p class="subtitle">${escapeHTML(p.summary)}</p><div class="tags"><span class="pill">${icon('check')} Research unpacked</span><span class="pill coral">${escapeHTML(p.category.slice(0,-1))}</span><span class="pill lavender">${state.profile?'Made more personal':'Your skin, your story'}</span></div><p class="small-copy">${escapeHTML(p.kind)} · Example formula</p><div class="detail-buttons"><button class="primary" data-action="chat">${icon('chat')} Talk about it <span>↗</span></button><button class="secondary" data-action="save" data-id="${escapeHTML(p.id)}" aria-pressed="${state.saved.has(p.id)}">${icon('bookmark')}${state.saved.has(p.id)?'Saved to my shelf':'Save to my shelf'}</button></div><div class="research-summary">${icon('flask')}${p.reviews.toLocaleString()} example reviews · ${p.papers} illustrative papers · Demo research</div><button class="text-button detail-owned" data-action="toggle-owned" data-id="${escapeHTML(p.id)}" aria-pressed="${state.owned.has(p.id)}">${state.owned.has(p.id)?'✓ In my products · Remove':'+ I use this product'}</button></div></section><nav class="report-tabs" aria-label="Product research sections">${[['overview','The little overview'],['ingredients','Ingredient deep dive'],['reviews','What people say'],['sources','The research']].map(([id,label])=>`<button class="report-tab ${state.tab===id?'active':''}" data-tab="${id}" aria-current="${state.tab===id?'page':'false'}">${label}</button>`).join('')}</nav><section class="report-content" id="report-content" aria-live="polite"></section>`;
  renderReportTab();
}
function renderReportTab() {
  const p=state.currentProduct;
  if(!p)return;
  $$('.report-tab').forEach(button=>{button.classList.toggle('active',button.dataset.tab===state.tab);button.setAttribute('aria-current',button.dataset.tab===state.tab?'page':'false');});
  let html='';
  if(state.tab==='overview') {
    html=`${state.profile?`<div class="personal-summary">${monster()}<div><h3>A little more you.</h3><p>${escapeHTML(profileSummary())}.</p></div><button class="text-button" data-action="profile">Update my skin ↗</button></div>`:''}<div class="report-overview"><div><div class="section-label" style="margin-bottom:12px">The short & sweet</div><h2>${escapeHTML(p.takeaway)}</h2><p>${escapeHTML(p.summary)}</p><ul class="finding-list">${p.benefits.map(item=>`<li><span class="finding-icon">✓</span><span>${escapeHTML(item)}</span></li>`).join('')}<li><span class="finding-icon caution">!</span><span>${escapeHTML(p.caution)}</span></li></ul></div><aside class="fit-panel">${monster()}<h3>${state.profile?'Let’s put your skin in the picture.':'Who might love this little one?'}</h3><p>Example fit for these skin tendencies:</p><div class="skin-tags">${p.skin.map(s=>`<span class="pill">${s}</span>`).join('')}</div><p>${state.profile?escapeHTML(personalFinding(p)):'Skin type is only part of the story. Your sensitivities, goals, and routine matter, too.'}</p><button class="secondary" data-action="profile">${state.profile?'Edit my skin profile':'Customize for my skin'} ↗</button></aside></div><div class="research-metrics"><div class="metric"><strong>${p.reviews.toLocaleString()}</strong><span>example review observations</span></div><div class="metric"><strong>${p.papers}</strong><span>illustrative research records</span></div><div class="metric"><strong>Moderate</strong><span>example evidence confidence</span></div></div><p class="report-note">All findings, counts, and research records are dummy content for this design prototype. Ingredient evidence and personal experiences are different kinds of information.</p>`;
  } else if(state.tab==='ingredients') {
    html=`<h2>Inside the bottle.</h2><p>A closer look at the ingredients, the evidence, and the little unknowns.</p>${p.ingredients.map(key=>{const i=ingredients[key];return `<article class="ingredient-row"><div><h3>${i.name}</h3><p>${i.role}</p><button class="text-button" data-action="study" data-ingredient="${key}">Explore research note ↗</button></div><div><p>${i.finding}</p><p class="small-copy" style="margin-top:8px">${i.limit}</p></div><span class="pill ${i.confidence==='Limited'?'yellow':''}">${i.confidence} evidence</span></article>`;}).join('')}<div class="inci"><div class="section-label">Example ingredient list · Abbreviated</div><p>${escapeHTML(p.inci)}</p></div><p class="report-note">Illustrative ingredient findings only. Concentrations and finished-formula performance may be unknown.</p>`;
  } else if(state.tab==='reviews') {
    html=`<h2>The word on the shelf.</h2><p>Experiences from people, kept separate from scientific evidence.</p><div class="review-layout" style="margin-top:30px"><div><div class="section-label">Overall example sentiment</div><div class="sentiment-big">${p.positive}<span>% positive</span></div><p>Across ${p.reviews.toLocaleString()} fictional review observations.</p><div class="sentiment-track" aria-label="Illustrative positive, mixed, and negative review distribution"><i style="flex:${p.positive}"></i><i style="flex:${Math.round((100-p.positive)*.65)}"></i><i style="flex:${Math.round((100-p.positive)*.35)}"></i></div><div class="sentiment-legend"><span>● Positive</span><span>● Mixed</span><span>● Negative</span></div><div class="quote">“${p.id==='ordinary'?'A little goes a long way. I added it slowly and kept the rest of my routine simple.':'It found a happy little place in my routine. The texture is what keeps me coming back.'}”<cite>Fictional review · Written for this prototype</cite></div></div><div><h3>The recurring themes</h3>${p.themes.map(([theme,label])=>`<div class="review-theme"><span>${escapeHTML(theme)}</span><strong>${escapeHTML(label)}</strong></div>`).join('')}<p class="small-copy" style="margin-top:20px">Source mix preview: retailer reviews, skincare communities, and independent reviews. These are example categories; no live reviews were retrieved.</p>${state.profile?`<div class="saved-profile"><h3>A note for your skin</h3><p>${escapeHTML(personalFinding(p))}</p></div>`:''}</div></div><p class="report-note">Review experiences are anecdotal and do not establish efficacy, safety, or causation. All figures above are fictional.</p>`;
  } else {
    html=`<h2>A peek behind the claims.</h2>${p.ingredients.map(key=>{const i=ingredients[key];return `<article class="source-card"><span class="pill">Illustrative research record</span><h3 style="margin-top:12px">${i.study}</h3><div class="source-meta">${i.name} · Topical skincare relevance · Example evidence: ${i.confidence.toLowerCase()}</div><p>${i.finding}</p><button class="text-button" data-action="study" data-ingredient="${key}">Read evidence & limitations ↗</button></article>`;}).join('')}`;
  }
  $('#report-content').innerHTML=html;
}
function route() {
  const match=location.hash.match(/^#product\/([^/]+)$/);
  if(location.hash==='#skin')renderSkinPage();
  else if(match){let id;try{id=decodeURIComponent(match[1]);}catch{id='';}const p=state.products.find(p=>p.id===id);if(p)renderDetail(p);else{renderHome();toast('That product isn’t on your shelf.');}}
  else renderHome();
  updateProfileLabel();
}
window.addEventListener('hashchange',()=>{if(modal.open)closeModal();state.tab='overview';route();window.scrollTo(0,0);});

function openScan() {
  state.returnTo=null;
  state.scan={front:null,back:null,demo:false};
  renderScan();
}
function uploadZone(side) {
  const image=state.scan[side];
  return `<label class="upload-zone">${image?`<img src="${image}" alt="${side} of selected product"/>`:icon('upload')}<strong>${side==='front'?'The front':'The back'}</strong><small>${image?'Click to replace photo':'Drop a photo or click to upload'}</small><input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" data-upload="${side}" aria-label="Upload product ${side}"/></label>`;
}
function renderScan() {
  showModal(modalShell(`<div class="step-label"><i></i> A new shelf mate</div><h2>What’s on your skincare shelf?</h2><p class="intro">Find the product by name, or show us one photo of the front. We’ll look up the ingredients.</p><div class="form-field product-search-field"><label for="new-product-search">Search by product name</label><input id="new-product-search" type="search" role="combobox" aria-autocomplete="list" aria-controls="new-product-results" aria-expanded="false" autocomplete="off" placeholder="Start typing a brand or product name…" value="${escapeHTML(state.scan.searchQuery||'')}"/><div id="new-product-results" class="product-search-results" role="listbox" aria-label="Matching products"></div></div><p class="scan-divider">or add one front photo</p><div class="upload-grid single-upload">${uploadZone('front')}</div><div class="camera-row"><button class="secondary" data-action="product-camera">${icon('camera')} Take a front photo</button><button class="text-button" data-action="demo-product">Try a demo product ↗</button></div><p class="small-copy">JPG, PNG, WebP · Up to 10 MB. Make the brand and full product name clear.</p>${!state.profile?.hasPhoto?`<div class="customize-block">${monster()}<div><h3>A little more you?</h3><p>Add a face photo or quick skin preferences.</p></div><button class="text-button" data-action="scan-customize">Customize for my skin ↗</button></div>`:`<div class="customize-block">${monster()}<div><h3>Your skin profile is coming along.</h3><p>${escapeHTML(profileSummary())}.</p></div><button class="text-button" data-action="scan-profile">Edit ↗</button></div>`}<div class="privacy-note">${icon('shield')}Product photos are sent privately for label reading and expire from storage.</div><button class="primary full-width" data-action="extract" ${!state.scan.front&&!state.scan.selected?'disabled':''}>Analyze this product <span>→</span></button>`));
}
function validateFile(file) {
  if(!file)return false;
  if(!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)){toast('Please choose a JPG, PNG, or WebP image.');return false;}
  if(file.size>10*1024*1024){toast('That photo is a little big. Please keep it under 10 MB.');return false;}
  return true;
}
function objectURL(file) {const url=URL.createObjectURL(file);state.urls.add(url);return url;}
function receiveUpload(file, target) {
  if(!validateFile(file))return;
  if(target==='face'){releaseURL(state.faceUrl);state.faceUrl=objectURL(file);renderFace();}
  else{releaseURL(state.scan[target]);state.scan[target]=objectURL(file);state.scan.demo=false;renderScan();}
}
function extractProduct() {
  if(!state.scan?.front&&!state.scan?.back)return;
  showModal(modalShell(`<div class="progress-view">${monster()}<div class="step-label" style="justify-content:center">Demo label reading</div><h2 style="margin-top:12px">Meeting your new product…</h2><p>We’re playing through the label-reading step.<br>You’ll check the example details next.</p></div>`));
  later(renderConfirmation,1000);
}
function renderConfirmation(draft) {
  if(!state.scan)return;
  const data=draft||state.scan.draft||{brand:'BYOMA',name:'Moisturizing Rich Cream',inci:'Aqua, Glycerin, Caprylic/Capric Triglyceride, Niacinamide, Ceramide NP, Ceramide AP, Ceramide EOP, Cholesterol, Phytosphingosine.'};
  state.scan.draft=data;
  showModal(modalShell(`<div class="step-label"><i></i> Check the little details · 2 of 3</div><h2>Is this your new shelf mate?</h2><p class="intro">These are sample extracted details, regardless of your photo. You can edit every field before the demo research starts.</p><div class="extracted-product"><img src="assets/byoma.svg" alt="Example BYOMA packaging"/><div><h3>Example label match</h3><p>Identity & ingredient confirmation</p></div></div><form id="confirm-product"><div class="form-field"><label for="product-brand">Brand</label><input id="product-brand" name="brand" required maxlength="60" value="${escapeHTML(data.brand)}"/></div><div class="form-field"><label for="product-name">Product name</label><input id="product-name" name="name" required maxlength="100" value="${escapeHTML(data.name)}"/></div><div class="form-field"><label for="product-inci">Ingredient list</label><textarea id="product-inci" name="inci" required maxlength="3000">${escapeHTML(data.inci)}</textarea></div><p class="small-copy">Editing defines the demo product label. Research remains an illustrative fixture.</p><div class="modal-actions"><button type="button" class="secondary" data-action="scan-back">← Photos</button><button class="primary" type="submit">Looks right. Let’s explore →</button></div></form>`));
}
function startAnalysis(data) {
  state.scan.draft=data;
  showModal(modalShell(`<div class="progress-view">${monster()}<div class="step-label" style="justify-content:center">A little digging · 3 of 3</div><h2 style="margin-top:12px">Good things take a little curiosity.</h2><p>Unpacking the story of ${escapeHTML(data.name)}.</p><ol class="progress-list"><li class="current"><span class="progress-dot"></span>Getting to know the ingredients</li><li><span class="progress-dot"></span>Looking through the review themes</li><li><span class="progress-dot"></span>${state.profile?'Adding your skin context':'Putting the little pieces together'}</li></ol><div class="progress-track"><i id="analysis-progress"></i></div><p class="small-copy" style="margin-top:15px">A simulated research journey. No live analysis.</p></div>`));
  [0,1,2].forEach((stage)=>later(()=>{
    $$('.progress-list li',modal).forEach((li,i)=>{li.className=i<=stage?'done':i===stage+1?'current':'';$('.progress-dot',li).textContent=i<=stage?'✓':'';});
    $('#analysis-progress').style.width=`${(stage+1)/3*100}%`;
  },(stage+1)*800));
  later(()=>{
    const product={...catalog[0],id:`demo-${Date.now()}`,brand:data.brand,name:data.name,inci:data.inci,kind:'Your scanned product · Example report',tag:'Your new shelf mate',summary:'Your product label is ready to explore. This report uses sample moisturizer research to demonstrate how ingredient evidence, reviews, and skin context come together.'};
    state.products.push(product);
    writeStorage('skimple.products',state.products.filter(p=>p.id.startsWith('demo-')).slice(-12).map(({id,brand,name,inci,kind,tag,summary})=>({id,brand,name,inci,kind,tag,summary})));
    closeModal();location.hash=`product/${product.id}`;toast('A new little shelf mate. Your demo report is ready!');
  },2900);
}

function openProfile(returnTo=null, forceEdit=false) {
  state.returnTo=returnTo;
  if(state.profile&&!forceEdit)renderProfileSummary();else renderQuestionnaire();
}
function renderQuestionnaire() {
  const p=state.profileDraft||state.profile||{};
  showModal(modalShell(`<div class="step-label"><i></i> A quick hello to your skin · About 30 seconds</div><div class="profile-monster">${monster()}<div><h2>Num num. A little context?</h2><p>The more I know, the more this feels like you.</p></div></div>${skinQuestionnaireMarkup(p)}`));
}
function saveProfile(form) {
  const data=new FormData(form);
  const feel=data.getAll('feel'),goals=data.getAll('goals'),sensitivities=data.getAll('sensitivities');
  if(!feel.length||!goals.length){$('[data-profile-error]',form).textContent='A skin feel and one little goal are all we need to start.';return;}
  if(sensitivities.includes('Nothing I know of')&&sensitivities.length>1){$('[data-profile-error]',form).textContent='Choose your sensitivities, or “Nothing I know of”, so your profile is clear.';return;}
  state.profile={feel,goals,sensitivities,routine:data.getAll('routine'),extraContext:String(data.get('extraContext')||'').trim().slice(0,1500),hasPhoto:state.profile?.hasPhoto||false,observations:state.profile?.observations||''};
  state.profileDraft=null;
  persistProfile();returnFromProfile();toast('Num num. Your skin context is saved!');
}
function persistProfile() {writeStorage('skimple.profile',state.profile);updateProfileLabel();if(location.hash==='#skin')renderSkinPage();else if(state.currentProduct)renderDetail(state.currentProduct);else if(!location.hash||location.hash==='#')renderHome();}
function renderProfileSummary() {
  const p=state.profile;
  showModal(modalShell(`<div class="step-label"><i></i> Your little skin story</div><div class="profile-monster">${monster()}<div><h2>Context: happily fed.</h2><p>This profile travels with you to every product.</p></div></div><div class="saved-profile"><h3>Here’s what you’ve shared.</h3><p>${escapeHTML(profileSummary())}.</p><div class="tags">${[...(p.feel||[]),...(p.goals||[])].map(label=>`<span class="pill">${escapeHTML(label)}</span>`).join('')}</div>${p.extraContext?`<p style="margin-top:14px"><strong>Tell me more:</strong> ${escapeHTML(p.extraContext)}</p>`:''}${p.routine?.length?`<p style="margin-top:14px">Routine: ${escapeHTML(p.routine.join(', '))}.</p>`:''}${p.hasPhoto?`<p style="margin-top:14px">${escapeHTML(p.observations)}</p><p style="margin-top:8px"><strong>Face photo discarded. Only demo observation text remains.</strong></p>`:''}</div><div class="privacy-note">${icon('shield')}Saved locally in this browser. No account, uploads, or AI connection.</div><div class="modal-actions"><button class="secondary" data-action="edit-profile">Edit my answers</button><button class="primary" data-action="return">${state.returnTo?'Bring my context along':'Happy with my skin story'} →</button></div><button class="delete-profile" data-action="forget-profile">Clear my saved skin profile</button>`));
}
function returnFromProfile() {
  const target=state.returnTo;state.returnTo=null;
  if(target==='scan'&&state.scan)renderScan();else if(target==='chat')openChat();else closeModal();
}
function renderFace() {
  const questions=$('#skin-form',modal)||$('#skin-page-form');
  if(questions){const values=new FormData(questions);state.profileDraft={...Object.fromEntries(['feel','goals','sensitivities','routine'].map(key=>[key,values.getAll(key)])),extraContext:String(values.get('extraContext')||'').trim().slice(0,1500)};}
  showModal(modalShell(`<div class="step-label"><i></i> Optional · Your face, your choice</div><h2>Say a little hello.</h2><p class="intro">A photo can add visible observations, like shine or redness. It can’t diagnose a condition or determine your skin type.</p>${state.faceUrl?`<img class="face-preview" src="${state.faceUrl}" alt="Your temporary selected face photo"/><button class="text-button" data-action="replace-face">Choose a different photo ↗</button>`:`<label class="upload-zone face-upload">${icon('face')}<strong>Upload a face photo</strong><small>JPG, PNG, WebP · Up to 10 MB · Natural light is lovely</small><input type="file" accept="image/jpeg,image/png,image/webp" data-upload="face" aria-label="Upload a temporary face photo"/></label><div class="camera-row"><button class="secondary" data-action="face-camera">${icon('camera')} Take a photo</button><button class="text-button" data-action="demo-face">Use a demo instead ↗</button></div>`}<div class="saved-profile"><h3>A face photo is a passing hello.</h3><p>Your photo is never uploaded or saved. We release its temporary preview when you continue or close this window. Only clearly labeled demo observations are kept.</p></div><form id="face-form"><label class="check-label"><input type="checkbox" name="consent" required/>I’m happy to use this photo temporarily for this demo. I understand the observations are a sample, not an actual assessment.</label><div class="modal-actions"><button type="button" class="secondary" data-action="edit-profile">← Quick questions</button><button class="primary" type="submit" ${state.faceUrl?'':'disabled'}>Add my skin context →</button></div></form>`));
}
function processFace() {
  releaseURL(state.faceUrl);state.faceUrl=null;
  showModal(modalShell(`<div class="progress-view">${monster()}<h2>A little hello, then goodbye.</h2><p>Your temporary photo preview has been discarded.<br>We’re adding the sample observation text.</p></div>`));
  later(()=>{state.profile={feel:[],goals:[],sensitivities:[],routine:[],...state.profile,hasPhoto:true,observations:'Demo observations: mild visible shine and redness. These are illustrative, not an assessment of your photo; skin tendencies remain questionnaire-based.'};persistProfile();renderProfileSummary();},1000);
}
async function openCamera(target) {
  showModal(modalShell(`<div class="step-label"><i></i> ${target==='face'?'A temporary face photo':'Product camera'}</div><h2>${target==='face'?'A little camera hello.':'Ready for its close-up?'}</h2><p class="intro">${target==='face'?'Use soft, natural light. The image stays temporary.':'Hold the front label steady so the full product name is visible.'}</p><div id="camera-status" class="small-copy">Waiting for camera permission…</div><div class="camera-view hidden" id="camera-view"><video id="camera-video" autoplay playsinline muted></video><div class="camera-frame"></div></div><div id="camera-error" role="alert"></div><div class="modal-actions"><button class="secondary" data-action="${target==='face'?'face':'scan-back'}">← Upload instead</button><button id="capture-button" class="primary" data-action="capture" data-target="${target}" disabled>${icon('camera')} Capture photo</button></div>`));
  const status=$('#camera-status');
  try {
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera access needs localhost or a secure HTTPS page.');
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:target==='face'?'user':'environment'},audio:false});
    if(!modal.open||!status.isConnected){stream.getTracks().forEach(t=>t.stop());return;}
    state.stream=stream;
    const video=$('#camera-video');video.srcObject=stream;await video.play();
    if(!video.isConnected){stopCamera();return;}
    $('#camera-view').classList.remove('hidden');status.textContent='Camera ready. Nothing is uploaded.';$('#capture-button').disabled=false;
  } catch(error) {
    stopCamera();if(!status.isConnected)return;
    status.textContent='Your camera couldn’t open.';
    $('#camera-error').innerHTML=`<p class="camera-error">${error.name==='NotAllowedError'?'Camera permission was declined. You can upload a photo or use the demo product instead.':'Your camera is unavailable here. Try uploading a photo, or open this prototype on localhost or HTTPS.'}</p>`;
  }
}
function capturePhoto(target) {
  const video=$('#camera-video');if(!video?.videoWidth||!state.stream){toast('The camera is still getting ready.');return;}
  const side=target==='face'?'face':'front';
  const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d').drawImage(video,0,0);
  const stream=state.stream;
  canvas.toBlob(blob=>{if(!blob||!modal.open||state.stream!==stream)return;stopCamera();receiveUpload(new File([blob],'capture.jpg',{type:'image/jpeg'}),side);},'image/jpeg',.85);
}

function openChat() {
  const p=state.currentProduct;if(!p)return;
  state.returnTo=null;
  if(!state.messages[p.id])state.messages[p.id]=[{role:'assistant',text:`Let’s talk about ${p.name}. I’ve got its example ingredient notes and review themes right here. ${state.profile?'Your saved skin preferences are coming along, too.':'What are you curious about?'}`}];
  showModal(`<div class="chat-shell"><header class="chat-header">${closeButton}<div class="section-label">A little skincare conversation</div><h2>Let’s talk about it.</h2><p>${escapeHTML(p.brand)} · ${escapeHTML(p.name)}</p><div class="chat-context"><span class="pill">${icon('flask')} Product research</span><span class="pill">Review themes</span><button class="pill ${state.profile?'':'coral'}" data-action="chat-profile">${state.profile?'✓ Your skin context':'+ Add my skin context'}</button></div></header><div class="chat-feed" id="chat-feed" aria-live="polite" role="log" aria-label="Product conversation">${!state.profile?`<button class="chat-monster wiggle" data-action="chat-profile">${monster()}<span><strong>I’m hungry for more context!<br>Tell me about your skin. Num num.</strong><small>Feed me a few quick answers ↗</small></span></button>`:''}<div id="messages"></div></div><div class="chat-suggestions">${['Would this suit my skin?','What do the ingredients do?','How could I use it?'].map(text=>`<button data-question="${text}">${text}</button>`).join('')}</div><form class="chat-composer" id="chat-form"><label class="chat-input-row"><input id="chat-input" name="message" aria-label="Ask about this product" placeholder="A little question on your mind?" maxlength="500" autocomplete="off"/><button class="send-button" type="submit" aria-label="Send message">↑</button></label><p class="chat-disclaimer">Scripted demo replies · Educational content, not medical advice</p></form></div>`,'chat-dialog');
  renderMessages();
}
function renderMessages() {
  if(!$('#messages'))return;
  $('#messages').innerHTML=state.messages[state.currentProduct.id].map(m=>`<div class="message ${m.role}"><div class="message-name">${m.role==='user'?'YOU':'SKIMPLE'}</div><p>${escapeHTML(m.text)}</p>${m.source?`<span class="message-source">${escapeHTML(m.source)}</span>`:''}</div>`).join('')+(state.busy?'<div class="message assistant" aria-label="Preparing demo reply"><div class="typing-dots"><i></i><i></i><i></i></div></div>':'');
  $('#chat-feed').scrollTop=$('#chat-feed').scrollHeight;
}
function chatResponse(question,p) {
  const q=question.toLowerCase();
  const context=state.profile?`With your saved context (${profileSummary()}), ${personalFinding(p)}`:'I don’t have your skin preferences yet. Feed the context monster a few details for a more personal perspective.';
  let reply;
  if(/pregnan|diagnos|eczema|rosacea|cancer|prescri|allerg/.test(q))reply='This static demo can’t assess a medical concern or medication compatibility. A qualified clinician or pharmacist can help with those questions. You can still explore the example ingredient notes and reported review themes here.';
  else if(/ingredient|ceramide|niacinamide|science|paper|research/.test(q))reply=p.ingredients.map(key=>`${ingredients[key].name}: ${ingredients[key].finding}`).join(' ')+' These are illustrative ingredient notes. Concentration, the complete formula, and study quality all matter.';
  else if(/review|people|say|pilling|feel|sticky/.test(q))reply=`The fictional review summary is ${p.positive}% positive across ${p.reviews.toLocaleString()} example observations. Common themes include ${p.themes.map(t=>t[0].toLowerCase()).join(', ')}. ${p.caution} Reviews describe experiences, not clinical proof.`;
  else if(/use|routine|layer|often|morning|night/.test(q))reply=`The example category here is ${p.category.toLowerCase()}. ${p.category==='Cleansers'?'A cleanser usually comes before leave-on products.':p.category==='Sunscreens'?'Sunscreen is generally the final skincare step before makeup; follow the label for application and reapplication.':p.category==='Serums'?'A serum generally goes before a moisturizer. Introduce one new product at a time.':'A moisturizer generally follows cleansing and lighter layers.'} ${p.caution} ${context}`;
  else if(/skin|suit|fit|good|dry|oily|sensitive|custom/.test(q))reply=`In this example report, ${p.name} may suit ${p.skin.join(', ').toLowerCase()} skin tendencies. ${context}`;
  else reply=`For “${question}”, here’s the product context this demo can share: ${p.summary} ${p.caution} ${context} You can also ask about ingredients, review themes, or routine placement.`;
  if(state.profile?.extraContext&&!reply.includes(state.profile.extraContext))reply+=` Your extra context is also here: “${state.profile.extraContext}”.`;
  return {role:'assistant',text:reply,source:`Example ${p.brand} product notes${state.profile?' + your saved skin preferences':''} · Scripted demo response`};
}
function sendChat(question) {
  const text=question.trim();if(!text||state.busy)return;
  const p=state.currentProduct;state.messages[p.id].push({role:'user',text});$('#chat-input').value='';state.busy=true;renderMessages();
  later(()=>{state.messages[p.id].push(chatResponse(text,p));state.busy=false;renderMessages();},650);
}
function showStudy(key) {
  const i=ingredients[key];if(!i)return;
  showModal(modalShell(`<div class="step-label"><i></i> An illustrative evidence note</div><h2>${i.study}</h2><p class="intro">${i.name} · ${i.role}</p><span class="pill">${i.confidence} example confidence</span><div class="saved-profile"><h3>What the example finding says</h3><p>${i.finding}</p></div><h3 style="font-size:16px;margin-bottom:10px">The little unknowns</h3><p class="small-copy">${i.limit}</p><div class="source-notice" style="margin-top:20px">This is a dummy research record, not a published paper. A live report would show verified authors, study design, sample size, publication date, DOI or PMID, and a source link.</div><button class="primary full-width" data-action="close">Back to the product →</button>`));
}
function showHow() {
  showModal(modalShell(`<div class="step-label"><i></i> Curiosity looks good on you</div><h2>A little less skincare guesswork.</h2><p class="intro">From a shelf discovery to a conversation that gets your skin.</p><div class="how-steps">${[['Meet a product','Pick a researched product or scan the front and back of something on your shelf.'],['Unpack the little details','Confirm the label, then explore product reviews and ingredient research side by side.'],['Make it more you','Share a few skin preferences, or add a temporary face photo. Only profile text is saved.'],['Talk about it','Ask questions with the product’s research and your saved skin preferences in the conversation.']].map(([title,body],i)=>`<div class="how-step"><span>0${i+1}</span><div><h3>${title}</h3><p>${body}</p></div></div>`).join('')}</div><div class="source-notice">You’re exploring a static UI prototype. Research, label extraction, skin observations, and chat are all simulated. No backend or AI services are connected.</div><button class="primary full-width" data-action="close">Let’s meet the shelf →</button>`));
}

document.addEventListener('click', event=>{
  const skinLink=event.target.closest('[data-skin-scroll]');if(skinLink){event.preventDefault();document.getElementById(skinLink.dataset.skinScroll)?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});return;}
  const filter=event.target.closest('[data-filter]');if(filter){state.filter=filter.dataset.filter;renderShelfGrid();return;}
  const tab=event.target.closest('[data-tab]');if(tab){state.tab=tab.dataset.tab;renderReportTab();return;}
  const suggestion=event.target.closest('[data-question]');if(suggestion){sendChat(suggestion.dataset.question);return;}
  const button=event.target.closest('[data-action]');if(!button)return;
  switch(button.dataset.action) {
    case 'close':closeModal();break;
    case 'how':showHow();break;
    case 'scan':openScan();break;
    case 'scan-back':renderScan();break;
    case 'demo-product':state.scan.front='assets/byoma.svg';state.scan.back='assets/byoma.svg';state.scan.demo=true;renderScan();toast('A demo product is ready for its close-up.');break;
    case 'extract':extractProduct();break;
    case 'profile':openProfile();break;
    case 'update-skin':openProfile(null,true);break;
    case 'add-owned':openProductLookup(button.dataset.query||'');break;
    case 'select-owned':addOwnedProduct(button.dataset.id);break;
    case 'lookup-scan':openScan();break;
    case 'remove-owned':state.owned.delete(button.dataset.id);persistOwnedProducts();renderPersonalSections();toast('Removed from your products. Your research stays on the main shelf.');break;
    case 'toggle-owned':if(state.owned.has(button.dataset.id)){state.owned.delete(button.dataset.id);persistOwnedProducts();renderDetail(state.currentProduct);toast('Removed from your products.');}else addOwnedProduct(button.dataset.id);break;
    case 'scan-profile':openProfile('scan');break;
    case 'scan-customize':state.returnTo='scan';renderFace();break;
    case 'edit-profile':renderQuestionnaire();break;
    case 'return':returnFromProfile();break;
    case 'face':renderFace();break;
    case 'replace-face':releaseURL(state.faceUrl);state.faceUrl=null;renderFace();break;
    case 'demo-face':state.faceUrl='assets/demo-face.svg';renderFace();break;
    case 'forget-profile':state.profile=null;try{localStorage.removeItem('skimple.profile');}catch{}updateProfileLabel();route();returnFromProfile();toast('Your skin story has been cleared from this browser.');break;
    case 'product-camera':openCamera('product');break;
    case 'face-camera':openCamera('face');break;
    case 'capture':capturePhoto(button.dataset.target);break;
    case 'chat':openChat();break;
    case 'chat-profile':clearTimers();openProfile('chat',true);break;
    case 'study':showStudy(button.dataset.ingredient);break;
    case 'save':{
      const id=button.dataset.id;if(state.saved.has(id))state.saved.delete(id);else state.saved.add(id);writeStorage('skimple.saved',[...state.saved]);
      if(location.hash==='#skin')renderPersonalSections();else if(state.currentProduct)renderDetail(state.currentProduct);else renderShelfGrid();
      toast(state.saved.has(id)?'A little favorite, saved to your shelf.':'Removed from your favorites.');break;
    }
  }
});
document.addEventListener('keydown',event=>{if(event.target.id==='owned-search')handleLookupKey(event);});
document.addEventListener('input', event=>{if(event.target.id==='owned-search')renderLookupResults(event.target.value);if(event.target.id==='product-search'){state.search=event.target.value;renderShelfGrid();}});
document.addEventListener('change', event=>{if(event.target.dataset.upload)receiveUpload(event.target.files[0],event.target.dataset.upload);});
document.addEventListener('submit', event=>{
  const form=event.target;
  if(!['confirm-product','skin-form','skin-page-form','face-form','chat-form'].includes(form.id))return;
  event.preventDefault();
  if(form.id==='skin-form'||form.id==='skin-page-form')saveProfile(form);
  if(form.id==='confirm-product'){
    const data=Object.fromEntries(new FormData(form));Object.keys(data).forEach(key=>data[key]=data[key].trim());
    if(!data.brand||!data.name||!data.inci){toast('Please add a brand, product name, and ingredient list.');return;}
    startAnalysis(data);
  }
  if(form.id==='face-form'&&state.faceUrl&&new FormData(form).has('consent'))processFace();
  if(form.id==='chat-form')sendChat(new FormData(form).get('message')||'');
});
document.addEventListener('dragover',event=>{if(event.target.closest('.upload-zone'))event.preventDefault();});
document.addEventListener('drop',event=>{const zone=event.target.closest('.upload-zone');if(!zone)return;event.preventDefault();receiveUpload(event.dataTransfer.files[0],$('input',zone).dataset.upload);});
window.addEventListener('pagehide',()=>{stopCamera();state.urls.forEach(url=>URL.revokeObjectURL(url));});
route();
