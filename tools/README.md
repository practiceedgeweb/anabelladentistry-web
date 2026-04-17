# Migration Toolchain

Automated, repeatable pipeline for mirroring `https://www.anabelladentistry.com/` into this Astro project.

## One-time setup

```bash
cd tools
npm install           # installs cheerio, undici, p-limit, sharp, pixelmatch, pngjs, playwright
npx playwright install chromium
```

## The pipeline

```bash
npm run migrate:crawl      # Stage 1 — capture all HTML to tools/snapshot/
npm run migrate:assets     # Stage 2 — mirror images to public/assets/
npm run migrate:extract    # Stage 3 — HTML -> src/data/pages/<slug>.json
npm run migrate:generate   # Stage 4 — JSON -> src/pages/<route>/index.astro
npm run migrate:verify     # Stage 6 — visual diff against live site
```

Each stage is idempotent. Re-running should produce a byte-identical result. See `MIGRATION_CRITIQUE_AND_PLAN_v2.md` in the repo root for the full rationale.

## Outputs

| Path | Produced by | Purpose |
|---|---|---|
| `tools/snapshot/*.html` | crawl | Raw HTML of every discovered URL |
| `tools/snapshot/urls.json` | crawl | Canonical list of site URLs |
| `tools/snapshot/assets.json` | crawl | Every referenced wp-content image |
| `tools/snapshot/asset-map.json` | download-assets | Maps live URL → local `/assets/...` |
| `tools/snapshot/migration-manifest.csv` | extract | Per-page status spreadsheet |
| `src/data/site.json` | extract | Nav, footer, hours, address, testimonials |
| `src/data/pages/*.json` | extract | One JSON per page |
| `src/pages/**/index.astro` | generate | One Astro route per page |
| `tools/snapshot/diff-report.html` | verify | Visual diff report |
