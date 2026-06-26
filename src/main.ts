import { mount } from 'svelte';
import { registerSW } from 'virtual:pwa-register';
import './app.css';
import { applyTheme } from './design/theme';
import { init, seedDemo } from './lib/store';
import App from './App.svelte';

// Offline service worker (Phase 2): precaches the app shell + rail packages so a ride can be marked
// with no signal. autoUpdate swaps in a new package+manifest atomically on the next load (no skew).
// No-op in dev / when the browser lacks service workers; never blocks the first paint.
registerSW({ immediate: true });

applyTheme();
void (async () => {
  await init();
  if (import.meta.env.DEV) await seedDemo();
})();

const app = mount(App, { target: document.getElementById('app')! });

export default app;
