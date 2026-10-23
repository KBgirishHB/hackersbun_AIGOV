// HACKERSBUN v2 - pure helpers shared by build-news.mjs and test.mjs. No dependencies, no network.

/* ===== TEXT ===== */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™', euro: '€', pound: '£', middot: '·', bull: '•', eacute: 'é', egrave: 'è', uuml: 'ü', ouml: 'ö', auml: 'ä', szlig: 'ß' };
export function decodeEntities(s) {
  return String(s || '').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1); try { return String.fromCodePoint(n); } catch { return ''; } }
    return ENT[e.toLowerCase()] ?? m;
  });
}
const unCdata = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
// HTML/escaped HTML -> plain text, optionally clipped at a word boundary.
export function plain(s, max) {
  let t = decodeEntities(unCdata(s));
  t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
  if (/&(#\d+|#x[\da-f]+|[a-z]+);/i.test(t)) t = decodeEntities(t).replace(/<[^>]+>/g, ' ');
  t = t.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/\[(…|\.\.\.)\]/g, '')
    .replace(/\s*The post .{0,300}? appeared first on .*$/i, '').replace(/\s*(Read more|Continue reading|Click here)[^.]{0,60}(…|\.\.\.|»)?\s*$/i, '')
    .replace(/^[\s\-–—•·*]+/, '').trim();
  if (max && t.length > max) { t = t.slice(0, max); const i = t.lastIndexOf(' '); t = (i > max * 0.6 ? t.slice(0, i) : t).replace(/[\s,;:.\-]+$/, '') + '…'; }
  return t;
}

/* ===== FEED PARSING (RSS 2.0, RSS 1.0/RDF, Atom) ===== */
const tagRx = name => new RegExp(`<(?:[\\w-]+:)?${name}(?=[\\s>/])[^>]*?(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>)`, 'i');
function field(block, ...names) { for (const n of names) { const m = block.match(tagRx(n)); if (m && m[1] && m[1].trim()) return m[1]; } return ''; }
function linkOf(block) {
  const links = [...block.matchAll(/<link\b([^>]*?)\/?>(?:([\s\S]*?)<\/link>)?/gi)];
  let alt = null, any = null;
  for (const [, attrs, body] of links) {
    const href = (attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1];
    const rel = ((attrs.match(/\brel\s*=\s*["']([^"']+)["']/i) || [])[1] || 'alternate').toLowerCase();
    const v = href || unCdata(body || '').trim();
    if (!v) continue;
    if (rel === 'alternate' && !alt) alt = v; if (!any && rel !== 'self' && rel !== 'replies' && rel !== 'enclosure') any = v;
  }
  let link = alt || any || '';
  if (!link) { const g = unCdata(field(block, 'guid', 'id')).trim(); if (/^https?:\/\//i.test(g)) link = g; }
  return decodeEntities(link).trim();
}
export function parseFeed(xml) {
  const text = String(xml || '');
  if (!/<(rss|feed|rdf:RDF|channel)\b/i.test(text)) throw new Error('not an RSS/Atom feed');
  const blocks = [...text.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(m => m[2]);
  return blocks.map(b => ({
    title: plain(field(b, 'title'), 220),
    link: linkOf(b),
    date: plain(field(b, 'pubDate', 'published', 'updated', 'date', 'issued', 'modified')),
    summary: plain(field(b, 'description', 'summary', 'encoded', 'content'), 320)
  }));
}

/* ===== URL CANONICALISATION ===== */
const TRACK = /^(utm_\w+|mc_\w+|fbclid|gclid|dclid|msclkid|yclid|igshid|ref|ref_src|ref_url|referrer|source|src|cmpid|cmp|ncid|ito|sr_share|guccounter|guce_\w+|mkt_tok|_hs\w+|hsctatracking|at_\w+|ns_\w+|ocid|smid|share|via|feature|rss|output|spm|wt\.\w+|ss_source)$/i;
// cleanUrl: the link we show (tracking removed). canonicalKey: what we compare for duplicates.
export function cleanUrl(u) {
  try {
    const x = new URL(String(u).trim());
    if (!/^https?:$/.test(x.protocol)) return null;
    for (const k of [...x.searchParams.keys()]) if (TRACK.test(k)) x.searchParams.delete(k);
    x.hash = '';
    return x.href;
  } catch { return null; }
}
export function canonicalKey(u) {
  const c = cleanUrl(u); if (!c) return null;
  const x = new URL(c);
  const host = x.hostname.toLowerCase().replace(/^(www\d?|m|amp|mobile)\./, '');
  let path = decodeURIComponent(x.pathname).replace(/\/(amp|index\.html?|index\.php)\/?$/i, '/').replace(/\/+$/, '').toLowerCase();
  x.searchParams.delete('amp');
  const qs = [...x.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => k + '=' + v).join('&');
  return host + (path || '/') + (qs ? '?' + qs : '');
}

/* ===== TITLE SIMILARITY ===== */
const STOP = new Set('a an the of to in on for and or with by at from as is are was were be been this that these those it its how why what who when new says say said will would can could may after over into about up out vs via amid than more just now has have had their they our your you we not no'.split(' '));
const stem = w => w.length > 4 ? w.replace(/(ies)$/, 'y').replace(/(ing|ed|es|s)$/, '') : w;
export function titleTokens(title) {
  const t = String(title || '').toLowerCase()
    .replace(/\s+[|\-–—]\s+[^|\-–—]{2,40}$/, '') // trailing " - Publisher"
    .replace(/[’']s\b/g, '').replace(/[^a-z0-9]+/g, ' ');
  return t.split(' ').filter(w => w && !STOP.has(w)).map(stem);
}
function bigrams(tokens) { const s = new Set(); for (let i = 0; i < tokens.length - 1; i++) s.add(tokens[i] + ' ' + tokens[i + 1]); return s; }
export function similarity(a, b) {
  const A = new Set(a), B = new Set(b); if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  const jac = n / (A.size + B.size - n), overlap = n / Math.min(A.size, B.size);
  const ba = bigrams(a), bb = bigrams(b); let m = 0; for (const g of ba) if (bb.has(g)) m++;
  const dice = ba.size + bb.size ? (2 * m) / (ba.size + bb.size) : 0;
  // overlap only counts when the shorter title is substantial, so "AI Act" doesn't swallow everything
  return Math.max(jac, dice, Math.min(A.size, B.size) >= 6 ? overlap * 0.8 : 0);
}
// Level 1 "duplicate": same canonical URL, same normalised title, or near-identical title (any source, 4-day window).
// Level 2 "same story": different outlets covering one event - IDF-weighted cosine over title+summary words, 48h window.
// Thresholds were tuned on real feed data (see v2/README.md); same-source pairs never use level 2 (Part 1 / Part 2 posts).
export const SIM_THRESHOLD = 0.6, SIM_WINDOW_MS = 4 * 864e5, STORY_THRESHOLD = 0.28, STORY_WINDOW_MS = 2 * 864e5;
export function storySimilarity(a, b, idf) {
  let sh = 0, sa = 0, sb = 0;
  for (const w of a) { const x = idf(w); sa += x; if (b.has(w)) sh += x; }
  for (const w of b) sb += idf(w);
  return sa && sb ? sh / Math.sqrt(sa * sb) : 0;
}

// Cluster duplicates. items: [{key, tokens, ts, sourceId, title, summary}]. Returns clusters (arrays), primary first.
export function cluster(items) {
  const bags = items.map(it => new Set([...it.tokens, ...titleTokens(it.summary || '')]));
  const df = new Map(); for (const b of bags) for (const w of b) df.set(w, (df.get(w) || 0) + 1);
  const N = items.length, idf = w => Math.log((N + 1) / ((df.get(w) || 0) + 0.5));
  const parent = items.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (i, j) => { const a = find(i), b = find(j); if (a !== b) parent[b] = a; };
  const byKey = new Map(), byTitle = new Map();
  items.forEach((it, i) => {
    if (byKey.has(it.key)) join(byKey.get(it.key), i); else byKey.set(it.key, i);
    const tk = it.tokens.join(' ');
    if (tk) { if (byTitle.has(tk)) join(byTitle.get(tk), i); else byTitle.set(tk, i); }
  });
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    if (find(i) === find(j)) continue;
    const dt = Math.abs((items[i].ts || 0) - (items[j].ts || 0));
    if (dt > SIM_WINDOW_MS) continue;
    if (similarity(items[i].tokens, items[j].tokens) >= SIM_THRESHOLD) join(i, j);
    else if (dt <= STORY_WINDOW_MS && items[i].sourceId !== items[j].sourceId && storySimilarity(bags[i], bags[j], idf) >= STORY_THRESHOLD) join(i, j);
  }
  const groups = new Map();
  items.forEach((it, i) => { const r = find(i); (groups.get(r) || groups.set(r, []).get(r)).push(it); });
  // primary = earliest report (the scoop); ties go to the richer summary
  return [...groups.values()].map(g => g.sort((a, b) => (a.ts || 9e15) - (b.ts || 9e15) || (b.summary || '').length - (a.summary || '').length));
}

/* ===== CLASSIFICATION ===== */
export const AI_RX = /\b(ai|a\.i\.|artificial intelligence|gen ?ai|generative|llms?|large language models?|language models?|machine learning|neural net\w*|chatgpt|gpt-?\d\w*|openai|anthropic|claude|gemini|copilot|deepfakes?|chatbots?|foundation models?|frontier models?|agentic|ai agents?|mcp|model context protocol|deepseek|mistral|llama|hugging ?face|diffusion models?|ai act|gpai)\b/i;
export const TOPICS = {
  security: { label: 'AI security', terms: [['prompt injection', 6], ['jailbreak\\w*', 5], ['(data|model|training) poisoning', 6], ['adversarial', 3], ['red[- ]team\\w*', 3], ['guardrails?', 3], ['model (theft|extraction|stealing)', 5], ['(ai|llm|genai|model) security', 6], ['securing ai', 5], ['secure ai', 4], ['vulnerabilit\\w+', 2], ['exploit\\w*', 2], ['malware', 2], ['backdoor\\w*', 3], ['supply[- ]chain', 2], ['shadow ai', 5], ['(agent|tool) hijack\\w*', 5], ['cve-\\d{4}-\\d+', 3], ['owasp', 3], ['secure by design', 3], ['zero[- ]day', 2], ['security', 1], ['threat\\w*', 1], ['attack\\w*', 1], ['hacker\\w*', 2], ['cyber\\w*', 1], ['data (leak\\w*|exfiltration)', 4], ['sandbox escape', 4], ['mcp server', 3]] },
  governance: { label: 'AI governance', terms: [['ai governance', 6], ['responsible ai', 5], ['trustworthy ai', 5], ['ai ethics', 4], ['ai risk', 3], ['risk management', 3], ['iso(/iec)? ?42001', 6], ['ai rmf', 6], ['risk management framework', 5], ['ai polic\\w+', 3], ['oversight', 2], ['accountab\\w+', 2], ['audit\\w*', 2], ['assurance', 3], ['transparen\\w+', 2], ['ai safety', 3], ['safety institute', 4], ['governance', 2], ['frameworks?', 1], ['standards?', 1], ['principles', 1], ['model cards?', 3], ['impact assessment', 3], ['ai literacy', 4], ['code of practice', 4]] },
  regulation: { label: 'Regulation & policy', terms: [['ai act', 6], ['gpai', 4], ['regulat\\w+', 3], ['legislat\\w+', 3], ['laws?', 2], ['executive order', 4], ['complian\\w+', 2], ['gdpr', 3], ['data protection', 2], ['edpb', 4], ['european commission', 2], ['parliament', 2], ['congress\\w*', 2], ['senat\\w+', 2], ['lawsuits?', 2], ['sued|sues', 2], ['court', 1], ['fined?|fines', 2], ['bans?|banned', 2], ['enforcement', 2], ['privacy', 1], ['copyright', 2], ['digital omnibus', 5], ['ai office', 4], ['policy', 1], ['bill', 1]] },
  incidents: { label: 'Incidents & threats', terms: [['breach\\w*', 3], ['leak(ed|s)?', 2], ['ransomware', 3], ['hacked', 3], ['compromis\\w+', 2], ['exploited', 3], ['stolen', 2], ['scams?|scammers?', 2], ['fraud\\w*', 2], ['phishing', 2], ['deepfakes?', 2], ['incidents?', 2], ['cyberattacks?', 3], ['exposed', 2], ['outage', 1], ['impersonat\\w+', 2], ['misuse\\w*', 2], ['threat actors?', 3], ['espionage', 3], ['abus\\w+', 1]] },
  research: { label: 'Research', terms: [['researchers?', 2], ['study|studies', 1], ['paper', 2], ['arxiv', 3], ['benchmarks?', 2], ['proof[- ]of[- ]concept', 3], ['new technique', 2], ['discovered', 1], ['evaluation', 1], ['open[- ]source', 1]] }
};
const COMPILED = Object.fromEntries(Object.entries(TOPICS).map(([k, v]) => [k, v.terms.map(([t, w]) => [new RegExp(`\\b(?:${t})\\b`, 'i'), w])]));
export const TOPIC_MIN = 3;
export const TAGS = [
  ['EU AI Act', /\b(eu ai act|ai act|gpai|ai office)\b/i], ['NIST', /\bnist\b/i], ['ISO 42001', /\biso(\/iec)? ?42001\b/i], ['GDPR', /\bgdpr\b/i],
  ['Prompt injection', /\bprompt injection/i], ['Jailbreak', /\bjailbreak/i], ['Data poisoning', /\bpoisoning\b/i], ['Deepfakes', /\bdeepfake/i],
  ['AI agents', /\b(ai agents?|agentic|autonomous agents?)\b/i], ['MCP', /\b(mcp|model context protocol)\b/i], ['Supply chain', /\bsupply[- ]chain\b/i],
  ['Ransomware', /\bransomware\b/i], ['Phishing', /\bphishing\b/i], ['Vulnerability', /\b(cve-\d|vulnerabilit|zero[- ]day)/i], ['Privacy', /\b(privacy|data protection)\b/i],
  ['Copyright', /\bcopyright/i], ['Shadow AI', /\bshadow ai\b/i], ['Biometrics', /\b(biometric|facial recognition)/i], ['Critical infrastructure', /\bcritical infrastructure\b/i],
  ['OpenAI', /\b(openai|chatgpt)\b/i], ['Anthropic', /\b(anthropic|claude)\b/i], ['Google', /\b(google|gemini|deepmind)\b/i], ['Microsoft', /\b(microsoft|copilot)\b/i], ['Meta', /\b(meta|llama)\b/i],
  ['USA', /\b(white house|congress|senate|u\.s\.|federal|fcc|ftc|cisa)\b/i], ['UK', /\b(uk|u\.k\.|britain|british|ncsc|ico)\b/i], ['China', /\b(china|chinese|beijing)\b/i]
];
export const ACTION_RX = /\b((actively |being |were |was |been )?exploited|under (active )?exploitation|known exploited|patch(ed)? (now|immediately|urgently)|urged to (patch|update|upgrade|rotate|change)|rotate (your )?credentials|critical (flaw|vulnerabilit\w+|bug)|urgent\w*|emergency( directive)?|deadlines?|enters? into (force|application)|comes? into (force|effect)|takes effect|applies from|consultation|comment period|call for (evidence|input|comments)|guidelines? (published|adopted|released)|final text|adopted|zero[- ]day)\b/i;

// -> {topics:[...], tags:[...], score, action} or null when the item is off-topic.
export function classify(item, source = {}) {
  const T = item.title || '', B = item.summary || '', all = T + ' ' + B;
  if (!source.ai && !AI_RX.test(all)) return null;
  const scores = {};
  for (const [k, rules] of Object.entries(COMPILED)) {
    let s = 0; for (const [rx, w] of rules) { if (rx.test(T)) s += 2 * w; else if (rx.test(B)) s += w; }
    if (s) scores[k] = s;
  }
  let topics = Object.keys(scores).filter(k => scores[k] >= TOPIC_MIN).sort((a, b) => scores[b] - scores[a]);
  if (!topics.length && source.topic) topics = [source.topic];
  if (!topics.length) return null;
  const tags = TAGS.filter(([, rx]) => rx.test(all)).map(([t]) => t).slice(0, 6);
  const score = Object.values(scores).reduce((a, b) => a + b, 0) + (AI_RX.test(T) ? 4 : 0);
  return { topics, tags, score, action: ACTION_RX.test(all) };
}

/* ===== MISC ===== */
export function parseDate(s, now = Date.now()) {
  const t = Date.parse(String(s || '').trim()); if (!t) return 0;
  return t > now + 3600e3 ? now : t;
}
export function hashId(s) { // FNV-1a 32-bit x2 -> 12 hex chars, stable across runs
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = Math.imul(h2 ^ c, 2246822519) >>> 0; }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 12);
}
