# Claude Code, Codex, Antigravity の レートリミットモニター

各AIエージェントの5時間制限や、週次制限を一覧で表示するモニターアプリ

## アクセス方法

起動中は、ブラウザーで次のURLを開くと表示される。

- 同じPC: http://localhost:4590
- 他のPCやスマートフォン: `http://<このPCのホスト名またはIPアドレス>:4590`（Windowsファイアウォールで受信ポートの許可が必要な場合がある）
- JSON API: `GET /api/limits`（例: http://localhost:4590/api/limits）

ポートは環境変数 `LIMIT_MONITOR_PORT`、ポーリング間隔（ミリ秒）は `LIMIT_MONITOR_POLL_MS` で変更できる（既定は 4590 / 60000）。

## 開発起動

```
npm ci
npm start
```

## Windowsサービスとして常駐させる

管理者権限のターミナルで実行する。

```
npm install
npm run service:install
```

- サービス名: `AI-Rate-limit-monitor`
- 実行ユーザーは現在のログインユーザー（`~/.claude` 等を読むため）。パスワードは対話入力、または環境変数 `LIMIT_MONITOR_PASSWORD` で渡す
- アプリが停止した場合は60秒後に自動再起動する
- 旧タスクスケジューラの `AI-Rate-limit-monitor` タスクがあれば削除する（事前に実行中の `npm start` は止めておくこと）
- 削除: `npm run service:uninstall`
