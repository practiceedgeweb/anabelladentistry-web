// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';

export default defineConfig({
  site: 'https://www.anabelladentistry.com',
  output: 'static',
  adapter: vercel(),
  integrations: [sitemap()],
  build: {
    inlineStylesheets: 'always',
  },
});
