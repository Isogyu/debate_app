# v6 実装計画（消す／残す／作り直す／新しく作る）

> 対象: `debate_app`（Next.js 16 / React 19 / Drizzle + SQLite / Fly.io / Anthropic SDK）
> 基準: `docs/REQUIREMENTS_v6_draft.md`（第5回確認まで反映）
> 方針: **作り直しではなく改修**。v5 の基盤（生成ジョブ、字数計算、資料番号の不変条件、エクスポート、ログイン）はよくできているので残し、
> 機能の外側（画面・ステップ・テーブル）を入れ替える。

---

## 1. 全体像

| 領域 | 判定 | 要点 |
|------|------|------|
| ログイン（合言葉＋名前選択） | 残す | `lib/auth.ts` `lib/session.ts` `app/login/` `proxy.ts` はそのまま |
| 生成ジョブ基盤 | 残す（ステップ入れ替え） | `lib/jobs/runner.ts` の永続化・再開・リトライ・partial はそのまま。ステップ定義だけ v6 用に差し替え |
| 字数・読み上げ時間 | 残す | `domain/speech.ts` `domain/pacing.ts`、`components/speech-meter.tsx` `pacemaker.tsx` |
| 立論フォーマット・資料番号 | 残す | `domain/case-format.ts` `domain/invariants.ts`（`assertPublishable` だけ削除） |
| few-shot お手本 | 残す | `domain/exemplars.ts`、`docs/samples/` |
| LLM 抽象化 | 残して拡張 | `lib/llm/provider.ts` に「Web検索ツール付き呼び出し」を追加 |
| テーマ（プロジェクト） | 作り直す | v5 は既に「お題は常に1つ＋過去のお題」。**賛成／反対の区別をなくす**（`mySide` 廃止）、資料コピーを追加 |
| 立論（バリエーション） | 作り直す | 採用／相手予想の役割を廃止し、**出どころ（登録／生成）**で持つ。削除機能を撤去、生成は各側3本まで |
| 資料 | 作り直す | 「必要／発見／確認済」の手作業前提から、**AI取得＋作成手順＋数字の検査**へ |
| 質疑 | 作り直す | 相手予想の立論だけ → **全立論**に。連鎖・優先度・8分セットを持たせる |
| 質疑フローチャート | 新規（画面） | 操作型の分岐図＋台本。印刷用の静的な図 |
| 最終弁論の雛形／特徴と戦い方 | 新規 | 立論ごとに生成 |
| 登録（アップロード） | 新規 | .docx／PDF の取り込み |
| 資料取得エンジン | 新規 | **最大のリスク**。§6 |
| 数字の検査 | 新規 | §1-9 の4観点 |
| タイマー | 残して調整 | 合図は既に画面表示。1分前・30秒前の**画面全体の色変化と大きな表示**に強化 |
| 質疑シミュレーター | 残して拡張 | 講評の観点を「テキストで判定できるもの」に絞り、フローチャート照合・練習結果の反映を追加 |
| エクスポート | 残して拡張 | 立論・資料 Word に**統計の表・グラフ画像**を追加。フローチャート・最終弁論の印刷を追加、ブロック集の印刷を削除 |
| 本番モード・PWA・ブロック集・反駁・比較衡量 | 消す | §2 |

---

## 2. 消すもの

### 2.1 ファイル・画面

| 対象 | パス |
|------|------|
| 本番モード | `src/app/live/`（`page.tsx`、`[projectId]/page.tsx`、`live-client.tsx`） |
| オフライン・PWA | `src/app/offline/`、`src/components/pwa.tsx`、`src/components/install-guide.tsx`、`public/sw.js`、`public/manifest.webmanifest`（`layout.tsx` と `app/page.tsx` の参照も外す） |
| ブロック集 | `src/app/projects/[projectId]/blocks/` |
| 反駁シート | `src/app/projects/[projectId]/rebuttal/` |
| ブロック集の印刷 | `print/[kind]/page.tsx` の `blocks` と `BlocksSheet` |
| 採用・削除 | `case/actions.ts` の `adoptVariant` `deleteVariant`、`variant-manager.tsx` の該当ボタン |
| 本番論題フラグ | `isCompetitionTopic`（ウィザードのチェック、`assertPublishable`）※事例DB公開が削除されたため不要 |
| モック | `docs/mock/` の `live*.html` `blocks.html` `rebuttal.html` `admin.html` `guide.html` `dashboard.html` |

