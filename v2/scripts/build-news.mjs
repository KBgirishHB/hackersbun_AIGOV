// HACKERSBUN v2 news builder - Node 20+, zero dependencies.
// Fetches every feed in v2/feeds.json server-side (no CORS proxies), filters to AI security / governance,
// merges with the previous v2/data/news.json (so stories survive feed rotation), de-duplicates and writes the result.
// Run: node v2/scripts/build-news.mjs        (behind a TLS-inspecting proxy: node --use-system-ca ...)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFeed, cleanUrl, canonicalKey, titleTokens, cluster, classify, parseDate, hashId } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FEEDS = join(ROOT, 'feeds.json'), OUT = join(ROOT, 'data', 'news.json');
const RETAIN_DAYS = 30, KEEP_LATEST = 3, KEEP_LATEST_DAYS = 180, MAX_ITEMS = 900, HEARTBEAT_H = 2, PER_FEED = 40, TIMEOUT = 20000, POOL = 8;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 HackersBunWire/2.0';

async function fetchText(url) {
  const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT), headers: { 'User-Agent': UA, 'Accept-Language': 'en', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const buf = new Uint8Array(await r.arrayBuffer());
  const head = new TextDecoder('latin1').decode(buf.slice(0, 200));
  const cs = ((r.headers.get('content-type') || '').match(/charset=([\w-]+)/i) || head.match(/encoding=["']([\w-]+)/i) || [])[1] || 'utf-8';
  try { return new TextDecoder(cs).decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

async function main() {
  const now = Date.now(), cutoff = now - RETAIN_DAYS * 864e5;
  const { sources } = JSON.parse(await readFile(FEEDS, 'utf8'));
  let prev = { items: [] };
  try { prev = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* first run */ }

  // Raw members from the previous build (primary + its duplicates), so clusters are rebuilt from scratch every time.
  const seen = new Map(); // canonical key -> firstSeen
  const carried = [];
  for (const it of prev.items || []) for (const m of [it, ...(it.also || [])]) {
    const key = canonicalKey(m.url); if (!key) continue;
    seen.set(key, m.firstSeen || it.firstSeen || now);
    carried.push({ title: m.title || it.title, url: m.url, ts: Date.parse(m.published) || 0, summary: m.summary || '', sourceId: m.sourceId, key, firstSeen: m.firstSeen || it.firstSeen || now });
  }

  const health = [], fresh = [];
  let idx = 0, fetched = 0;
  const worker = async () => {
    while (idx < sources.length) {
      const s = sources[idx++], t0 = Date.now();
      try {
        const raw = parseFeed(await fetchText(s.url)).slice(0, PER_FEED);
        const list = [];
        for (const r of raw) {
          const url = cleanUrl(r.link), key = url && canonicalKey(url);
          if (!key || !r.title) continue;
          fetched++;
          list.push({ title: r.title, url, ts: parseDate(r.date, now) || seen.get(key) || now, summary: r.summary, sourceId: s.id, key, firstSeen: seen.get(key) || now });
        }
        // slow, authoritative sources (regulators, AI Act tracker) keep their latest few posts even when older than the window
        list.sort((a, b) => b.ts - a.ts);
        const keep = list.filter((it, i) => it.ts >= cutoff || (i < KEEP_LATEST && it.ts >= now - KEEP_LATEST_DAYS * 864e5));
        fresh.push(...keep);
        const kept = keep.length;
        health.push({ id: s.id, ok: true, items: raw.length, kept, ms: Date.now() - t0 });
      } catch (e) {
        health.push({ id: s.id, ok: false, error: String(e.cause?.code || e.message || e).slice(0, 120), ms: Date.now() - t0 });
      }
    }
  };
  await Promise.all(Array.from({ length: POOL }, worker));

  // Fresh copy wins over the carried copy of the same URL; carried items keep their place if the feed rotated them out.
  const srcById = new Map(sources.map(s => [s.id, s]));
  const byKey = new Map();
  const failed = new Set(health.filter(h => !h.ok).map(h => h.id)); // a failing feed keeps last run's stories
  for (const it of carried) if (srcById.has(it.sourceId) && (it.ts >= cutoff || (failed.has(it.sourceId) && it.ts >= now - KEEP_LATEST_DAYS * 864e5))) byKey.set(it.key + '|' + it.sourceId, it);
  for (const it of fresh) byKey.set(it.key + '|' + it.sourceId, it);
  const pool = [];
  for (const it of byKey.values()) {
    const c = classify(it, srcById.get(it.sourceId)); if (!c) continue;
    pool.push({ ...it, ...c, tokens: titleTokens(it.title) });
  }

  const clusters = cluster(pool);
  const items = clusters.map(g => {
    const p = g[0], others = g.slice(1).filter(o => o.key !== p.key || o.sourceId !== p.sourceId);
    const topics = [...new Set(g.flatMap(x => x.topics))], tags = [...new Set(g.flatMap(x => x.tags))].slice(0, 6);
    return {
      id: hashId(p.key), title: p.title, url: p.url, source: srcById.get(p.sourceId).name, sourceId: p.sourceId,
      published: new Date(p.ts).toISOString(), firstSeen: Math.min(...g.map(x => x.firstSeen || now)),
      summary: p.summary || (others.find(o => o.summary) || {}).summary || '', topics, tags,
      score: Math.max(...g.map(x => x.score)) + 3 * others.length, action: g.some(x => x.action),
      also: others.map(o => ({ id: hashId(o.key), source: srcById.get(o.sourceId).name, sourceId: o.sourceId, title: o.title, url: o.url, published: new Date(o.ts).toISOString(), firstSeen: o.firstSeen, summary: o.summary }))
    };
  }).sort((a, b) => Date.parse(b.published) - Date.parse(a.published)).slice(0, MAX_ITEMS);

  const ok = health.filter(h => h.ok).length;
  const out = {
    version: 2, generatedAt: new Date(now).toISOString(), retainDays: RETAIN_DAYS,
    stats: { sources: sources.length, sourcesOk: ok, fetched, relevant: pool.length, stories: items.length, duplicatesMerged: pool.length - clusters.length },
    sources: sources.map(s => ({ id: s.id, name: s.name, url: s.url, ...(health.find(h => h.id === s.id) || {}) })),
    items
  };
  if (!ok) { console.error('Every source failed - keeping the previous news.json'); process.exitCode = 1; return; }
  // Avoid a commit every run: if no story changed, only rewrite as a heartbeat (keeps "Updated" honest without bloating git history).
  const sameItems = prev.items && JSON.stringify(prev.items) === JSON.stringify(items);
  if (sameItems && now - Date.parse(prev.generatedAt || 0) < HEARTBEAT_H * 36e5) { console.log('No story changes - news.json left as is'); return; }
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out, null, 1) + '\n');
  console.log(`sources ${ok}/${sources.length} ok, fetched ${fetched}, relevant ${pool.length}, stories ${items.length}, merged ${out.stats.duplicatesMerged} duplicates`);
  for (const h of health.filter(h => !h.ok)) console.log(`  failed: ${h.id} - ${h.error}`);
}
main().catch(e => { console.error(e); process.exit(1); });
