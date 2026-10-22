import { backgroundStatus, runQueue, runZip, type Mode, type Progress } from './downloader';
import { css } from './styles';
import type { Adapter, FileEntry, Folder } from './types';
import { AbortedError, errorMessage, formatBytes } from './util';

const isAndroid = /Android/i.test(navigator.userAgent);
/** Shown in the panel so test reports say which build they used. */
const VERSION = `Grab All v${browser.runtime.getManifest().version}`;
/** Above this, zip mode shows a warning: the whole zip is built in memory. */
const ZIP_WARN_BYTES = (isAndroid ? 500 : 2048) * 1024 * 1024;
/** fflate writes no ZIP64, so a zip must stay under 4 GiB. */
const ZIP_MAX_BYTES = 4 * 1024 ** 3 - 64 * 1024 ** 2;

type Status = 'pending' | 'active' | 'done' | 'failed';

interface Row {
  file: FileEntry;
  li: HTMLLIElement;
  checkbox: HTMLInputElement;
  status: HTMLElement;
  state: Status;
}

// Props are loosely typed: precise per-tag types make nested el() calls too complex for tsc.
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

export class Panel {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private panel!: HTMLElement;
  private titleEl!: HTMLElement;
  private subEl!: HTMLElement;
  private toolbar!: HTMLElement;
  private selectAll!: HTMLInputElement;
  private warn!: HTMLElement;
  private list!: HTMLUListElement;
  private bar!: HTMLElement;
  private summary!: HTMLElement;
  private startBtn!: HTMLButtonElement;
  private cancelBtn!: HTMLButtonElement;

  private folder: Folder | null = null;
  private rows: Row[] = [];
  private mode: Mode = 'zip';
  private controller: AbortController | null = null;
  /** Bytes finished plus bytes of the file in progress (zip mode). */
  private doneBytes = 0;
  private activeBytes = 0;

  constructor(private adapter: Adapter) {
    const host = (this.host = document.createElement('div'));
    host.id = 'grab-all-root';
    host.hidden = true;
    this.shadow = host.attachShadow({ mode: 'closed' });
    this.shadow.append(el('style', { textContent: css }));
    const root = el('div', { className: 'root' });
    this.shadow.append(root);
    root.append(el('button', { className: 'fab', textContent: '⬇ Download all', onclick: () => this.toggle() }), this.buildPanel());
    document.documentElement.append(host);
    addEventListener('beforeunload', (e) => {
      if (this.controller) e.preventDefault();
    });
  }

  private buildPanel(): HTMLElement {
    this.titleEl = el('h2', { textContent: 'Grab All' });
    this.subEl = el('div', { className: 'sub' });
    this.selectAll = el('input', { type: 'checkbox', checked: true, onchange: () => this.setAll(this.selectAll.checked) });
    const modeRadio = (mode: Mode, label: string) =>
      el('label', {}, el('input', { type: 'radio', name: 'mode', checked: mode === this.mode, onchange: () => this.setMode(mode) }), label);
    this.toolbar = el('div', { className: 'toolbar' },
      el('label', {}, this.selectAll, 'All'),
      el('span', { className: 'modes' }, modeRadio('zip', 'One zip'), modeRadio('queue', 'One by one')),
    );
    this.warn = el('div', { className: 'warn', hidden: true });
    this.list = el('ul', { className: 'list' });
    this.bar = el('div');
    this.summary = el('div', { className: 'summary', textContent: VERSION });
    this.startBtn = el('button', { className: 'primary', textContent: 'Download', onclick: () => this.start() });
    this.cancelBtn = el('button', { textContent: 'Cancel', hidden: true, onclick: () => this.controller?.abort() });

    this.panel = el('section', { className: 'panel', hidden: true },
      el('header', {},
        el('div', { className: 'title' }, this.titleEl, this.subEl),
        el('button', { textContent: '✕', title: 'Close', onclick: () => this.toggle(false) }),
      ),
      this.toolbar,
      this.warn,
      this.list,
      el('footer', {},
        el('div', { className: 'bar' }, this.bar),
        this.summary,
        el('div', { className: 'actions' }, this.cancelBtn, this.startBtn),
      ),
    );
    return this.panel;
  }

  /** Shows the button only on folder pages; a new folder means a fresh file list. */
  onUrlChange(isFolderPage: boolean): void {
    if (this.controller) return; // never interrupt a running download
    this.host.hidden = !isFolderPage;
    this.toggle(false);
    this.folder = null;
    this.rows = [];
    this.list.replaceChildren();
    this.bar.style.width = '0';
    this.summary.textContent = VERSION;
    this.subEl.textContent = '';
    this.titleEl.textContent = 'Grab All';
  }

  private toggle(open = this.panel.hidden): void {
    this.panel.hidden = !open;
    if (open && !this.folder) void this.load();
  }

  private showMessage(text: string, error = false): void {
    this.list.replaceChildren(el('li', { className: error ? 'message error' : 'message', textContent: text }));
  }