### 2.2 生成ステップ・プロンプト・型

- `lib/jobs/steps.ts`: `stepRebuttal` `stepBlocks` `stepComparison` `opponentVariants`
- `lib/llm/prompts.ts`: `rebuttalPrompt` `blocksPrompt` `comparisonPrompt`
- `domain/schemas.ts`: `rebuttalOutputSchema` `blocksOutputSchema` `comparisonOutputSchema`
- `domain/types.ts`: `Rebuttal` `BlockEntry` `Comparison` `VariantRole` `AttackPoint` の旧定義（新定義に置換）、`GenStep` の `rebuttal` `blocks` `comparison`
- `lib/export/data.ts`: blocks・rebuttals の読み込み

### 2.3 DB

- テーブル: `rebuttals` `blocks`
- 列: `projects.my_side` `projects.comparison` `projects.adopted_case_id` `projects.is_competition_topic` `case_variants.role` `case_variants.quality_score`
- `activity_logs.action` の `pack_build`

### 2.4 依存パッケージ

- `fuse.js`（本番モードの検索専用）

---

## 3. データモデル

### 3.1 変更する既存テーブル

| テーブル | 変更 |
|----------|------|
| `projects`（＝テーマ） | 上記の列を削除。`status` を `active` / `archived` の2値に。**`active` は常に1件**をアプリ側とユニーク部分インデックスの両方で保証 |
| `case_variants`（＝立論） | `origin`（`uploaded` / `generated`）、`label`（一覧での呼び名）、`speechSeconds`（推定読み上げ秒）、`lengthWarning`（字数調整で収まらなかった場合）を追加。`framework` `approach` は生成時のみ使用 |
| `source_materials`（＝資料の実体） | `status` を `procedure`（作成手順のみ）／`unverified`（AI取得・未確認）／`verified` に置換。`origin`（`ai_fetched` / `uploaded` / `copied`）、`url`、`lastCheckedAt`、`sourceDomain`、`withinAllowedSources`（§1-3a 内か）、`procedure`（JSON: 何を証明／検索語／探す場所／抜き出すもの）、`statistic`（JSON: §3.3）、`copiedFromMaterialId` を追加 |
| `cross_exam_nodes`（＝質疑） | `targetVariantId` を必須に（全立論が対象）。`direction` を廃止（同じデータを両面で見せる）。`chainId`、`chainOrder`、`priority`、`inEightMinuteSet`、`attackPoint`（前提／根拠／因果／効果／数字の使い方）、`targetParagraph`、`modelAnswer`、`origin`（`generated` / `practice`）、`stuckCount`（練習で詰まった回数）を追加 |
| `practice_sessions` | `userVariantId`（自分が守る立論）を追加。`feedback` の型を §8 の新形式に |
| `generation_jobs` | `kind`（`generate` / `import` / `more_questions` / `copy`）を追加。ステップ名を v6 のものに |
| `activity_logs` | `action` に `upload` `copy` を追加、`pack_build` を削除 |

### 3.2 新しいテーブル

| テーブル | 中身 |
|----------|------|
| `uploads` | 登録ファイルの原本（ファイル名・形式・保存パス・抽出テキスト・取り込み結果の指摘） |
| `fetched_documents` | 資料取得で取ってきたページ／PDF の本文テキストとハッシュ、URL、取得日時。**引用文の照合元**。同じURLは再取得しない |
| `number_findings` | 数字の検査結果。立論ID・該当箇所・数字・観点（出典／計算／比較の前提／使い方）・重大度・説明 |
| `closing_templates` | 最終弁論の雛形（穴埋め枠＋経路ごとの記入例）。立論ごと |
| `case_strategies` | 特徴と戦い方（強み・弱点・守るところ・譲らないこと・勝ち筋）。立論ごと |

### 3.3 統計資料の JSON（`source_materials.statistic`）

