#!/usr/bin/env bash
# Static checks: syntax, manifest shape, permissions, privacy (no network / eval).
set -euo pipefail
cd "$(dirname "$0")/.."
fail=0
for f in content.js popup.js; do node --check "$f" || fail=1; done
node -e '
const m = require("./manifest.json");
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const errs = [];
if (m.manifest_version !== 3) errs.push("manifest_version != 3");
if (!eq(m.permissions, ["storage"])) errs.push("permissions must be exactly [storage]");
if (!eq(m.host_permissions, ["https://x.com/*", "https://twitter.com/*"])) errs.push("host_permissions mismatch");
const cs = m.content_scripts && m.content_scripts[0];
if (!cs || cs.run_at !== "document_start") errs.push("content script must run at document_start");
if (m.background) errs.push("no background worker expected");
const fs = require("fs");
for (const p of ["popup.html","popup.css","content.css","README.md","icons/icon16.png","icons/icon48.png","icons/icon128.png"])
  if (!fs.existsSync(p)) errs.push("missing " + p);
const src = fs.readFileSync("content.js", "utf8");
if (!/const SELECTORS\s*=/.test(src) || !/const LABELS\s*=/.test(src)) errs.push("content.js must define SELECTORS and LABELS");
for (const l of ["en","es","fr","de","ru","ro","pt","ja"]) if (!new RegExp("\\b" + l + "\\s*:").test(src)) errs.push("LABELS missing " + l);
if (errs.length) { console.error(errs.join("\n")); process.exit(1); }
' || fail=1
if grep -nE '\b(fetch|XMLHttpRequest|eval|WebSocket|sendBeacon|importScripts)\s*\(|new Function' content.js popup.js popup.html; then
  echo "network/eval usage found"; fail=1
fi
if grep -nE 'src="https?:|href="https?:' popup.html; then echo "remote resource in popup"; fail=1; fi
[ "$fail" = 0 ] && echo "STATIC: PASS" || { echo "STATIC: FAIL"; exit 1; }