  private async load(): Promise<void> {
    this.startBtn.disabled = true;
    this.showMessage('Loading file list…');
    try {
      this.folder = await this.adapter.listFolder();
    } catch (error) {
      this.showMessage(`Could not read the file list: ${errorMessage(error)}`, true);
      return;
    }
    this.titleEl.textContent = this.folder.name;
    if (!this.folder.files.length) {
      this.showMessage('No files found in this folder.');
      return;
    }
    this.rows = this.folder.files.map((file) => {
      const checkbox = el('input', { type: 'checkbox', checked: true, onchange: () => this.refresh() });
      const status = el('div', { className: 'status' });
      const label = file.dir ? `${file.dir}/${file.name}` : file.name;
      const li = el('li', {}, checkbox, el('span', { className: 'name', textContent: label, title: label }), el('span', { className: 'size', textContent: formatBytes(file.size) }), status);
      return { file, li, checkbox, status, state: 'pending' as Status };
    });
    this.list.replaceChildren(...this.rows.map((r) => r.li));
    this.refresh();
  }

  private selected(): Row[] {
    return this.rows.filter((r) => r.checkbox.checked);
  }

  private setAll(checked: boolean): void {
    for (const r of this.rows) r.checkbox.checked = checked;
    this.refresh();
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    this.refresh();
  }

  /** Updates header, warning and the Download button from the current selection. */
  private refresh(): void {
    const sel = this.selected();
    const bytes = sel.reduce((n, r) => n + r.file.size, 0);
    const total = this.rows.length;
    this.subEl.textContent = `${sel.length} of ${total} files selected${bytes ? ` · ${formatBytes(bytes)}` : ''}`;
    this.selectAll.checked = sel.length === total;
    this.selectAll.indeterminate = sel.length > 0 && sel.length < total;

    let warning = '';
    if (this.mode === 'zip' && bytes > ZIP_MAX_BYTES) warning = 'Too big for one zip (4 GB limit). Use "One by one" or select fewer files.';
    else if (this.mode === 'zip' && bytes > ZIP_WARN_BYTES) warning = `The zip is built in memory, and ${formatBytes(bytes)} may be too much for this device. "One by one" is safer.`;
    this.warn.textContent = warning;
    this.warn.hidden = !warning;
    this.startBtn.disabled = !!this.controller || sel.length === 0 || (this.mode === 'zip' && bytes > ZIP_MAX_BYTES);
  }

  private setStatus(row: Row, state: Status, text: string): void {
    row.state = state;
    row.li.className = state;
    row.status.textContent = text;
  }

  private async start(): Promise<void> {
    const rows = this.selected();
    if (!rows.length || !this.folder) return;
    const byFile = new Map(rows.map((r) => [r.file, r]));
    const totalBytes = rows.reduce((n, r) => n + r.file.size, 0);
    let finished = 0;
    let failed = 0;
    this.doneBytes = 0;
    this.activeBytes = 0;

    const update = () => {
      const fraction = totalBytes && this.mode === 'zip' ? (this.doneBytes + this.activeBytes) / totalBytes : finished / rows.length;
      this.bar.style.width = `${Math.min(100, fraction * 100).toFixed(1)}%`;
      this.summary.textContent = `${finished} of ${rows.length} files${failed ? ` · ${failed} failed` : ''}`;
    };

    const progress: Progress = {
      onStart: (file) => {
        this.activeBytes = 0;
        const row = byFile.get(file)!;
        this.setStatus(row, 'active', this.mode === 'zip' ? 'Downloading…' : 'Saving…');
        row.li.scrollIntoView({ block: 'nearest' });
        update();
      },
      onBytes: (file, loaded) => {
        this.activeBytes = loaded;
        const pct = file.size ? ` ${Math.floor((loaded / file.size) * 100)}%` : ` ${formatBytes(loaded)}`;
        byFile.get(file)!.status.textContent = `Downloading…${pct}`;
        update();
      },
      onDone: (file) => {
        finished++;
        this.doneBytes += file.size;
        this.activeBytes = 0;
        this.setStatus(byFile.get(file)!, 'done', 'Done');
        update();
      },
      onError: (file, message) => {
        finished++;
        failed++;
        this.doneBytes += file.size;
        this.activeBytes = 0;
        this.setStatus(byFile.get(file)!, 'failed', `Failed: ${message}`);
        update();
      },
    };

    for (const r of rows) this.setStatus(r, 'pending', 'Waiting');
    for (const r of this.rows) r.checkbox.disabled = true;
    this.toolbar.querySelectorAll('input').forEach((i) => (i.disabled = true));
    this.controller = new AbortController();
    this.cancelBtn.hidden = false;
    this.refresh();
    update();

    let result: string;
    try {
      const run = this.mode === 'zip' ? runZip : runQueue;
      await run(this.adapter, this.folder.name, rows.map((r) => r.file), progress, this.controller.signal);
      result = this.mode === 'zip' ? 'Zip saved to your Downloads.' : 'All files sent to your Downloads.';
      if (failed) result += ` ${failed} failed. They stay selected; press Download to retry them.`;
      const { problem } = await backgroundStatus();
      if (problem) result += ` (Saved via page links. ${problem})`;
    } catch (error) {
      result = error instanceof AbortedError ? 'Cancelled.' : `Stopped: ${errorMessage(error)}`;
      for (const r of rows) if (r.state === 'pending' || r.state === 'active') this.setStatus(r, 'pending', '');
    }

    // Keep only the files that still need downloading selected, so pressing
    // Download again retries exactly those.
    for (const r of this.rows) r.checkbox.disabled = false;
    for (const r of rows) r.checkbox.checked = r.state !== 'done';
    this.toolbar.querySelectorAll('input').forEach((i) => (i.disabled = false));
    this.controller = null;
    this.cancelBtn.hidden = true;
    this.refresh();
    this.summary.textContent = result;
  }
}
