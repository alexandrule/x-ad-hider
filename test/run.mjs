#!/usr/bin/env node
// Zero-dependency test runner: launches headless Chrome, opens test/test.html
// over the DevTools protocol (Node's built-in WebSocket), waits for the page to
// set document.title to PASS/FAIL, prints the results and exits 0 only on PASS.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = mkdtempSync(join(tmpdir(), 'xah-test-'));
const url = pathToFileURL(join(root, 'test', 'test.html')).href;

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, '--allow-file-access-from-files',
  '--remote-debugging-port=0', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

const cleanup = code => { try { chrome.kill(); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(code); };
const timer = setTimeout(() => { console.log('RESULT: FAIL (timeout)'); cleanup(1); }, 30000);

const wsUrl = await new Promise((res, rej) => {
  let buf = '';
  chrome.stderr.on('data', d => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) res(m[1]); });
  chrome.on('exit', c => rej(new Error('chrome exited ' + c)));
});
const port = new URL(wsUrl).port;
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;

await send('Page.enable');
await send('Page.navigate', { url });
let title = '';
for (let i = 0; i < 250; i++) {
  await new Promise(r => setTimeout(r, 100));
  title = await evaluate('document.title');
  if (title === 'PASS' || title === 'FAIL') break;
}
const text = await evaluate('document.getElementById("results") && document.getElementById("results").textContent');
console.log(text || 'RESULT: FAIL (no results rendered)');
clearTimeout(timer);
cleanup(title === 'PASS' ? 0 : 1);
