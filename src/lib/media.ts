// Reactive desktop breakpoint (DESIGN.md responsive: ≥768px gets a side panel, not a
// stretched mobile layout). SSR-safe: defaults to mobile when there is no matchMedia.
import { readable } from 'svelte/store';

export const isDesktop = readable(false, (set) => {
  if (typeof window === 'undefined' || !window.matchMedia) return;
  const mq = window.matchMedia('(min-width: 768px)');
  set(mq.matches);
  const onChange = (): void => set(mq.matches);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
});
