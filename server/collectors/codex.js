import fs from "node:fs/promises";
import { CODEX_AUTH_PATH } from "../config.js";
import { okStatus, errorStatus } from "./types.js";

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const REFRESH_URL = "https://auth.openai.com/oauth/token";
const REFRESH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const EXP_SKEW_SECONDS = 60;

function base64UrlDecode(segment) {
  const padded = segment + "=".repeat((4 - (segment.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function decodeJwtPayload(token) {
  const parts = String(token).split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(base64UrlDecode(parts[1]));
  } catch {
    return null;
  }
}

function isExpired(accessToken) {
  const payload = decodeJwtPayload(accessToken);
  if (!payload?.exp) return false;
  return Math.floor(Date.now() / 1000) >= payload.exp - EXP_SKEW_SECONDS;
}

async function readAuth() {
  const raw = await fs.readFile(CODEX_AUTH_PATH, "utf8");
  return JSON.parse(raw);
}

async function refreshAndPersist(auth) {
  const refreshToken = auth.tokens?.refresh_token;
  if (!refreshToken) throw new Error("Codex の refresh_token が見つかりません");

  const res = await fetch(REFRESH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: REFRESH_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: "openid profile email",
    }),
  });
  if (!res.ok) throw new Error(`Codex トークンリフレッシュが ${res.status} を返しました`);
  const refreshed = await res.json();
  if (!refreshed.access_token) throw new Error("Codex トークンリフレッシュ結果に access_token がありません");

  auth.tokens = auth.tokens || {};
  auth.tokens.access_token = refreshed.access_token;
  if (refreshed.id_token) auth.tokens.id_token = refreshed.id_token;
  if (refreshed.refresh_token) auth.tokens.refresh_token = refreshed.refresh_token;
  auth.last_refresh = new Date().toISOString();
  await fs.writeFile(CODEX_AUTH_PATH, `${JSON.stringify(auth, null, 2)}\n`);
  return auth.tokens;
}

async function fetchUsage(accessToken, accountId) {
  const headers = {
    "User-Agent": "limit-monitor/1.0",
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };
  if (accountId) headers["ChatGPT-Account-Id"] = accountId;

  const res = await fetch(USAGE_URL, { headers });
  if (!res.ok) {
    const err = new Error(`Codex usage API が ${res.status} を返しました`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function mapWindow(window) {
  if (!window) return null;
  const usedPercent = Number(window.used_percent ?? window.usedPercent ?? 0);
  const resetAtSeconds = window.reset_at ?? window.resetAt ?? null;
  return {
    usedPercent,
    resetAt: resetAtSeconds != null ? new Date(resetAtSeconds * 1000).toISOString() : null,
    windowMinutes: window.limit_window_seconds != null ? Math.ceil(window.limit_window_seconds / 60) : null,
  };
}

export async function collectCodex() {
  try {
    const auth = await readAuth();
    let tokens = auth.tokens || {};
    if (!tokens.access_token) throw new Error("~/.codex/auth.json に access_token がありません(未ログイン)");

    const identity = decodeJwtPayload(tokens.id_token);
    let accountId = tokens.account_id || identity?.["https://api.openai.com/auth"]?.chatgpt_account_id || null;

    if (isExpired(tokens.access_token) && tokens.refresh_token) {
      tokens = await refreshAndPersist(auth);
    }

    let payload;
    try {
      payload = await fetchUsage(tokens.access_token, accountId);
    } catch (err) {
      if (err.status === 401 && tokens.refresh_token) {
        tokens = await refreshAndPersist(auth);
        payload = await fetchUsage(tokens.access_token, accountId);
      } else {
        throw err;
      }
    }

    const rateLimit = payload?.rate_limit ?? null;
    const primary = mapWindow(rateLimit?.primary_window);
    const secondary = mapWindow(rateLimit?.secondary_window);

    // 5時間枠は2026年7月に廃止されたため primary_window が無い/週次以外の枠であれば null 扱いにする
    const fiveHour = primary && primary.windowMinutes != null && primary.windowMinutes <= 6 * 60 ? primary : null;
    const weekly = secondary || (fiveHour ? null : primary);

    return okStatus("codex", { fiveHour, weekly });
  } catch (err) {
    return errorStatus("codex", err);
  }
}
