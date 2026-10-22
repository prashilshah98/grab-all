import type { Adapter, FileEntry } from '../types';
import { fetchJson, sleep } from '../util';

const SLUG_RE = /\/d\/([A-Za-z0-9_-]+)/;

/** Folder pages are server-rendered: each file is a `.file-item` with data attributes. */
function parseFiles(doc: Document): FileEntry[] {
  return [...doc.querySelectorAll<HTMLElement>('#filesGrid .file-item')].flatMap((el) => {
    const slug = el.getAttribute('onclick')?.match(SLUG_RE)?.[1];
    if (!slug) return [];
    return [{ key: slug, name: el.dataset.name || slug, dir: '', size: Number(el.dataset.size) || 0 }];
  });
}

interface TokenResponse {
  success: boolean;
  server: string;
  file: string;
  name: string;
  token: string;
}

export const filester: Adapter = {
  id: 'filester',
  hosts: ['filester.me'],

  matches: (url) => url.hostname === 'filester.me' && url.pathname.startsWith('/f/'),

  async listFolder() {
    const name = document.querySelector('h1')?.textContent?.trim() || document.title.replace(/\s*\|.*$/, '');
    const files = new Map<string, FileEntry>();
    const add = (doc: Document) => parseFiles(doc).forEach((f) => files.set(f.key, f));
    add(document);

    // 24 files per page. The button disappears once the site's own "Load all pages" ran,
    // and then every file is already in the current document.
    const pages = Number(document.querySelector<HTMLElement>('#loadAllPagesBtn')?.dataset.total) || 1;
    for (let page = 2; page <= pages; page++) {
      await sleep(250);
      const url = new URL(location.pathname, location.origin);
      url.searchParams.set('page', String(page));
      const res = await fetch(url.href);
      if (!res.ok) throw new Error(`Could not load page ${page} (HTTP ${res.status})`);
      add(new DOMParser().parseFromString(await res.text(), 'text/html'));
    }
    return { name, files: [...files.values()] };
  },

  async resolveUrl(file) {
    const data = await fetchJson<TokenResponse>(`${location.origin}/v2/api/public/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_slug: file.key }),
    });
    if (!data.success || !data.token) throw new Error('Filester refused the download');
    const url = new URL(`${data.server}/v2/${data.file}`);
    url.searchParams.set('token', data.token);
    url.searchParams.set('download', 'true');
    url.searchParams.set('n', data.name || file.name);
    return url.href;
  },
};
