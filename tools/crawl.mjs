// Stage 1 — Crawl anabelladentistry.com and capture every reachable on-site HTML page
// + every referenced wp-content asset URL.
//
// Writes:
//   tools/snapshot/<slug>.html
//   tools/snapshot/urls.json
//   tools/snapshot/assets.json

import fs from 'node:fs/promises';
import path from 'node:path';
import { request } from 'undici';
import { load } from 'cheerio';
import pLimit from 'p-limit';
import {
  SITE_ORIGIN,
  SNAPSHOT,
  MAX_DEPTH,
  CONCURRENCY,
  USER_AGENT,
  shouldCrawl,
  slugFromUrl,
} from './config.mjs';

await fs.mkdir(SNAPSHOT, { recursive: true });

const visited = new Set();
const assets = new Set();
const queue = [{ url: SITE_ORIGIN + '/', depth: 0 }];
const limit = pLimit(CONCURRENCY);

function normalize(u, base) {
  try {
    const absolute = new URL(u, base).toString();
    // strip fragments and trailing query strings we don't care about
    const url = new URL(absolute);
    url.hash = '';
    // keep path, drop query string entirely — WP content pages don't rely on it
    url.search = '';
    // normalize trailing slash
    if (!url.pathname.endsWith('/') && !/\.[a-z0-9]+$/i.test(url.pathname)) {
      url.pathname += '/';
    }
    return url.toString();
  } catch {
    return null;
  }
}

async function fetchPage(url) {
  const res = await request(url, {
    method: 'GET',
    headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
    maxRedirections: 5,
  });
  if (res.statusCode >= 400) {
    throw new Error(`HTTP ${res.statusCode} for ${url}`);
  }
  const body = await res.body.text();
  return body;
}

async function processOne(url, depth) {
  if (visited.has(url)) return;
  visited.add(url);

  let html;
  try {
    html = await fetchPage(url);
  } catch (err) {
    console.warn(`[crawl] skipped ${url}: ${err.message}`);
    return;
  }

  // Save snapshot
  const slug = slugFromUrl(url) ?? 'unknown';
  const outfile = path.join(SNAPSHOT, `${slug}.html`);
  await fs.writeFile(outfile, html, 'utf8');
  console.log(`[crawl] ${depth} ${url} -> ${path.basename(outfile)}`);

  // Parse for more links and assets
  const $ = load(html);

  // Assets: any img[src], link[href] with preload, CSS url()s inside <style>/style attrs
  $('img').each((_, el) => {
    const src = $(el).attr('src');
    if (src) {
      const abs = normalize(src, url);
      if (abs && /wp-content|dental\.inceptionimages\.com/.test(abs)) assets.add(abs);
    }
    const srcset = $(el).attr('srcset');
    if (srcset) {
      srcset.split(',').forEach((part) => {
        const asset = part.trim().split(/\s+/)[0];
        const abs = normalize(asset, url);
        if (abs && /wp-content|dental\.inceptionimages\.com/.test(abs)) assets.add(abs);
      });
    }
  });
  $('[style]').each((_, el) => {
    const style = $(el).attr('style') || '';
    const matches = style.matchAll(/url\(['"]?([^'")]+)['"]?\)/g);
    for (const m of matches) {
      const abs = normalize(m[1], url);
      if (abs && /wp-content|dental\.inceptionimages\.com/.test(abs)) assets.add(abs);
    }
  });

  if (depth >= MAX_DEPTH) return;

  // Enqueue anchor hrefs on this site
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const abs = normalize(href, url);
    if (!abs) return;
    if (!shouldCrawl(abs)) return;
    if (visited.has(abs)) return;
    queue.push({ url: abs, depth: depth + 1 });
  });
}

// Drain queue with bounded concurrency
while (queue.length > 0) {
  const batch = queue.splice(0, queue.length);
  await Promise.all(batch.map(({ url, depth }) => limit(() => processOne(url, depth))));
}

const urls = [...visited].sort();
await fs.writeFile(
  path.join(SNAPSHOT, 'urls.json'),
  JSON.stringify(urls, null, 2),
  'utf8',
);
const assetList = [...assets].sort();
await fs.writeFile(
  path.join(SNAPSHOT, 'assets.json'),
  JSON.stringify(assetList, null, 2),
  'utf8',
);

console.log(`\n[crawl] done. ${urls.length} pages, ${assetList.length} assets.`);
