/**
 * AI の呼び出しの診断。生成のステップが「AIへの依頼内容に問題がありました」で落ちるときに使う。
 *
 *   fly ssh console -C "npm run diagnose:llm"
 *
 * 1. 立論用のモデル（DEBATE_MODEL）に短い依頼を送る
 * 2. 軽い処理用のモデル（DEBATE_MODEL_LIGHT）に短い依頼を送る
 * 3. Web 検索（資料の取得で使う）を1回だけ試す
 * 4. 本番DBにある最新の生成立論で、質疑の依頼を1段落ぶんだけ実際に送る（保存はしない）
 *
 * API が返したエラーの説明文（英語）をそのまま表示する。本番のデータは書き換えない。
 */

async function step(label: string, fn: () => Promise<string>) {
  const started = Date.now();
  try {
    const out = await fn();
    console.log(`✓ ${label}（${Math.round((Date.now() - started) / 1000)}秒）${out ? ` — ${out}` : ""}`);
  } catch (err) {
    const e = err as { status?: number; message?: string; error?: unknown };
    console.log(`✗ ${label}`);
    if (e.status) console.log(`  HTTP ${e.status}`);
    console.log(`  ${e.message ?? String(err)}`);
    if (e.error) console.log(`  詳細: ${JSON.stringify(e.error).slice(0, 600)}`);
  }
}

async function main() {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const { DEFAULT_MODEL, LIGHT_MODEL, getLlmProvider } = await import("../src/lib/llm/anthropic");
  const key = process.env.ANTHROPIC_API_KEY;
  console.log(`APIキー: ${key ? `設定あり（${key.slice(0, 7)}…）` : "未設定"}`);
  console.log(`立論用モデル: ${DEFAULT_MODEL} / 軽い処理用モデル: ${LIGHT_MODEL}`);
  console.log(`e-Stat: ${process.env.ESTAT_APP_ID ? "設定あり" : "未設定"}\n`);
  if (!key) return;

  // SDK を直接呼び、API の生のエラーを見る
  const client = new Anthropic({ apiKey: key });
  for (const model of [DEFAULT_MODEL, LIGHT_MODEL]) {
    await step(`短い依頼（${model}）`, async () => {
      const r = await client.messages.create({
        model,
        max_tokens: 50,
        messages: [{ role: "user", content: "「はい」とだけ答えてください。" }],
      });
      const text = r.content.find((b) => b.type === "text");
      return text && text.type === "text" ? text.text.trim() : "";
    });
  }

  await step(`出力上限 16000 の依頼（${DEFAULT_MODEL}）`, async () => {
    const r = await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 16000,
      messages: [{ role: "user", content: "「はい」とだけ答えてください。" }],
    });
    return r.stop_reason ?? "";
  });

  await step(`Web検索（${LIGHT_MODEL}・go.jp に限定）`, async () => {
    const r = await getLlmProvider().searchWeb({
      query: "国税庁 所得税法56条",
      allowedDomains: ["go.jp"],
      maxUses: 1,
    });
    return `${r.data.length}件（${r.data.slice(0, 2).map((h) => h.url).join(", ")}）`;
  });

  // 本番DBの最新の生成立論で、質疑の依頼を1段落ぶんだけ送る
  await step("質疑の依頼（本番の最新の立論・1段落・保存しない）", async () => {
    const { desc, eq } = await import("drizzle-orm");
    const { db } = await import("../src/db");
    const { caseVariants, projects } = await import("../src/db/schema");
    const { paragraphsOf, loadCategories } = await import("../src/lib/jobs/common");
    const PQ = await import("../src/lib/llm/prompts-questions");
    const { SYSTEM_BASE } = await import("../src/lib/llm/prompts");
    const { crossExamChainsSchema } = await import("../src/domain/schemas");
    const [v] = await db
      .select()
      .from(caseVariants)
      .where(eq(caseVariants.origin, "generated"))
      .orderBy(desc(caseVariants.createdAt))
      .limit(1);
    if (!v) return "生成立論がないため省略";
    const [project] = await db.select().from(projects).where(eq(projects.id, v.projectId));
    const p = paragraphsOf(v)[0];
    if (!p) return "段落がないため省略";
    const categories = (await loadCategories(v.projectId)).map((c) => c.name);
    const prompt = PQ.crossExamParagraphPrompt({
      resolution: project?.resolution ?? "",
      caseText: v.debateCase.fullText,
      paragraphLabel: p.label,
      paragraphText: p.text,
      attackPoints: ["premise"],
      numberIssues: [],
      categories,
      existingQuestions: [],
      count: "1〜2問",
    });
    console.log(`  （プロンプト ${prompt.length}字・本文 ${v.debateCase.fullText.length}字）`);
    const r = await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 12000,
      system: `${SYSTEM_BASE}\n\n出力は説明文を付けず、JSONオブジェクトのみを返してください。`,
      messages: [{ role: "user", content: prompt }],
    });
    const text = r.content.find((b) => b.type === "text");
    const raw = text && text.type === "text" ? text.text : "";
    const json = raw.match(/\{[\s\S]*\}/)?.[0] ?? "";
    let parsed = "形式: 読み取れず";
    try {
      parsed = crossExamChainsSchema.safeParse(JSON.parse(json)).success ? "形式: OK" : "形式: 想定と違う";
    } catch {
      /* 読み取れず */
    }
    return `${r.stop_reason} / ${parsed}`;
  });
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
