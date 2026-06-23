import { mount } from 'svelte';
import './app.css';
import { applyTheme } from './design/theme';
import { init, seedDemo } from './lib/store';
import App from './App.svelte';

applyTheme();
void (async () => {
  await init();
  if (import.meta.env.DEV) await seedDemo();
})();

const app = mount(App, { target: document.getElementById('app')! });

export default app;
