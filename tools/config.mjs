// Shared config for the migration toolchain.
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '..');
export const TOOLS = __dirname;
export const SNAPSHOT = path.join(TOOLS, 'snapshot');
export const DATA = path.join(ROOT, 'src', 'data');
export const DATA_PAGES = path.join(DATA, 'pages');
export const PUBLIC_ASSETS = path.join(ROOT, 'public', 'assets');
export const SRC_PAGES = path.join(ROOT, 'src', 'pages');

export const SITE_ORIGIN = 'https://www.anabelladentistry.com';
export const MAX_DEPTH = 3;
export const CONCURRENCY = 6;
export const USER_AGENT =
  'anabelladentistry-migration/1.0 (+https://github.com/) Mozilla/5.0 (compatible)';

// Paths that should never be crawled
export const EXCLUDE_PATTERNS = [
  /\/wp-admin\//,
  /\/wp-json\//,
  /\/feed\/?$/,
  /\?s=/,
  /\/author\//,
  /\/tag\//,
  /\/category\//,
  /\/page\/\d+\//,
  /\.(xml|txt|ico|pdf)$/i,
];

// URL -> slug (used as filename stem and later as route)
export function slugFromUrl(u) {
  try {
    const url = new URL(u);
    let p = url.pathname.replace(/\/$/, '');
    if (p === '') return 'home';
    // strip leading slash and normalize
    return p.replace(/^\//, '').replace(/\//g, '--');
  } catch {
    return null;
  }
}

// slug -> astro route directory (reverse of slugFromUrl)
export function routeFromSlug(slug) {
  if (slug === 'home') return '';
  return slug.replace(/--/g, '/');
}

export function isOnSite(u) {
  try {
    const url = new URL(u);
    return url.origin === SITE_ORIGIN || url.origin === SITE_ORIGIN.replace('www.', '');
  } catch {
    return false;
  }
}

export function shouldCrawl(u) {
  if (!isOnSite(u)) return false;
  return !EXCLUDE_PATTERNS.some((re) => re.test(u));
}
