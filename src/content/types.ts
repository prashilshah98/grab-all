export interface FileEntry {
  /** Unique within the folder (site-specific id or path). */
  key: string;
  name: string;
  /** Sub-folder path relative to the shared folder, '' for the top level. */
  dir: string;
  /** Bytes; 0 when the site does not say. */
  size: number;
}

export interface Folder {
  name: string;
  files: FileEntry[];
}

/** One per file host. */
export interface Adapter {
  id: string;
  /** Hostnames the content script runs on. The button shows only where `matches` is true. */
  hosts: string[];
  matches(url: URL): boolean;
  listFolder(): Promise<Folder>;
  /** Returns a direct download URL. Tokens can expire, so call it right before downloading. */
  resolveUrl(file: FileEntry): Promise<string>;
  /** The host rejects downloads whose Referer isn't its own page (koofr). */
  needsReferer?: boolean;
  /** Credentials mode for zip-mode fetches of file bodies (default 'omit'). */
  credentials?: RequestCredentials;
}
