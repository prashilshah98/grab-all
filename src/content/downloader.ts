import { Zip, ZipPassThrough } from 'fflate';
import type { BgRequest, BgResponse, BgStatus } from '../shared/messages';
import { DOWNLOADS_API_FAILED } from '../shared/messages';
import type { Adapter, FileEntry } from './types';
import { AbortedError, errorMessage, relativePath, safeName, sleep, withRetry } from './util';

export type Mode = 'zip' | 'queue';

export interface Progress {
  onStart(file: FileEntry): void;
  /** Bytes received so far for this file (zip mode only). */
  onBytes(file: FileEntry, loaded: number): void;
  onDone(file: FileEntry): void;
  onError(file: FileEntry, message: string): void;
}

/** Pause between files so hosts don't rate-limit us. */
const GAP_MS = 500;
/** Received data is moved out of JS memory into a Blob every this many bytes. */
const FLUSH_BYTES = 32 * 1024 * 1024;

async function bg(message: BgRequest): Promise<void> {
  let res: BgResponse;
  try {
    res = (await browser.runtime.sendMessage(message)) as BgResponse;
  } catch (error) {
    throw new Error(`${SEND_FAILED} ${errorMessage(error)}`);
  }
  if (!res.ok) throw new Error(res.error.startsWith(DOWNLOADS_API_FAILED) ? res.error : `[step: background download] ${res.error}`);
}

const SEND_FAILED = '[step: sending to background]';
// Firefox for Android: the status message reaches the background, but download
// messages fail with "Receiving end does not exist" (phone tests of v0.1.0–0.1.2).
const isAndroid = /Android/i.test(navigator.userAgent);

let status: Promise<BgStatus> | null = null;

/** Asks the background once what it can do. No answer within 3 s counts as "nothing". */
export function backgroundStatus(): Promise<BgStatus> {
  if (isAndroid) status ??= Promise.resolve({ downloads: false, refererFix: false });
  status ??= Promise.race([
    browser.runtime.sendMessage({ type: 'status' } satisfies BgRequest) as Promise<BgStatus>,
    sleep(3000).then((): never => {
      throw new Error('no answer');
    }),
  ]).catch((error) => ({ downloads: false, refererFix: false, problem: `[step: background status] ${errorMessage(error)}` }));
  return status;
}

/** Fallback when the background can't save (seen on Android): a normal page link. */
function clickLink(href: string, filename: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
}

/**
 * Saves through the background's downloads API. Returns false when that API
 * is unusable here; it is then marked off for the rest of the page's life.
 */
async function tryBackground(message: BgRequest): Promise<boolean> {
  const current = await backgroundStatus();
  if (!current.downloads) return false;
  try {
    await bg(message);
    return true;
  } catch (error) {
    const text = errorMessage(error);
    // Anything else is a real transfer failure: retry as usual.
    if (!text.startsWith(DOWNLOADS_API_FAILED) && !text.startsWith(SEND_FAILED)) throw error;
    status = Promise.resolve({ ...current, downloads: false, problem: text });
    return false;
  }
}

async function saveUrl(adapter: Adapter, url: string, filename: string): Promise<void> {
  const { refererFix } = await backgroundStatus();
  if ((refererFix || !adapter.needsReferer) && (await tryBackground({ type: 'download', url, filename }))) return;
  // A hidden frame carries the page as Referer and, unlike a link to another
  // site, doesn't count as leaving the page (no "leave this site?" prompt).
  // We can't tell when it finishes.
  const frame = document.createElement('iframe');
  frame.style.display = 'none';
  frame.src = url;
  document.body.append(frame);
  setTimeout(() => frame.remove(), 5 * 60_000);
  await sleep(1500);
}

async function saveBlob(blob: Blob, filename: string): Promise<void> {
  if (await tryBackground({ type: 'saveBlob', blob, filename })) return;
  const url = URL.createObjectURL(blob);
  clickLink(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function readBody(url: string, credentials: RequestCredentials, signal: AbortSignal, onBytes: (loaded: number) => void): Promise<Uint8Array[]> {
  try {
    const res = await fetch(url, { credentials, signal });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return chunks;
      chunks.push(value);
      loaded += value.length;
      onBytes(loaded);
    }
  } catch (error) {
    if (signal.aborted) throw new AbortedError();
    throw error;
  }
}

/** "a.txt" → "a (2).txt" when the path is already taken. */
function uniquePath(path: string, used: Set<string>): string {
  let candidate = path;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) {
    candidate = path.replace(/(\.[^./]*)?$/, (ext) => ` (${n})${ext}`);
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/** Downloads files one by one into the Downloads folder (inside a sub-folder named after the share). */
export async function runQueue(adapter: Adapter, folder: string, files: FileEntry[], progress: Progress, signal: AbortSignal): Promise<void> {
  for (const file of files) {
    if (signal.aborted) throw new AbortedError();
    progress.onStart(file);
    try {
      await withRetry(async () => saveUrl(adapter, await adapter.resolveUrl(file), relativePath(folder, file.dir, file.name)), signal);
      progress.onDone(file);
    } catch (error) {
      if (signal.aborted) throw new AbortedError();
      progress.onError(file, errorMessage(error));
    }
    await sleep(GAP_MS, signal);
  }
}

/** Downloads every file into memory and saves one uncompressed zip. Failed files are left out. */
export async function runZip(adapter: Adapter, folder: string, files: FileEntry[], progress: Progress, signal: AbortSignal): Promise<void> {
  const parts: Blob[] = [];
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let zipError: Error | null = null;
  const flush = () => {
    if (!pending.length) return;
    parts.push(new Blob(pending as BlobPart[]));
    pending = [];
    pendingBytes = 0;
  };

  const zip = new Zip((error, chunk) => {
    if (error) {
      zipError = error;
      return;
    }
    pending.push(chunk);
    pendingBytes += chunk.length;
    if (pendingBytes >= FLUSH_BYTES) flush();
  });

  const used = new Set<string>();
  let added = 0;
  for (const file of files) {
    if (signal.aborted) throw new AbortedError();
    progress.onStart(file);
    try {
      const chunks = await withRetry(async () => {
        progress.onBytes(file, 0);
        const url = await adapter.resolveUrl(file);
        return readBody(url, adapter.credentials ?? 'omit', signal, (loaded) => progress.onBytes(file, loaded));
      }, signal);
      const entry = new ZipPassThrough(uniquePath(relativePath(file.dir, file.name), used));
      zip.add(entry);
      for (const chunk of chunks) entry.push(chunk);
      entry.push(new Uint8Array(0), true);
      if (zipError) throw zipError;
      added++;
      progress.onDone(file);
    } catch (error) {
      if (signal.aborted) throw new AbortedError();
      if (zipError) throw zipError;
      progress.onError(file, errorMessage(error));
    }
    await sleep(GAP_MS, signal);
  }

  zip.end();
  flush();
  if (!added) throw new Error('No file could be downloaded');
  await saveBlob(new Blob(parts, { type: 'application/zip' }), `${safeName(folder)}.zip`);
}
