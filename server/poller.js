import { POLL_INTERVAL_MS } from "./config.js";
import { collectClaude } from "./collectors/claude.js";
import { collectCodex } from "./collectors/codex.js";
import { collectGemini } from "./collectors/gemini.js";
import { setResults } from "./cache.js";

async function pollOnce() {
  const results = await Promise.all([collectClaude(), collectCodex(), collectGemini()]);
  setResults(results);
}

export function startPoller() {
  pollOnce().catch((err) => console.error("初回ポーリングに失敗しました:", err));
  setInterval(() => {
    pollOnce().catch((err) => console.error("ポーリングに失敗しました:", err));
  }, POLL_INTERVAL_MS);
}
