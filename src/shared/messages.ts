/** Messages from the content script to the background script. */
export type BgRequest =
  | { type: 'status' }
  | { type: 'download'; url: string; filename: string }
  | { type: 'saveBlob'; blob: Blob; filename: string };

export type BgResponse = { ok: true } | { ok: false; error: string };

/** Error prefix when `downloads.download` itself throws (seen on Android), as opposed to a failed transfer. */
export const DOWNLOADS_API_FAILED = '[step: downloads API] ';

/** What the background can do in this Firefox (Android lacks some APIs). */
export interface BgStatus {
  downloads: boolean;
  /** The Koofr Referer fix (blocking webRequest) is active. */
  refererFix: boolean;
  /** Why something is unavailable, shown to the user. */
  problem?: string;
}
