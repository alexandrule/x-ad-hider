'use strict';
// Popup: reads/writes settings in chrome.storage.sync (content scripts pick
// changes up live via storage.onChanged) and shows hidden-item counts.
const DEFAULTS = {
  enabled: true, debug: false,
  optPremium: false, optSidecards: false, optSuggest: false, optGrok: false,
};
const TOTAL_KEY = 'totalHidden';
const $ = id => document.getElementById(id);

function render(s) {
  for (const key of Object.keys(DEFAULTS)) $(key).checked = !!s[key];
  $('opts').classList.toggle('off', !s.enabled);
}

async function init() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  render(s);
  for (const key of Object.keys(DEFAULTS)) {
    $(key).addEventListener('change', e => {
      chrome.storage.sync.set({ [key]: e.target.checked });
      if (key === 'enabled') $('opts').classList.toggle('off', !e.target.checked);
      setTimeout(refreshCounts, 100);
    });
  }
  refreshCounts();
}

async function refreshCounts() {
  const local = await chrome.storage.local.get({ [TOTAL_KEY]: 0 });
  let total = local[TOTAL_KEY] || 0;
  let tab = '—';
  try {
    // No "tabs" permission needed: query + sendMessage work without it.
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (active && active.id != null) {
      const res = await chrome.tabs.sendMessage(active.id, { type: 'xah:getCount' });
      if (res) { tab = String(res.tab); total = Math.max(total, res.total || 0); }
    }
  } catch (_) { /* not an X tab, or content script not loaded yet */ }
  $('tabCount').textContent = tab;
  $('totalCount').textContent = String(total);
}

init();
