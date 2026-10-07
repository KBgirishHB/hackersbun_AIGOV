# HACKERSBUN - AI Governance Wire

Run locally (recommended, most reliable): double-click `start.cmd`. It uses the portable Node in `.env\` and opens http://localhost:8787.
`index.html` also works straight from file://; the app then tries the local gateway first and falls back to public CORS proxies.

- Edit feeds: the `FEEDS` array at the top of the script in `index.html`, or use ADD FEED in the sidebar.
- Own credentials for subscribed feeds: `AUTH_HEADERS` in `gateway.js` (empty by default, never commit real values).
- Posture extras: AI SECURITY topic, ACTION/WATCH/FYI signal, EU AI Act tier hints (heuristic), posture radar, COPY BRIEF (markdown digest with gateway links).
