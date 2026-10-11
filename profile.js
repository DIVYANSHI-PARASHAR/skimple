/* The personal skin space. Product lookup uses the live catalog and saved reports. */

function hasSkinAnswers() {
  return Boolean(state.profile?.feel?.length && state.profile?.goals?.length);
}

function skinQuestionnaireMarkup(profile, inPage = false) {
  const p = profile || {};
  const question = (name, title, choices, multiple = true) => `
    <fieldset class="question">
      <legend>${title} ${multiple ? '<span>Pick any that fit.</span>' : ''}</legend>
      <div class="choices">${choices.map(choice => `
        <label class="choice"><input type="${multiple ? 'checkbox' : 'radio'}" name="${name}"
          value="${escapeHTML(choice)}" ${(p[name] || []).includes(choice) ? 'checked' : ''}/><span>${choice}</span></label>`).join('')}
      </div>
    </fieldset>`;
  const contextId = inPage ? 'page-extra-context' : 'extra-context';
  return `<form id="${inPage ? 'skin-page-form' : 'skin-form'}" ${inPage ? 'class="page-questionnaire"' : ''}>
    <div class="skin-question-grid">
      ${question('feel', 'After washing, your skin usually feels…', ['Dry & tight', 'Oily', 'Combination', 'Comfortable', 'Not sure'], false)}
      ${question('sensitivities', 'Anything your skin tends to dislike?', ['Fragrance', 'Strong actives', 'New products', 'Nothing I know of'])}
      ${question('goals', 'What would you love a little help with?', ['Hydration', 'Blemishes', 'Uneven tone', 'Barrier support', 'Sun protection'])}
      ${question('routine', 'What’s already in your routine?', ['Cleanser', 'Moisturizer', 'Sunscreen', 'Retinoid', 'Exfoliating acids', 'Keeping it simple'])}
    </div>
    <div class="form-field more-context"><label for="${contextId}">Tell me more! <span>Anything else your skin wants us to know?</span></label>
      <textarea id="${contextId}" name="extraContext" maxlength="1500" placeholder="That one product you loved, a texture you can’t stand, a routine you’re trying…">${escapeHTML(p.extraContext || '')}</textarea>
    </div>
    <div id="${inPage ? 'page-profile-error' : 'profile-error'}" data-profile-error class="error-message" role="alert"></div>
    <button type="button" class="text-button" data-action="face">${icon('camera')}${p.hasPhoto ? 'Update my temporary face photo' : 'Or add a temporary face photo'} ↗</button>
    <div class="modal-actions">${!inPage && state.returnTo ? '<button type="button" class="secondary" data-action="return">← Go back</button>' : ''}
      <button class="primary" type="submit">${inPage ? 'Meet my skin space →' : 'Feed the context monster ♡'}</button>
    </div>
  </form>`;
}

function skinSidebar() {
  const p = state.profile;
  return `<aside class="skin-sidebar">
    <div class="skin-story">
      <div class="skin-story-art wiggle">${monster()}<span class="story-spark" aria-hidden="true">✧</span></div>
      <div class="section-label">A little snapshot of you</div>
      <h2>${escapeHTML(p.feel[0] === 'Not sure' ? 'Still getting to know your skin.' : `${p.feel[0]} & wonderfully you.`)}</h2>
      <div class="skin-story-tags">${p.goals.map(goal => `<span class="pill">${escapeHTML(goal)}</span>`).join('')}</div>
      <p>${p.sensitivities?.length && !p.sensitivities.includes('Nothing I know of') ? `Keeping an eye on ${escapeHTML(p.sensitivities.join(', ').toLowerCase())}.` : 'Your preferences, your pace. We’re getting to know your skin together.'}</p>
      ${p.extraContext ? `<div class="skin-extra-note"><span>Your extra little context</span><p>${escapeHTML(p.extraContext)}</p></div>` : ''}
      ${p.hasPhoto ? `<div class="skin-photo-note">${icon('shield')}Photo discarded. Text context kept.</div>` : ''}
      <button class="secondary full-width" data-action="update-skin">Update my skin profile ↗</button>
    </div>
    <p class="skin-sidebar-note">Skin changes. Your little profile can, too.</p>
    <button class="delete-profile" data-action="forget-profile">Clear my saved skin profile</button>
  </aside>`;
}

