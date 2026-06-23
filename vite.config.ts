/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// RailPrint app build (Opus 4.8 / experience lane). Static, no backend.
// Build-time turf precompute is engine-side; the app ships zero runtime turf.
export default defineConfig({
  plugins: [svelte()],
  // PMTiles archives are fetched as static assets / via the protomaps protocol;
  // keep them out of the JS bundle.
  assetsInclude: ['**/*.pmtiles'],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.{test,spec}.ts'],
  },
});
