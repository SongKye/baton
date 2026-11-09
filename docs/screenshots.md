# README screenshots

The README images show the real UI from `public/`, with fictional projects,
sessions and usage numbers. They are illustrative screenshots, not a live demo.
English and Korean captures use the Forest light theme at 1440 × 1080 (desktop)
and 390 × 844 (mobile).

To refresh all four images, install Chrome and provide an existing
`playwright-core` installation, as with `scripts/smoke.cjs`:

```bash
node scripts/readme-screenshots.cjs /path/to/playwright-core
```

The script writes `docs/images/{desktop,mobile}-{en,ko}.png`. It serves local UI
files through Playwright request interception and supplies fixed example API
responses. It does not start Baton or access real sessions, settings or CLIs.
The only external requests allowed are the UI's font assets on jsDelivr.

Review both languages after capture. The script checks page errors, missing
fixtures/assets and horizontal overflow. Keep the example-data captions in both
READMEs when updating images.
