import fs from "node:fs/promises";
import { CLAUDE_CREDENTIALS_PATH, CLAUDE_DESKTOP_USAGE_PATH, POLL_INTERVAL_MS } from "../config.js";
import { okStatus, errorStatus } from "./types.js";
import { setResult } from "../cache.js";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const REFRESH_URL = "https://console.anthropic.com/v1/oauth/token";
const REFRESH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const EXP_SKEW_MS = 60_000;

// Anthropicの使用量APIは429時にRetry-Afterヘッダーを返す(実測で1000秒超)ことがあるため、
// それを最優先で使う。無い場合のみヒューリスティックな指数バックオフにフォールバックする。
const MIN_BACKOFF_MS = 10_000;
const MAX_BACKOFF_MS = 30 * 60_000;

// 直近で判明している「最良の」使用量データ。APIから直接取れなくても、
// Claude Desktopアプリのログや前回の成功結果があればこれを表示し続ける。
let lastGood = null; // { fiveHour, weekly, updatedAt: number(ms), source: "api" | "desktop-log" }
let backoffMs = null; // null = バックオフしていない(通常間隔)
let nextAttemptAt = 0;
// バックオフ待機中(APIを叩いていない間)も直近のエラーを表示し続けるための状態。
// tickのローカル変数にすると、待機中のtickではdirectErrorがnullになってしまい
// 表示が「取得できていません」という汎用メッセージに化けてしまうため、モジュールで保持する。
let lastError = null;

async function readCredentials() {
  const raw = await fs.readFile(CLAUDE_CREDENTIALS_PATH, "utf8");
  return JSON.parse(raw);
}

function isExpired(oauth) {
  if (!oauth?.expiresAt) return false;
  return Date.now() >= oauth.expiresAt - EXP_SKEW_MS;
}

// アクセストークンが期限切れの場合、refreshTokenを使ってconsole.anthropic.comから
// 新しいトークンを取得し、資格情報ファイルに書き戻す(claude CLI自身の挙動と同じ)。
async function refreshAndPersist(credentials) {
  const oauth = credentials.claudeAiOauth || {};
  const refreshToken = oauth.refreshToken;
  if (!refreshToken) throw new Error("claudeAiOauth.refreshToken が資格情報ファイルに見つかりません");

  const res = await fetch(REFRESH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: REFRESH_CLIENT_ID,
    }),
  });
  if (!res.ok) throw new Error(`Claude トークンリフレッシュが ${res.status} を返しました`);
  const refreshed = await res.json();
  if (!refreshed.access_token) throw new Error("Claude トークンリフレッシュ結果に access_token がありません");

  oauth.accessToken = refreshed.access_token;
  if (refreshed.refresh_token) oauth.refreshToken = refreshed.refresh_token;
  if (refreshed.expires_in) oauth.expiresAt = Date.now() + refreshed.expires_in * 1000;
  if (refreshed.scope) oauth.scopes = refreshed.scope.split(" ");
  credentials.claudeAiOauth = oauth;
  await fs.writeFile(CLAUDE_CREDENTIALS_PATH, `${JSON.stringify(credentials, null, 2)}\n`);
  return oauth;
}

async function readAccessToken() {
  const credentials = await readCredentials();
  let oauth = credentials.claudeAiOauth;
  if (!oauth?.accessToken) throw new Error("claudeAiOauth.accessToken が資格情報ファイルに見つかりません");
  if (isExpired(oauth) && oauth.refreshToken) {
    oauth = await refreshAndPersist(credentials);
  }
  return oauth.accessToken;
}

// Retry-Afterヘッダーは秒数、またはHTTP-date形式で来る。どちらもパースを試みる。
function parseRetryAfterMs(res) {
  const header = res.headers.get("retry-after");
  if (!header) return null;
  const asSeconds = Number(header);
  if (Number.isFinite(asSeconds)) return asSeconds * 1000;
  const asDate = Date.parse(header);
  return Number.isNaN(asDate) ? null : asDate - Date.now();
}

async function callUsageApi(token) {
  return fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "anthropic-beta": "oauth-2025-04-20",
      "User-Agent": "limit-monitor/1.0",
    },
  });
}

