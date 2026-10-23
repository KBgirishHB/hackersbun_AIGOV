// Tests for lib.mjs. Run: node v2/scripts/test.mjs  (no dependencies; uses node:test)
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, cleanUrl, canonicalKey, titleTokens, similarity, cluster, classify, plain, parseDate } from './lib.mjs';

test('URL canonicalisation strips tracking, www, amp and trailing slashes', () => {
  assert.equal(cleanUrl('https://www.ex.com/a/?utm_source=rss&id=3#top'), 'https://www.ex.com/a/?id=3');
  assert.equal(canonicalKey('https://www.ex.com/news/story/?utm_campaign=x'), canonicalKey('http://ex.com/news/story'));
  assert.equal(canonicalKey('https://ex.com/news/story/amp/'), canonicalKey('https://ex.com/news/story'));
  assert.equal(canonicalKey('https://m.ex.com/p?b=2&a=1'), canonicalKey('https://ex.com/p?a=1&b=2'));
  assert.notEqual(canonicalKey('https://ex.com/p?id=1'), canonicalKey('https://ex.com/p?id=2'));
  assert.equal(cleanUrl('javascript:alert(1)'), null);
});

test('parses RSS 2.0 and Atom, including CDATA and entities', () => {
  const rss = `<?xml version="1.0"?><rss><channel><item><title><![CDATA[EU &amp; AI Act: GPAI rules]]></title><link>https://ex.com/a?utm_source=rss</link>
    <pubDate>Tue, 20 Oct 2026 10:00:00 GMT</pubDate><content:encoded><![CDATA[<p>Long <b>body</b></p>]]></content:encoded><description>&lt;p&gt;Short &amp;amp; sweet&lt;/p&gt;</description></item></channel></rss>`;
  const [r] = parseFeed(rss);
  assert.equal(r.title, 'EU & AI Act: GPAI rules');
  assert.equal(r.link, 'https://ex.com/a?utm_source=rss');
  assert.equal(r.summary, 'Short & sweet');
  assert.equal(parseDate(r.date), Date.UTC(2026, 9, 20, 10));
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="html">Prompt injection in agents</title><link rel="replies" href="https://ex.com/c"/><link rel="alternate" href="https://ex.com/p1"/>
    <published>2026-10-21T08:00:00Z</published><summary>Hello</summary></entry></feed>`;
  const [a] = parseFeed(atom);
  assert.equal(a.link, 'https://ex.com/p1');
  assert.equal(a.title, 'Prompt injection in agents');
  assert.throws(() => parseFeed('<!DOCTYPE html><html></html>'));
});

test('plain() removes markup, scripts and feed boilerplate', () => {
  assert.equal(plain('<script>x()</script><p>Hi <i>there</i>.</p> The post Hi appeared first on Blog.'), 'Hi there.');
});

test('title similarity: near-identical titles match, different stories do not', () => {
  const s = (a, b) => similarity(titleTokens(a), titleTokens(b));
  assert.ok(s('AI Guardrails Aren’t Stopping Criminal Hackers', 'AI guardrails aren\'t stopping criminal hackers - WIRED') >= 0.6);
  assert.ok(s('EU delays high-risk AI rules by a year', 'EU delays high-risk AI rules by one year, Commission says') >= 0.6);
  assert.ok(s('Building your AI vulnerability harness, Part 1', 'Configuring your AI vulnerability harness, Part 2: The steering file') < 0.6);
  assert.ok(s('Microsoft: Treat AI agents as insider threats', 'The AI Agent Nobody Owns: Watch Expert Webinar On Your Newest Insider Threat') < 0.6);
});

const mk = (id, sourceId, title, summary, h = 0) => ({ id, sourceId, title, summary, key: 'ex.com/' + id, ts: Date.UTC(2026, 9, 20) + h * 36e5, tokens: titleTokens(title) });
const W = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu'.split(' ');
const words = (i, n) => Array.from({ length: n }, (_, k) => W[(i + k) % W.length] + i + 'q' + k).join(' ');
const filler = Array.from({ length: 30 }, (_, i) => mk('f' + i, 'f' + (i % 5), words(i, 6), words(i + 40, 10), i)); // realistic IDF background

test('cluster merges same URL, cross-posts and same-event coverage; keeps same-source series apart', () => {
  const items = [
    mk('a1', 's1', 'China-Linked Hackers Use ARTEX AI Agents in ConnectWise Supply Chain Attack', 'Microsoft says Storm-0940 used ARTEX agents to breach ConnectWise tenants.', 0),
    mk('a2', 's2', 'Microsoft blames ConnectWise attacks on Chinese state hacker using ARTEX AI agents', 'Storm-0940 ARTEX agents ConnectWise tenants compromised, Microsoft said.', 5),
    { ...mk('a3', 's3', 'Totally different headline', 'x', 1), key: 'ex.com/a1' }, // same URL as a1
    mk('b1', 's4', 'Building your AI vulnerability harness, Part 1', 'Harness steering for AI vulnerability research.', 0),
    mk('b2', 's4', 'Configuring your AI vulnerability harness, Part 2: The steering file', 'Harness steering for AI vulnerability research.', 30),
    ...filler
  ];
  const groups = cluster(items), of = id => groups.find(g => g.some(x => x.id === id));
  assert.equal(of('a1'), of('a2'), 'same event across outlets');
  assert.equal(of('a1'), of('a3'), 'same canonical URL');
  assert.notEqual(of('b1'), of('b2'), 'a series from one source stays separate');
  assert.equal(of('a1')[0].id, 'a1', 'earliest report is the primary');
  assert.equal(groups.length, items.length - 2);
});

test('classify keeps AI security/governance news and drops off-topic items', () => {
  assert.deepEqual(classify({ title: 'Prompt injection flaw lets attackers hijack Copilot agents', summary: '' }, { topic: 'security' }).topics.slice(0, 1), ['security']);
  assert.ok(classify({ title: 'Commission publishes GPAI code of practice under the AI Act', summary: '' }, {}).topics.includes('regulation'));
  assert.equal(classify({ title: 'Ransomware gang hits hospital chain', summary: 'Patients diverted to other sites.' }, { topic: 'security' }), null, 'security news without AI is out');
  assert.equal(classify({ title: 'New phone launches in five colours', summary: 'Camera upgrade' }, { ai: true }), null, 'AI-source item with no topic is out');
  assert.ok(classify({ title: 'Attackers exploit zero-day in AI gateway, patch now', summary: '' }, {}).action);
});
