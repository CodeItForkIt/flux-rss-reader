'use strict';
/**
 * flux/core/fetcher.js
 * Shared RSS fetching, article extraction, element blocking, OPML parsing.
 * Used by both the Electron main process and the Express server.
 * All deps are ESM-only so we lazy-import them.
 */

let _Parser, _Readability, _JSDOM, _cheerio, _fetch, _CookieJar, _createDOMPurify, _purifyWindow;

async function loadDeps() {
  if (_fetch) return; // already loaded
  _Parser      = (await import('rss-parser')).default;
  const r      = await import('@mozilla/readability');
  _Readability = r.Readability;
  const j      = await import('jsdom');
  _JSDOM       = j.JSDOM;
  _cheerio     = await import('cheerio');
  const nf     = await import('node-fetch');
  _fetch       = nf.default;
  const tc     = await import('tough-cookie');
  _CookieJar   = tc.CookieJar;
  const dp     = await import('dompurify');
  _createDOMPurify = dp.default;
  _purifyWindow = new _JSDOM('').window; // DOMPurify needs a DOM window to sanitize against
}

// Every piece of HTML that ends up in the client's dangerouslySetInnerHTML
// (article body, RSS-fallback excerpts, error notices with user-influenced
// values interpolated in) MUST pass through this first. Readability/cheerio
// only reshape markup — they do not strip <script>, event handler attributes,
// or javascript: URLs, so without this step any page a feed links to (or a
// page later compromised after you subscribed) can run arbitrary JS in
// Flux's origin, with full access to every /api/* endpoint.
function sanitizeArticleHtml(html) {
  if (!html) return html;
  const DOMPurify = _createDOMPurify(_purifyWindow);
  return DOMPurify.sanitize(html, {
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i, // blocks javascript:, data: (except relative/http/mailto/tel)
    ADD_ATTR: ['target'], // Readability output sometimes sets target="_blank" on links
    FORBID_TAGS: ['style'], // inline <style> can still smuggle exfil via CSS (background-image beacons); visual styling isn't needed for reading
  });
}

// ─── Cookie jars (per domain, shared within a process) ───────────────────────
// In Docker/server mode each user gets their own CookieStore passed in.
const _defaultJars = {};

function getCookieJar(domain, jars) {
  const store = jars || _defaultJars;
  if (!store[domain]) store[domain] = new _CookieJar();
  return store[domain];
}

