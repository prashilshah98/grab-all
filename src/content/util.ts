export class AbortedError extends Error {
  constructor() {
    super('Cancelled');
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortedError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortedError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Retries `fn` with exponential backoff (1s, 2s, 4s, ...). Never retries after cancel. */
export async function withRetry<T>(fn: () => Promise<T>, signal: AbortSignal, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    if (signal.aborted) throw new AbortedError();
    try {
      return await fn();
    } catch (error) {
      if (signal.aborted || error instanceof AbortedError || attempt >= attempts) throw error;
      await sleep(1000 * 2 ** (attempt - 1), signal);
    }
  }
}

export async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${new URL(input).pathname}`);
  return (await res.json()) as T;
}

/** Makes a name safe as a file or folder name on Windows, macOS, Linux and Android. */
export function safeName(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/, '')
    .trim();
  return cleaned || 'file';
}

/** Joins folder, sub-folder and file name into a relative path with safe segments. */
export function relativePath(...parts: string[]): string {
  return parts
    .flatMap((p) => p.split('/'))
    .filter(Boolean)
    .map(safeName)
    .join('/');
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
