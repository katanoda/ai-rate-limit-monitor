import fs from "node:fs/promises";
import { CLAUDE_CREDENTIALS_PATH } from "../config.js";
import { okStatus, errorStatus } from "./types.js";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

async function readAccessToken() {
  const raw = await fs.readFile(CLAUDE_CREDENTIALS_PATH, "utf8");
  const parsed = JSON.parse(raw);
  const token = parsed?.claudeAiOauth?.accessToken;
  if (!token) throw new Error("claudeAiOauth.accessToken が資格情報ファイルに見つかりません");
  return token;
}

export async function collectClaude() {
  try {
    const token = await readAccessToken();
    const res = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "limit-monitor/1.0",
      },
    });
    if (!res.ok) {
      throw new Error(`Anthropic usage API が ${res.status} を返しました`);
    }
    const data = await res.json();
    return okStatus("claude", {
      fiveHour: data.five_hour
        ? { usedPercent: data.five_hour.utilization, resetAt: data.five_hour.resets_at }
        : null,
      weekly: data.seven_day
        ? { usedPercent: data.seven_day.utilization, resetAt: data.seven_day.resets_at }
        : null,
    });
  } catch (err) {
    return errorStatus("claude", err);
  }
}