```
{
  inputs:   [{ label, value, unit, year, statName, tableId, url, locator }],  // 取得した元の数値と、その表のどこか
  formula:  [{ label, expression, resultRef }],                              // コードで計算する式
  results:  [{ label, value, unit }],                                        // 計算結果（コードが書く）
  table:    { columns, rows },
  chart:    { type: "bar" | "line", series },                                // 画像はエクスポート時にコードで描く
  comparability: [{ ok, aspect: "年次"|"定義"|"単位"|"対象範囲"|"名目/実質", note }]
}
```

### 3.4 既存データの移行

手元の `data/debate.db` は空。本番（Fly.io）にデータがある場合に備え、次の手順にする。

1. 移行前に本番DBをバックアップ（`docs/DEPLOY.md` の手順）
2. **旧データは引き継がず、v6 スキーマで作り直す**案を推奨（v5 の立論は「相手予想」など役割が v6 と対応しないため）。
   引き継ぐ場合は、立論を「生成」扱いで移し、ブロック・反駁・比較衡量は捨てる
   → **確認事項 1**

---

## 4. 生成パイプライン（v6）

`runner.ts` は変えずに、`GEN_STEPS` と `HANDLERS` を差し替える。ジョブは**立論1本につき1ジョブ**（v5 は論題全体で1ジョブだった）。

### 4.1 生成（AI）ジョブ

| # | ステップ | 担当 | 備考 |
|---|----------|------|------|
| 1 | `analysis` | LLM | テーマで1回だけ（2本目以降は再利用）。確認関門はチェック時のみ（既存の `awaiting_review` を流用） |
| 2 | `case_outline` | LLM | 既存。2本目以降は既存立論の枠組み・構成を渡して「変える」指示 |
| 3 | `case_body` | LLM＋コード | 既存＋**字数の自動調整**。`countSpeechChars` で数え、4分30秒超〜5分00秒に入らなければ「削る／補う」を最大2回。外れたら `lengthWarning` |
| 4 | `source_plan` | LLM | 既存 `source_req` を改修。資料ごとに「何を証明するか・種類・検索語・候補の情報源（ホワイトリストIDのみ）」 |
| 5 | `source_fetch` | コード＋LLM | **新規**。§6 の資料取得。取れたものは引用・出典・統計を埋め、取れないものは `procedure` |
| 6 | `number_check` | コード＋LLM | **新規**。§7 |
| 7 | `cross_exam` | LLM | 改修。§5 |
| 8 | `closing` | LLM | **新規**。最終弁論の雛形 |
| 9 | `strategy` | LLM | **新規**。特徴と戦い方（`number_findings` と質疑の弱点を入力に使う） |

- 生成の開始時に**その側の生成済み本数が3本未満か**をサーバーで検査（DBトランザクション内で数える。二重押しで4本目ができないように）
- 生成中は**テーマ変更を不可**に（`status` が `queued` / `running` / `awaiting_review` のジョブがあれば拒否）

### 4.2 登録（アップロード）ジョブ

`import`（抽出・構造化・番号対応） → `number_check` → `cross_exam` → `closing` → `strategy`

- `import`: .docx は `mammoth` でテキスト化、PDF は `unpdf`（pdf.js ベース）でテキスト化。**文字が取れないPDFはスキャン画像として拒否**
- 構造化（Ⅰ／Ⅱ／(1)(2)／Ⅲ）は LLM に「区切り位置」だけ返させ、**本文そのものはコードで切り出す**（自作の文章を書き換えさせない）
- `【資料N参照】` と `【資料N】` の対応はコード（既存 `matchRefMarkers` / `extractRefNumbers` を流用）
- 登録資料は `origin=uploaded`。出典のドメインが §1-3a 外なら `withinAllowedSources=false` → 注意表示＋弱点

### 4.3 追加生成

- 「この箇所をもっと」: `more_questions` ジョブ（`cross_exam` のみ、既存の質問を渡して同趣旨を除外）
- 練習からの質問追加: ジョブにせず、講評と同じリクエストで保存（§8）

---

## 5. 質疑とフローチャート

### 5.1 生成

