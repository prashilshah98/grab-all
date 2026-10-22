import { findAdapter } from './adapters';
import { Panel } from './ui';

const adapter = findAdapter(location.hostname);
if (adapter && !document.getElementById('grab-all-root')) {
  const panel = new Panel(adapter);
  // Single-page apps (gofile) change the URL without reloading, so keep checking.
  let lastUrl = '';
  const check = () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    panel.onUrlChange(adapter.matches(new URL(lastUrl)));
  };
  check();
  setInterval(check, 1000);
}
