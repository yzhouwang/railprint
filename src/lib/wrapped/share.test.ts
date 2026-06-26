import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { shareCard, downloadBlob } from './share';

// These tests pin down the iOS-gesture-safe contract documented in share.ts:
// shareCard prefers navigator.share({files}) and never throws on a user cancel,
// falls back to a synchronous <a download> when the Web Share (files) API is
// missing, and now defensively rejects an empty/non-Blob argument.

function pngBlob(bytes = [137, 80, 78, 71]): Blob {
  // A tiny non-empty blob standing in for the eagerly-rendered Wrapped PNG.
  return new Blob([new Uint8Array(bytes)], { type: 'image/png' });
}

// Stub URL.createObjectURL / revokeObjectURL. URL's static methods are
// non-enumerable, so a `{ ...URL }` spread silently drops them — always wire
// BOTH explicitly so the deferred revoke timer never hits an undefined fn.
function stubObjectURL(value = 'blob:test') {
  const createObjectURL = vi.fn().mockReturnValue(value);
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  return { createObjectURL, revokeObjectURL };
}

// Snapshot the bits of navigator we mutate so each test starts clean.
const realShare = (navigator as any).share;
const realCanShare = (navigator as any).canShare;

beforeEach(() => {
  // Fake timers across the suite so downloadBlob's deferred URL.revokeObjectURL
  // (scheduled via setTimeout) is drained INSIDE the test while the URL stub is
  // still installed — otherwise it leaks to a real timer that fires after the
  // stub is torn down and throws (jsdom has no real revokeObjectURL).
  vi.useFakeTimers();
  // Neuter anchor.click() at the prototype so the download path doesn't trigger
  // jsdom's "Not implemented: navigation" noise. Tests that assert on a specific
  // anchor install their own per-instance click spy (which shadows this).
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  // Drain any pending revoke timer before tearing the URL stub down.
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  // Restore navigator + any spies/stubs between tests.
  (navigator as any).share = realShare;
  (navigator as any).canShare = realCanShare;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('shareCard — Web Share (files) path', () => {
  it('(a) shares via navigator.share with a files array and returns "shared"', async () => {
    const canShare = vi.fn().mockReturnValue(true);
    const share = vi.fn().mockResolvedValue(undefined);
    (navigator as any).canShare = canShare;
    (navigator as any).share = share;

    const blob = pngBlob();
    const outcome = await shareCard(blob, 'railprint.png', { title: 'RailPrint', text: 'my year' });

    expect(outcome).toBe('shared');
    expect(share).toHaveBeenCalledTimes(1);

    // It must hand share() a files array containing a File built from the blob.
    const arg = share.mock.calls[0][0];
    expect(Array.isArray(arg.files)).toBe(true);
    expect(arg.files).toHaveLength(1);
    const file = arg.files[0];
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('railprint.png');
    expect(file.type).toBe('image/png');
    expect(arg.title).toBe('RailPrint');
    expect(arg.text).toBe('my year');

    // canShare must be consulted (it gates the path) and given a files descriptor.
    expect(canShare).toHaveBeenCalled();
    expect(canShare.mock.calls[0][0]).toHaveProperty('files');
  });

  it('(b) a user cancel (AbortError) resolves as "cancelled" and does NOT fall through to download', async () => {
    const abort = new DOMException('The user aborted a request.', 'AbortError');
    const share = vi.fn().mockRejectedValue(abort);
    (navigator as any).canShare = vi.fn().mockReturnValue(true);
    (navigator as any).share = share;

    // Spy on the download fallback to prove it is NOT reached on cancel.
    const { createObjectURL } = stubObjectURL('blob:cancel');

    const outcome = await shareCard(pngBlob(), 'railprint.png');

    expect(outcome).toBe('cancelled');
    expect(share).toHaveBeenCalledTimes(1);
    // The download path was never taken — no object URL was created.
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('falls back to download when navigator.share rejects with a non-abort error', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('boom', 'DataError'));
    (navigator as any).canShare = vi.fn().mockReturnValue(true);
    (navigator as any).share = share;

    const { createObjectURL } = stubObjectURL('blob:fallback');

    const outcome = await shareCard(pngBlob(), 'railprint.png');

    expect(outcome).toBe('downloaded');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });
});

describe('shareCard — download fallback path', () => {
  it('(c) falls back to downloadBlob and returns "downloaded" when canShare is false', async () => {
    (navigator as any).canShare = vi.fn().mockReturnValue(false);
    (navigator as any).share = vi.fn(); // present, but canShare gates it out

    const { createObjectURL } = stubObjectURL('blob:nope');

    const outcome = await shareCard(pngBlob(), 'railprint.png');

    expect(outcome).toBe('downloaded');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    // share() must NOT be invoked when canShare gates the path out.
    expect((navigator as any).share).not.toHaveBeenCalled();
  });

  it('falls back to download when navigator.share is undefined entirely', async () => {
    (navigator as any).share = undefined;
    (navigator as any).canShare = undefined;

    const { createObjectURL } = stubObjectURL('blob:noshare');

    const outcome = await shareCard(pngBlob(), 'railprint.png');

    expect(outcome).toBe('downloaded');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });
});

describe('downloadBlob', () => {
  it('(d) creates an <a download> with the object URL, appends, clicks, and removes it', () => {
    const { createObjectURL } = stubObjectURL('blob:download-url');

    // Capture the real anchor created so we can assert on its attributes + click.
    const anchor = document.createElement('a');
    const clickSpy = vi.spyOn(anchor, 'click').mockImplementation(() => {});
    const createElement = vi.spyOn(document, 'createElement').mockReturnValue(anchor);
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const removeSpy = vi.spyOn(anchor, 'remove');

    downloadBlob(pngBlob(), 'railprint.png');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createElement).toHaveBeenCalledWith('a');
    expect(anchor.getAttribute('download')).toBe('railprint.png');
    expect(anchor.getAttribute('href')).toBe('blob:download-url');
    expect(appendSpy).toHaveBeenCalledWith(anchor);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });

  it('revokes the object URL on the next tick (after the click consumes it)', () => {
    // Fake timers are already on (suite beforeEach).
    const { revokeObjectURL } = stubObjectURL('blob:revoke-url');
    const anchor = document.createElement('a');
    vi.spyOn(anchor, 'click').mockImplementation(() => {});
    vi.spyOn(document, 'createElement').mockReturnValue(anchor);

    downloadBlob(pngBlob(), 'railprint.png');

    // Not revoked synchronously — only after the timer drains.
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:revoke-url');
  });
});

describe('shareCard — defensive blob guard', () => {
  beforeEach(() => {
    // A working share path, so a failure here is the guard firing — not a missing API.
    (navigator as any).canShare = vi.fn().mockReturnValue(true);
    (navigator as any).share = vi.fn().mockResolvedValue(undefined);
  });

  it('(e) throws when given a zero-size Blob', async () => {
    const empty = new Blob([], { type: 'image/png' });
    expect(empty.size).toBe(0);
    await expect(shareCard(empty, 'railprint.png')).rejects.toThrow(/non-empty Blob/);
    expect((navigator as any).share).not.toHaveBeenCalled();
  });

  it('(e) throws when the argument is not a Blob at all', async () => {
    // Simulate a caller that forgot to build the blob and passed null/undefined.
    await expect(shareCard(null as any, 'railprint.png')).rejects.toThrow(/non-empty Blob/);
    await expect(shareCard(undefined as any, 'railprint.png')).rejects.toThrow();
    await expect(shareCard({} as any, 'railprint.png')).rejects.toThrow();
    expect((navigator as any).share).not.toHaveBeenCalled();
  });
});
