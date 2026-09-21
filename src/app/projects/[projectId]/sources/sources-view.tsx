"use client";

/**
 * 資料要件画面（DESIGN.md §6 SRC）
 *
 *  - 「どんな資料が必要か」→「実際に見つけて登録する」までを1画面で完結させる
 *  - 資料番号は立論パターン内でのみ有効。パターンを切り替えると番号も変わる
 *  - 「証明すること」を必ず先頭に出す（実物では資料タイトル＝命題だったため）
 */

import { useActionState, useEffect, useState } from "react";
import { saveMaterial, verifyMaterial, type ActionState } from "./actions";
import { Term } from "@/components/chrome";
import { useOnline } from "@/components/pwa";

export interface SourceItem {
  refId: string;
  number: number;
  materialId: string;
  provesWhat: string;
  sourceType: string;
  status: "needed" | "found" | "verified";
  citation?: string;
  quote?: string;
  isModified: boolean;
  modificationNote?: string;
  description: string;
  searchKeywords: string[];
  suggestedSources: {
    id: string;
    label: string;
    url: string;
    /** 検索語入りで開けるか。開けるなら見た目で分かるようにする */
    searchable?: boolean;
    hint: string;
  }[];
  categoryIds: string[];
  /** どのClaimを支えるか。立論への逆リンク（§14 相互リンク） */
  usedIn: { claimId: string; title: string }[];
  formatHint: string;
}

export interface VariantOption {
  id: string;
  label: string;
}

const TYPE_LABELS: Record<string, string> = {
  law: "法令",
  precedent: "判例",
  statistic: "統計",
  paper: "論文",
  govt_doc: "政府文書",
  diet_record: "国会",
  news: "報道",
  book: "書籍",
  org_doc: "団体資料",
  self_made: "自分で作る",
};

const STATUS_LABELS = {
  needed: { label: "未発見", color: "var(--neg)" },
  found: { label: "発見済", color: "var(--accent)" },
  verified: { label: "確認済", color: "var(--aff)" },
} as const;