function renderSkinPage() {
  state.currentProduct = null;
  $('.site-header .nav-link').classList.remove('active');
  const ready = hasSkinAnswers();
  $('#app').innerHTML = `<div class="skin-page">
    ${ready ? `<div class="skin-layout"><div class="skin-workspace">
      <nav class="skin-section-nav" aria-label="Your skin space sections"><a href="#skin" data-skin-scroll="my-products"><span>01</span> My products</a><a href="#skin" data-skin-scroll="my-watchouts"><span>02</span> Ingredient watch-outs</a><a href="#skin" data-skin-scroll="my-routine"><span>03</span> My routine</a></nav>
      <section id="my-products" class="skin-section" aria-labelledby="my-products-title"></section>
      <section id="my-watchouts" class="skin-section" aria-labelledby="watchouts-title"></section>
      <section id="my-routine" class="skin-section" aria-labelledby="routine-title"></section>
    </div>${skinSidebar()}</div>` : `<div class="skin-onboarding">
      <section class="skin-questions" aria-labelledby="skin-hello-title">
        <h1 id="skin-hello-title">Feed me a little context.</h1>
        ${skinQuestionnaireMarkup(state.profileDraft || state.profile, true)}
      </section>
      <aside class="skin-onboarding-aside"><div class="wiggle">${monster()}</div><h2>Num num.<br>Good context, happy skin.</h2><p>Your answers help connect the little dots.</p>
        <ol><li><span>01</span><div><strong>Your very own shelf</strong><p>Just the products you actually use.</p></div></li><li><span>02</span><div><strong>A few little watch-outs</strong><p>Ingredients to be mindful of.</p></div></li><li><span>03</span><div><strong>Good morning. Good night.</strong><p>A simple place for every step.</p></div></li></ol>
        <span class="onboarding-note">No perfect answers needed. Just you. ♡</span>
      </aside>
    </div>`}
  </div>`;
  if (ready) renderPersonalSections();
}

function ownedProducts() {
  return state.products.filter(product => state.owned.has(product.id));
}

function addProductTile() {
  return `<button class="scan-tile add-product-tile" data-action="add-owned"><span class="tile-star" aria-hidden="true">✧</span>
    <svg class="bottle-outline" viewBox="0 0 100 110" fill="none" aria-hidden="true"><path d="M39 11h23v17H39zM34 28h34v13H34zM36 41q-12 7-12 21v32q0 7 8 7h38q8 0 8-7V62q0-14-12-21" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 4"/><path d="M40 74h22m-11-11v22" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
    <h3>Make room for<br>a shelf mate.</h3><span class="scan-cta"><span>+</span> Add product</span></button>`;
}

function renderPersonalSections() {
  if (!$('#my-products')) return;
  const products = ownedProducts();
  $('#my-products').innerHTML = `<div class="skin-section-heading"><div><h1 id="my-products-title">My products<span class="skin-count">${products.length}</span></h1></div>${products.length ? '<button class="text-button" data-action="add-owned">+ Add product</button>' : ''}</div>
    <div class="product-grid owned-product-grid">${products.map((p, index) => `<div class="owned-product">${productCard(p, index)}<div class="owned-product-meta"><span>${icon('check')} In my routine</span><button data-action="remove-owned" data-id="${escapeHTML(p.id)}" aria-label="Remove ${escapeHTML(p.name)} from my products">Remove</button></div></div>`).join('')}${addProductTile()}
    ${!products.length ? `<div class="empty-personal-shelf"><span class="empty-shelf-spark" aria-hidden="true">✳</span><h3>A little shelf, waiting for you.</h3><p>Your cleanser, that trusty moisturizer, your daily SPF…<br>Start with one product you’re already using.</p><span class="hand-note">your favorites deserve a home ♡</span></div>` : ''}</div>`;
  $('#my-watchouts').innerHTML = watchoutsMarkup(products);
  $('#my-routine').innerHTML = routineMarkup(products);
}

