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
6. Edit or clear your profile from the header. Profile preferences carry into future products and chats.

## Data and privacy behavior

- Extraction, evidence, review counts, observations, and chat are **clearly labeled dummy content**. Study cards are illustrative records, not fabricated citations. Edited labels do not change the underlying research fixture.
- Photos use temporary object URLs in the current tab. No photo is uploaded, converted into persistent storage, or sent to an AI. Face previews are revoked immediately on continuing; all remaining image URLs are revoked on dialog close. Camera tracks stop on capture, switching screens, dismissal, and page exit.
- Only questionnaire text, illustrative observation text, a photo-completed flag, bookmarks, and edited demo product labels persist in browser `localStorage`. Chat history stays in memory for the visit. Clearing the skin profile removes its local record.
- Google Fonts supplies optional typography; local system fonts are the fallback. All product illustrations and the monster are original, local SVGs. There are no analytics or service calls.

## Test

The UI has no runtime dependencies. Playwright is a development-only test dependency:

```sh
npm install
npx playwright install chromium
# Start the preview in another terminal, then:
npm test
```

The journey tests cover filtering, searching, bookmarks, report tabs, research dialogs, questionnaire validation, contextual scripted chat, upload validation, face consent and object-URL disposal, text-only persistence, the full scan-to-report flow, profile deletion, cancelled timers, camera fallback/capture/track cleanup, keyboard dialog focus, and overflow at 390, 768, 1024, and 1440 pixels. Screenshots are written to ignored `test-results/`.

Override the preview URL with `BASE_URL` and screenshot location with `SCREENSHOT_DIR`. Respect reduced-motion settings; native dialogs provide focus trapping and Escape dismissal.

## Files

- `index.html`: document shell and navigation.
- `styles.css`: responsive design, colors, component styles, and reduced-motion-aware animation.
- `app.js`: dummy catalog, hash routing, prototype flows, local preferences, and scripted chat.
- `assets/`: local packaging illustrations, hero artwork, demo face, and favicon.
- `tests/journey.cjs`: browser-level journey regression checks.
