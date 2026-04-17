// Stage 3 — Extract structured content from each snapshotted HTML.
//
// For each tools/snapshot/<slug>.html produces:
//   src/data/pages/<slug>.json  (content for that page)
// Also emits:
//   src/data/site.json           (nav, footer, hours, address, phone, testimonials)
//   tools/snapshot/migration-manifest.csv (per-page status)
//
// The extraction is intentionally conservative — it preserves the raw copy and
// asset references rather than trying to cleverly reinterpret Beaver Builder
// markup. generate.mjs turns the JSON into components.

import fs from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';
import {
  SNAPSHOT,
  DATA,
  DATA_PAGES,
  SITE_ORIGIN,
  slugFromUrl,
  routeFromSlug,
} from './config.mjs';

await fs.mkdir(DATA, { recursive: true });
await fs.mkdir(DATA_PAGES, { recursive: true });

// Load asset map (remote URL -> /assets/... web path). Optional.
let assetMap = {};
try {
  assetMap = JSON.parse(
    await fs.readFile(path.join(SNAPSHOT, 'asset-map.json'), 'utf8'),
  );
} catch {}

function rewriteAsset(url) {
  return assetMap[url] || url;
}

function rewriteLink(href) {
  if (!href) return href;
  try {
    const u = new URL(href, SITE_ORIGIN);
    if (u.origin === SITE_ORIGIN || u.origin === SITE_ORIGIN.replace('www.', '')) {
      return u.pathname + (u.search || '') + (u.hash || '');
    }
    return u.toString();
  } catch {
    return href;
  }
}

function extractMeta($) {
  return {
    title: $('head > title').text().trim(),
    description: $('meta[name="description"]').attr('content') || '',
    canonical: $('link[rel="canonical"]').attr('href') || '',
    ogImage: rewriteAsset($('meta[property="og:image"]').attr('content') || ''),
    jsonLd: $('script[type="application/ld+json"]')
      .map((_, el) => $(el).html())
      .get()
      .filter(Boolean),
  };
}

