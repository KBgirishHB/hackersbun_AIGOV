# HACKERSBUN v2: AI Security & Governance Wire

Live at `https://kbgirishhb.github.io/hackersbun_AIGOV/v2/`. The classic site (`/index.html`) is untouched.

## How it stays live
1. **Every 30 minutes** the GitHub Action [`.github/workflows/v2-news.yml`](../.github/workflows/v2-news.yml) runs `node v2/scripts/build-news.mjs`.
2. The script fetches every feed in [`feeds.json`](feeds.json) **server-side** (no CORS proxies, no third parties, no secrets), keeps AI security / AI governance stories, merges duplicates and writes [`data/news.json`](data/news.json).
3. If any story changed, the Action commits `news.json` and GitHub Pages republishes. With no changes it only commits a heartbeat every 2 hours, so git history stays small.
4. The page loads `data/news.json` (same origin only, strict CSP), shows **"Updated N min ago"**, re-checks every 5 minutes and offers "N new stories arrived" without reshuffling what you're reading. If the data is more than 3 hours old the header warns that the job looks paused.

Stories are kept for 30 days. Slow, authoritative sources (regulators, AI Act tracker) always keep their latest 3 posts, up to 180 days old. A failing feed keeps its previous stories until it recovers. Health for each source is under **Source health** in the footer.

Run it by hand: Actions tab → *v2 news refresh* → **Run workflow**. Note: GitHub pauses scheduled workflows in repos with no activity for 60 days. The bot's own commits normally count as activity, but if updates stop, re-enable the workflow on the Actions tab.

## De-duplication (two levels)
- **Duplicate:** same canonical URL (tracking params, `www.`/`m.`/AMP, trailing slashes and param order normalised), same normalised title, or near-identical title (token Jaccard / bigram Dice ≥ 0.6 within 4 days). Catches cross-posts and syndication.
- **Same story:** different outlets covering one event. IDF-weighted cosine over title + summary words ≥ 0.28 within 48 h, across different sources only, so a single blog's "Part 1 / Part 2" never merge.

The earliest report becomes the card. The others are listed under "Also covered by N other sources". These thresholds were tuned on real feed data (e.g. six reports of one supply-chain attack become one card, with no false merges found). Tune them in `scripts/lib.mjs`.

## Team features
Full-text search (`/` to focus, `Esc` to clear) · topic filters (AI security, AI governance, Regulation & policy, Incidents & threats, Research) · source picker · 24 h / 7 d / 30 d · sort by newest, oldest, relevance or most covered · clickable tags · "Needs attention" filter (exploited, urged to patch, deadlines, adopted rules, consultations) · **every view is a shareable URL** · per-story **Copy link** (`?story=<id>`, still works if the story later merges) · **Copy for Teams** (rich text) · **Copy digest** (top 15 as Markdown/rich text) · CSV export (formula-injection safe) · "New" badge since your last visit · dark/light theme · mobile layout · print-friendly.

Accessibility (WCAG 2.1 AA basics): skip link, landmarks, labelled controls, `aria-pressed` toggles, live result count, visible focus, text contrast ≥ 5.7:1 in both themes, colour never the only signal, honours reduced motion.

## Edit sources
Add an entry to `feeds.json`: `{ "id": "short-id", "name": "Display name", "url": "https://…/feed", "ai": true, "topic": "security" }`.
- `ai: true`: the whole feed is about AI, so no AI keyword is needed.
- `topic`: the fallback topic when keywords don't decide (`security`, `governance`, `regulation`, `incidents`, `research`).
Pushing a change to `feeds.json` triggers a rebuild.

## Local run (Windows, no install)
```powershell
node --use-system-ca v2/scripts/test.mjs
node --use-system-ca v2/scripts/build-news.mjs
```
`--use-system-ca` (Node 22+) trusts the corporate TLS-inspection certificate. To preview, serve the repo folder with any static server and open `/v2/`. Browsers block `fetch` on `file://`.
