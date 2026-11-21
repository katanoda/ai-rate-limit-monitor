# AGENTS.md

## プロジェクト概要

Claude Code、Codex CLI、Antigravity の利用枠をブラウザで確認するモニター。Node.js の ES Modules と Express で動作し、画面はビルド不要の HTML、CSS、JavaScript で構成する。設定の既定値は `server/config.js`、Windows サービスの運用手順は `README.md` を参照する。

## 構成と変更時の確認事項

- `server/index.js` は静的ファイルと `GET /api/limits` を配信する。取得結果は `server/cache.js` のメモリ上のキャッシュを経由する。
- `server/poller.js` と `server/collectors/` がプロバイダーごとの取得を担当する。Codex と Antigravity（内部キーは `gemini`）は共通周期で取得する。Claude は独自周期で動き、`Retry-After` を考慮したバックオフと Claude Desktop のログへのフォールバックを持つ。
- 取得結果の共通形式は `server/collectors/types.js` の `ProviderStatus` に従う。応答形式を変更するときは `public/app.js` の描画も確認する。利用率 0%、利用枠が不明な場合、取得失敗、未対応を区別し、フォールバックを表示するときは取得元と取得時点を確認できるようにする。
- `scripts/service.js` は Windows サービスの登録・解除を担当する。登録時は同名の旧タスクを削除する処理もあるため、通常の開発確認ではサービス操作を実行しない。

## 開発と検証

- 依存関係の再現には `npm ci` を使う。開発起動は `npm start`。既定では `http://localhost:4590` から画面を確認できる。ポートは `LIMIT_MONITOR_PORT` で指定できる。
- 現状、`package.json` にテストや lint のスクリプトはない。JavaScript を変更したら `node --check <変更したファイル>` を実行する。API や表示を変更した場合は、影響する箇所をモック応答やダミーデータで確認する。
- 開発起動でもポーリングが始まり、実環境では外部 API や Antigravity CLI を呼び出す。Claude と Codex のトークン更新処理はローカル認証ファイルに書き戻すため、通常の検証は実アカウントから切り離す。実アカウントで確認する場合は、同じ認証ファイルを使う既存のサービスや開発プロセスと並行起動しない。
- OAuth トークン、認証ファイルの内容、サービス用パスワードをコミット、画面、API 応答、ログ、検証出力に含めない。検証用の認証データには架空の値を使う。