- 1立論につき、**段落（(1)(2)(3)…）× 攻撃点（前提／根拠／因果／効果／数字の使い方）**の表を先にコードで作り、LLM に各マスを埋めさせる（網羅をプロンプト頼みにしない）
- 出力は既存の `CrossExamNode` ＋ 分岐（認める／否定する／はぐらかす）＋ 模範回答。**連鎖**は `chainId` で束ねる
- 数が多いので段落ごとに分けて呼ぶ（v5 は 16000 トークンでも切れかけていた）。1回の出力を小さくし、並列数は2
- `number_findings` の「使い方」の指摘は、必ず1つ以上の質問にする（コードで漏れを検査）
- `assertNoCycle` は継続
- **8分セット**: 優先度上位から、発言の字数で読み上げ時間を見積もって合計8分弱になるよう**コードで選ぶ**

### 5.2 フローチャート画面

- `@xyflow/react`（React Flow）＋ `elkjs` で自動レイアウト
- 連鎖ごとに折り畳み。ノードの色: 質問／認める／否定する／はぐらかす／引き出したい結論
- ノードを押すと、根からそのノードまでの経路を会話形式（台本）で右側に表示
- 「攻める側で見る」「守る側で見る」の切替（同じデータ、文言と並び順だけ変える）

### 5.3 印刷

- 同じレイアウト結果を**静的SVG**で出し、連鎖ごとに1ページ、下に台本。既存の印刷CSS方式（`print/[kind]`）に `flowchart` を追加

---

## 6. 資料取得エンジン（最大のリスク）

### 6.1 構成

```
source_plan（何を証明する資料か・検索語・候補情報源）
   │
   ├─ 法令 ──────→ e-Gov 法令API（v2）で条文取得 → そのまま掲載
   ├─ 国会 ──────→ 国会会議録検索API → 発言本文
   ├─ 統計 ──────→ e-Stat API（要 appId）→ 表の値 ──→ コードで計算・表・グラフ定義
   ├─ 論文 ──────→ CiNii Research API で検索 → 公開PDFのみ取得（J-STAGE 含む）
   └─ 官公庁・判例 → Claude の Web検索ツール（allowed_domains で §1-3a のドメインに限定）で URL を得る
                        → サーバーが自分で fetch（ドメインを再検査）→ HTML/PDF を本文テキスト化
   ↓
fetched_documents に本文を保存
   ↓
LLM に「本文の中から引用する箇所」を選ばせる
   ↓
コードで照合（空白・改行・全半角を正規化した上で、本文に部分一致するか）→ 一致しなければ不採用
   ↓
出典（書式は docs/samples の実物に合わせる）＋ URL ＋ 最終確認日（取得日）
```

- ドメインの許可リストは `domain/source-whitelist.ts` を拡張して一元管理（`go.jp` 配下、`courts.go.jp`、`kokkai.ndl.go.jp`、`laws.e-gov.go.jp`、`e-stat.go.jp`、`ci.nii.ac.jp`、`jstage.jst.go.jp`）
- 取得の上限: 1資料あたり候補URL 5件・ページ3MB・PDF 60ページまで。1立論あたりの取得回数にも上限を設け、超えたら残りは `procedure`
- 取れなかった理由（検索で見つからない／本文が取れない／引用が照合できない）を `procedure` に添える

### 6.2 統計資料

- 数値は e-Stat の表から**セル単位で**取り、`inputs[].locator` に表ID・行・列を記録
- 計算は `domain/statistics.ts`（新規）の関数で行う（割合・伸び率・差・一人当たり・構成比）。**LLM は式の選択だけ**、値はコードが入れる
- 比較の前提（年次・定義・単位・対象範囲・名目/実質）はメタデータから機械的に比べ、判定できない項目は LLM に「確認が必要」とだけ言わせる
- グラフ画像はエクスポート時に SVG をコードで組み、`@resvg/resvg-js` で PNG にして Word に貼る

### 6.3 先に試す（スパイク）

本番の論題1つ（`docs/samples` の青色事業専従者の題材）で、資料5本の取得がどこまで成功するかを**実装の最初に**測る。成功率が低い場合は「作成手順を丁寧に出す」側に比重を移す判断をここで行う。

