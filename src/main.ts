import { mount } from 'svelte';
import { registerSW } from 'virtual:pwa-register';
import './app.css';
import { applyTheme } from './design/theme';
import { init, seedDemo } from './lib/store';
import App from './App.svelte';

// Offline service worker (Phase 2): precaches the app shell + rail packages so a ride can be marked
// with no signal. On a new deploy autoUpdate activates the new SW and auto-reloads the tab, so the
// app re-boots against the new package+manifest as a consistent set (no half-old/half-new skew).
// No-op in dev / when the browser lacks service workers; never blocks the first paint.
registerSW({ immediate: true });

applyTheme();

/**
 * Boot failure = a blank page with zero explanation unless it is caught here. init() opens
 * IndexedDB first, and that open genuinely fails in the wild (Safari Lockdown Mode, Firefox
 * private windows, quota exhaustion / profile corruption); a bare floating `void (async)()`
 * swallows the rejection and leaves the mounted app stuck on its splash forever. On failure we
 * replace #app with a tiny dependency-free error card — plain DOM, no framework, since the
 * environment is already known-broken — with a bilingual message, the error name, and a reload
 * button. NOT unit-tested: main.ts imports `virtual:pwa-register` (a build-time virtual module)
 * and mounts the full App at module scope, so it cannot be imported under vitest without harness
 * changes owned by the orchestrator; the failure path is covered by e2e/manual instead.
 */
function renderBootError(err: unknown): void {
  const root = document.getElementById('app');
  if (!root) return;
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const el = (tag: string, css: string, text: string): HTMLElement => {
    const node = document.createElement(tag);
    node.style.cssText = css;
    node.textContent = text; // textContent, never innerHTML — `detail` is attacker-ish input
    return node;
  };
  const box = el('div', 'max-width:28rem;margin:18vh auto 0;padding:0 1.5rem;font-family:system-ui,sans-serif;text-align:center;', '');
  const btn = el('button', 'background:#00A040;color:#fff;border:0;border-radius:.5rem;padding:.6rem 1.4rem;font-size:.9rem;cursor:pointer;', '再読み込み / Reload');
  btn.addEventListener('click', () => window.location.reload());
  box.append(
    el('h1', 'font-size:1.1rem;margin:0 0 .75rem;', '起動に失敗しました / RailPrint failed to start'),
    el('p', 'font-size:.85rem;line-height:1.6;margin:0 0 .75rem;', 'ブラウザのデータ保存（IndexedDB）を利用できない可能性があります（プライベートブラウズ・ロックダウンモード等）。 Browser storage (IndexedDB) may be unavailable — private browsing or Lockdown Mode can block it.'),
    el('p', 'font-size:.75rem;opacity:.7;margin:0 0 1.25rem;word-break:break-all;', detail),
    btn,
  );
  root.replaceChildren(box);
}

void (async () => {
  try {
    await init();
    if (import.meta.env.DEV) await seedDemo();
  } catch (err) {
    console.error('[boot] init() failed — rendering the static error state', err);
    renderBootError(err);
  }
})();

const app = mount(App, { target: document.getElementById('app')! });

export default app;
