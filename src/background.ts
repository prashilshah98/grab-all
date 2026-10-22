import type { BgRequest, BgResponse, BgStatus } from './shared/messages';
import { DOWNLOADS_API_FAILED } from './shared/messages';

const problems: string[] = [];
if (!browser.downloads?.download) problems.push('downloads API missing');

/** Starts a download and resolves once Firefox reports it finished. */
async function download(url: string, filename: string): Promise<void> {
  let id: number;
  try {
    id = await browser.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
  } catch (error) {
    throw new Error(DOWNLOADS_API_FAILED + (error instanceof Error ? error.message : String(error)));
  }
  // Polling instead of downloads.onChanged keeps this independent of event
  // support differences between desktop and Android.
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    const [item] = await browser.downloads.search({ id });
    if (!item) throw new Error('Download disappeared');
    if (item.state === 'complete') return;
    if (item.state === 'interrupted') throw new Error(`Download interrupted: ${item.error ?? 'unknown reason'}`);
  }
}

// Registered first: if anything below fails on some platform, messages must still work.
browser.runtime.onMessage.addListener(async (message: BgRequest): Promise<BgResponse | BgStatus> => {
  if (message.type === 'status') {
    return { downloads: !!browser.downloads?.download, refererFix: refererFix, problem: problems.join('; ') || undefined };
  }
  try {
    if (message.type === 'download') {
      await download(message.url, message.filename);
    } else {
      const url = URL.createObjectURL(message.blob);
      try {
        await download(url, message.filename);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// Koofr answers "Hotlinking not allowed" unless the Referer is the link page.
// Requests from the extension (downloads API, content-script fetch) may not
// carry it, so add it here.
const KOOFR_CONTENT = /^https:\/\/app\.koofr\.net\/content\/links\/([0-9a-f-]+)\//;
let refererFix = false;
try {
  browser.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      const linkId = KOOFR_CONTENT.exec(details.url)?.[1];
      if (!linkId) return {};
      const headers = (details.requestHeaders ?? []).filter((h) => h.name.toLowerCase() !== 'referer');
      headers.push({ name: 'Referer', value: `https://app.koofr.net/links/${linkId}` });
      return { requestHeaders: headers };
    },
    { urls: ['https://app.koofr.net/content/links/*'] },
    ['blocking', 'requestHeaders'],
  );
  refererFix = true;
} catch (error) {
  problems.push(`Referer fix failed: ${error instanceof Error ? error.message : String(error)}`);
}
