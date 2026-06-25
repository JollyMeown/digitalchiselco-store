import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import netlify from '@astrojs/netlify';

// Storefront is static-first for SEO/speed; admin + checkout + webhooks run on-demand (SSR).
export default defineConfig({
  site: 'https://digitalchiselco.com',
  output: 'server',
  adapter: netlify(),
  integrations: [react(), tailwind()],
});