// ─── HTTP fetch with cookie jar ───────────────────────────────────────────────
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function fetchWithCookies(url, opts = {}, cookieJars) {
  await loadDeps();
  const domain   = new URL(url).hostname;
  const jar      = getCookieJar(domain, cookieJars);

  // YouTube/Google can serve a consent/cookie-wall HTML page instead of
  // the real response (e.g. feeds/videos.xml) when no consent cookie is
  // present — most reliably reproduced from EU-region IPs, but it isn't
  // strictly geo-gated, so we always pre-seed this. YT001 is the
  // long-standing "accept all" sentinel value Google's own consent
  // banner sets; setting it ourselves skips the interstitial entirely.
  if (/(^|\.)youtube\.com$|(^|\.)google\.com$/i.test(domain)) {
    const existing = await jar.getCookieString(url);
    if (!/(?:^|;\s*)CONSENT=/.test(existing)) {
      try { await jar.setCookie('CONSENT=YES+; Domain=.youtube.com; Path=/', url); } catch {}
      try { await jar.setCookie('CONSENT=YES+; Domain=.google.com; Path=/', url); } catch {}
    }
  }

  const cookieStr = await jar.getCookieString(url);

  const headers = {
    'User-Agent':      UA,
    'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control':   'no-cache',
    ...(cookieStr ? { Cookie: cookieStr } : {}),
    ...(opts.headers || {}),
  };

  // 15s timeout — a single hung connection shouldn't block the whole
  // parallel feed fetch, leaving "Fetching feeds…" spinner forever.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || 15000);
  let resp;
  try {
    resp = await _fetch(url, { ...opts, headers, redirect: 'follow', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }

  // Persist Set-Cookie
  const raw = resp.headers.raw?.()?.['set-cookie'] || [];
  for (const c of raw) {
    try { await jar.setCookie(c, url); } catch {}
  }
  return resp;
}

// Bare _fetch() calls (archive.ph and googlebot-ua below) previously had NO
// timeout at all — unlike fetchWithCookies, which has always aborted at
// 15s. A hung connection to either host could stall an article-open
// indefinitely. This gives any fetch the same abort-based timeout.
async function withTimeout(url, opts, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await _fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── Paywall bypass chain ─────────────────────────────────────────────────────
// Each strategy: { name, minLength, run(url, cookieJars) -> html|null }
// Exported so Settings/FeedRules UI can list available strategies by name.
//
// Per-strategy timeouts are staggered and shrink down the fallback chain:
// 'direct' is the common case and gets the most patience, while later
// strategies are already a degraded fallback path, so a slow one shouldn't
// eat as much of the budget. Worst case (all four fail slowly) is bounded
// to ~26s, leaving headroom under Vercel's 30s function maxDuration for
// the readability/cheerio pass that runs afterward.
const FETCH_STRATEGIES = {
  direct: {
    minLength: 5000,
    run: async (url, cookieJars) => {
      const resp = await fetchWithCookies(url, { timeoutMs: 9000 }, cookieJars);
      return resp.ok ? await resp.text() : null;
    },
  },
  '12ft.io': {
    minLength: 3000,
    run: async (url, cookieJars) => {
      const resp = await fetchWithCookies(`https://12ft.io/proxy?q=${encodeURIComponent(url)}`, { timeoutMs: 6000 }, cookieJars);
      return resp.ok ? await resp.text() : null;
    },
  },
  'archive.ph': {
    minLength: 3000,
    run: async (url) => {
      const resp = await withTimeout(`https://archive.ph/newest/${url}`, { headers: { 'User-Agent': UA }, redirect: 'follow' }, 6000);
      return resp.ok ? await resp.text() : null;
    },
  },
  'googlebot-ua': {
    minLength: 5000,
    run: async (url) => {
      const resp = await withTimeout(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
      }, 5000);
      return resp.ok ? await resp.text() : null;
    },
  },
};
const DEFAULT_STRATEGY_ORDER = ['direct', '12ft.io', 'archive.ph', 'googlebot-ua'];

// order: optional array of strategy names controlling priority — lets the
// user customize fetch order globally (Settings) or per-feed (feed rules),
// e.g. putting '12ft.io' first for known-paywalled sites.
async function fetchArticleHtml(url, cookieJars, order) {
  await loadDeps();
  const names = (order && order.length ? order : DEFAULT_STRATEGY_ORDER).filter(n => FETCH_STRATEGIES[n]);

  for (const name of names) {
    const strategy = FETCH_STRATEGIES[name];
    try {
      const html = await strategy.run(url, cookieJars);
      if (html && html.length > strategy.minLength) return { html, source: name };
    } catch (e) { console.warn(`[fetch/${name}]`, e.name === 'AbortError' ? 'timed out' : e.message); }
  }

  throw new Error('All fetch strategies exhausted for: ' + url);
}

// ─── Element blocking ─────────────────────────────────────────────────────────
// ─── Lazy-loaded image fixup ──────────────────────────────────────────────────
// Most sites ship <img> tags with src pointing at a tiny placeholder (or no
// src at all) and the real URL in data-src/data-srcset/data-original/etc,
// swapped in by JS on scroll. We don't run that JS, so Readability sees a
// placeholder and either drops the image or keeps a broken one. This
// promotes the first real-looking URL it can find into `src`/`srcset`.
const LAZY_SRC_ATTRS    = ['data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'data-actualsrc', 'data-srcset'];
const PLACEHOLDER_SRC_RE = /^(data:image\/(gif|png);base64,|about:blank$|.*1x1.*\.(gif|png)$|.*blank\.(gif|png)$)/i;

function normalizeLazyImages($) {
  $('img').each((_, el) => {
    const $el = $(el);
    const src = $el.attr('src');
    const needsFix = !src || PLACEHOLDER_SRC_RE.test(src);
    if (!needsFix) return;

    for (const attr of LAZY_SRC_ATTRS) {
      const val = $el.attr(attr);
      if (!val) continue;
      if (attr.includes('srcset')) {
        // srcset is a comma-separated "url size" list — take the first URL
        const first = val.split(',')[0].trim().split(/\s+/)[0];
        if (first) { $el.attr('src', first); $el.attr('srcset', val); break; }
      } else {
        $el.attr('src', val);
        break;
      }
    }
  });
}

// ─── Lead/header image extraction ─────────────────────────────────────────────
function extractLeadImage($) {
  return (
    $('meta[property="og:image"]').attr('content') ||
    $('meta[property="og:image:secure_url"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content') ||
    $('meta[name="twitter:image:src"]').attr('content') ||
    $('link[rel="image_src"]').attr('href') ||
    null
  );
}

// Walks up from a just-removed element's former parent, removing ancestors
// that are now empty as a direct result of that removal — bounded to the
// removed element's own ancestry, not a sweep of the whole document. A
// blanket sweep would also catch elements that were already empty for
// unrelated reasons (many real pages have empty <span>/<div> elements used
// purely as CSS/JS hooks), which risks stripping page structure a rule had
// nothing to do with — especially in the early applyBlockRules pass, which
// runs on the raw page before Readability has even parsed it.
function pruneNowEmptyAncestors($, parentEl) {
  let $p = $(parentEl);
  while ($p.length && $p.children().length === 0 && !$p.text().trim() &&
         $p.find('img,video,iframe,svg,picture,audio').length === 0) {
    const $next = $p.parent();
    $p.remove();
    $p = $next;
  }
}

function applyBlockRules(html, feedRules) {
  if (!feedRules || (!feedRules.cssSelectors?.length && !feedRules.htmlPatterns?.length)) return html;
  const $ = _cheerio.load(html);

  if (feedRules.cssSelectors?.length) {
    // Applied one at a time rather than $(selectors.join(', ')) as a
    // single call. cheerio's selector engine (css-select) supports less
    // CSS than a real browser does — no pseudo-elements, for instance —
    // and the selectors here were built by walking a real browser's DOM
    // (see buildSelector in App.jsx), so they're only ever guaranteed
    // valid *there*, not necessarily here. With one combined selector
    // string, a single selector css-select can't parse throws and (since
    // this was wrapped in one try/catch) silently kills removal for every
    // *other* selector too — including a brand-new one just picked,
    // making the element picker look completely broken for anything you
    // pick from then on, even though the actual problem is one unrelated
    // selector saved earlier. Isolating each one means a bad selector only
    // ever affects itself.
    for (const sel of feedRules.cssSelectors) {
      try {
        const $matched = $(sel);
        const parents = $matched.map((_, el) => $(el).parent()[0]).get();
        $matched.remove();
        for (const p of parents) pruneNowEmptyAncestors($, p);
      } catch (e) { console.warn('[block-rule] selector failed, skipping just this one:', sel, e.message); }
    }
  }
  if (feedRules.htmlPatterns?.length) {
    for (const pattern of feedRules.htmlPatterns) {
      try {
        const re = new RegExp(pattern, 'i');
        const $matched = $('*').filter((_, el) => {
          return re.test($(el).text()) && $(el).children().length === 0;
        }).closest('[class],[id]');
        const parents = $matched.map((_, el) => $(el).parent()[0]).get();
        $matched.remove();
        for (const p of parents) pruneNowEmptyAncestors($, p);
      } catch {}
    }
  }

  return $.html();
}

// ─── Readability ──────────────────────────────────────────────────────────────
function extractReadable(html, url) {
  // virtualConsole suppresses "Could not parse CSS stylesheet" warnings —
  // jsdom's CSS parser doesn't support many modern CSS features (container
  // queries, cascade layers, :has(), etc.), so it logs an error for almost
  // every article on a modern site. These errors are harmless (Readability
  // only needs the DOM structure, not CSS rendering) but very noisy.
  const virtualConsole = new (require('jsdom').VirtualConsole)();
  virtualConsole.on('jsdomError', () => {}); // swallow jsdom errors
  const dom    = new _JSDOM(html, { url, virtualConsole });
  const reader = new _Readability(dom.window.document, { charThreshold: 100, keepClasses: true });
  return reader.parse();
}

// ─── Full article fetch pipeline ─────────────────────────────────────────────
async function fetchArticle(url, feedRules, cookieJars, rssFallback) {
  await loadDeps();

  let html, source;
  try {
    ({ html, source } = await fetchArticleHtml(url, cookieJars, feedRules?.fetchStrategyOrder));
  } catch (fetchErr) {
    // All fetch strategies failed — fall back to the RSS summary/description
    // if the caller supplied one (common for paywalled sites like Bloomberg
    // that include their article text in the RSS item itself). Show a notice
    // so the user knows they're seeing a partial version.
    if (rssFallback?.content || rssFallback?.summary) {
      const text = rssFallback.content || rssFallback.summary || '';
      const notice = `<p style="background:rgba(245,166,35,0.12);border:1px solid rgba(245,166,35,0.3);border-radius:6px;padding:10px 14px;font-size:13px;color:#f5a623;margin-bottom:16px;">⚠ Article could not be fetched — showing RSS excerpt. <a href="${url}" style="color:inherit;text-decoration:underline;">Open original ↗</a></p>`;
      return {
        title:       rssFallback.title   || '',
        byline:      rssFallback.byline  || '',
        content:     sanitizeArticleHtml(notice + `<p>${text}</p>`),
        excerpt:     text.slice(0, 300),
        siteName:    '',
        bypassSource:'rss-fallback',
        length:      text.length,
      };
    }
    throw fetchErr;
  }

  // The link can point straight at a non-HTML file (most commonly a PDF —
  // e.g. Daring Fireball linking to a press release PDF). resp.text() still
  // "succeeds" on these since node-fetch doesn't care about content-type,
  // but it decodes raw binary as UTF-8 garbage, which then gets fed into
  // cheerio/Readability and produces nonsense output. Detect by magic
  // bytes/signature up front and short-circuit with a clear notice instead.
  if (/^%PDF-/.test(html)) {
    const notice = `<p style="background:rgba(245,166,35,0.12);border:1px solid rgba(245,166,35,0.3);border-radius:6px;padding:10px 14px;font-size:13px;color:#f5a623;margin-bottom:16px;">⚠ This link points to a PDF, not an article — Flux can't extract readable text from it. <a href="${url}" style="color:inherit;text-decoration:underline;">Open the PDF ↗</a></p>`;
    return {
      title: '', byline: '', content: sanitizeArticleHtml(notice), excerpt: 'PDF document',
      siteName: '', bypassSource: source, length: 0, isNonHtml: true,
    };
  }

  // One cheerio pass over the raw HTML: fix lazy-loaded images so
  // Readability sees real URLs, and grab the page's lead/header image
  // (og:image etc.) before anything gets stripped.
  const $ = _cheerio.load(html);
  normalizeLazyImages($);
  const leadImage = extractLeadImage($);
  const fixedHtml = $.html();

  const cleaned  = applyBlockRules(fixedHtml, feedRules);
  const readable = extractReadable(cleaned, url);
  let content    = readable?.content || '<p>Could not extract article content.</p>';

  if (leadImage && readable?.content) {
    const startsWithImage = /^\s*(<figure[^>]*>\s*)?<(img|picture)\b/i.test(content);
    const hasImageEarly   = /<img\b/i.test(content.slice(0, 600));
    if (!startsWithImage && !hasImageEarly) {
      const safeImg = leadImage.replace(/"/g, '&quot;');
      content = `<figure class="flux-lead-image"><img src="${safeImg}" alt="" loading="lazy" /></figure>` + content;
    }
  }

  // Second block-rules pass, on the fully-assembled final content rather
  // than the raw pre-Readability page HTML applyBlockRules ran on above.
  // Necessary because some elements the rules target don't exist yet at
  // that earlier point — the lead image figure just above is synthesized
  // by Flux itself *after* Readability runs, so a rule picked against it
  // (e.g. via the element picker, which shows the rendered reader output)
  // would have nothing to match against in the earlier pass: it'd get
  // silently skipped there, then unconditionally re-added by the lead-
  // image step regardless, making the rule look like it "did nothing" on
  // every re-fetch. The earlier pass stays as-is — stripping junk from the
  // raw page before Readability parses it measurably helps Readability's
  // own content-detection heuristics — this just adds a final safety net
  // that also covers anything assembled after that point.
  content = applyBlockRules(content, feedRules);

  return {
    title:       readable?.title   || '',
    byline:      readable?.byline  || '',
    content:     sanitizeArticleHtml(content),
    excerpt:     readable?.excerpt || '',
    siteName:    readable?.siteName || '',
    bypassSource: source,
    length:      readable?.length || 0,
    leadImage:   leadImage || null,
  };
}

// rss-parser usually normalizes RSS <pubDate> and Atom <published>/<updated>
// into item.isoDate, but this isn't airtight — some Atom feeds (e.g. feeds
// that only set <updated>, or use a date format rss-parser's normalizer
// doesn't recognize) leave isoDate undefined while still having a raw,
// parseable date string in a different field. Previously we fell straight
// back to `new Date()` (i.e. "right now") whenever isoDate was missing —
// which silently made genuinely old items sort as if freshly published
// every single time the feed was refetched. That's a much worse failure
// mode than just trying harder to find a real date first.
function resolveItemDate(item, feedTitle) {
  const candidates = [item.isoDate, item.pubDate, item.published, item.updated, item.date];
  for (const c of candidates) {
    if (!c) continue;
    const d = new Date(c);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  // Genuinely no usable date anywhere on the item — only now do we fall
  // back, and we say so, so this is debuggable instead of invisible.
  console.warn(`[flux] no parseable date for item "${item.title}" in feed "${feedTitle}" — using current time as fallback`);
  return new Date().toISOString();
}

// YouTube channel RSS feeds normally look like:
//   https://www.youtube.com/feeds/videos.xml?channel_id=UCxxxxxxxx
// Swapping channel_id for playlist_id and prefixing the channel ID with
// UULF (instead of UC) points at YouTube's "uploads, videos only" playlist
// — which excludes Shorts and live streams entirely, at the source. This
// is undocumented but has been stable for years and is dramatically more
// reliable than guessing from the title/description, since YouTube's RSS
// items don't expose video duration at all. Returns null if the URL isn't
// a recognizable channel-id-based YouTube feed URL (e.g. it's already a
// playlist URL, or a third-party YouTube-RSS proxy).
function toShortsFreeYoutubeUrl(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('youtube.com')) return null;
    const channelId = u.searchParams.get('channel_id');
    if (!channelId || !channelId.startsWith('UC')) return null;
    u.searchParams.delete('channel_id');
    u.searchParams.set('playlist_id', 'UULF' + channelId.slice(2));
    return u.toString();
  } catch { return null; }
}

// YouTube's own channel RSS feed XML doesn't expose a channel avatar
// anywhere (only per-video thumbnails) — confirmed against the actual feed
// schema. The only way to get the real avatar is a secondary fetch of the
// channel's HTML page, which reliably exposes it via the standard
// `og:image` meta tag. Costs one extra request per YouTube feed per
// refresh; worth it since the generic favicon service otherwise returns
// YouTube's own generic play-button icon for every single YouTube feed,
// making them indistinguishable from each other in a collapsed sidebar.
async function fetchYoutubeChannelAvatar(feedUrl, cookieJars) {
  try {
    // Derive the channel page URL straight from channel_id in the feed
    // URL, which every youtube.com/feeds/videos.xml URL is built from
    // (including the Shorts-free playlist_id variant, since that's also
    // derived from a UC... channel ID — see toShortsFreeYoutubeUrl).
    const u = new URL(feedUrl);
    const channelId = u.searchParams.get('channel_id')
      || (u.searchParams.get('playlist_id')||'').replace(/^UULF/, 'UC');
    if (!channelId || !channelId.startsWith('UC')) return null;
    const channelUrl = `https://www.youtube.com/channel/${channelId}`;
    const resp = await fetchWithCookies(channelUrl, {}, cookieJars);
    const html = await resp.text();
    const match = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
    return match ? match[1] : null;
  } catch { return null; }
}

// ─── RSS feed fetch ───────────────────────────────────────────────────────────
async function fetchFeed(feedConfig, cookieJars) {
  await loadDeps();
  const parser = new _Parser({
    customFields: {
      item: [
        ['media:thumbnail', 'mediaThumbnail'],
        ['media:group',     'mediaGroup'],
        ['yt:videoId',      'ytVideoId'],
      ],
    },
    requestOptions: { rejectUnauthorized: false },
  });

  // If "Hide Shorts" is on and this is a channel-id-based YouTube feed,
  // fetch the Shorts-free uploads-only playlist variant instead — Shorts
  // never arrive in the first place rather than being filtered after the
  // fact. Falls back to the original URL (and the title/path heuristic
  // below) for feeds this doesn't apply to.
  const shortsFreeUrl = (feedConfig.hideShorts && feedConfig.isYoutube)
    ? toShortsFreeYoutubeUrl(feedConfig.url) : null;
  const fetchUrl = shortsFreeUrl || feedConfig.url;

  const resp     = await fetchWithCookies(fetchUrl, {}, cookieJars);
  const feedText = await resp.text();

  // YouTube (and Google infra generally) can occasionally return an HTML
  // consent/cookie-wall page instead of the actual Atom feed, especially
  // without prior cookies set. Feeding that into the XML parser produces
  // confusing low-level errors like "Unquoted attribute value" instead of
  // a clear "this isn't a feed" message — detect it up front.
  if (/^\s*<!DOCTYPE html/i.test(feedText) || /<html[\s>]/i.test(feedText.slice(0, 200))) {
    throw new Error(`Expected XML feed but got an HTML page from ${fetchUrl} (possible consent/cookie wall or geo-block)`);
  }

  let feed;
  try {
    feed = await parser.parseString(feedText);
  } catch (parseErr) {
    throw new Error(`Failed to parse feed XML from ${fetchUrl}: ${parseErr.message}`);
  }

  // If the Shorts-free playlist returned suspiciously few items (< 3),
  // fall back to the original channel feed — some channels' UULF playlist
  // isn't populated, which would make the feed look empty even though the
  // channel has recent uploads. Better to show some Shorts than no content.
  if (shortsFreeUrl && (feed.items || []).length < 3 && feedConfig.url !== fetchUrl) {
    console.warn(`[flux] UULF playlist returned ${(feed.items||[]).length} items for ${feedConfig.name}, falling back to channel feed`);
    const fallbackResp = await fetchWithCookies(feedConfig.url, {}, cookieJars);
    const fallbackText = await fallbackResp.text();
    if (/^\s*<!DOCTYPE html/i.test(fallbackText) || /<html[\s>]/i.test(fallbackText.slice(0, 200))) {
      throw new Error(`Expected XML feed but got an HTML page from ${feedConfig.url} (possible consent/cookie wall or geo-block)`);
    }
    try {
      feed = await parser.parseString(fallbackText);
    } catch (parseErr) {
      throw new Error(`Failed to parse fallback feed XML from ${feedConfig.url}: ${parseErr.message}`);
    }
  }

  const items = (feed.items || []).map((item, i) => {
    const isYoutube = !!item.ytVideoId || feedConfig.url.includes('youtube.com');
    const videoId   = item.ytVideoId   || extractYtId(item.link || '');
    const thumbnail =
      item.mediaThumbnail?.['$']?.url ||
      item.mediaGroup?.['media:thumbnail']?.[0]?.['$']?.url ||
      (videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null);

    // Heuristic Shorts detection (fallback for feeds where the playlist_id
    // swap above doesn't apply — e.g. already a playlist URL, or the feed
    // came from a third-party YouTube-RSS proxy with a different shape).
    // Two independent signals: the #shorts tag creators near-universally
    // add to the title/description, and the /shorts/ URL path segment
    // that YouTube sometimes uses even when a video isn't explicitly
    // tagged. Neither is perfect alone (duration isn't exposed in RSS at
    // all), but checking both catches more than either by itself.
    const mediaDescription = item.mediaGroup?.['media:description']?.[0] || '';
    const hasShortsTag  = /#shorts\b/i.test(`${item.title || ''} ${mediaDescription}`);
    const hasShortsPath = /\/shorts\//i.test(item.link || '');
    const isShort = isYoutube && (hasShortsTag || hasShortsPath);
    // Stable ID: prioritize guid/id (Atom's <id> / RSS's <guid>) over link
    // for identity hashing. This matters more than it looks: <link> is NOT
    // guaranteed stable by either spec, and several real feeds exploit
    // that — Daring Fireball's "Linked List" items, for instance, point
    // <link> at whatever external article is being linked to (not at
    // daringfireball.net), and Gruber edits/retargets those after
    // publishing. If link changes for what's logically the same item, a
    // link-first hash mints a brand-new article ID on the next refresh —
    // which looks exactly like "the old article vanished and a new one
    // appeared," because that's literally what happens downstream. guid
    // (Atom <id> / RSS <guid>) exists specifically to be a permanent,
    // content-independent identifier per spec, so it should win whenever
    // present.
    //
    // IMPORTANT: rss-parser exposes RSS 2.0's <guid> as item.guid, but
    // Atom's <id> comes through as item.id instead — a different field
    // entirely. The check below previously only looked at item.guid, which
    // is always undefined for Atom feeds (DF included), so it silently
    // fell through to item.link every single time — exactly the failure
    // mode this comment describes wanting to prevent. Both are checked now.
    //
    // Below THAT, before finally falling back to raw array position: a
    // feed with no guid/id/link at all (rare, but real — some minimal or
    // broken feeds genuinely omit all three) previously fell straight to
    // `${feedId}-pos-${i}`, keyed purely on the item's index in this
    // fetch's array. That's fragile in a specific, easy-to-hit way: if the
    // feed's item order shifts at all between fetches — a new item gets
    // inserted at the top, one gets removed, the publisher re-sorts —
    // every subsequent item's index shifts too, so position i now refers
    // to a genuinely different article than it did last time. The article
    // that used to own that ID keeps it, misattributing its read/starred
    // state to whatever article now happens to sit in that slot, while the
    // real previously-read article looks unread again under a new one.
    // Title+pubDate is a much better last resort: both fields belong to
    // the article itself, not its position, so they stay attached to the
    // right item regardless of how the feed reorders things around it —
    // this only degrades to pure position when a feed is missing all four
    // of guid, id, link, AND title+pubDate, which is vanishingly rare.
    const contentKey = (item.title && (item.pubDate || item.isoDate)) ? `content:${item.title}|${item.pubDate || item.isoDate}` : null;
    const rawKey = item.guid || item.id || item.link || contentKey || `${feedConfig.id}-pos-${i}`;
    let hash = 0;
    for (let c = 0; c < rawKey.length; c++) { hash = ((hash << 5) - hash + rawKey.charCodeAt(c)) | 0; }
    const stableKey = (Math.abs(hash) >>> 0).toString(36) + '_' + rawKey.replace(/[^a-zA-Z0-9._~-]/g,'_').slice(-40);

    return {
      id:         `${feedConfig.id}__${stableKey}`,
      feedId:     feedConfig.id,
      title:      decodeHtmlEntities(item.title || 'Untitled'),
      link:       item.link  || item.guid || item.id || '',
      summary:    decodeHtmlEntities(stripHtml(item.contentSnippet || item.summary || '').slice(0, 300)),
      date:       resolveItemDate(item, feed.title || feedConfig.name),
      isRead:     false,
      isStarred:  false,
      isYoutube,
      videoId:    videoId || null,
      thumbnail,
      duration:   item['itunes:duration'] || null,
      isShort,
    };
  });

  // Use Google's favicon service for the initial render — it's instant
  // (just a URL construction, no HTTP round-trip required at fetch time).
  // The YouTube channel avatar fetch (which requires scraping the channel
  // page) is intentionally moved out of this hot path: we return the fast
  // favicon URL now so articles appear immediately, and the caller can
  // optionally do the avatar upgrade in the background. The 300-800ms
  // channel-page fetch per YouTube feed was a major contributor to slow
  // refresh times when a user has multiple YouTube channels subscribed.
  //
  // Only computed when feedConfig doesn't already have a favicon — this
  // previously ran unconditionally on every single fetch, which meant a
  // real, already-fetched-and-persisted YouTube channel avatar (see
  // fetchFeedAvatar below) got silently clobbered back to the generic
  // fallback on the very next refresh, every time — the avatar upgrade
  // could never actually stick.
  let favicon = feedConfig.favicon || null;
  if (!favicon) {
    try {
      const homeUrl = feed.link || feedConfig.url;
      const origin  = new URL(homeUrl).origin;
      favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(origin)}&sz=32`;
    } catch {}
  }

  return { feedId: feedConfig.id, title: feed.title || feedConfig.name, items, favicon };
}

// Fetch the real YouTube channel avatar as a background task after articles
// are already showing. Separated from fetchFeed so it doesn't delay the
// critical path. Returns null if the fetch fails or this isn't a YouTube feed.
async function fetchFeedAvatar(feedConfig, cookieJars) {
  if (!feedConfig.isYoutube && !feedConfig.url.includes('youtube.com')) return null;
  return fetchYoutubeChannelAvatar(feedConfig.url, cookieJars);
}

function extractYtId(url) {
  try {
    const u = new URL(url);
    return u.searchParams.get('v') || (u.pathname.length > 1 ? u.pathname.split('/').pop() : null);
  } catch { return null; }
}

function decodeHtmlEntities(str) {
  if (!str) return str;
  // Numeric entities: &#8217; → ' (and hex &#x2019;)
  str = str.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex,16)));
  str = str.replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(parseInt(dec,10)));
  // Named entities we care about in titles/summaries
  const named = { '&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' ',
    '&mdash;':'—','&ndash;':'–','&ldquo;':'"','&rdquo;':'"','&lsquo;':'\u2018','&rsquo;':'\u2019',
    '&hellip;':'…','&copy;':'©','&reg;':'®','&trade;':'™','&bull;':'•','&middot;':'·' };
  return str.replace(/&[a-z]+;/gi, e => named[e] ?? e);
}

function stripHtml(str) {
  return str.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ─── OPML ─────────────────────────────────────────────────────────────────────
function buildOpml(feeds, folders) {
  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const feedLine = (f, indent = '    ') =>
    `${indent}<outline type="rss" text="${esc(f.name)}" title="${esc(f.name)}" xmlUrl="${esc(f.url)}"` +
    (f.cssSelectors?.length  ? ` flux:cssSelectors="${esc(f.cssSelectors.join('\n'))}"` : '') +
    (f.htmlPatterns?.length  ? ` flux:htmlPatterns="${esc(f.htmlPatterns.join('\n'))}"` : '') +
    (f.inlineBrowser         ? ` flux:inlineBrowser="true"`                             : '') +
    ' />';

  const byFolder = {};
  for (const f of feeds) {
    const key = f.folder || '__root';
    (byFolder[key] = byFolder[key] || []).push(f);
  }

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head>',
    `    <title>Flux feed export</title>`,
    `    <dateCreated>${new Date().toUTCString()}</dateCreated>`,
    '  </head>',
    '  <body>',
  ];

  for (const folder of folders) {
    const ffeeds = byFolder[folder.id] || [];
    if (!ffeeds.length) continue;
    lines.push(`    <outline text="${esc(folder.name)}" title="${esc(folder.name)}" flux:icon="${esc(folder.icon || '◈')}">`);
    for (const f of ffeeds) lines.push(feedLine(f, '      '));
    lines.push('    </outline>');
  }
  for (const f of (byFolder['__root'] || [])) lines.push(feedLine(f));

  lines.push('  </body>', '</opml>');
  return lines.join('\n');
}

function parseOpml(xml) {
  const folders = [], feeds = [];
  const src = xml.replace(/<!--[\s\S]*?-->/g, '').replace(/\r\n?/g, '\n');

  const attr = (tag, name) => {
    const re = new RegExp(`(?:^|\\s)${name.replace(':', '\\:')}="([^"]*)"`, 'i');
    const m  = tag.match(re);
    return m ? m[1]
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>') : null;
  };

  let currentFolder = null;
  const bodyStart   = src.search(/<body[\s>]/i);
  const body        = src.slice(bodyStart === -1 ? 0 : bodyStart);
  const tokenRe     = /(<outline([^>]*?)(\/?>))|(<\/outline>)/gi;
  let m;

  while ((m = tokenRe.exec(body)) !== null) {
    if (m[4]) { currentFolder = null; continue; }
    const selfClose = m[3] === '/>';
    const attrs     = m[2];
    const xmlUrl    = attr(attrs, 'xmlUrl');
    const text      = attr(attrs, 'text') || attr(attrs, 'title') || '';

    if (xmlUrl) {
      feeds.push({
        url:           xmlUrl,
        name:          text || new URL(xmlUrl).hostname,
        folderName:    currentFolder,
        cssSelectors:  (attr(attrs, 'flux:cssSelectors') || '').split('\n').filter(Boolean),
        htmlPatterns:  (attr(attrs, 'flux:htmlPatterns') || '').split('\n').filter(Boolean),
        inlineBrowser: attr(attrs, 'flux:inlineBrowser') === 'true',
      });
    } else if (!selfClose && text) {
      currentFolder = text;
      if (!folders.find(f => f.name === text)) {
        folders.push({ name: text, icon: attr(attrs, 'flux:icon') || '◈' });
      }
    }
  }
  return { folders, feeds };
}

// ─── Ollama dedup/clustering ──────────────────────────────────────────────────
// Uses nomic-embed-text (or any embed model) to get vectors, then cosine clusters.
async function ollamaCluster(articles, ollamaUrl = 'http://localhost:11434', model = 'nomic-embed-text', opts = {}) {
  const threshold = 0.82; // cosine similarity threshold for "same story"
  // Two articles never cluster together unless they're this close in time —
  // otherwise very generic, recurring headlines (e.g. weekly roundups, or
  // two unrelated stories that happen to use similar phrasing) get lumped
  // together just because their embeddings are similar, regardless of how
  // far apart they actually happened. Defaults to 3 days, per-user configurable.
  const maxDaysApart     = Number.isFinite(opts.maxDaysApart) ? opts.maxDaysApart : 3;
  const maxGapMs         = maxDaysApart * 24 * 60 * 60 * 1000;
  // Same-source exclusion: a single outlet often runs several of its own
  // articles on the same story (a live-blog, a follow-up, an update) — those
  // are near-duplicate embeddings but aren't "other outlets covering the
  // same story", which is what the grouping feature is actually for. Default
  // on; toggleable in case someone wants that behavior back.
  const excludeSameSource = opts.excludeSameSource !== false;

  // Ensure the embedding model is available — a 501 from /api/embed means
  // the specified model doesn't support embeddings (e.g. user has llama3.2
  // loaded but not an embedding model). Try to pull it automatically first
  // so the feature "just works" without manual `ollama pull nomic-embed-text`.
  try {
    const check = await _fetch(`${ollamaUrl}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model }),
    });
    if (!check.ok) {
      // Model not present — pull it (streaming; wait for completion)
      console.log(`[flux] Ollama: pulling embedding model ${model}…`);
      const pull = await _fetch(`${ollamaUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: model, stream: false }),
      });
      if (!pull.ok) throw new Error(`Could not pull ${model}: ${pull.status}`);
      console.log(`[flux] Ollama: ${model} ready`);
    }
  } catch (e) {
    console.warn('[flux] Ollama embedding model check/pull failed:', e.message);
    // Continue anyway — maybe it'll work
  }

  // Embed each article title+summary
  const texts = articles.map(a => `${a.title}. ${a.summary || ''}`);
  const vectors = [];

  for (const text of texts) {
    try {
      // Try /api/embed first (current Ollama API). If it fails with any
      // non-2xx status, fall back to /api/embeddings (older Ollama builds).
      // Don't rely on the specific error code (404 vs 501 vs 400) as it
      // varies by version.
      let resp = await _fetch(`${ollamaUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: text }),
      });
      let data;
      if (resp.ok) {
        data = await resp.json();
        vectors.push(data.embeddings?.[0] || null);
      } else {
        // Fallback to legacy endpoint
        resp = await _fetch(`${ollamaUrl}/api/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, prompt: text }),
        });
        if (resp.ok) {
          data = await resp.json();
          vectors.push(data.embedding || null);
        } else {
          vectors.push(null);
        }
      }
    } catch {
      vectors.push(null);
    }
  }

  // Cosine similarity
  const cosine = (a, b) => {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]**2; nb += b[i]**2; }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
  };

  // Union-find clustering
  const parent = articles.map((_, i) => i);
  const find   = (i) => parent[i] === i ? i : (parent[i] = find(parent[i]));
  const union  = (a, b) => { parent[find(a)] = find(b); };

  const articleTimeMs = articles.map(a => a._dateMs ?? (a.date ? new Date(a.date).getTime() : 0));

  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      if (cosine(vectors[i], vectors[j]) < threshold) continue;
      if (excludeSameSource && articles[i].feedId && articles[i].feedId === articles[j].feedId) continue;
      if (articleTimeMs[i] && articleTimeMs[j] && Math.abs(articleTimeMs[i] - articleTimeMs[j]) > maxGapMs) continue;
      union(i, j);
    }
  }

  // Assign cluster IDs
  const clusterMap = {};
  const result = articles.map((a, i) => {
    const root = find(i);
    if (!clusterMap[root]) clusterMap[root] = `cl-${root}-${Date.now()}`;
    return { ...a, clusterId: clusterMap[root] };
  });

  // Count cluster sizes and null out singletons
  const sizes = {};
  for (const a of result) sizes[a.clusterId] = (sizes[a.clusterId] || 0) + 1;
  return result.map(a => ({
    ...a,
    clusterId:   sizes[a.clusterId] > 1 ? a.clusterId  : null,
    clusterSize: sizes[a.clusterId] > 1 ? sizes[a.clusterId] : null,
  }));
}