function watchoutsMarkup(products) {
  const sensitivities = state.profile.sensitivities || [];
  const watches = [];
  if (sensitivities.includes('Fragrance')) watches.push({name:'Fragrance / parfum',tag:'Your reported sensitivity',reason:'You told us fragrance can be a trigger. This flags fragrance labels for a closer look.',pattern:/\b(parfum|fragrance)\b/i,tip:'Look for “parfum” or “fragrance” on the complete label.'});
  if (sensitivities.includes('Strong actives')) watches.push({name:'High-strength active formulas',tag:'A little extra caution',reason:'You reported discomfort with strong actives. This highlights the 10% niacinamide serum for a tolerance check, not a blanket ingredient ban.',pattern:/niacinamide 10%/i,tip:'Strength and the whole formula matter. Niacinamide is not automatically something to avoid.'});
  if (sensitivities.includes('New products')) watches.push({name:'New-to-you ingredients',tag:'Go one little step at a time',reason:'You told us new products can be tricky. Your answers don’t identify a specific ingredient allergy.',pattern:null,tip:'Keep track of which product you added and how your skin felt.'});
  return `<div class="skin-section-heading"><div><h2 id="watchouts-title">Ingredients to watch out for.</h2></div><span class="watchout-doodle" aria-hidden="true">✧</span></div>
    ${watches.length ? `<div class="watchout-list">${watches.map((watch, index) => {
      const matches = watch.pattern ? products.filter(p => watch.pattern.test(`${p.name} ${p.inci}`)) : [];
      return `<article class="watchout-row"><span class="watchout-number">0${index + 1}</span><div><div class="watchout-title"><h3>${watch.name}</h3><span class="pill yellow">${watch.tag}</span></div><p>${watch.reason}</p><p class="watchout-tip">${watch.tip}</p>
        <div class="watchout-products">${matches.length ? matches.map(p => `<a href="#product/${encodeURIComponent(p.id)}">${icon('flask')} Check ${escapeHTML(p.brand)} ${escapeHTML(p.name)} ↗</a>`).join('') : `<span>${watch.pattern ? products.length ? 'No match in the stored formulas. Check your own packaging for regional differences or formula updates.' : 'Add your products to check their labels here.' : 'No specific ingredient is identified from this answer alone.'}</span>`}</div>
      </div></article>`;
    }).join('')}</div>` : `<div class="no-watchouts"><span aria-hidden="true">♡</span><div><h3>No specific avoid list, just yet.</h3><p>Your answers don’t establish an ingredient reaction. We won’t invent one from your skin type. You can update your preferences as you learn more.</p></div><button class="text-button" data-action="update-skin">Add a little context ↗</button></div>`}
    <p class="small-copy watchout-footnote">Watch-outs reflect your reported sensitivities and stored formulas. They do not diagnose allergies or establish compatibility.</p>`;
}

function routineMarkup(products) {
  const find = category => products.find(p => p.category === category);
  const dry = state.profile.feel.includes('Dry & tight');
  const step = (number, title, category, detail, optional = false) => {
    const p = find(category);
    return `<li class="routine-step"><span class="routine-step-number">${number}</span><div class="routine-step-content"><div class="routine-step-title"><h4>${title}</h4>${optional ? '<span>optional</span>' : ''}</div>
      ${p ? `<a class="routine-product" href="#product/${encodeURIComponent(p.id)}"><img src="assets/${p.asset}.svg" alt="" width="40" height="48"/><span><strong>${escapeHTML(p.name)}</strong><small>${escapeHTML(p.brand)}</small></span><span aria-hidden="true">↗</span></a>` : `<button class="routine-add" data-action="add-owned" data-query="${category}">+ Choose ${category === 'Sunscreens' ? 'a sunscreen' : category === 'Moisturizers' ? 'a moisturizer' : category === 'Serums' ? 'a serum' : 'a cleanser'} from your shelf</button>`}
      <p>${detail}</p></div></li>`;
  };
  return `<div class="skin-section-heading"><div><h2 id="routine-title">A little AM. A little PM.</h2></div></div>
    <div class="routine-columns"><article class="routine-panel morning"><header><span class="routine-sun" aria-hidden="true">☼</span><div><div class="section-label">Rise & shine</div><h3>Good morning, skin.</h3></div><span class="routine-time">AM</span></header><ol>
      ${step(1, 'A fresh little start', 'Cleansers', dry ? 'Keep this step gentle; your profile mentions a tight, dry feel.' : 'Start gently and follow your product’s directions.', true)}
      ${step(2, 'A little hydration', 'Moisturizers', `Your ${escapeHTML(state.profile.goals.join(' and ').toLowerCase())} goals stay in the picture.`)}
      ${step(3, 'Hello, daily SPF', 'Sunscreens', 'Follow the sunscreen label for application and reapplication.')}
    </ol></article><article class="routine-panel evening"><header><span class="routine-moon" aria-hidden="true">☾</span><div><div class="section-label">Slow down & settle in</div><h3>Good night, skin.</h3></div><span class="routine-time">PM</span></header><ol>
      ${step(1, 'Wash the day away', 'Cleansers', 'A gentle cleanse before your leave-on steps.')}
      ${step(2, 'Your little extra', 'Serums', 'Optional. Check the product label and your watch-outs before layering.', true)}
      ${step(3, 'A cozy final layer', 'Moisturizers', 'Finish with the amount that feels comfortable for your skin.')}
    </ol></article></div><p class="small-copy routine-footnote">An illustrative routine, not a treatment plan. Missing products stay as open slots; your extra notes are carried into product chats.</p>`;
}

