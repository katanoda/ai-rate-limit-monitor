import os from "node:os";
import path from "node:path";

export const PORT = Number(process.env.LIMIT_MONITOR_PORT || 4590);
export const POLL_INTERVAL_MS = Number(process.env.LIMIT_MONITOR_POLL_MS || 10 * 1000);

export const CLAUDE_CREDENTIALS_PATH = path.join(
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
  ".credentials.json",
);

export const CODEX_AUTH_PATH = path.join(
  process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
  "auth.json",
);
