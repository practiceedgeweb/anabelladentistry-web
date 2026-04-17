// Stage 6 — Visual-diff the local build against the live site.
//
// Requires `npm run preview` (or `npm run dev`) to be running on :4321.
// For every URL in tools/snapshot/urls.json, screenshots the live page and the
// matching local route at 3 widths, pixelmatches them, and writes
// tools/snapshot/diff-report.html.

import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { SNAPSHOT, SITE_ORIGIN, slugFromUrl } from './config.mjs';

const LOCAL_ORIGIN = process.env.LOCAL_ORIGIN || 'http://localhost:4321';
const WIDTHS = [375, 768, 1440];
const DIFFS_DIR = path.join(SNAPSHOT, 'diffs');
await fs.mkdir(DIFFS_DIR, { recursive: true });

const urls = JSON.parse(await fs.readFile(path.join(SNAPSHOT, 'urls.json'), 'utf8'));

const browser = await chromium.launch();
const rows = [];

for (const url of urls) {
  const slug = slugFromUrl(url);
  const localPath = new URL(url).pathname;
  const localUrl = LOCAL_ORIGIN + localPath;
  for (const w of WIDTHS) {
    const liveBuf = await capture(browser, url, w).catch((e) => {
      console.warn(`[verify] live ${url} w${w}: ${e.message}`);
      return null;
    });
    const localBuf = await capture(browser, localUrl, w).catch((e) => {
      console.warn(`[verify] local ${localUrl} w${w}: ${e.message}`);
      return null;
    });
    if (!liveBuf || !localBuf) {
      rows.push({ url, w, status: 'error' });
      continue;
    }
    const live = PNG.sync.read(liveBuf);
    const local = PNG.sync.read(localBuf);
    const height = Math.min(live.height, local.height);
    const width = Math.min(live.width, local.width);
    const diff = new PNG({ width, height });
    const diffPixels = pixelmatch(
      cropToSize(live, width, height),
      cropToSize(local, width, height),
      diff.data,
      width,
      height,
      { threshold: 0.1 },
    );
    const totalPixels = width * height;
    const pct = (diffPixels / totalPixels) * 100;
    const outBase = `${slug}-w${w}`;
    await fs.writeFile(path.join(DIFFS_DIR, `${outBase}-live.png`), liveBuf);
    await fs.writeFile(path.join(DIFFS_DIR, `${outBase}-local.png`), localBuf);
    await fs.writeFile(
      path.join(DIFFS_DIR, `${outBase}-diff.png`),
      PNG.sync.write(diff),
    );
    rows.push({ url, w, pct, status: pct < 3 ? 'pass' : 'fail', file: outBase });
    console.log(`[verify] ${outBase} diff=${pct.toFixed(2)}%`);
  }
}
await browser.close();

// Render a tiny HTML report
const html = `<!doctype html><meta charset="utf-8"><title>Diff Report</title>
<style>
  body { font: 14px system-ui; margin: 2rem; }
  table { border-collapse: collapse; width: 100%; }
  td, th { padding: 8px 12px; border-bottom: 1px solid #eee; text-align: left; }
  tr.fail { background: #fff1f0; }
  tr.pass { background: #f6ffed; }
  img { width: 180px; border: 1px solid #ddd; }
</style>
<h1>Migration Visual Diff</h1>
<p>${rows.length} checks. ${rows.filter((r) => r.status === 'pass').length} pass, ${rows.filter((r) => r.status === 'fail').length} fail.</p>
<table>
  <tr><th>URL</th><th>Width</th><th>Diff %</th><th>Status</th><th>Live</th><th>Local</th><th>Diff</th></tr>
  ${rows
    .map(
      (r) =>
        `<tr class="${r.status}"><td>${r.url}</td><td>${r.w}</td><td>${r.pct?.toFixed(2) ?? '-'}</td><td>${r.status}</td>` +
        (r.file
          ? `<td><img src="diffs/${r.file}-live.png"></td>
             <td><img src="diffs/${r.file}-local.png"></td>
             <td><img src="diffs/${r.file}-diff.png"></td>`
          : '<td></td><td></td><td></td>') +
        `</tr>`,
    )
    .join('\n')}
</table>`;
await fs.writeFile(path.join(SNAPSHOT, 'diff-report.html'), html, 'utf8');

async function capture(browser, url, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  const buf = await page.screenshot({ fullPage: true });
  await ctx.close();
  return buf;
}

function cropToSize(png, w, h) {
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    png.data.copy(out, y * w * 4, y * png.width * 4, y * png.width * 4 + w * 4);
  }
  return out;
}