function extractNav($) {
  const nav = [];
  // Beaver Builder's main menu: ul.menu > li
  $('nav .menu > li, nav#menu-main-menu > li, ul.menu > li').each((_, li) => {
    const $li = $(li);
    const $a = $li.children('a').first();
    const item = {
      text: $a.text().trim(),
      href: rewriteLink($a.attr('href')),
      children: [],
    };
    $li.find('ul.sub-menu > li, ul > li').each((_, sub) => {
      const $sub = $(sub);
      const $subA = $sub.children('a').first();
      if (!$subA.length) return;
      item.children.push({
        text: $subA.text().trim(),
        href: rewriteLink($subA.attr('href')),
      });
    });
    if (item.text) nav.push(item);
  });
  // Dedupe by href+text
  const seen = new Set();
  return nav.filter((n) => {
    const k = `${n.text}|${n.href}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function extractFooter($) {
  const footer = { links: [], copyright: '' };
  $('footer a').each((_, a) => {
    const href = rewriteLink($(a).attr('href'));
    const text = $(a).text().trim();
    if (href && text) footer.links.push({ href, text });
  });
  const fullText = $('footer').text();
  const m = fullText.match(/(©|COPYRIGHT)[^\n]{0,60}/i);
  if (m) footer.copyright = m[0].trim();
  return footer;
}

function extractContact($) {
  // Phone is usually a tel: link
  const phone = $('a[href^="tel:"]').first().attr('href')?.replace('tel:', '') || '';
  // Address — look for structured addresses or text near "NE 15th St"
  let address = '';
  $('address, p').each((_, el) => {
    const txt = $(el).text().replace(/\s+/g, ' ').trim();
    if (/Bellevue|WA 98004/i.test(txt) && !address) address = txt;
  });
  return { phone, address };
}

function extractHours($) {
  const hours = {};
  const text = $('body').text().replace(/\s+/g, ' ');
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  for (const d of days) {
    const re = new RegExp(
      `${d}[:\\s]+([0-9]{1,2}:?[0-9]{0,2}\\s*(?:am|pm)?\\s*[\\-–—]\\s*[0-9]{1,2}:?[0-9]{0,2}\\s*(?:am|pm)?|Closed)`,
      'i',
    );
    const m = text.match(re);
    if (m) hours[d] = m[1].trim();
  }
  return hours;
}

function extractTestimonials($) {
  const out = [];
  // Beaver Builder testimonials module commonly uses .fl-testimonials-wrapper or .quote
  $('.fl-testimonial, blockquote').each((_, el) => {
    const $el = $(el);
    const quote = $el.find('.fl-testimonial-text, p').first().text().trim();
    const author = $el.find('.fl-testimonial-author, cite').first().text().trim();
    if (quote) out.push({ quote, author });
  });
  return out;
}

function extractPageSections($) {
  // Walk Beaver Builder row blocks; extract headings + paragraphs + images + CTA buttons.
  const sections = [];
  $('section, .fl-row, .fl-col, main > div').each((_, section) => {
    const $s = $(section);
    const headings = [];
    $s.find('h1, h2, h3, h4').each((_, h) => {
      headings.push({ tag: h.tagName.toLowerCase(), text: $(h).text().trim() });
    });
    if (headings.length === 0) return;
    const paragraphs = [];
    $s.find('p').each((_, p) => {
      const t = $(p).text().trim();
      if (t.length > 15) paragraphs.push(t);
    });
    const images = [];
    $s.find('img').each((_, img) => {
      const src = rewriteAsset($(img).attr('src') || '');
      const alt = $(img).attr('alt') || '';
      if (src) images.push({ src, alt });
    });
    const ctas = [];
    $s.find('a.fl-button, a.wp-block-button__link, a.btn, .cta a').each((_, a) => {
      const href = rewriteLink($(a).attr('href'));
      const text = $(a).text().trim();
      if (href && text) ctas.push({ href, text });
    });
    sections.push({ headings, paragraphs, images, ctas });
  });
  return sections;
}

function extractBreadcrumbs($) {
  const crumbs = [];
  $('.breadcrumb a, nav[aria-label*="breadcrumb" i] a').each((_, a) => {
    crumbs.push({
      text: $(a).text().trim(),
      href: rewriteLink($(a).attr('href')),
    });
  });
  return crumbs;
}

// --- main loop ---

const files = (await fs.readdir(SNAPSHOT)).filter((f) => f.endsWith('.html'));
const manifest = [['slug', 'route', 'title', 'status']];

let siteMeta = null;

for (const f of files) {
  const slug = f.replace(/\.html$/, '');
  const html = await fs.readFile(path.join(SNAPSHOT, f), 'utf8');
  const $ = load(html);

  const page = {
    slug,
    route: '/' + routeFromSlug(slug) + (slug === 'home' ? '' : '/'),
    meta: extractMeta($),
    breadcrumbs: extractBreadcrumbs($),
    sections: extractPageSections($),
  };

  // Capture site-wide metadata from the homepage
  if (slug === 'home' && !siteMeta) {
    siteMeta = {
      origin: SITE_ORIGIN,
      nav: extractNav($),
      footer: extractFooter($),
      contact: extractContact($),
      hours: extractHours($),
      testimonials: extractTestimonials($),
    };
  }

  await fs.writeFile(
    path.join(DATA_PAGES, `${slug}.json`),
    JSON.stringify(page, null, 2),
    'utf8',
  );
  manifest.push([slug, page.route, page.meta.title, 'extracted']);
  console.log(`[extract] ${slug} (${page.sections.length} sections)`);
}

if (siteMeta) {
  await fs.writeFile(
    path.join(DATA, 'site.json'),
    JSON.stringify(siteMeta, null, 2),
    'utf8',
  );
}

await fs.writeFile(
  path.join(SNAPSHOT, 'migration-manifest.csv'),
  manifest.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'),
  'utf8',
);

console.log(`\n[extract] done. ${files.length} pages -> src/data/pages/.`);
