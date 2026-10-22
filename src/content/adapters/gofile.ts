import type { Adapter, FileEntry } from '../types';
import { sleep } from '../util';

/**
 * Gofile's API needs an `X-Website-Token` made by the page's own obfuscated
 * `generateWT`. Its secret rotates, and per gofile's code a stale or forged
 * token gets the IP banned. So we never make one ourselves: we call the
 * page's function and send the request from the page context, exactly like
 * the site does.
 */

const FOLDER_RE = /^\/d\/([A-Za-z0-9-]+)/;
const API = 'https://api.gofile.io';
const PAGE_SIZE = 100;
/** Gofile itself stops signing after 6 h (rotated secrets); stay well below. */
const MAX_PAGE_AGE_MS = 5 * 60 * 60 * 1000;

interface GofileItem {
  id: string;
  type: 'file' | 'folder';
  name: string;
  size?: number;
  link?: string;
  isFrozen?: boolean;
  overloaded?: boolean;
  children?: Record<string, GofileItem>;
}

interface ContentsResponse {
  status: string;
  data: GofileItem;
  metadata?: { totalPages?: number };
}

/** Firefox content-script helpers for reaching the page's own JavaScript. */
declare function cloneInto<T>(obj: T, target: Window): T;
declare global {
  interface Window {
    wrappedJSObject: {
      generateWT?: (token: string) => string | Promise<string>;
      fetch: typeof fetch;
    };
  }
}

/** fetch() as the page itself: Origin gofile.io, like gofile's own requests. */
function pageFetch(url: string, init: RequestInit): Promise<Response> {
  return window.wrappedJSObject.fetch(url, cloneInto(init, window));
}

/** Items from the last listing, for download links. */
const items = new Map<string, GofileItem>();

function accountToken(): string {
  const token = /(?:^|;\s*)accountToken=([^;]+)/.exec(document.cookie)?.[1];
  if (!token) throw new Error('Gofile has not finished loading. Wait a moment and try again.');
  return token;
}

async function websiteToken(token: string): Promise<string> {
  if (Date.now() - performance.timeOrigin > MAX_PAGE_AGE_MS) {
    throw new Error('This gofile tab has been open for hours. Reload the page, then try again.');
  }
  const generate = window.wrappedJSObject.generateWT;
  if (typeof generate !== 'function') throw new Error('Gofile has not finished loading. Wait a moment and try again.');
  return String(await generate(token));
}

/** Same request as gofile's own `getFolder`, sent from the page. */
async function getContents(id: string, page: number): Promise<ContentsResponse> {
  const token = accountToken();
  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), sortField: 'name', sortDirection: '1' });
  const password = sessionStorage.getItem(`password|${id}`);
  if (password) query.set('password', password);
  const res = await pageFetch(`${API}/contents/${encodeURIComponent(id)}?${query}`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Website-Token': await websiteToken(token), 'X-BL': navigator.language || '' },
  });
  // Parse from text: objects created by the page are awkward to read from a content script.
  const body = JSON.parse(await res.text()) as ContentsResponse;
  if (body.status !== 'ok') {
    const reason = body.status === 'error-passwordRequired' ? 'Unlock the folder with its password first' : body.status;
    throw new Error(`Gofile refused the folder list (${reason})`);
  }
  return body;
}

/** Lists folder `id` and every sub-folder below it. */
async function walk(id: string, dir: string, out: FileEntry[]): Promise<string> {
  let name = '';
  const folders: GofileItem[] = [];
  for (let page = 1, pages = 1; page <= pages; page++) {
    if (page > 1) await sleep(400);
    const { data, metadata } = await getContents(id, page);
    name = data.name;
    pages = metadata?.totalPages ?? 1;
    const children = data.type === 'folder' ? Object.values(data.children ?? {}) : [data];
    for (const child of children) {
      if (child.type === 'folder') {
        folders.push(child);
      } else {
        items.set(child.id, child);
        out.push({ key: child.id, name: child.name, dir, size: child.size ?? 0 });
      }
    }
  }
  for (const folder of folders) {
    await sleep(400);
    await walk(folder.id, dir ? `${dir}/${folder.name}` : folder.name, out);
  }
  return name;
}

export const gofile: Adapter = {
  id: 'gofile',
  hosts: ['gofile.io', 'www.gofile.io'],
  // Downloads need the accountToken cookie.
  credentials: 'include',

  matches: (url) => gofile.hosts.includes(url.hostname) && FOLDER_RE.test(url.pathname),

  async listFolder() {
    const id = FOLDER_RE.exec(location.pathname)?.[1];
    if (!id) throw new Error('Not a gofile folder');
    items.clear();
    const files: FileEntry[] = [];
    const name = await walk(id, '', files);
    return { name, files };
  },

  async resolveUrl(file) {
    const item = items.get(file.key);
    if (!item?.link) throw new Error('No download link');
    if (item.isFrozen) throw new Error('File is in cold storage (premium only)');
    if (item.overloaded) throw new Error('Gofile server overloaded, try later');
    return item.link;
  },
};
