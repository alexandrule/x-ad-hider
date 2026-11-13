# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Manifest V3 Chrome extension that hides promoted content on x.com / twitter.com. Plain JavaScript, **no build step, no dependencies, no package.json**. README.md is the user-facing doc and explains detection logic in depth. Read it before changing detection.

## Commands

```sh
node test/run.mjs     # behaviour tests (Node 22+, Chrome installed; set CHROME=/path/to/chrome if not at the default macOS path)
./test/static.sh      # syntax check, manifest/permission invariants, no network/eval usage
```

There is no per-test runner: `test/run.mjs` drives headless Chrome over CDP, loads `test/test.html` (which runs every case against the real `content.js`/`content.css` with a stubbed `chrome.*` API), and waits for `document.title` to become `PASS`/`FAIL`. To focus on one case, edit `test/test.html` or open it in Chrome directly (`--allow-file-access-from-files`) and read `#results`.

Manual check: load the folder unpacked at `chrome://extensions`, then after edits click reload on the extension card **and** reload the X tab.

## Architecture

- **Detect vs. hide are split.** `content.js` only tags elements with `data-xah-cat="ad|premium|sidecards|suggest|grok"`. `content.css` does all hiding, gated by classes on `<html>` (`xah-on`, `xah-debug`, `xah-opt-*`). A settings change flips a class and never triggers a rescan. Keep it that way.
- **Never remove nodes.** Hide the enclosing `cellInnerDiv` with `display: none`. X's virtualized list relies on the nodes staying in place to measure rows.
- **Incremental scanning.** One `MutationObserver` on `#react-root`; only `addedNodes` are processed, batched per `requestAnimationFrame`. Processed rows are marked `data-xah="1"` and never revisited. Rows not yet rendered are left unmarked so they are picked up later. Tests assert the whole document is never rescanned.
- **Promoted-post detection order:** `data-testid` scope → exact localized label in a leaf `<span>` (excluding links, `tweetText`, quoted posts, cards, to avoid false positives) → structural fallback (`placementTracking` **and** no own `/status/` timestamp; neither alone, because organic videos have `placementTracking`).
- **Markup maintenance lives in the `SELECTORS` and `LABELS` objects at the top of `content.js`.** Never use X's hashed class names (`css-…`, `r-…`). `LABELS` is keyed by the language part of `<html lang>`. That language is tried first, then all languages.
- **Settings:** `chrome.storage.sync` (live via `storage.onChanged`). The lifetime hidden count lives in `chrome.storage.local` (`totalHidden`, flushed on a throttle). The popup gets the per-tab count via `chrome.tabs.sendMessage({type: 'xah:getCount'})`.
- **`DEFAULTS` is duplicated** in `content.js` and `popup.js`. A new setting must be added to both, plus a checkbox in `popup.html` with the same `id`, a CSS gate in `content.css`, and (for a new category) an `OPT_CLASS` entry.

## Invariants enforced by `test/static.sh`

Changing any of these makes the static check fail:

- `permissions` must be exactly `["storage"]`; host permissions exactly x.com + twitter.com; no background worker; content script at `document_start`.
- No `fetch`, `XMLHttpRequest`, `eval`, `new Function`, `WebSocket`, `sendBeacon`, `importScripts` in `content.js`/`popup.js`/`popup.html`; no remote `src`/`href` in the popup.
- `content.js` must define `SELECTORS` and `LABELS`, with entries for `en es fr de ru ro pt ja`.
