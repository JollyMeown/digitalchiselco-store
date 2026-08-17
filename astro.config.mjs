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
  // CSRF origin checking is done in src/middleware.ts instead of Astro's
  // built-in guard so we can exempt exactly ONE path: POST /api/unsubscribe.
  // Gmail/Yahoo one-click unsubscribe (List-Unsubscribe-Post) is a cross-site
  // form POST from Google's servers and the built-in guard would 403 it (the
  // same guard that silently killed our scheduled cron for 11 days).
  security: { checkOrigin: false },
});
