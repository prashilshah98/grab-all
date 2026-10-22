import type { Adapter, FileEntry } from '../types';
import { fetchJson, sleep } from '../util';

const LINK_RE = /^\/links\/([0-9a-f-]{36})/;

interface KoofrItem {
  name: string;
  type: 'file' | 'dir';
  size: number;
}

function linkId(): string {
  const id = LINK_RE.exec(location.pathname)?.[1];
  if (!id) throw new Error('Not a Koofr shared link');
  return id;
}

const api = (id: string) => `${location.origin}/api/v2/public/links/${id}`;

/** Lists `path` and every sub-folder below it. `path` is '/' or '/a/b'. */
async function walk(id: string, path: string, out: FileEntry[]): Promise<void> {
  const { files } = await fetchJson<{ files: KoofrItem[] }>(`${api(id)}/bundle?path=${encodeURIComponent(path)}`);
  const dir = path === '/' ? '' : path.slice(1);
  for (const item of files) {
    const full = `${path === '/' ? '' : path}/${item.name}`;
    if (item.type === 'dir') {
      await sleep(150);
      await walk(id, full, out);
    } else {
      out.push({ key: full, name: item.name, dir, size: item.size || 0 });
    }
  }
}

export const koofr: Adapter = {
  id: 'koofr',
  hosts: ['app.koofr.net'],
  needsReferer: true,

  matches: (url) => url.hostname === 'app.koofr.net' && LINK_RE.test(url.pathname),

  async listFolder() {
    const id = linkId();
    const info = await fetchJson<{ name: string; isDownloadable: boolean; file: KoofrItem }>(api(id));
    if (!info.isDownloadable) throw new Error('The owner disabled downloads for this link');
    if (info.file.type === 'file') {
      return { name: info.name, files: [{ key: `/${info.file.name}`, name: info.file.name, dir: '', size: info.file.size }] };
    }
    const files: FileEntry[] = [];
    await walk(id, '/', files);
    return { name: info.name, files };
  },

  async resolveUrl(file) {
    // The background script adds the Referer Koofr requires for these URLs.
    return `${location.origin}/content/links/${linkId()}/files/get/${encodeURIComponent(file.name)}?path=${encodeURIComponent(file.key)}&force`;
  },
};
