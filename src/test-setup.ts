// Vitest setup — give jsdom a real IndexedDB so the Dexie kernel (T5) can be
// exercised in unit tests exactly as it runs in the browser.
import 'fake-indexeddb/auto';
