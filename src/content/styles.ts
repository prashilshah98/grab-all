export const css = `
:host { all: initial; }
* { box-sizing: border-box; }

.root {
  --bg: #ffffff;
  --fg: #111827;
  --muted: #6b7280;
  --line: #e5e7eb;
  --accent: #2563eb;
  --accent-fg: #ffffff;
  --ok: #15803d;
  --bad: #b91c1c;
  --warn-bg: #fef3c7;
  --warn-fg: #92400e;
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--fg);
}
@media (prefers-color-scheme: dark) {
  .root {
    --bg: #1f2937;
    --fg: #f3f4f6;
    --muted: #9ca3af;
    --line: #374151;
    --accent: #3b82f6;
    --ok: #4ade80;
    --bad: #f87171;
    --warn-bg: #451a03;
    --warn-fg: #fcd34d;
  }
}

button { font: inherit; cursor: pointer; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); color: var(--fg); padding: 8px 14px; min-height: 40px; }
button:disabled { opacity: .5; cursor: default; }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); font-weight: 600; }

.fab {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
  background: var(--accent); color: var(--accent-fg); border: none;
  border-radius: 999px; padding: 12px 18px; font-weight: 600;
  box-shadow: 0 4px 16px rgba(0,0,0,.3);
}

.panel {
  position: fixed; right: 16px; bottom: 76px; z-index: 2147483647;
  width: min(440px, calc(100vw - 32px)); max-height: min(75vh, 680px);
  display: flex; flex-direction: column;
  background: var(--bg); border: 1px solid var(--line); border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0,0,0,.35); overflow: hidden;
}
.panel[hidden] { display: none; }

header { display: flex; align-items: center; gap: 8px; padding: 12px 12px 8px 16px; border-bottom: 1px solid var(--line); }
header .title { flex: 1; min-width: 0; }
header h2 { font-size: 15px; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
header .sub { color: var(--muted); font-size: 12px; }
header button { border: none; min-height: 32px; padding: 4px 10px; font-size: 18px; }

.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 8px 16px; border-bottom: 1px solid var(--line); }
.toolbar label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
.modes { display: inline-flex; gap: 12px; margin-left: auto; }

.warn { margin: 8px 16px 0; padding: 8px 10px; border-radius: 8px; background: var(--warn-bg); color: var(--warn-fg); font-size: 13px; }
.warn[hidden] { display: none; }

.list { list-style: none; margin: 0; padding: 4px 0; overflow-y: auto; flex: 1; min-height: 80px; }
.list li { display: grid; grid-template-columns: auto 1fr auto; gap: 2px 10px; align-items: center; padding: 6px 16px; }
.list li + li { border-top: 1px solid var(--line); }
.list .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.list .size { color: var(--muted); font-size: 12px; }
.list .status { grid-column: 2 / 4; font-size: 12px; color: var(--muted); }
.list .status:empty { display: none; }
.list li.done .status { color: var(--ok); }
.list li.failed .status { color: var(--bad); }
.list li.active .status { color: var(--accent); }
input[type=checkbox], input[type=radio] { width: 18px; height: 18px; margin: 0; accent-color: var(--accent); }

.message { padding: 24px 16px; text-align: center; color: var(--muted); }
.message.error { color: var(--bad); }

footer { padding: 10px 16px 14px; border-top: 1px solid var(--line); display: grid; gap: 8px; }
.bar { height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; }
.bar > div { height: 100%; width: 0; background: var(--accent); transition: width .2s; }
.summary { font-size: 12px; color: var(--muted); }
.actions { display: flex; gap: 8px; justify-content: flex-end; }

@media (max-width: 520px) {
  .panel { left: 8px; right: 8px; width: auto; bottom: 72px; max-height: 78vh; }
}
`;
