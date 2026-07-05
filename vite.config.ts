/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

// RailPrint app build (Opus 4.8 / experience lane). Static, no backend.
// Build-time turf precompute is engine-side; the app ships zero runtime turf.
export default defineConfig({
  // GitHub Pages serves a PROJECT site under /railprint/ — the deploy workflow builds with
  // PAGES_BASE=/railprint/. Local dev/preview/e2e stay at '/', so nothing local changes. Every
  // runtime fetch already goes through import.meta.env.BASE_URL (store.ts, MapView) or the
  // asset-url resolver (line logos, whose package data paths are root-absolute).
  base: process.env.PAGES_BASE || '/',
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
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'RailPrint — 乗りつぶしマップ',
        short_name: 'RailPrint',
        description: "An open-source map of every train you've ridden. Japan-first, China-ready.",
        lang: 'ja',
        theme_color: '#00A040',
        background_color: '#0b0b0c',
        display: 'standalone',
        start_url: '.',
        // Separate `any` and `maskable` entries — a combined 'any maskable' SVG fails maskable
        // audits; Android's install prompt wants the 192/512 PNGs, iOS uses apple-touch-icon
        // (linked in index.html; SVG unsupported there).
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the shell + the rail data. jp-2025.json is ~8.8 MB, so raise the per-file cap.
        // NOTE: only SAME-ORIGIN rail/*.json is precached, so the offline guarantee requires the
        // canonical package to ship in this build. When the package later moves to a CDN
        // (VITE_RAIL_CDN_SECONDARY, store.ts), this needs a revisioned/runtime-warmed entry for that
        // origin or offline breaks — tracked in docs/designs/rail-geo-durable-package.md.
        globPatterns: ['**/*.{js,css,html,svg,woff2}', 'rail/*.json', 'rail/migrations/**/*.json', 'basemap/*.json'],
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
            // OpenFreeMap basemap tiles/glyphs/sprite (the vendored style JSON itself is precached
            // same-origin). Cache on first use so revisited areas render their basemap offline;
            // the rail layers never depend on these.
            urlPattern: ({ url }) => url.origin === 'https://tiles.openfreemap.org',
            handler: 'CacheFirst',
            options: {
              cacheName: 'basemap-tiles',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
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
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.{test,spec}.ts'], // the rail-geo pipeline tests now live in the railnet repo
  },
});
