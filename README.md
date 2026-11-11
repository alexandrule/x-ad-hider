# X Ad Hider

A Manifest V3 Chrome extension that hides promoted posts, promoted accounts and promoted trends on X (`x.com` / `twitter.com`). Organic content and the page layout are left alone.

Optional toggles, all off by default, can also hide:

- Premium/Verified upsells
- the Subscribe / Get Verified sidebar cards
- the Who to follow, Relevant people and Topics to follow modules
- Grok entry points

It uses plain JavaScript, with no build step and no dependencies. It makes **no network requests**, collects **no analytics** and loads **no remote code**. The only permissions are `storage` and the host permissions for `https://x.com/*` and `https://twitter.com/*`.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder (the one containing `manifest.json`).
4. Open or reload x.com. Click the toolbar icon to open the popup.

After you edit any file, click the reload icon on the extension's card in `chrome://extensions`, then reload the X tab.

## Popup

| Control | Effect |
|---|---|
| Master switch | Turns all hiding on or off |
| Premium / Verified upsells | Hides Premium nav links and timeline upsell cells |
| Subscribe & Get Verified sidebar cards | Hides those cards in the right-hand sidebar |
| Who to follow, Relevant people, Topics | Hides suggestion modules in the timeline and sidebar |
| Grok / AI entry points | Hides Grok nav links and the Grok drawer |
| Show hidden items (debug) | Outlines items in red instead of hiding them |
| Hidden on this tab / in total | Item counts. The total is kept in `chrome.storage.local` |

Settings are stored in `chrome.storage.sync` and apply to open tabs immediately, with no reload.

## How detection works

`content.js` runs at `document_start` and **only tags** elements, by setting `data-xah-cat="ad|premium|sidecards|suggest|grok"`. `content.css` does all of the hiding, using classes that `content.js` puts on `<html>`:

```
xah-on  xah-debug  xah-opt-premium  xah-opt-sidecards  xah-opt-suggest  xah-opt-grok
```

Because of this split, toggling a setting only flips a class, so there is never a rescan. Hidden rows get `display: none` on the outer `cellInnerDiv`, and **nodes are never removed**, so X's virtualized list keeps measuring rows correctly and the page does not jump while you scroll.

**Promoted posts.** The signals are checked in this order:

1. **Stable `data-testid`s.** Every row is a `cellInnerDiv`, and the post inside it is an `article[data-testid="tweet"]`.
2. **A visible label.** The extension looks for a leaf `<span>` whose trimmed text *exactly* matches a localized "Ad"/"Promoted" string. It skips spans inside links (display names), the post text (`tweetText`), quoted posts and link cards, so a post that just *says* "Ad" is not hidden. Strings for the page's `<html lang>` are tried first, then the strings for all languages.
3. **Structure.** If the post has a `placementTracking` wrapper **and** no timestamp link of its own (`a[href*="/status/"] time`), it is treated as an ad. Neither signal is used alone, because organic video posts also have `placementTracking`.

**Promoted accounts and trends.** A `UserCell` or `trend` that contains the label, or the "Promoted by …" prefix, is tagged `ad`.

**Optional categories:**

- **Suggestion modules.** A row whose `h2` matches a module heading is tagged `suggest`, along with the rows under it, up to the next post. In the sidebar, the whole `aside`/`section` is tagged.
- **Premium upsells.** A non-post row with a `/i/premium…` or `/i/verified…` link is tagged `premium`. Premium nav links are hidden by CSS alone.
- **Sidebar cards.** A sidebar `aside` with one of those links is tagged `sidecards`. It is also matched by a CSS `:has()` rule, so it never flashes.
- **Grok.** `a[href^="/i/grok"]` and `[data-testid="GrokDrawer"]` are hidden by CSS alone.

**Performance.** There is a single `MutationObserver` on `#react-root`. X swaps the timeline container on every route change, but the root never changes. Only `addedNodes` are processed, each resolved to its enclosing row plus any rows inside it. The work is batched into one `requestAnimationFrame`. A processed row is marked `data-xah="1"` and is never checked again. A row that has not rendered yet is left unmarked, so it is picked up when its content arrives.

## Updating when X changes its markup

Everything you might need to change is in the `SELECTORS` and `LABELS` objects at the top of `content.js`.

1. Turn on **Show hidden items (debug)** in the popup. Ads that are still detected get a red outline. An ad without an outline is a miss.
2. Right-click the missed promoted post, choose **Inspect**, and find:
   - the row wrapper (normally `div[data-testid="cellInnerDiv"]`) → `SELECTORS.cell`
   - the post element → `SELECTORS.tweet`
   - the exact text of the "Ad"/"Promoted" span → add it to `LABELS.<lang>.ad`
   - whether `placementTracking` is still there, and what the timestamp link looks like → `SELECTORS.placement` / `SELECTORS.timestamp`
3. **Adding a language:** add an entry such as `it: { ad: ['Annuncio', 'Promosso'], promotedBy: ['Promosso da'], modules: ['Chi seguire'] }`. The key is the language part of `<html lang>`.
4. Never use the hashed CSS class names (`css-175oi2r`, `r-…`). They change all the time.
5. Run the tests (below), reload the extension, and check again with debug mode on.

## Tests

```sh
node test/run.mjs     # behaviour tests: headless Chrome + test/test.html fixture (Node 22+, Chrome installed)
./test/static.sh      # syntax, manifest/permissions, no network or eval usage
```

`test/test.html` loads the real `content.js` and `content.css` against mock X markup, with a stubbed `chrome.*` API. It covers:

- every category
- false-positive traps: post text "Ad", a user named "Promoted", a quoted "Promoted", organic video
- localized labels
- live toggles and debug mode
- lazily rendered rows
- counts
- the rule that the whole document is never rescanned

Set `CHROME=/path/to/chrome` if Chrome is not installed in the default macOS location.

## Known limits

- Detection depends on X's `data-testid`s and label texts. When X renames either, update the config as described above.
- Module headings and labels outside the eight bundled languages (EN, ES, FR, DE, RU, RO, PT, JA) only match through the structural signal for posts. Promoted accounts, promoted trends and modules are not detected in other languages until you add strings.
- Some of the localized strings for modules and "Promoted by" are best-effort. Check them in your locale and correct them if needed.
