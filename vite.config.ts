/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

// RailPrint app build (Opus 4.8 / experience lane). Static, no backend.
// Build-time turf precompute is engine-side; the app ships zero runtime turf.
export default defineConfig({
  plugins: [
    svelte(),
    // Phase 2 — OFFLINE. A Workbox service worker precaches the app shell AND the rail packages
    // (rail/*.json + migration maps) so a ride can be marked with no signal. Precaching the package
    // and manifest TOGETHER at one content-revision keeps them consistent — fetchOne's SHA-256 check
    // can never see a fresh-manifest / stale-package skew, and a within-year version bump (filename
    // unchanged) still busts the cache because the revision is the file's content hash. On a new
    // deploy `autoUpdate` activates the new SW and auto-reloads the tab, so the app re-boots against
    // the new package+manifest as a set — never a half-old / half-new tab.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null, // registered manually in main.ts for control
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'RailPrint — 乗りつぶしマップ',
        short_name: 'RailPrint',
        description: "An open-source map of every train you've ridden. Japan-first, China-ready.",
        lang: 'ja',
        theme_color: '#00A040',
        background_color: '#0b0b0c',
        display: 'standalone',
        start_url: '.',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: {
        // Precache the shell + the rail data. jp-2025.json is ~8.8 MB, so raise the per-file cap.
        // NOTE: only SAME-ORIGIN rail/*.json is precached, so the offline guarantee requires the
        // canonical package to ship in this build. When the package later moves to a CDN
        // (VITE_RAIL_CDN_SECONDARY, store.ts), this needs a revisioned/runtime-warmed entry for that
        // origin or offline breaks — tracked in docs/designs/rail-geo-durable-package.md.
        globPatterns: ['**/*.{js,css,html,svg,woff2}', 'rail/*.json', 'rail/migrations/**/*.json'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // Line-badge logos are many and cosmetic — cache on first use, not on install.
            urlPattern: ({ url }) => url.pathname.includes('/rail/logos/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'rail-logos',
              expiration: { maxEntries: 800, maxAgeSeconds: 60 * 60 * 24 * 60 },
            },
          },
          {
            // Noto Sans JP from Google Fonts — cache so labels render offline after the first load.
            urlPattern: ({ url }) =>
              url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  // PMTiles archives are fetched as static assets / via the protomaps protocol;
  // keep them out of the JS bundle.
  assetsInclude: ['**/*.pmtiles'],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.{test,spec}.ts', 'pipeline/**/*.{test,spec}.ts'],
  },
});