export function SourcesView({
  projectId,
  items,
  variants,
  currentVariantId,
  categoryNames,
  initialStatus = "all",
}: {
  projectId: string;
  items: SourceItem[];
  variants: VariantOption[];
  currentVariantId: string;
  categoryNames: Record<string, string>;
  /** 「AI生成（未確認）」から来たときは未発見だけを出す */
  initialStatus?: "all" | "needed" | "found" | "verified";
}) {
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [status, setStatus] = useState<"all" | "needed" | "found" | "verified">(
    initialStatus,
  );

  const visible = items.filter(
    (i) =>
      (status === "all" || i.status === status) &&
      (!categoryId || i.categoryIds.includes(categoryId)),
  );

  const counts = {
    all: items.length,
    needed: items.filter((i) => i.status === "needed").length,
    found: items.filter((i) => i.status === "found").length,
    verified: items.filter((i) => i.status === "verified").length,
  };

  return (
    <div>
      {/* 「確認済」にする手順が分からないと、バッジが永遠に消えない */}
      <details className="mb-4 rounded border border-[var(--line)] p-3 text-sm">
        <summary className="cursor-pointer font-bold">
          「AI生成（未確認）」を「確認済」にするには
        </summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>下の資料ごとに「探し方」と「情報源」を見て、実物を探す</li>
          <li>見つけたら「出典・引用文を登録する」から出典を入れる（→ 発見済）</li>
          <li>実物を目で確かめたら「実物を確認した」を押す（→ 確認済）</li>
        </ol>
        <p className="mt-2 text-[var(--muted)]">
          全部の資料が確認済になると、立論のバッジも「確認済」に変わります。
        </p>
      </details>

      <div className="mb-5 space-y-3 border-b border-[var(--line)] pb-4">
        {/* 選べる相手がいて初めて意味がある。1つなら用語ごと隠す */}
        {variants.length > 1 && (
          <label className="block text-sm">
            <span className="mr-2 text-[var(--muted)]">どの立論の資料か:</span>
            <select
              defaultValue={currentVariantId}
              onChange={(e) => {
                window.location.href = `/projects/${projectId}/sources?variant=${e.target.value}`;
              }}
              className="rounded border border-[var(--line)] p-2"
            >
              {variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
            <span className="ml-2 text-xs text-[var(--muted)]">
              ※資料番号は立論ごとに振られます
            </span>
          </label>
        )}

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-[var(--muted)]">状態:</span>
          {(["all", "needed", "found", "verified"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded px-3 py-1 ${
                status === s
                  ? "bg-[var(--accent)] text-white"
                  : "border border-[var(--line)]"
              }`}
            >
              {s === "all" ? "全て" : STATUS_LABELS[s].label}（{counts[s]}）
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-[var(--muted)]">争点:</span>
          <button
            onClick={() => setCategoryId(null)}
            className={`rounded px-3 py-1 ${
              !categoryId ? "bg-[var(--accent)] text-white" : "border border-[var(--line)]"
            }`}
          >
            全て
          </button>
          {Object.entries(categoryNames).map(([id, name]) => (
            <button
              key={id}
              onClick={() => setCategoryId(id)}
              className={`rounded px-3 py-1 ${
                categoryId === id
                  ? "bg-[var(--accent)] text-white"
                  : "border border-[var(--line)]"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="rounded border border-dashed border-[var(--line)] p-8 text-center text-[var(--muted)]">
          該当する資料はありません。
        </p>
      ) : (
        <ul className="space-y-4">
          {visible.map((item) => (
            <SourceCard
              key={item.refId}
              item={item}
              projectId={projectId}
              variantId={currentVariantId}
              categoryNames={categoryNames}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SourceCard({
  item,
  projectId,
  variantId,
  categoryNames,
}: {
  item: SourceItem;
  projectId: string;
  variantId: string;
  categoryNames: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [saveState, saveAction, saving] = useActionState<ActionState, FormData>(
    saveMaterial,
    {},
  );
  const [verifyState, verifyAction, verifying] = useActionState<
    ActionState,
    FormData
  >(verifyMaterial, {});
  const [modified, setModified] = useState(item.isModified);
  const online = useOnline();

  // 保存できたら登録フォームを閉じる
  useEffect(() => {
    if (saveState.ok) setOpen(false);
  }, [saveState.ok]);

  const st = STATUS_LABELS[item.status];
  const error = saveState.error ?? verifyState.error;

  return (
    <li
      id={`ref-${item.number}`}
      className="rounded border border-[var(--line)] p-4 target:border-[var(--accent)]"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <b className="text-lg">資料{item.number}</b>
        <span className="rounded bg-[var(--line)]/60 px-2 py-0.5 text-xs">
          {TYPE_LABELS[item.sourceType] ?? item.sourceType}
        </span>
        {item.categoryIds.map((id) => (
          <span key={id} className="rounded bg-[var(--line)]/60 px-2 py-0.5 text-xs">
            {categoryNames[id] ?? "?"}
          </span>
        ))}
        <span
          className="ml-auto rounded border px-2 py-0.5 text-xs"
          style={{ color: st.color, borderColor: st.color }}
        >
          {st.label}
        </span>
      </div>

      <p className="mb-2">
        <span className="font-bold">証明すること: </span>
        {item.provesWhat}
      </p>

      {item.description && (
        <p className="mb-2 text-sm text-[var(--muted)]">{item.description}</p>
      )}

      {item.searchKeywords.length > 0 && (
        <p className="mb-2 text-sm">
          <span className="text-[var(--muted)]">探し方: </span>
          {item.searchKeywords.map((k) => `「${k}」`).join(" ")}
        </p>
      )}

      {item.suggestedSources.length > 0 && (
        <p className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-[var(--muted)]">情報源:</span>
          {item.suggestedSources.map((s) =>
            s.url ? (
              <a
                key={s.id}
                href={s.url}
                target="_blank"
                rel="noreferrer noopener"
                title={s.hint}
                // 読み上げ名に情報源の名前そのものを含める。title だけだと
                // 画面に見えている名前と読み上げが食い違う
                aria-label={`${s.label}${s.searchable ? "（検索語を入れて別タブで開く）" : "（別タブで開く）"}${s.hint}`}
                className="rounded border border-[var(--accent)] px-2 py-0.5 text-[var(--accent)]"
              >
                {s.label}{s.searchable ? " で検索" : ""} ↗
              </a>
            ) : (
              <span key={s.id} title={s.hint} className="rounded border border-[var(--line)] px-2 py-0.5">
                {s.label}
              </span>
            ),
          )}
        </p>
      )}

      {item.formatHint === "self_made" && (
        <p className="mb-2 rounded bg-[var(--line)]/30 p-2 text-sm">
          これは<b>自分たちで作る資料</b>です（税額シミュレーション表など）。
          計算の根拠を資料内に必ず書いてください。
        </p>
      )}

      {item.usedIn.length > 0 && (
        <p className="mb-2 text-sm">
          <span className="text-[var(--muted)]">使用箇所: </span>
          <a
            href={`/projects/${projectId}/case`}
            className="text-[var(--accent)] underline underline-offset-2"
          >
            {item.usedIn.map((u) => u.title).join("、")}
          </a>
        </p>
      )}

      {item.citation && (
        <div className="mt-3 rounded bg-[var(--line)]/30 p-3 text-sm">
          <p>
            <span className="text-[var(--muted)]">出典: </span>
            {item.citation}
          </p>
          {item.quote && (
            <p className="mt-2 leading-7">
              「{item.quote}」
              {item.modificationNote && (
                <span className="text-[var(--muted)]">{item.modificationNote}</span>
              )}
            </p>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--neg)]">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button
          onClick={() => setOpen(!open)}
          disabled={!online}
          title={online ? undefined : "オフラインでは登録できません"}
          className="rounded border border-[var(--line)] px-3 py-1 text-sm disabled:opacity-40"
        >
          {open ? "閉じる" : item.citation ? "出典を編集" : "出典・引用文を登録する"}
        </button>
        {item.citation && (
          <form action={verifyAction}>
            <input type="hidden" name="materialId" value={item.materialId} />
            <button
              type="submit"
              disabled={verifying}
              className="rounded border border-[var(--line)] px-3 py-1 text-sm disabled:opacity-60"
            >
              {item.status === "verified" ? "確認済を取り消す" : "実物を確認した"}
            </button>
          </form>
        )}
      </div>

      {open && (
        <form
          action={saveAction}
          className="mt-3 rounded border-2 border-[var(--accent)] p-3"
        >
          <input type="hidden" name="materialId" value={item.materialId} />
          <input type="hidden" name="variantId" value={variantId} />

          <label className="mb-3 block">
            <span className="mb-1 block text-sm font-bold">証明すること</span>
            <input
              name="provesWhat"
              defaultValue={item.provesWhat}
              className="w-full rounded border border-[var(--line)] p-2"
            />
          </label>

          <label className="mb-3 block">
            <span className="mb-1 block text-sm font-bold">
              出典{" "}
              <Term note="書籍: 著者『書名〔版〕』（出版社・年）頁数 ／ 機関文書: 機関名「文書名〔版〕」（年）頁数 ／ 議事録: 「第N回国会 院 委員会 第N号 年月日」">
                書き方
              </Term>
            </span>
            <input
              name="citation"
              defaultValue={item.citation ?? ""}
              placeholder="例: 金子宏『租税法〔第24版〕』（弘文堂・2021年）88頁"
              className="w-full rounded border border-[var(--line)] p-2"
            />
          </label>

          <label className="mb-3 block">
            <span className="mb-1 block text-sm font-bold">引用文</span>
            <textarea
              name="quote"
              rows={4}
              defaultValue={item.quote ?? ""}
              placeholder="資料から引用する部分をそのまま貼り付けてください"
              className="w-full rounded border border-[var(--line)] p-2"
            />
            <span className="mt-1 block text-xs text-[var(--muted)]">
              引用文を入れる場合は出典が必須です。
            </span>
          </label>

          <label className="mb-2 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="isModified"
              checked={modified}
              onChange={(e) => setModified(e.target.checked)}
              className="mt-1"
            />
            <span>下線・傍点などを加えた</span>
          </label>

          {modified && (
            <label className="mb-3 block">
              <span className="mb-1 block text-sm font-bold">加工の注記（必須）</span>
              <input
                name="modificationNote"
                defaultValue={
                  item.modificationNote ?? "［下線はディベーターによる。］"
                }
                className="w-full rounded border border-[var(--line)] p-2"
              />
            </label>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
            >
              {saving ? "保存中…" : "保存する"}
            </button>
          </div>
        </form>
      )}
    </li>
  );
}
