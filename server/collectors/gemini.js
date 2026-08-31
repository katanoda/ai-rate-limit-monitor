import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { okStatus, errorStatus } from "./types.js";

const execFileAsync = promisify(execFile);

const AGY_CLI_PATH = process.env.AGY_CLI_PATH || "agy";

/**
 * Antigravity CLI(`agy`)には `/usage` というスラッシュコマンドがあり、
 * `--print --output-format json` で非対話的に叩くとモデルグループ別の
 * 週次/5時間クォータを構造化JSONで返す。認証はagy自身が管理する
 * (Windows Credential Manager等)ため、このプロセスからは一切トークンに触れない。
 */
async function fetchUsageViaCli() {
  const { stdout } = await execFileAsync(AGY_CLI_PATH, ["--print", "/usage", "--output-format", "json"], {
    timeout: 15000,
  });
  return JSON.parse(stdout);
}

function mapBucket(bucket) {
  if (!bucket) return null;
  return {
    usedPercent: Math.round((1 - Number(bucket.remaining_fraction)) * 1000) / 10,
    resetAt: bucket.reset_time || null,
  };
}

export async function collectGemini() {
  try {
    const result = await fetchUsageViaCli();
    if (result.status !== "SUCCESS") {
      throw new Error(result.error || "agy /usage が失敗しました");
    }

    const groups = result.command?.data?.groups || [];
    const geminiGroup = groups.find((g) => /gemini/i.test(g.name || ""));
    if (!geminiGroup) {
      throw new Error("agy /usage の結果にGeminiモデルグループが見つかりません");
    }

    const buckets = geminiGroup.buckets || [];
    const fiveHour = mapBucket(buckets.find((b) => b.window === "5h"));
    const weekly = mapBucket(buckets.find((b) => b.window === "weekly"));

    return okStatus("gemini", { fiveHour, weekly });
  } catch (err) {
    if (err?.code === "ENOENT") {
      return errorStatus("gemini", "Antigravity CLI(agy)が見つかりません(PATHが通っていない可能性があります)");
    }
    return errorStatus("gemini", err);
  }
}
