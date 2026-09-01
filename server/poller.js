import { POLL_INTERVAL_MS } from "./config.js";
import { startClaudePolling } from "./collectors/claude.js";
import { collectCodex } from "./collectors/codex.js";
import { collectGemini } from "./collectors/gemini.js";
import { setResults } from "./cache.js";

async function pollOthers() {
  const results = await Promise.all([collectCodex(), collectGemini()]);
  setResults(results);
}

export function startPoller() {
  pollOthers().catch((err) => console.error("初回ポーリングに失敗しました:", err));
  setInterval(() => {
    pollOthers().catch((err) => console.error("ポーリングに失敗しました:", err));
  }, POLL_INTERVAL_MS);

  // Claudeは429時のバックオフやDesktopログへのフォールバックのため、
  // 他プロバイダーとは別に自身のペースでポーリングする
  startClaudePolling();
}