---

## 7. 数字の検査（`number_check`）

| 観点 | 方法 |
|------|------|
| 出典の明記 | 立論・資料から数字をコード（正規表現：数値＋単位、％、倍、割、円、人、件、年度）で抜き出し、近くに `【資料N参照】` があり、その資料に出典があるかを検査。**生成立論では出典のない数字を本文から除く**（`case_body` に差し戻し）。登録立論は指摘のみ |
| 計算の再現 | 資料の `results` と立論本文の数字を突き合わせ、一致しなければ指摘 |
| 比較の前提 | §6.2 の `comparability` |
| 使い方の妥当性 | LLM に、数字ごとに「相関と因果の混同／期間の切り取り／母数の違い／平均で隠れる分布」の観点で点検させる。結果は弱点として質疑・特徴と戦い方へ |

---

## 8. 練習（タイマー・ペースメーカー・シミュレーター）

- タイマー（`speech-timer.tsx`）: 1分前・30秒前に**画面全体の背景色が変わり、残り時間を大きく表示**。種目（5分／8分／1分）は既存の `SPEECH_KINDS`
- ペースメーカー: 既存のまま。登録・生成どちらの立論でも使える
- シミュレーター（`simulator/`）:
  - 自分が守る立論／AIが演じる相手の立論を、**登録・生成の全立論から選ぶ**（`mySide` による自動選択を廃止）
  - AIの質問は生成済みの質疑（特に8分セットと連鎖）を優先して使う
  - 講評（`simulatorFeedbackPrompt` 改修）: 要件 §4.4 の「判定できる」観点のみ。さえぎり・沈黙・声は外し、画面に「テキスト練習では判定しない観点」として明記。**フローチャート照合**（どの連鎖を使い、結論まで到達したか）を追加。発言の長さは `countSpeechChars` から読み上げ秒数を推定して渡す
  - 反映: 詰まった質問に `stuckCount++`（優先度に加算）、未登録の質問を `origin=practice` で追加（同趣旨判定は既存質問と一緒に LLM に渡して判定）、練習結果から最終弁論の雛形の記入例を出す

---

## 9. 画面とルート

| 画面 | ルート | 元になる v5 |
|------|--------|-------------|
| テーマ | `/`（現テーマ）、`/themes/new`、`/themes/archive/[id]` | `app/page.tsx`、`projects/new/`（`mySide`・本番論題の欄を削除） |
| 立論一覧 | `/themes/[id]/cases` | `case/variant-manager.tsx` を作り直し。賛成／反対 × 登録／生成、残り本数、アップロード |
| 立論詳細 | `/themes/[id]/cases/[caseId]/{body,sources,questions,flowchart,closing,strategy}` | `case/case-view.tsx`（本文）、`sources/`（資料）、`crossexam/`（質疑）を移設 |
| 練習 | `/themes/[id]/practice/{timer,pacemaker,simulator}` | `speech-timer` `pacemaker` `simulator/` |
| エクスポート | `/themes/[id]/export` | `export/`、`print/[kind]`、`api/.../export/[kind]` |

- URL の `projects` → `themes` の改名は任意（内部テーブル名は `projects` のまま）
- 「AI生成（未確認）／確認済」: 既存 `VerificationBadge` を立論・資料・質疑・雛形・戦い方の全画面とエクスポートに。確認済への変更はボタン一つ（記録は取らない）
- 過去テーマ: 閲覧・印刷のみ。資料の「現テーマにコピー」ボタン（コピー後は未確認に戻す）

---

## 10. 追加ライブラリ

| 用途 | パッケージ |
|------|-----------|
| .docx の取り込み | `mammoth` |
| PDF のテキスト化（取り込み・資料取得） | `unpdf` |
| HTML の本文抽出 | `@mozilla/readability` ＋ `linkedom` |
| フローチャート | `@xyflow/react`、`elkjs` |
| グラフ画像（Word 用） | `@resvg/resvg-js` |

環境変数: `ESTAT_APP_ID`（e-Stat API の無料登録で取得）を追加。**確認事項 2**

---

## 11. 進め方

