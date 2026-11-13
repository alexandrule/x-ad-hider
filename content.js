/*
 * X Ad Hider: content script (runs at document_start on x.com / twitter.com).
 *
 * This script only *detects and tags* elements. Hiding is done by content.css,
 * keyed on classes this script puts on <html>. That way, settings changes
 * apply live without rescanning anything.
 *
 * Maintenance: when X changes its markup, edit SELECTORS / LABELS below.
 */
(() => {
  'use strict';

  // ===========================================================================
  // CONFIG: the only place that should need edits when X changes markup.
  // ===========================================================================
  const SELECTORS = {
    root: '#react-root',                         // stable app root; observed once
    cell: '[data-testid="cellInnerDiv"]',        // one virtualized list row
    tweet: 'article[data-testid="tweet"]',       // a post
    placement: '[data-testid="placementTracking"]', // present on promoted posts (and some videos)
    timestamp: 'a[href*="/status/"] time',       // organic posts always link their time
    tweetText: '[data-testid="tweetText"]',      // post body: never scanned for labels
    quote: 'div[role="link"]',                   // quoted post inside a post
    card: '[data-testid="card.wrapper"]',        // link preview card
    userCell: '[data-testid="UserCell"]',        // account row (Who to follow, search, ...)
    trend: '[data-testid="trend"]',              // trend row (sidebar + Explore)
    sidebar: '[data-testid="sidebarColumn"]',
    sidebarModule: 'aside, section',             // a sidebar card
    heading: 'h2',
    premiumLink: 'a[href^="/i/premium"], a[href^="/i/verified"]',
  };

  // Localized strings. `ad` = exact label text on a promoted item.
  // `promotedBy` = prefix used on promoted trends ("Promoted by Acme").
  // `adFrom` = prefix of the footer line on newer promoted posts ("Ad from acme.com").
  //   Only `en` is confirmed; the others are best-effort guesses.
  // `modules` = headings of suggestion modules (optional "suggest" category).
  const LABELS = {
    en: { ad: ['Ad', 'Promoted'], promotedBy: ['Promoted by'], adFrom: ['Ad from'],
          modules: ['Who to follow', 'Relevant people', 'Topics to follow', 'You might like'] },
    es: { ad: ['Anuncio', 'Promocionado'], promotedBy: ['Promocionado por'], adFrom: ['Anuncio de'],
          modules: ['A quién seguir', 'Personas relevantes', 'Temas para seguir', 'Quizá te guste'] },
    fr: { ad: ['Publicité', 'Sponsorisé'], promotedBy: ['Sponsorisé par'], adFrom: ['Publicité de'],
          modules: ['Suggestions', 'Personnes pertinentes', 'Sujets à suivre', 'Vous pourriez aimer'] },
    de: { ad: ['Anzeige', 'Gesponsert'], promotedBy: ['Gesponsert von'], adFrom: ['Anzeige von'],
          modules: ['Wem folgen?', 'Relevante Personen', 'Themen zum Folgen', 'Das könnte dir gefallen'] },
    ru: { ad: ['Реклама', 'Продвигается'], promotedBy: ['Продвигается', 'Реклама от'], adFrom: ['Реклама от'],
          modules: ['Кого читать', 'Актуальные пользователи', 'Темы, которые стоит читать', 'Вам может понравиться'] },
    ro: { ad: ['Reclamă', 'Promovat'], promotedBy: ['Promovat de'], adFrom: ['Reclamă de la'],
          modules: ['Pe cine să urmărești', 'Persoane relevante', 'Subiecte de urmărit', 'S-ar putea să-ți placă'] },
    pt: { ad: ['Anúncio', 'Promovido'], promotedBy: ['Promovido por'], adFrom: ['Anúncio de'],
          modules: ['Quem seguir', 'Pessoas relevantes', 'Tópicos para seguir', 'Você talvez goste'] },
    ja: { ad: ['広告', 'プロモーション'], promotedBy: ['プロモーション'],
          modules: ['おすすめユーザー', '関連性の高いアカウント', 'フォローするトピック', 'おすすめ'] },
  };

  const DEFAULTS = {
    enabled: true, debug: false,
    optPremium: false, optSidecards: false, optSuggest: false, optGrok: false,
  };
  const OPT_CLASS = {
    optPremium: ['xah-opt-premium', 'premium'],
    optSidecards: ['xah-opt-sidecards', 'sidecards'],
    optSuggest: ['xah-opt-suggest', 'suggest'],
    optGrok: ['xah-opt-grok', 'grok'],
  };
  const ATTR_DONE = 'data-xah';
  const ATTR_CAT = 'data-xah-cat';
  const TOTAL_KEY = 'totalHidden';
  const TOTAL_FLUSH_MS = 2000;

  // ===========================================================================
  // Settings → <html> classes (assume "on" immediately so ads never flash).
  // ===========================================================================
  const html = document.documentElement;
  html.classList.add('xah-on');
  let settings = { ...DEFAULTS };

  function applySettings() {
    html.classList.toggle('xah-on', !!settings.enabled);
    html.classList.toggle('xah-debug', !!settings.debug);
    for (const key in OPT_CLASS) html.classList.toggle(OPT_CLASS[key][0], !!settings[key]);
  }
  function isActive(cat) {
    if (!settings.enabled) return false;
    if (cat === 'ad') return true;
    for (const key in OPT_CLASS) if (OPT_CLASS[key][1] === cat) return !!settings[key];
    return false;
  }

  // ===========================================================================
  // Label matching (language-aware with fallback to all languages).
  // ===========================================================================
  const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const ALL = { ad: new Set(), promotedBy: [], adFrom: [], modules: new Set() };
  for (const l of Object.values(LABELS)) {
    l.ad.forEach(s => ALL.ad.add(norm(s)));
    l.promotedBy.forEach(s => ALL.promotedBy.push(norm(s)));
    (l.adFrom || []).forEach(s => ALL.adFrom.push(norm(s)));
    l.modules.forEach(s => ALL.modules.add(norm(s)));
  }
  let langCache = { lang: null, ad: null, modules: null };
  function primary() {
    const lang = (html.lang || '').toLowerCase().split('-')[0];
    if (langCache.lang !== lang) {
      const l = LABELS[lang];
      langCache = { lang, ad: l ? new Set(l.ad.map(norm)) : null, modules: l ? new Set(l.modules.map(norm)) : null };
    }
    return langCache;
  }
  const isAdLabel = t => { const p = primary(); return (p.ad && p.ad.has(t)) || ALL.ad.has(t); };
  const isModuleHeading = t => { const p = primary(); return (p.modules && p.modules.has(t)) || ALL.modules.has(t); };
  const startsWithAny = (t, list) => list.some(p => t === p || t.startsWith(p + ' '));
  // "Ad from acme.com" in one span, or "Ad from" with the domain in a separate link.
  const isAdLabelOrAdFrom = t => isAdLabel(t) || startsWithAny(t, ALL.adFrom);
  const isPromotedBy = t => isAdLabel(t) || ALL.promotedBy.some(p => t.startsWith(p + ' ') || t === p);

  // Leaf <span>s inside `scope` that are not inside links, post text, quotes or cards.
  function* labelSpans(scope) {
    for (const span of scope.querySelectorAll('span')) {
      if (span.firstElementChild) continue;
      if (span.closest('a')) continue;
      const skip = span.closest(`${SELECTORS.tweetText}, ${SELECTORS.quote}, ${SELECTORS.card}`);
      if (skip && scope.contains(skip) && skip !== scope) continue;
      yield span;
    }
  }
  function hasLabel(scope, test) {
    for (const span of labelSpans(scope)) if (test(norm(span.textContent))) return true;
    return false;
  }

  // ===========================================================================
  // Classification
  // ===========================================================================
  function hasOwnTimestamp(article) {
    for (const t of article.querySelectorAll(SELECTORS.timestamp)) {
      const q = t.closest(SELECTORS.quote);
      if (!q || !article.contains(q)) return true;
    }
    return false;
  }
  function isPromotedTweet(article) {
    // 1+2: data-testid scope + visible localized label in the post chrome.
    if (hasLabel(article, isAdLabelOrAdFrom)) return true;
    // 3: structural: tracking wrapper and no timestamp link of its own.
    return !!article.querySelector(SELECTORS.placement) && !hasOwnTimestamp(article);
  }

  // ===========================================================================
  // Tagging + counts
  // ===========================================================================
  const tally = { ad: 0, premium: 0, sidecards: 0, suggest: 0, grok: 0 };
  let storedTotal = 0;
  let pendingTotal = 0;
  let flushTimer = 0;

  function tag(el, cat) {
    const prev = el.getAttribute(ATTR_CAT);
    if (prev === cat) return;
    if (prev === 'ad') return; // ads always win
    if (prev) tally[prev]--;
    el.setAttribute(ATTR_CAT, cat);
    tally[cat]++;
    if (isActive(cat)) bumpTotal();
  }
  function bumpTotal() {
    pendingTotal++;
    if (!flushTimer) flushTimer = setTimeout(flushTotal, TOTAL_FLUSH_MS);
  }
  function flushTotal() {
    flushTimer = 0;
    if (!pendingTotal) return;
    const delta = pendingTotal;
    pendingTotal = 0;
    try {
      chrome.storage.local.get({ [TOTAL_KEY]: 0 }).then(r => {
        storedTotal = (r[TOTAL_KEY] || 0) + delta;
        return chrome.storage.local.set({ [TOTAL_KEY]: storedTotal });
      }).catch(() => {});
    } catch (_) { /* extension context invalidated (reloaded) */ }
  }
  function tabCount() {
    let n = 0;
    for (const cat in tally) if (isActive(cat)) n += tally[cat];
    return n;
  }

  // ===========================================================================
  // Per-node processing
  // ===========================================================================
  const cellHeading = cell => {
    const h = cell.querySelector(SELECTORS.heading);
    return h ? norm(h.textContent) : null;
  };

  // Is `cell` inside a suggestion module? Walk back over sibling cells until
  // we hit a post (no) or a module heading (yes).
  function inSuggestModule(cell) {
    let prev = cell.previousElementSibling;
    for (let i = 0; prev && i < 15; i++, prev = prev.previousElementSibling) {
      if (!prev.matches(SELECTORS.cell)) continue;
      if (prev.querySelector(SELECTORS.tweet)) return false;
      const h = cellHeading(prev);
      if (h !== null) return isModuleHeading(h);
    }
    return false;
  }
  // A module heading arrived after its rows (scrolling up): tag processed rows below it.
  function tagFollowingRows(headCell) {
    let next = headCell.nextElementSibling;
    for (let i = 0; next && i < 15; i++, next = next.nextElementSibling) {
      if (!next.matches(SELECTORS.cell)) continue;
      if (next.querySelector(SELECTORS.tweet) || cellHeading(next) !== null) break;
      if (next.hasAttribute(ATTR_DONE) && !next.hasAttribute(ATTR_CAT)) tag(next, 'suggest');
    }
  }

  function processCell(cell) {
    const article = cell.querySelector(SELECTORS.tweet);
    if (cell.hasAttribute(ATTR_DONE) && (!article || article.hasAttribute(ATTR_DONE))) return;
    if (!cell.firstElementChild) return; // not rendered yet; a later mutation will bring it back
    cell.setAttribute(ATTR_DONE, '1');

    if (article) {
      article.setAttribute(ATTR_DONE, '1');
      if (isPromotedTweet(article)) tag(cell, 'ad');
      return;
    }
    for (const uc of cell.querySelectorAll(SELECTORS.userCell)) {
      if (hasLabel(uc, isAdLabel)) { tag(cell, 'ad'); return; }
    }
    for (const tr of cell.querySelectorAll(SELECTORS.trend)) {
      if (hasLabel(tr, isPromotedBy)) { tag(cell, 'ad'); return; }
    }
    const h = cellHeading(cell);
    if (h !== null && isModuleHeading(h)) { tag(cell, 'suggest'); tagFollowingRows(cell); return; }
    if (h === null && inSuggestModule(cell)) { tag(cell, 'suggest'); return; }
    if (cell.querySelector(SELECTORS.premiumLink)) tag(cell, 'premium');
  }

  // Elements outside the virtualized list (sidebar trends, accounts, cards).
  function processLoose(el) {
    if (el.hasAttribute(ATTR_DONE)) return;
    if (el.matches(SELECTORS.trend)) {
      if (!el.firstElementChild) return;
      el.setAttribute(ATTR_DONE, '1');
      if (hasLabel(el, isPromotedBy)) tag(el, 'ad');
    } else if (el.matches(SELECTORS.userCell)) {
      if (!el.firstElementChild) return;
      el.setAttribute(ATTR_DONE, '1');
      if (hasLabel(el, isAdLabel)) tag(el, 'ad');
    } else if (el.matches(SELECTORS.sidebarModule)) {
      const h = el.querySelector(SELECTORS.heading);
      if (h && isModuleHeading(norm(h.textContent))) { el.setAttribute(ATTR_DONE, '1'); tag(el, 'suggest'); }
      else if (el.matches('aside') && el.querySelector(SELECTORS.premiumLink)) { el.setAttribute(ATTR_DONE, '1'); tag(el, 'sidecards'); }
    }
  }

  // Resolve one added node to the units we classify: its enclosing unit and
  // any units inside it. Only the added subtree is searched.
  const LOOSE = `${SELECTORS.trend}, ${SELECTORS.userCell}`;
  function handleNode(node, cells, loose) {
    if (node.nodeType !== 1) node = node.parentElement;
    if (!node) return;
    const cell = node.closest(SELECTORS.cell);
    if (cell) cells.add(cell);
    else {
      const l = node.closest(LOOSE);
      if (l) loose.add(l);
      const sb = node.closest(SELECTORS.sidebar);
      if (sb) {
        const mod = node.closest(SELECTORS.sidebarModule);
        if (mod && sb.contains(mod)) loose.add(mod);
      }
    }
    for (const c of node.querySelectorAll(SELECTORS.cell)) cells.add(c);
    for (const l of node.querySelectorAll(LOOSE)) if (!l.closest(SELECTORS.cell)) loose.add(l);
    if (node.closest(SELECTORS.sidebar) || node.querySelector(SELECTORS.sidebar)) {
      for (const m of node.querySelectorAll(SELECTORS.sidebarModule)) if (m.closest(SELECTORS.sidebar)) loose.add(m);
    }
  }

  // ===========================================================================
  // Observer: one MutationObserver on the stable app root, added nodes only,
  // batched per animation frame.
  // ===========================================================================
  let queue = new Set();
  let scheduled = false;

  function flush() {
    scheduled = false;
    const nodes = queue;
    queue = new Set();
    const cells = new Set();
    const loose = new Set();
    for (const n of nodes) if (n.isConnected) handleNode(n, cells, loose);
    for (const c of cells) { try { processCell(c); } catch (e) { /* never break the page */ } }
    for (const l of loose) { try { processLoose(l); } catch (e) { /* never break the page */ } }
  }
  function enqueue(node) {
    queue.add(node);
    if (!scheduled) { scheduled = true; requestAnimationFrame(flush); }
  }

  function start(root) {
    const mo = new MutationObserver(records => {
      for (const r of records) for (const n of r.addedNodes) enqueue(n);
    });
    mo.observe(root, { childList: true, subtree: true });
    enqueue(root); // whatever rendered before we attached
  }

  const existing = document.querySelector(SELECTORS.root);
  if (existing) start(existing);
  else {
    const waiter = new MutationObserver(() => {
      const root = document.querySelector(SELECTORS.root);
      if (root) { waiter.disconnect(); start(root); }
    });
    waiter.observe(html, { childList: true, subtree: true });
  }

  // ===========================================================================
  // Extension plumbing: settings, live updates, popup counts.
  // ===========================================================================
  try {
    chrome.storage.sync.get(DEFAULTS).then(s => { settings = { ...DEFAULTS, ...s }; applySettings(); }).catch(() => {});
    chrome.storage.local.get({ [TOTAL_KEY]: 0 }).then(r => { storedTotal = r[TOTAL_KEY] || 0; }).catch(() => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      let touched = false;
      for (const key in changes) if (key in DEFAULTS) { settings[key] = changes[key].newValue ?? DEFAULTS[key]; touched = true; }
      if (touched) applySettings();
    });
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg && msg.type === 'xah:getCount') {
        sendResponse({ tab: tabCount(), byCat: { ...tally }, total: storedTotal + pendingTotal });
      }
    });
  } catch (_) { /* extension context unavailable */ }
})();
