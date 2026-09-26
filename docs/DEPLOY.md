# デプロイ手順（Fly.io）

ゼミ生が各自のPC・スマホから使えるようにするまでの手順。
URLを1つ配るだけで済む形にする。

## なぜFly.ioか

- SQLiteを**そのまま**使える（永続ボリュームが付けられる）
- 生成ジョブを**バックグラウンドで数分走らせられる**（サーバーレスだと途中で止まる）
- 管理者PCの電源に依存しない

> Vercelは使えない。ファイルシステムが永続せずSQLiteが消え、
> 関数がレスポンス後に終了するため生成が完走しない。

## 0. 事前に必要なもの

- **Fly.ioにクレジットカードを登録しておくこと。**
  無料枠を使う場合でも登録が必須で、未登録だと `fly apps create` の時点で止まる
- Anthropic APIキー
- ゼミで共有する合言葉
- （任意）e-Stat APIのアプリケーションID。統計資料を自動で完成させたい場合は取得しておく
  （[e-Stat](https://www.e-stat.go.jp/api/) で無料登録）

### 費用の目安

課金される軸は3つ。単価は変動するので [fly.io/docs/about/pricing](https://fly.io/docs/about/pricing/) で確認すること。

| 軸 | 課金 | この構成 |
|----|------|----------|
| コンピュート | 起動時間×スペック | shared-cpu-1x / 512MB。使っていない間は停止するので実使用時間ぶんのみ |
| ボリューム | GB×月（**停止中も発生**） | 1GB。唯一の固定費 |
| 送信量 | 外向き通信 | テキスト中心で誤差の範囲 |

**費用の主役はFlyではなくAnthropic API。** 生成1本あたりの費用は、資料取得（法令・統計・
論文などの検索・取得）と質疑・フローチャートの生成量に左右される。

## 1. 初回のデプロイ

```bash
brew install flyctl
fly auth login
```

アプリ名はFly全体で重複できないため、`fly.toml` の `app` を自分用の名前に変える
（例: `debate-app-zemi2026`）。そのうえで、

```bash
fly apps create <fly.tomlに書いた名前>
fly volumes create debate_data --region nrt --size 1 --yes
```

> コマンドに `#` 以降のコメントを付けて貼らないこと。
> `fly launch --no-deploy   # 説明` のように貼ると、`#` が引数として渡されて
> `unknown command "#"` になる。

## 2. 秘密情報を設定する

```bash
fly secrets set ANTHROPIC_API_KEY=sk-ant-... DEBATE_APP_PASSWORD=ゼミの合言葉
```

統計資料の自動取得を使う場合は、e-Stat の appId も設定する。

```bash
fly secrets set ESTAT_APP_ID=...
```

軽い処理に使うモデルを既定（Haiku）から変えたい場合は、これも secrets で設定できる
（任意）。

```bash
fly secrets set DEBATE_MODEL_LIGHT=claude-haiku-4-5-20251001
```

`fly secrets` はイメージに焼き込まれず、リポジトリにも残らない。

## 3. デプロイ

```bash
fly deploy
fly open        # 発行されたURLが開く
```

URL（`https://debate-app-zemi.fly.dev` 等）をゼミ生に配る。配るのはこれだけ。

### 初回デプロイで起きること

起動時（`npm run start:migrate`）にマイグレーションが走り、次の判定をする
（`src/db/migrate.ts`）。

- 既存の `data/debate.db` が **v5 のスキーマ**（`blocks` テーブルがある）なら、
  そのまま `data/backups/debate-v5-<日時>.db` に退避し、**v6 は空のDBから始める**。
  v5 のデータは引き継がない
- v6 のDBが既にある場合は、マイグレーション前に通常のバックアップ（`data/backups/debate-<日時>.db`）
  を取ってから適用する

いずれの場合もボリューム（`debate_data`）自体は消えないので、退避したファイルは
`fly ssh console` で読み出せる。

## 4. ゼミ生側の初回設定

電波のある場所で以下をやってもらう。

1. 配られたURLを開く
2. 合言葉と名前を入れてログイン

## 5. 運用の注意

| 項目 | 内容 |
|------|------|
| マシンは1台のまま | SQLiteなので増やすとデータが分かれる。`fly scale count 1` を維持する |
| バックアップ | `fly ssh console -C "ls /app/data/backups"`。マイグレーション時に自動取得される |
| 手元に落とす | `fly ssh sftp get /app/data/debate.db ./debate.db` |
| 合言葉の変更 | `fly secrets set DEBATE_APP_PASSWORD=新しい合言葉`。全員のログインが切れる |

### バックグラウンドの生成ジョブとauto-stop

`fly.toml` は `auto_stop_machines = "stop"` / `min_machines_running = 0` にしている。
使われていない間はマシンを止め、コンピュート課金を発生させない**意図的な設定**。

この設定により、生成ジョブが走っている最中にアクセスが途絶えてマシンが停止すると、
ジョブはその時点で止まる。**次に誰かがアクセスしてマシンが起動すると、
`src/instrumentation.ts` の起動処理が途中のジョブを検知して続きから自動的に再開する**
（実行中だったステップだけpendingに戻し、完了済みのステップはやり直さない）。
つまりデータが失われることはないが、アクセスが長時間ないと生成の完了が
その分遅れる。ゼミ生には「生成中は少し待ってからもう一度開くと進んでいる」と伝えておく。

## 6. 資料取得の試験をFlyのマシン上で実行する

`npm run spike:sources` は実際の官公庁サイト・e-Gov・国会会議録・e-Stat・CiNiiに繋いで
資料取得の成功率を測るスクリプト。この開発環境（アプリ内ブラウザ等）からは外部の実サイトに
到達できない場合があるため、Flyのマシン上か自分のPCで実行する。

Dockerfile の実行イメージには `scripts/` と、`npm ci` でインストールした
`node_modules`（`tsx` を含む devDependencies ごと）がそのままコピーされているため、
デプロイ後のマシンで直接実行できる。

```bash
fly ssh console -C "npm run spike:sources"
```

一時ディレクトリのDBを使うため、本番の `data/debate.db` には触れない。
`ESTAT_APP_ID` を設定していない場合、統計資料の取得は測れない（secretsで設定してから
実行すること）。

### ローカルで実行する場合

Flyに繋がなくても、政府サイトに到達できる自分のPCなら直接実行できる。

```bash
ANTHROPIC_API_KEY=... ESTAT_APP_ID=... npm run spike:sources
```

## 紙の併用を勧める

サーバーもスマホも当日に壊れることがある。エクスポート画面から立論・資料をPDF・Wordで
書き出して持っておくのが最終手段になる。
