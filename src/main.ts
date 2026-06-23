// RailPrint app entry (scaffold placeholder).
// The real surface — the map, line-first marking, the % card — is the experience
// lane's T6 (CLAUDE_PLAN.md), built in cycle 2 against the engine's RailGeoPackage.
// This placeholder exists so the static build stands up; it imports the design
// tokens so the emerald system is wired from line one.

import { tokens } from './design/tokens';

const app = document.querySelector<HTMLDivElement>('#app');

if (app) {
  app.style.cssText = [
    'min-height:100dvh',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'gap:12px',
    'font-family:system-ui,sans-serif',
    `background:${tokens.white}`,
    `color:${tokens.ink}`,
  ].join(';');

  const mark = document.createElement('div');
  mark.style.cssText = `width:40px;height:40px;border-radius:10px;background:${tokens.railLit};color:${tokens.white};display:flex;align-items:center;justify-content:center;font-weight:600;font-size:20px`;
  mark.textContent = 'R';

  const title = document.createElement('div');
  title.style.cssText = 'font-size:18px;font-weight:500';
  title.textContent = 'RailPrint';

  const note = document.createElement('div');
  note.style.cssText = `font-size:13px;color:${tokens.inkMuted}`;
  note.textContent = '地図は次のサイクル（T6）で実装します。';

  app.append(mark, title, note);
}
