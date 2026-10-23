/* HACKERSBUN v2 client. Reads data/news.json (built server-side by .github/workflows/v2-news.yml).
   No third-party requests, no innerHTML with feed data, all view state lives in the URL so any view can be shared. */
'use strict';
(() => {
  const DATA_URL = 'data/news.json', RECHECK_MS = 5 * 60e3, STALE_H = 3, PAGE = 40;
  const TOPICS = { security: 'AI security', governance: 'AI governance', regulation: 'Regulation & policy', incidents: 'Incidents & threats', research: 'Research' };
  const $ = s => document.querySelector(s);
  const S = { data: null, items: [], byId: new Map(), q: '', topics: [], range: 0, sort: 'new', src: null, tag: '', action: false, story: '', page: 1, lastVisit: 0, pending: null };

  /* ---------- helpers ---------- */
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  }
  const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600); }
  function ago(ts) {
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 90) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago'; const d = Math.round(s / 86400); return d === 1 ? 'yesterday' : d + ' days ago';
  }
  const fmt = ts => new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fmtDay = ts => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const pageBase = () => location.origin + location.pathname;
  const storyUrl = it => pageBase() + '?story=' + it.id;
  async function copyText(text, html) {
    try {
      if (html && window.ClipboardItem && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
      } else await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const a = h('textarea', { class: 'sr-only', 'aria-hidden': 'true' }); a.value = text; document.body.append(a); a.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ } a.remove(); return ok;
    }
  }
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // text with search words wrapped in <mark>, built from text nodes only
  function marked(text, words) {
    if (!words.length) return [text];
    const f = fold(text), hits = [];
    for (const w of words) { let i = 0; while ((i = f.indexOf(w, i)) !== -1) { hits.push([i, i + w.length]); i += w.length; } }
    if (!hits.length) return [text];
    hits.sort((a, b) => a[0] - b[0]); const out = []; let pos = 0;
    for (const [a, b] of hits) { if (a < pos) continue; if (a > pos) out.push(text.slice(pos, a)); out.push(h('mark', {}, text.slice(a, b))); pos = b; }
    out.push(text.slice(pos)); return out;
  }

  /* ---------- URL state ---------- */
  function readUrl() {
    const p = new URLSearchParams(location.search);
    S.q = p.get('q') || ''; S.topics = (p.get('topics') || '').split(',').filter(t => TOPICS[t]);
    S.range = [0, 1, 7, 30].includes(+p.get('range')) ? +p.get('range') : 0; S.sort = ['new', 'old', 'rel', 'cov'].includes(p.get('sort')) ? p.get('sort') : 'new';
    S.src = p.get('src') ? p.get('src').split(',') : null; S.tag = p.get('tag') || ''; S.action = p.get('action') === '1'; S.story = p.get('story') || ''; S.page = 1;
  }
  function viewParams() {
    const p = new URLSearchParams();
    if (S.q.trim()) p.set('q', S.q.trim()); if (S.topics.length) p.set('topics', S.topics.join(','));
    if (S.range) p.set('range', S.range); if (S.sort !== 'new') p.set('sort', S.sort);
    if (S.src) p.set('src', S.src.join(',')); if (S.tag) p.set('tag', S.tag); if (S.action) p.set('action', '1');
    return p;
  }
  function writeUrl() {
    const p = S.story ? new URLSearchParams({ story: S.story }) : viewParams(), qs = p.toString().replace(/%2C/gi, ',');
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  }
  function syncControls() {
    $('#q').value = S.q; $('#sort').value = S.sort; $('#actionOnly').checked = S.action;
    for (const r of document.querySelectorAll('input[name=range]')) r.checked = +r.value === S.range;
  }

  /* ---------- filtering ---------- */
  function matches(it, skip) {
    if (skip !== 'topic' && S.topics.length && !it.topics.some(t => S.topics.includes(t))) return false;
    if (skip !== 'src' && S.src && !S.src.includes(it.sourceId) && !it.also.some(a => S.src.includes(a.sourceId))) return false;
    if (S.range && it.ts < Date.now() - S.range * 864e5) return false;
    if (S.tag && !it.tags.includes(S.tag)) return false;
    if (S.action && !it.action) return false;
    if (S.words.length && !S.words.every(w => it._hay.includes(w))) return false;
    return true;
  }
  function view() {
    if (S.story) { const it = S.byId.get(S.story); return it ? [it] : []; }
    const l = S.items.filter(it => matches(it));
    const by = { new: (a, b) => b.ts - a.ts, old: (a, b) => a.ts - b.ts, rel: (a, b) => b.score - a.score || b.ts - a.ts, cov: (a, b) => b.also.length - a.also.length || b.ts - a.ts }[S.sort];
    return l.sort(by);
  }

  /* ---------- rendering ---------- */
  function render() {
    S.words = fold(S.q).split(/\s+/).filter(Boolean);
    const l = view(), shown = l.slice(0, S.page * PAGE), list = $('#list');
    list.replaceChildren(...shown.map(card));
    $('#moreBtn').hidden = shown.length >= l.length;
    if (!l.length) list.append(h('li', { class: 'empty' }, S.story ? 'This shared story is no longer in the 30-day window.' : 'No stories match these filters. ', S.story ? null : h('button', { type: 'button', class: 'btn small', onclick: reset }, 'Reset filters')));
    const total = S.items.length, stories = l.length;
    $('#count').replaceChildren(S.story ? 'Shared story' : h('span', {}, h('b', {}, String(stories)), ` of ${total} stories`, stories < total ? ' match' : '', ` · ${S.dupes} duplicate reports merged`));
    renderNotice(); renderTopicChips(); renderSources(); renderTag(); writeUrl();
    $('#digestBtn').disabled = $('#csvBtn').disabled = !l.length;
  }
  function card(it) {
    const main = it.topics[0] || 'security', isNew = S.lastVisit && it.firstSeen > S.lastVisit;
    const art = h('article', { class: 'card t-' + main, id: 's-' + it.id, 'aria-labelledby': 't-' + it.id },
      h('div', { class: 'meta' },
        h('span', { class: 'src' }, it.source),
        h('time', { datetime: it.published, title: fmt(it.ts) }, ago(it.ts)),
        isNew ? h('span', { class: 'badge new' }, 'New') : null,
        it.action ? h('span', { class: 'badge act', title: 'Mentions active exploitation, deadlines, adopted rules or consultations' }, 'Needs attention') : null),
      h('h2', { class: 'ttl', id: 't-' + it.id }, h('a', { href: it.url, target: '_blank', rel: 'noopener noreferrer' }, ...marked(it.title, S.words), h('span', { class: 'sr-only' }, ' (opens in a new tab)'))),
      it.summary ? h('p', { class: 'sum' }, ...marked(it.summary, S.words)) : null,
      h('div', { class: 'tagrow' },
        it.topics.map(t => h('button', { type: 'button', class: 'tpc t-' + t, 'aria-label': 'Filter by topic ' + TOPICS[t], onclick: () => setFilter(() => { S.topics = [t]; }) }, TOPICS[t])),
        it.tags.map(t => h('button', { type: 'button', class: 'tag', 'aria-label': 'Filter by tag ' + t, onclick: () => setFilter(() => { S.tag = t; }) }, '#' + t))),
      it.also.length ? h('details', { class: 'also' },
        h('summary', {}, `Also covered by ${it.also.length} other source${it.also.length > 1 ? 's' : ''}`),
        h('ul', {}, it.also.map(a => h('li', {}, h('a', { href: a.url, target: '_blank', rel: 'noopener noreferrer' }, a.source + ': ' + a.title, h('span', { class: 'sr-only' }, ' (opens in a new tab)')), ' · ' + fmtDay(Date.parse(a.published)))))) : null,
      h('div', { class: 'acts' },
        h('button', { type: 'button', class: 'btn small', onclick: () => shareStory(it) }, 'Copy link', h('span', { class: 'sr-only' }, ' to: ' + it.title)),
        h('button', { type: 'button', class: 'btn small', onclick: () => teams(it) }, 'Copy for Teams', h('span', { class: 'sr-only' }, ': ' + it.title))));
    return h('li', {}, art);
  }
  function renderTopicChips() {
    const counts = {}; for (const it of S.items) if (matches(it, 'topic')) for (const t of it.topics) counts[t] = (counts[t] || 0) + 1;
    $('#topicChips').replaceChildren(...Object.entries(TOPICS).map(([k, label]) => h('button', { type: 'button', class: 'chip t-' + k, 'aria-pressed': String(S.topics.includes(k)), onclick: () => setFilter(() => { S.topics = S.topics.includes(k) ? S.topics.filter(x => x !== k) : [...S.topics, k]; }) }, label, h('span', { class: 'n' }, String(counts[k] || 0)), h('span', { class: 'sr-only' }, ' stories'))));
  }
  function renderSources() {
    const counts = {}; for (const it of S.items) if (matches(it, 'src')) for (const id of [it.sourceId, ...it.also.map(a => a.sourceId)]) counts[id] = (counts[id] || 0) + 1;
    const srcs = S.data.sources.slice().sort((a, b) => a.name.localeCompare(b.name)), sel = S.src ? S.src.length : srcs.length;
    $('#srcSel').textContent = S.src ? `(${sel} of ${srcs.length} selected)` : `(all ${srcs.length})`;
    const ul = $('#srcList');
    if (ul.children.length !== srcs.length) { // built once per data load; afterwards updated in place so focus is never lost
      ul.replaceChildren(...srcs.map(s => h('li', {}, h('label', {},
        h('input', { type: 'checkbox', value: s.id, onchange: e => setFilter(() => {
          const all = S.data.sources.map(x => x.id), cur = new Set(S.src || all);
          e.target.checked ? cur.add(s.id) : cur.delete(s.id); S.src = cur.size === all.length ? null : [...cur];
        }) }),
        h('span', {}, s.name), h('span', { class: 'n' }, '0')))));
    }
    for (const li of ul.children) {
      const cb = li.querySelector('input'); cb.checked = !S.src || S.src.includes(cb.value);
      li.querySelector('.n').textContent = String(counts[cb.value] || 0);
    }
  }
  function renderTag() {
    const box = $('#tagActive'); box.hidden = !S.tag;
    box.replaceChildren(...(S.tag ? ['Tag: ', h('b', {}, '#' + S.tag), h('button', { type: 'button', class: 'btn small', onclick: () => setFilter(() => { S.tag = ''; }) }, 'Remove tag filter')] : []));
  }
  function renderNotice() {
    const n = $('#notice');
    if (S.story) { n.hidden = false; n.className = 'notice'; n.replaceChildren('You are viewing a shared story.', h('button', { type: 'button', class: 'btn small', onclick: () => { S.story = ''; render(); $('#results').focus(); } }, 'Show all news')); return; }
    n.hidden = true;
  }
  function renderStatus() {
    const g = Date.parse(S.data.generatedAt), st = S.data.stats, hrs = (Date.now() - g) / 36e5, el = $('#status');
    el.className = 'status' + (hrs > STALE_H ? ' warn' : '');
    el.replaceChildren(h('span', { class: 'dot', 'aria-hidden': 'true' }), 'Updated ', h('b', {}, h('time', { datetime: S.data.generatedAt, title: fmt(g) }, ago(g))),
      ` · ${st.sourcesOk}/${st.sources} sources live`, hrs > STALE_H ? ' · the scheduled update looks paused' : '');
    const bad = S.data.sources.filter(s => !s.ok);
    $('#healthSum').textContent = `(${S.data.sources.length - bad.length} ok, ${bad.length} failing)`;
    $('#healthList').replaceChildren(...S.data.sources.map(s => h('li', { class: s.ok ? 'ok' : 'bad' }, s.name, s.ok ? ` · ${s.items} in feed` : ` · ${s.error || 'failed'}`)));
  }

  /* ---------- actions ---------- */
  function setFilter(fn) { fn(); S.story = ''; S.page = 1; syncControls(); render(); }
  function reset() { S.q = ''; S.topics = []; S.range = 0; S.sort = 'new'; S.src = null; S.tag = ''; S.action = false; S.story = ''; S.page = 1; syncControls(); render(); toast('Filters reset'); }
  async function shareStory(it) { toast(await copyText(storyUrl(it)) ? 'Link copied' : 'Copy failed - link is in the address bar'); }
  async function teams(it) {
    const link = storyUrl(it), extra = it.also.length ? ` (+${it.also.length} more source${it.also.length > 1 ? 's' : ''})` : '';
    const text = `${it.title}\n${it.summary}\n${it.source}, ${fmtDay(it.ts)}${extra}\nRead: ${it.url}\nOn HACKERSBUN: ${link}`;
    const html = `<p><b><a href="${esc(it.url)}">${esc(it.title)}</a></b><br>${esc(it.summary)}<br><i>${esc(it.source)}, ${esc(fmtDay(it.ts))}${esc(extra)}</i> · <a href="${esc(link)}">HACKERSBUN</a></p>`;
    toast(await copyText(text, html) ? 'Copied - paste into Teams or Outlook' : 'Copy failed');
  }
  async function digest() {
    const l = view().slice(0, 15), title = `HACKERSBUN AI security & governance digest, ${fmtDay(Date.now())}`;
    const md = `**${title}**\n\n` + l.map(i => `- **${i.title}** (${i.source}, ${fmtDay(i.ts)}${i.also.length ? `, +${i.also.length} sources` : ''})\n  ${i.url}`).join('\n') + `\n\nFull view: ${pageBase()}?${viewParams()}`;
    const html = `<p><b>${esc(title)}</b></p><ul>` + l.map(i => `<li><b><a href="${esc(i.url)}">${esc(i.title)}</a></b> (${esc(i.source)}, ${esc(fmtDay(i.ts))}${i.also.length ? `, +${i.also.length} sources` : ''})</li>`).join('') + `</ul><p><a href="${esc(pageBase() + '?' + viewParams())}">Open this view on HACKERSBUN</a></p>`;
    toast(await copyText(md, html) ? `Digest of ${l.length} stories copied` : 'Copy failed');
  }
  function csv() {
    const q = v => { v = String(v ?? ''); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; }; // formula-injection safe
    const rows = [['published', 'source', 'topics', 'tags', 'needs_attention', 'title', 'url', 'also_covered_by', 'hackersbun_link']]
      .concat(view().map(i => [i.published, i.source, i.topics.map(t => TOPICS[t]).join('; '), i.tags.join('; '), i.action ? 'yes' : '', i.title, i.url, i.also.map(a => a.source).join('; '), storyUrl(i)]));
    const a = h('a', { href: URL.createObjectURL(new Blob(['﻿' + rows.map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv' })), download: `hackersbun-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a); a.click(); a.remove(); toast('CSV downloaded');
  }

  /* ---------- data ---------- */
  function load(data) {
    S.data = data;
    S.items = data.items.map(it => ({ ...it, ts: Date.parse(it.published), _hay: fold([it.title, it.summary, it.source, it.tags.join(' '), it.topics.map(t => TOPICS[t]).join(' '), ...it.also.map(a => a.source + ' ' + a.title)].join(' ')) }));
    S.byId = new Map(); for (const it of S.items) { S.byId.set(it.id, it); for (const a of it.also) if (!S.byId.has(a.id)) S.byId.set(a.id, it); }
    S.dupes = S.items.reduce((n, it) => n + it.also.length, 0);
  }
  async function fetchData() { const r = await fetch(DATA_URL + '?t=' + Math.floor(Date.now() / 60e3), { cache: 'no-cache' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
  let lastCheck = Date.now();
  async function recheck() {
    if (Date.now() - lastCheck < 60e3) return; lastCheck = Date.now();
    try {
      const d = await fetchData(); if (d.generatedAt === S.data.generatedAt) return;
      const known = new Set(S.items.map(i => i.id)), fresh = d.items.filter(i => !known.has(i.id)).length;
      if (!fresh) { load(d); renderStatus(); render(); return; }
      S.pending = d; const b = $('#freshBtn'); b.hidden = false; b.textContent = `${fresh} new stor${fresh > 1 ? 'ies' : 'y'} arrived - show them`;
    } catch { /* offline: keep what we have */ }
  }

  /* ---------- events ---------- */
  function wire() {
    let qt; $('#q').addEventListener('input', e => { clearTimeout(qt); qt = setTimeout(() => setFilter(() => { S.q = e.target.value; }), 120); });
    $('#filterForm').addEventListener('submit', e => e.preventDefault());
    $('#sort').addEventListener('change', e => setFilter(() => { S.sort = e.target.value; }));
    $('#actionOnly').addEventListener('change', e => setFilter(() => { S.action = e.target.checked; }));
    $('#rangeSeg').addEventListener('change', e => setFilter(() => { S.range = +e.target.value; }));
    $('#srcAll').addEventListener('click', () => setFilter(() => { S.src = null; }));
    $('#srcNone').addEventListener('click', () => setFilter(() => { S.src = []; }));
    $('#resetBtn').addEventListener('click', reset);
    $('#shareView').addEventListener('click', async () => toast(await copyText(pageBase() + (viewParams().toString() ? '?' + viewParams().toString().replace(/%2C/gi, ',') : '')) ? 'Link to this view copied' : 'Copy failed'));
    $('#moreBtn').addEventListener('click', () => { const n = S.page * PAGE; S.page++; render(); document.querySelectorAll('#list .ttl a')[n]?.focus(); });
    $('#digestBtn').addEventListener('click', digest);
    $('#csvBtn').addEventListener('click', csv);
    $('#freshBtn').addEventListener('click', () => { if (!S.pending) return; load(S.pending); S.pending = null; $('#freshBtn').hidden = true; renderStatus(); render(); $('#results').focus(); });
    const ft = $('#filtersToggle'); ft.addEventListener('click', () => { const open = ft.getAttribute('aria-expanded') !== 'true'; ft.setAttribute('aria-expanded', String(open)); $('#filters').classList.toggle('open', open); });
    const tb = $('#themeBtn'), isDark = () => (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')) === 'dark';
    const paintTheme = () => tb.setAttribute('aria-pressed', String(isDark()));
    tb.addEventListener('click', () => { const t = isDark() ? 'light' : 'dark'; document.documentElement.dataset.theme = t; store.set('hb2.theme', t); paintTheme(); });
    paintTheme();
    addEventListener('keydown', e => {
      if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { e.preventDefault(); $('#q').focus(); }
      else if (e.key === 'Escape' && document.activeElement === $('#q') && S.q) { $('#q').value = ''; setFilter(() => { S.q = ''; }); }
    });
    addEventListener('popstate', () => { readUrl(); syncControls(); render(); });
    addEventListener('pagehide', () => store.set('hb2.lastVisit', String(Date.now())));
    setInterval(() => { if (S.data) renderStatus(); }, 60e3);
    setInterval(recheck, RECHECK_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.data) recheck(); });
  }

  async function boot() {
    S.lastVisit = +store.get('hb2.lastVisit') || 0;
    readUrl(); syncControls(); wire();
    try { load(await fetchData()); }
    catch (e) {
      $('#status').textContent = 'Could not load the news feed (' + e.message + '). Reload to try again.'; $('#status').className = 'status warn';
      $('#list').replaceChildren(h('li', { class: 'empty' }, location.protocol === 'file:' ? 'Open this page through a web server (GitHub Pages or a local server); browsers block data files on file://.' : 'News data is unavailable right now.'));
      return;
    }
    renderStatus(); render();
    if (S.story) { const el = $('#s-' + (S.byId.get(S.story) || {}).id); if (el) { el.classList.add('target'); el.querySelector('.ttl a').focus({ preventScroll: true }); } }
  }
  boot();
})();