function persistOwnedProducts() {
  writeStorage('skimple.owned', [...state.owned]);
}

function addOwnedProduct(id) {
  const product = state.products.find(p => p.id === id);
  if (!product || state.owned.has(id)) return;
  state.owned.add(id);
  persistOwnedProducts();
  if (location.hash === '#skin') renderPersonalSections();
  else if (state.currentProduct) renderDetail(state.currentProduct);
  closeModal();
  toast(`${product.name} has a little home on your shelf.`);
}

function openProductLookup(query = '') {
  state.lookupIndex = -1;
  showModal(modalShell(`<div class="step-label"><i></i> Your shelf, your actual favorites</div><h2>Add something you use.</h2><p class="intro">Type a product or brand, then pick your shelf mate. Choosing it confirms it’s part of your routine.</p>
    <label class="lookup-label" for="owned-search">Find your product</label><div class="lookup-search">${icon('search')}<input id="owned-search" type="text" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="product-options" aria-describedby="lookup-help" placeholder="Try CeraVe, BYOMA, or sunscreen…" autocomplete="off" maxlength="100" value="${escapeHTML(query)}" autofocus/></div>
    <div id="lookup-status" class="lookup-status" role="status"></div><div id="product-options" class="lookup-options" role="listbox" aria-label="Example product search results"></div>
    <p id="lookup-help" class="small-copy lookup-help">Example search results · No live web search.<br>Use ↑ ↓ and Enter to pick a product.</p><div class="lookup-bottom"><p>Not on our little shelf yet?</p><button class="text-button" data-action="lookup-scan">Scan a product instead ↗</button></div>`));
  renderLookupResults(query);
}

function renderLookupResults(query = '') {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = state.products.filter(p => terms.every(term => `${p.brand} ${p.name} ${p.category} ${p.kind}`.toLowerCase().includes(term)));
  state.lookupResults = matches;
  state.lookupIndex = -1;
  $('#owned-search').removeAttribute('aria-activedescendant');
  $('#lookup-status').textContent = `${matches.length} example ${matches.length === 1 ? 'match' : 'matches'}${query.trim() ? ' for your little search' : ' to get you started'}.`;
  $('#product-options').innerHTML = matches.length ? matches.map((p, i) => `<button class="lookup-option" id="lookup-option-${i}" role="option" aria-selected="false" ${state.owned.has(p.id) ? 'aria-disabled="true"' : ''} data-action="select-owned" data-id="${escapeHTML(p.id)}" data-index="${i}" tabindex="-1"><span class="lookup-thumbnail" style="--card-color:${p.color}"><img src="assets/${p.asset}.svg" alt="" width="48" height="64"/></span><span class="lookup-product-name"><small>${escapeHTML(p.brand)}</small><strong>${escapeHTML(p.name)}</strong><span>${escapeHTML(p.category)}</span></span><span class="lookup-add">${state.owned.has(p.id) ? 'On your shelf ✓' : '+'}</span></button>`).join('') : `<div class="lookup-empty"><span aria-hidden="true">✧</span><h3>No little match just yet.</h3><p>Try another brand or product name,<br>or scan the product you have.</p><button class="text-button" data-action="lookup-scan">Try a product scan ↗</button></div>`;
}

function handleLookupKey(event) {
  if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
  event.preventDefault();
  const selectable = (state.lookupResults || []).map((p, index) => ({p, index})).filter(({p}) => !state.owned.has(p.id));
  if (!selectable.length) return;
  if (event.key === 'Enter') {
    const selected = state.lookupResults[state.lookupIndex];
    if (selected && !state.owned.has(selected.id)) addOwnedProduct(selected.id);
    return;
  }
  const current = selectable.findIndex(item => item.index === state.lookupIndex);
  const next = event.key === 'ArrowDown' ? (current + 1) % selectable.length : (current <= 0 ? selectable.length - 1 : current - 1);
  state.lookupIndex = selectable[next].index;
  $$('.lookup-option').forEach(option => option.setAttribute('aria-selected', Number(option.dataset.index) === state.lookupIndex ? 'true' : 'false'));
  const option = $(`#lookup-option-${state.lookupIndex}`);
  $('#owned-search').setAttribute('aria-activedescendant', option.id);
  option.scrollIntoView({block:'nearest'});
}
