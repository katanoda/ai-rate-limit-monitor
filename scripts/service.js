// Windowsサービスの登録・削除。管理者権限のターミナルで実行すること。
//   npm run service:install   サービス登録 + 起動 (既存のタスクスケジューラ登録は削除)
//   npm run service:uninstall サービス削除
//
// サービスは ~/.claude や %APPDATA%\Claude を読むため、現在のユーザーで実行する。
// パスワードは環境変数 LIMIT_MONITOR_PASSWORD か対話入力で渡す (ファイルには保存しない)。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Service } = require("node-windows");

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVICE_NAME = "AI-Rate-limit-monitor";
const LEGACY_TASK = "AI-Rate-limit-monitor";

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    // 入力を表示しない
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (a) => { rl.close(); process.stdout.write("\n"); resolve(a); });
  });
}

// fnmのシェル別一時パス(fnm_multishells)は消えるので、安定したパスを使う
function resolveNodePath() {
  if (process.env.LIMIT_MONITOR_NODE) return process.env.LIMIT_MONITOR_NODE;
  const fnmDefault = path.join(process.env.APPDATA || "", "fnm", "aliases", "default", "node.exe");
  if (!process.execPath.includes("fnm_multishells") || !fs.existsSync(fnmDefault)) return process.execPath;
  return fnmDefault;
}

function createService(extra = {}) {
  return new Service({
    name: SERVICE_NAME,
    description: "Claude Code / Codex のレートリミット監視サーバー",
    script: path.join(root, "server", "index.js"),
    nodeOptions: [],
    workingDirectory: root,
    execPath: resolveNodePath(),
    // 停止したら60秒後に再起動 (固定間隔・回数無制限)
    wait: 60,
    grow: 0,
    // 実行ユーザーに「サービスとしてログオン」権限を付与する
    allowServiceLogon: true,
    maxRestarts: -1,
    ...extra,
  });
}

function removeLegacyTask() {
  try {
    execFileSync("schtasks", ["/delete", "/tn", LEGACY_TASK, "/f"], { stdio: "ignore" });
    console.log(`タスクスケジューラの ${LEGACY_TASK} を削除しました`);
  } catch {
    // 存在しない場合は何もしない
  }
}

const cmd = process.argv[2];

if (cmd === "install") {
  const username = process.env.USERNAME;
  const password = process.env.LIMIT_MONITOR_PASSWORD || (await ask(`${username} のWindowsパスワード: `));
  const svc = createService();
  // logOnAsはコンストラクタ設定では無視されるため、生成後に代入する
  svc.logOnAs.account = username;
  svc.logOnAs.password = password;
  svc.logOnAs.domain = os.hostname();
  svc.on("install", () => {
    removeLegacyTask();
    svc.start();
  });
  svc.on("alreadyinstalled", () => console.log("既にインストール済みです"));
  svc.on("start", () => console.log("サービスを開始しました"));
  svc.on("error", (e) => console.error("エラー:", e));
  svc.install();
} else if (cmd === "uninstall") {
  const svc = createService();
  svc.on("uninstall", () => console.log("サービスを削除しました"));
  svc.on("error", (e) => console.error("エラー:", e));
  svc.uninstall();
} else {
  console.error("usage: node scripts/service.js <install|uninstall>");
  process.exit(1);
}
