// Ephemeral UI state (not persisted): which tab is showing, whether the map is in
// "mark a ride" mode, and the toast queue that surfaces the D4 success / guard / error
// beats ("区間を記録しました", "この区間は記録済み", parse errors, …).

import { writable } from 'svelte/store';

export type Tab = 'map' | 'stats' | 'import';

export const activeTab = writable<Tab>('map');

/** Map "mark a ride" mode — toggled by the FAB; the map handles the A→B taps. */
export const markMode = writable<boolean>(false);

export type ToastKind = 'success' | 'info' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

export const toasts = writable<Toast[]>([]);

let nextToastId = 1;

export function toast(message: string, kind: ToastKind = 'info', ttlMs = 3200): number {
  const id = nextToastId++;
  toasts.update((list) => [...list, { id, kind, message }]);
  if (ttlMs > 0 && typeof window !== 'undefined') {
    window.setTimeout(() => dismissToast(id), ttlMs);
  }
  return id;
}

export function dismissToast(id: number): void {
  toasts.update((list) => list.filter((t) => t.id !== id));
}

export function goToTab(tab: Tab): void {
  activeTab.set(tab);
}
