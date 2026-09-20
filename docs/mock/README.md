# 画面モック

DESIGN.mdの画面遷移図に対応する静的HTMLモック。最小限のデザインで遷移を確認できる。

`index.html` をブラウザで開いて開始。

## 画面遷移との対応

| ファイル | 画面 | 遷移図ノード |
|----------|------|--------------|
| index.html | プロジェクト一覧 | HOME |
| wizard.html | 論題入力 | WIZ |
| analysis.html | 分析確認 | ANAL |
| generating.html | 生成進捗 | (ANAL→DASH間) |
| dashboard.html | ダッシュボード | DASH |
| case.html | 立論画面（肯定側） | CASE |
| case_neg.html | 立論画面（否定側・相手想定パターン） | CASE |
| sources.html | 資料要件 | SRC |
| crossexam.html | 質疑フロー | CX |
| rebuttal.html | 反駁・比較 | REB |
| blocks.html | ブロック集 | BLK |
| live.html | 本番モード（カテゴリ） | LIVE |
| live-list.html | 本番モード（ブロック一覧） | LIVE |
| live-detail.html | 本番モード（ブロック詳細） | LIVE |
| simulator.html | 質疑シミュレーター | SIM |
| export.html | エクスポート | EXP |
| guide.html | ガイド・用語集 | GUIDE |
| practice.html | 練習問題 | PRAC |
| admin.html | 管理 | ADMIN |

## モックで確認できること

- 本番モードは「カテゴリ→ブロック一覧→詳細」の2タップ3階層
- 立論画面の【資料N】リンク→資料要件画面への遷移
- ブロック集のカテゴリサイドバー→本番モードと同じ軸
- 生成中の進捗表示（generating.html）
