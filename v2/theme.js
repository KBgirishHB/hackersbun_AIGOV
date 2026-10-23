// Runs before first paint so a saved theme never flashes. Separate file because the CSP blocks inline scripts.
try { const t = localStorage.getItem('hb2.theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) { /* storage blocked */ }
