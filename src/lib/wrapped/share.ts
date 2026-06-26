// T8 — sharing the Wrapped card image. iOS-gesture-safe.
//
// The hard constraint: navigator.share() and navigator.canShare() must be reached from
// INSIDE the user-gesture (the click). iOS Safari throws NotAllowedError if the gesture
// is "spent" by an intervening await. So the contract is: the CALLER builds the Blob
// EAGERLY inside the tap handler (renderWrappedToBlob warmed via ensureWrappedFonts), then
// hands the already-created blob here. This function does NO long async work before the
// share call — it wraps the blob in a File and calls share immediately, falling back to a
// synchronous <a download> when the Web Share (files) API is unavailable.

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

interface ShareOpts {
  title?: string;
  text?: string;
}

/**
 * Share an already-rendered PNG blob. Uses navigator.share({files}) when the platform can
 * share files; otherwise triggers a same-gesture <a download>. Returns how it resolved.
 *
 * Never throws on a user cancel (iOS/Android surface AbortError when the sheet is
 * dismissed) — that resolves as 'cancelled'. A genuine share failure falls back to
 * download so the user always gets the image.
 */
export async function shareCard(
  blob: Blob,
  filename: string,
  opts: ShareOpts = {},
): Promise<ShareOutcome> {
  // Cheap, synchronous defensive guard. A caller that forgot to build the PNG
  // eagerly inside the tap gesture (the iOS contract above) should fail loudly
  // here instead of silently sharing/downloading an empty image. This is a sync
  // check — it adds NO await before navigator.share, so the gesture stays alive.
  if (!(blob instanceof Blob) || blob.size === 0) {
    throw new Error('shareCard: expected a non-empty Blob built eagerly inside the tap gesture');
  }

  const file = new File([blob], filename, { type: blob.type || 'image/png' });

  // Web Share with files — the preferred path on mobile. canShare({files}) gates it.
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const canShareFiles =
    !!nav &&
    typeof nav.share === 'function' &&
    typeof nav.canShare === 'function' &&
    nav.canShare({ files: [file] });

  if (canShareFiles) {
    try {
      await nav!.share({
        files: [file],
        title: opts.title ?? 'RailPrint',
        text: opts.text,
      });
      return 'shared';
    } catch (err) {
      // AbortError = the user dismissed the share sheet; don't fall back to a download.
      if (isAbort(err)) return 'cancelled';
      // Any other failure → fall through to the download path.
    }
  }

  downloadBlob(blob, filename);
  return 'downloaded';
}

/** Synchronous <a download> — works inside the same gesture, no async, no permissions. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click has consumed the URL first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException ? err.name === 'AbortError' : false;
}
