// Stage 2 — Download every asset discovered by crawl.mjs into public/assets/
// and emit asset-map.json mapping remote URL -> local path.

import fs from 'node:fs/promises';
import path from 'node:path';
import { request } from 'undici';
import pLimit from 'p-limit';
import sharp from 'sharp';
import { SNAPSHOT, PUBLIC_ASSETS, CONCURRENCY, USER_AGENT } from './config.mjs';

const assetsPath = path.join(SNAPSHOT, 'assets.json');
const raw = await fs.readFile(assetsPath, 'utf8').catch(() => '[]');
const assets = JSON.parse(raw);

await fs.mkdir(PUBLIC_ASSETS, { recursive: true });
const limit = pLimit(CONCURRENCY);

// Remote URL -> local `/assets/<subpath>` (web-relative)
const map = {};

function toLocalPath(remoteUrl) {
  const url = new URL(remoteUrl);
  // Drop /wp-content/uploads/ prefix; keep date folders + filename
  let p = url.pathname.replace(/^\/wp-content\/uploads\//, '');
  // For external inceptionimages, nest under external/
  if (url.hostname !== 'www.anabelladentistry.com') {
    p = 'external/' + url.hostname + '/' + p.replace(/^\//, '');
  }
  return p;
}

async function downloadOne(remoteUrl) {
  const localRel = toLocalPath(remoteUrl);
  const localAbs = path.join(PUBLIC_ASSETS, localRel);
  await fs.mkdir(path.dirname(localAbs), { recursive: true });

  try {
    const res = await request(remoteUrl, {
      method: 'GET',
      headers: { 'user-agent': USER_AGENT },
      maxRedirections: 5,
    });
    if (res.statusCode >= 400) {
      console.warn(`[assets] HTTP ${res.statusCode} ${remoteUrl}`);
      return;
    }
    const buf = Buffer.from(await res.body.arrayBuffer());
    await fs.writeFile(localAbs, buf);

    // For raster inputs, also emit .avif sibling
    if (/\.(jpe?g|png|webp)$/i.test(localAbs)) {
      try {
        const avifPath = localAbs.replace(/\.(jpe?g|png|webp)$/i, '.avif');
        await sharp(buf).avif({ quality: 60 }).toFile(avifPath);
      } catch (err) {
        // not fatal
      }
    }

    map[remoteUrl] = '/assets/' + localRel.replace(/\\/g, '/');
    console.log(`[assets] ${remoteUrl} -> ${map[remoteUrl]}`);
  } catch (err) {
    console.warn(`[assets] failed ${remoteUrl}: ${err.message}`);
  }
}

await Promise.all(assets.map((u) => limit(() => downloadOne(u))));

await fs.writeFile(
  path.join(SNAPSHOT, 'asset-map.json'),
  JSON.stringify(map, null, 2),
  'utf8',
);

console.log(`\n[assets] done. ${Object.keys(map).length}/${assets.length} downloaded.`);
