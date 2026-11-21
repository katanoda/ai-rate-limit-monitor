# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` にも同じ趣旨のプロジェクト指示がある（日本語）。変更時はそちらも合わせて確認すること。

## コマンド

- `npm ci` — 依存関係の再現
- `npm start` — 開発起動（`node --watch server/index.js`）。既定は http://localhost:4590、ポートは `LIMIT_MONITOR_PORT`、ポーリング間隔は `LIMIT_MONITOR_POLL_MS`
- テスト・lint・ビルドのスクリプトはない。JS を変更したら `node --check <file>` で構文確認し、API/表示の変更はモック応答やダミーデータで確認する
- `npm run service:install` / `service:uninstall` — Windows サービスの登録・解除（`scripts/service.js`、`node-windows` 使用）。登録時に同名の旧タスクを削除するため、通常の開発確認では実行しない

## アーキテクチャ

Express サーバー（ES Modules、ビルド不要）が `public/`（素の HTML/CSS/JS）と `GET /api/limits` を配信する。API はメモリ上のキャッシュ（`server/cache.js`）を返すだけで、リクエスト時に外部へ取りにいかない。

データの流れ: `server/poller.js` → 各 `server/collectors/*.js` → `cache.js` の `setResult(s)` → `/api/limits` → `public/app.js` が描画。

- **ポーリングは2系統**: Codex と Antigravity（内部キーは `gemini`、`agy` CLI の `/usage` を実行）は `poller.js` の共通周期。Claude は `collectors/claude.js` の `startClaudePolling()` が独自周期で動く。
- **Claude コレクターの特殊処理**: `~/.claude/.credentials.json` の OAuth トークンを使い、期限切れなら refresh して**ファイルに書き戻す**（Codex も `auth.json` に同様）。429 では `Retry-After` 優先の指数バックオフを行い、失敗時は直近成功値（`lastGood`）または Claude Desktop の `plan-usage-history.json` にフォールバックする。バックオフ中も直近エラーを表示し続けるため状態はモジュールスコープで保持している。
- **共通形式**: `collectors/types.js` の `ProviderStatus`（`okStatus` / `errorStatus` / `unsupportedStatus`）。形式を変えたら `public/app.js` も更新する。利用率 0%・枠不明・取得失敗・未対応を区別し、フォールバック表示では取得元（`note`）と取得時点（`asOf`）を確認できるようにする。
- パスや環境変数の既定値は `server/config.js`（`CLAUDE_CONFIG_DIR`、`CODEX_HOME`、`AGY_CLI_PATH` など）。
- `server/daemon/` は node-windows が生成するラッパーで gitignore 対象（編集しない）。

## 検証時の注意

開発起動でも実際にポーリングが走り、外部 API や `agy` を呼び、トークン更新で実際の認証ファイルを書き換える。実アカウントの認証ファイルを使う既存サービス／開発プロセスと並行起動しない。トークンや認証ファイルの内容をコミット・ログ・画面・API 応答・検証出力に出さず、検証用データは架空の値を使う。