各フェーズは「動く状態で終える」。テストは `node --test`（既存）に追加。

| フェーズ | 内容 | 完了条件 |
|----------|------|----------|
| 0 | ブランチ作成、本番DBバックアップ、要件書・DESIGN の差し替え | — |
| 1 | **資料取得のスパイク**（§6.3） | 実題材で資料5本の取得成功率と失敗理由が分かる |
| 2 | 削除（§2）＋スキーマ移行 | `typecheck` `lint` `test` が通る。消した画面へのリンクが残っていない |
| 3 | テーマ・立論一覧・生成上限・削除撤去・生成中のテーマ変更禁止 | 各側3本目の次が拒否される、生成中にテーマ変更できない |
| 4 | 生成パイプライン（`case_body` の字数自動調整まで） | 生成立論が4分30秒超〜5分に入るか、`lengthWarning` が付く |
| 5 | 資料取得エンジン・統計・作成手順 | 引用文の照合に落ちたものが保存されない（テスト）、計算がコードで再現できる |
| 6 | 数字の検査 | 出典のない数字が生成立論に残らない（テスト） |
| 7 | 登録（アップロード） | 実物の立論・資料（`docs/samples` を .docx 化したもの）が番号対応まで取り込める |
| 8 | 質疑・8分セット | 段落×攻撃点の網羅がコードで検査される、8分セットの推定時間が8分以内 |
| 9 | フローチャート（画面・印刷） | 台本表示、連鎖ごとの印刷 |
| 10 | 最終弁論の雛形・特徴と戦い方 | 雛形が約320字枠、記入例が経路ごとにある |
| 11 | 練習（タイマー強化・シミュレーター改修・講評・反映） | 詰まった質問の優先度が上がる、講評に判定しない観点が明記される |
| 12 | エクスポート（表・グラフ入り Word、フローチャート・雛形の印刷） | Word に表とグラフ画像、「AI取得（未確認）」表示 |
| 13 | 通しの確認 | 実題材で 登録1本＋生成各側1本 を最後まで流し、別のエージェントが要件書と照合 |

フェーズ1を最初に置くのは、資料取得の成功率次第でフェーズ5の作り込み方が変わるため。フェーズ2〜4は資料取得と独立に進められる。

---

## 12. テスト（追加分）

- 引用文の照合（正規化・部分一致・不一致で不採用）
- ドメイン検査（許可外URLの取得拒否、リダイレクト先も検査）
- 統計の計算関数（割合・伸び率・一人当たり・構成比）と比較の前提の判定
- 数字の抽出（全角数字・漢数字混じり・％・割）
- 字数の自動調整ループ（モックLLMで、2回で収まらない場合の警告）
- 生成上限（同時リクエストでも4本目ができない）
- 取り込み（番号の対応が取れない場合の指摘）
- 質疑の網羅検査・8分セットの時間見積もり
- 既存のテスト（`case-format` `invariants` `pacing` `speech` `exemplars` `generation-guards`）は継続

---

## 13. リスクと確認事項

### リスク

| リスク | 影響 | 対策 |
|--------|------|------|
| 資料取得の成功率が低い | 「資料は可能な限り完成」が達成できない | フェーズ1で測る。失敗理由ごとに作成手順を具体化 |
| 官公庁PDFの表が崩れてテキスト化される | 統計値を取り違える | 統計は e-Stat API を優先。PDFの表から取った値は「未確認」を強調表示 |
| 1立論あたりのAPI費用が v5 より増える（質疑の網羅＋取得） | 費用 | 段落ごとの分割呼び出し、取得回数の上限、同じURLの再取得をしない |
| Fly.io のメモリ（PDF処理） | 落ちる | ページ数上限、PDF処理をジョブ内で1件ずつ |

### 確認事項（実装前に決めたいこと）

1. **本番（Fly.io）の既存データ**を引き継ぐか、v6 で作り直すか（推奨: 作り直す）
2. **e-Stat の appId** を取得してよいか（無料の利用登録が必要。統計資料を完成させるのに必須）
3. 実装は誰がどこで行うか（このセッションで進める／Devin 等に渡す）。渡す場合はフェーズ単位のタスク票にする
