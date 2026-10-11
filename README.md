# skimple

A playful, responsive **HTML/CSS/vanilla JavaScript prototype** of the skincare journey in [the implementation plan](skincare_ai_implementation_plan.md). There is no application backend, AI, live research, account system, or build step.

## Preview

Open `index.html` directly, or run:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Visit http://localhost:4173. Camera access requires localhost or HTTPS, browser permission, and an available camera. Uploads and demo fixtures work without a camera.

## Walk through the journey

1. Browse six researched products. Filter by category, search, and bookmark favorites.
2. Open a product to explore its overview, skin fit, ingredient evidence, review themes, and illustrative research notes.
3. Choose **Scan a product**. Upload front/back photos, capture with your camera, or try the demo. Review and edit the sample extracted identity and ingredients, then watch the simulated research progress. Your new report opens and the product joins the shelf.
4. Choose **Customize for my skin** in the scan popup. Upload/capture a temporary face photo, try the illustrated demo face, or complete the quick questionnaire. A photo does not determine skin type or diagnose a condition.
5. Choose **Talk about it** on a product. The context monster invites users without a profile to answer quick questions. Scripted replies combine the selected product’s fixtures with saved skin preferences.
6. Open **My Skin Profile** in the header to visit your personal skin page (`#skin`). First-time visitors answer the quick questions directly on the page, including an optional **Tell me more!** text box. A photo alone does not skip the questions.
7. Once answered, explore **My Products**, **Ingredients to watch out for**, and **AM/PM routines**. Use the sidebar’s **Update my skin profile** button to edit answers and extra context; these notes also carry into scripted product chats.
8. Choose **Add product**, type a name/brand/category, and select an example search result. Arrow keys and Enter also work. This is a local search fixture for the planned Nimble lookup; it makes no web request. Only products explicitly added here or confirmed with **I use this product** appear in My Products. Bookmarks remain separate.
9. Remove products directly from your personal shelf. Routine slots update to use confirmed products in the relevant categories, and stay visibly empty when a category is missing. Watch-outs reflect reported sensitivities and example label matches; unknown reactions are not invented.

## Data and privacy behavior

- Extraction, evidence, review counts, observations, and chat are **clearly labeled dummy content**. Study cards are illustrative records, not fabricated citations. Edited labels do not change the underlying research fixture.
- Photos use temporary object URLs in the current tab. No photo is uploaded, converted into persistent storage, or sent to an AI. Face previews are revoked immediately on continuing; all remaining image URLs are revoked on dialog close. Camera tracks stop on capture, switching screens, dismissal, and page exit.
- Only questionnaire/extra-context text, illustrative observation text, a photo-completed flag, bookmarks, confirmed product IDs, and edited demo product labels persist in browser `localStorage`. Chat history stays in memory for the visit. Clearing the skin profile removes its local record and restores the question-first page; the independently confirmed product list remains.
- Google Fonts supplies optional typography; local system fonts are the fallback. All product illustrations and the monster are original, local SVGs. There are no analytics or service calls.

## Test

The UI has no runtime dependencies. Playwright is a development-only test dependency:

```sh
npm install
npx playwright install chromium
# Start the preview in another terminal, then:
npm test
```

The journey tests cover filtering, searching, bookmarks, report tabs, research dialogs, questionnaire validation, contextual scripted chat, upload validation, face consent and object-URL disposal, text-only persistence, the full scan-to-report flow, profile deletion, cancelled timers, camera fallback/capture/track cleanup, and keyboard dialog focus. The personal-page tests cover first-visit onboarding, extra context, profile editing, simulated keyboard search, duplicate prevention, product ownership/removal, sensitivity-based watch-outs, routine gaps, escaped free text, persistence, and responsive overflow from 320 to 1440 pixels. Screenshots are written to ignored `test-results/`.

Override the preview URL with `BASE_URL` and screenshot location with `SCREENSHOT_DIR`. Respect reduced-motion settings; native dialogs provide focus trapping and Escape dismissal.

## Files

- `index.html`: document shell and navigation.
- `styles.css`: responsive design, colors, component styles, and reduced-motion-aware animation.
- `app.js`: dummy catalog, hash routing, prototype flows, local preferences, and scripted chat.
- `profile.js` / `profile.css`: personal skin page, shared questionnaire, owned-product search, illustrative watch-outs, and routines using the same design tokens and product cards.
- `assets/`: local packaging illustrations, hero artwork, demo face, and favicon.
- `tests/journey.cjs`: browser-level journey regression checks.
- `tests/profile.cjs`: personal skin-page browser checks (`npm run test:profile`).