async function fetchDirectUsage() {
  let token = await readAccessToken();
  let res = await callUsageApi(token);

  // expiresAtの誤差などでトークンがまだ有効と判定されていた場合の保険として、
  // 401が返ってきたら一度だけリフレッシュしてリトライする。
  if (res.status === 401) {
    const credentials = await readCredentials();
    if (credentials.claudeAiOauth?.refreshToken) {
      const oauth = await refreshAndPersist(credentials);
      token = oauth.accessToken;
      res = await callUsageApi(token);
    }
  }

  if (!res.ok) {
    const err = new Error(`Anthropic usage API が ${res.status} を返しました`);
    err.status = res.status;
    err.retryAfterMs = parseRetryAfterMs(res);
    throw err;
  }
  const data = await res.json();
  return {
    fiveHour: data.five_hour
      ? { usedPercent: data.five_hour.utilization, resetAt: data.five_hour.resets_at }
      : null,
    weekly: data.seven_day
      ? { usedPercent: data.seven_day.utilization, resetAt: data.seven_day.resets_at }
      : null,
  };
}

// Claude Desktopアプリが自身の表示用に定期的(実測で約15分間隔)に書き出している
// ローカルログ。読むだけなら追加のAPIアクセスは発生しない。
// resetAt(リセット時刻)はこのログに含まれないため、既知の値があれば引き継ぐ。
async function readDesktopLogSample() {
  try {
    const raw = await fs.readFile(CLAUDE_DESKTOP_USAGE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const last = parsed?.samples?.[parsed.samples.length - 1];
    if (!last || typeof last.t !== "number") return null;
    return {
      sampledAt: last.t,
      fiveHourPercent: last.u?.fh ?? null,
      weeklyPercent: last.u?.sd ?? null,
    };
  } catch {
    return null;
  }
}

function applyDesktopSample(sample) {
  if (!sample) return;
  if (lastGood && lastGood.updatedAt >= sample.sampledAt) return; // 既知の値より古ければ無視
  lastGood = {
    fiveHour: { usedPercent: sample.fiveHourPercent, resetAt: lastGood?.fiveHour?.resetAt ?? null },
    weekly: { usedPercent: sample.weeklyPercent, resetAt: lastGood?.weekly?.resetAt ?? null },
    updatedAt: sample.sampledAt,
    source: "desktop-log",
  };
}

function applyDirectUsage(direct, now) {
  lastGood = { ...direct, updatedAt: now, source: "api" };
}

function buildResult() {
  if (!lastGood) {
    return errorStatus("claude", lastError ?? new Error("使用量データがまだ取得できていません"));
  }

  let note = null;
  if (lastError) {
    const status = lastError.status ?? "?";
    const via = lastGood.source === "api" ? "前回API取得値" : "Claude Desktopログ由来の値";
    const retryNote =
      nextAttemptAt > Date.now() ? ` (次回再試行: ${new Date(nextAttemptAt).toLocaleTimeString("ja-JP")})` : "";
    note = `直接取得に失敗中(${status}) - ${via}を表示しています${retryNote}`;
  } else if (lastGood.source === "desktop-log") {
    note = "Claude Desktopアプリのログから取得";
  }

  return okStatus("claude", {
    fiveHour: lastGood.fiveHour,
    weekly: lastGood.weekly,
    note,
    asOf: new Date(lastGood.updatedAt).toISOString(),
  });
}

async function tick() {
  const now = Date.now();

  // 1. Desktopログはノーコストなので毎回チェックし、より新しい値があれば取り込む
  applyDesktopSample(await readDesktopLogSample());

  // 2. バックオフ期間が明けていれば直接APIも試す
  if (now >= nextAttemptAt) {
    try {
      applyDirectUsage(await fetchDirectUsage(), now);
      backoffMs = null;
      lastError = null;
      nextAttemptAt = now + POLL_INTERVAL_MS;
    } catch (err) {
      lastError = err;
      // サーバーがRetry-Afterを返していればそれを最優先で使う。無ければ指数バックオフ。
      backoffMs = Number.isFinite(err.retryAfterMs)
        ? Math.min(Math.max(err.retryAfterMs, MIN_BACKOFF_MS), MAX_BACKOFF_MS)
        : Math.min(backoffMs ? backoffMs * 2 : MIN_BACKOFF_MS, MAX_BACKOFF_MS);
      nextAttemptAt = now + backoffMs;
    }
  }

  setResult(buildResult());

  // バックオフ中でもDesktopログの更新は取りこぼさないよう、
  // 次回チェックまでの待機は「次のAPI再試行時刻」と「通常間隔」の短い方にする
  const nextDelay = Math.max(1000, Math.min(nextAttemptAt - now, POLL_INTERVAL_MS));
  setTimeout(() => {
    tick().catch((err) => console.error("Claude usage ポーリングに失敗しました:", err));
  }, nextDelay);
}

export function startClaudePolling() {
  tick().catch((err) => console.error("Claude usage ポーリングに失敗しました:", err));
}