// ─── Ollama group-coverage summary ────────────────────────────────────────────
// Given several articles covering the same story (a cluster), ask a local
// Ollama chat model for a short synthesized summary of what's being reported
// across all of them, noting any differences in framing/emphasis if relevant.
async function ollamaSummarize(items, ollamaUrl = 'http://localhost:11434', model = 'llama3.2') {
  await loadDeps();
  const sources = items.map((a,i)=>`${i+1}. [${a.source||'Unknown source'}] ${a.title}\n${a.summary||''}`).join('\n\n');

  const prompt = items.length === 1
    ? `Here is an article:\n\n${sources}\n\nWrite a detailed 4-6 sentence summary covering the key facts, context, and significance. Include specific details, names, numbers, or quotes if relevant. Do not repeat the title verbatim or mention that you were given an article — just summarize the content.`
    : `Here are ${items.length} articles from different sources covering the same news story:\n\n${sources}\n\nWrite a detailed 4-6 sentence summary synthesizing what's being reported. Include specific facts, names, and figures where available. If sources differ meaningfully in framing or facts, note the discrepancy. Do not mention that you were given multiple articles or repeat the source list — just summarize the story.`;

  const resp = await _fetch(`${ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      options: { num_predict: 600 },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!resp.ok) throw new Error(`Ollama returned ${resp.status}`);
  const data = await resp.json();
  return (data.message?.content || data.response || '').trim();
}

// ─── Daily digest ─────────────────────────────────────────────────────────────
async function ollamaDailyDigest(articles, ollamaUrl = 'http://localhost:11434', model = 'llama3.2') {
  await loadDeps();
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const recent = articles
    .filter(a => new Date(a.date).getTime() > cutoff)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 30);

  if (recent.length === 0) throw new Error('No articles from the past 24 hours');

  const articleList = recent
    .map((a, i) => `${i+1}. [${a.source || 'Unknown'}] ${a.title}\n${a.summary || ''}`)
    .join('\n\n');

  const prompt = `Here are the most recent articles from someone's RSS reader from the past 24 hours:\n\n${articleList}\n\nWrite a daily digest — a 3-5 paragraph briefing on the most significant stories. Group related stories. Lead with the most important developments. Be specific: include names, numbers, and key facts. Write in a clear, journalistic tone. Don't mention that you were given a list of articles.`;

  const resp = await _fetch(`${ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      options: { num_predict: 1200 },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!resp.ok) throw new Error(`Ollama returned ${resp.status}`);
  const data = await resp.json();
  return (data.message?.content || data.response || '').trim();
}

// ─── Feed discovery ───────────────────────────────────────────────────────────
// Takes whatever URL the person actually has at hand — a YouTube channel
// page, a single YouTube video, a channel @handle, or just a normal
// website — and resolves it to an actual RSS/Atom feed URL. This is the
// "paste anything, we'll figure it out" entry point for adding feeds
// without needing to already know how to construct a feed URL.
async function resolveFeedUrl(input, cookieJars) {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  let parsed;
  try { parsed = new URL(url); }
  catch { throw new Error('Not a valid URL'); }

  // Already a feed URL (youtube.com/feeds/videos.xml, or ends in
  // .xml/.rss/.atom, or has /feed in the path) — pass through as-is.
  if (/\.xml($|\?)|\/feeds\/|\.(rss|atom)($|\?)|\/feed\/?($|\?)/i.test(parsed.pathname + parsed.search)) {
    return { feedUrl: url, name: null, isYoutube: parsed.hostname.includes('youtube.com') };
  }

  if (parsed.hostname.includes('youtube.com') || parsed.hostname === 'youtu.be') {
    return resolveYoutubeFeedUrl(parsed, cookieJars);
  }

  // Generic site: fetch the page and look for standard feed autodiscovery
  // <link> tags in <head>. Sites sometimes expose more than one — a main
  // feed plus a comments feed, or a feed per category/section — so collect
  // all of them rather than just the first match and let the caller decide
  // whether to prompt for a choice.
  const resp = await fetchWithCookies(url, {}, cookieJars);
  const html = await resp.text();
  const pageTitleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const pageTitle = pageTitleMatch ? decodeHtmlEntities(pageTitleMatch[1].trim()) : null;

  const linkTags = html.match(/<link\b[^>]*>/gi) || [];
  const seen = new Set();
  const candidates = [];
  for (const tag of linkTags) {
    const isFeedType = /type=["'](?:application\/rss\+xml|application\/atom\+xml)["']/i.test(tag);
    const isAlternate = /rel=["']alternate["']/i.test(tag);
    if (!isFeedType || !isAlternate) continue;
    const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    let feedUrl;
    try { feedUrl = new URL(hrefMatch[1], url).toString(); } catch { continue; }
    if (seen.has(feedUrl)) continue;
    seen.add(feedUrl);
    const titleMatch = tag.match(/title=["']([^"']+)["']/i);
    candidates.push({ feedUrl, name: titleMatch ? decodeHtmlEntities(titleMatch[1]) : pageTitle, isYoutube: false });
  }

  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) return { multiple: true, feeds: candidates };

  // No autodiscovery link at all — offer OpenRSS as a fallback rather than
  // just failing outright. OpenRSS (openrss.org) generates a best-effort
  // feed for sites that don't publish one themselves; it's a third-party
  // service, so this is surfaced to the caller as a suggestion (with a
  // link/credit) rather than silently substituted in.
  return {
    noFeedFound: true,
    pageTitle,
    openRssSuggestion: `https://openrss.org/${parsed.hostname}${parsed.pathname}`.replace(/\/$/, ''),
  };
}

// Resolve any youtube.com/youtu.be URL shape to a channel_id-based feed URL.
async function resolveYoutubeFeedUrl(parsedUrl, cookieJars) {
  const path = parsedUrl.pathname;

  // /channel/UCxxxx — channel ID is right there, no lookup needed
  let m = path.match(/\/channel\/(UC[\w-]+)/);
  if (m) return { feedUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${m[1]}`, name: null, isYoutube: true };

  // /@handle, /c/name, /user/name, or a video URL (/watch, youtu.be/<id>)
  // all require fetching the page and extracting the channel ID from its
  // HTML — YouTube doesn't expose a direct handle→ID API without auth.
  let pageUrl = parsedUrl.toString();
  if (parsedUrl.hostname === 'youtu.be') {
    pageUrl = `https://www.youtube.com/watch?v=${path.slice(1)}`;
  }

  const resp = await fetchWithCookies(pageUrl, {}, cookieJars);
  const html = await resp.text();
  // YouTube embeds the canonical channel ID in a few reliable, stable
  // places regardless of page type (channel page, video page, etc).
  const idMatch = html.match(/"channelId":"(UC[\w-]+)"/) || html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]+)"/);
  if (!idMatch) throw new Error("Couldn't find a channel ID on that page — try the channel's /channel/UC... URL directly if you have it.");

  const titleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
  return {
    feedUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${idMatch[1]}`,
    name: titleMatch ? decodeHtmlEntities(titleMatch[1]) : null,
    isYoutube: true,
  };
}

module.exports = {
  loadDeps, fetchWithCookies, fetchArticleHtml, fetchArticle,
  applyBlockRules, extractReadable, fetchFeed, fetchFeedAvatar,
  buildOpml, parseOpml, ollamaCluster, ollamaSummarize, ollamaDailyDigest,
  getCookieJar, resolveFeedUrl, sanitizeArticleHtml,
  FETCH_STRATEGY_NAMES: DEFAULT_STRATEGY_ORDER,
};
