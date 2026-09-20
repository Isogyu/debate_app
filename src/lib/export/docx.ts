/**
 * Word出力（REQUIREMENTS.md §12 / §2.1・§2.3 の実フォーマット準拠）
 *
 * 実物の立論・参考資料をそのまま再現する:
 *  - 見出しは Ⅰ. 主張 / Ⅱ. 理由 / Ⅲ. 結論
 *  - 理由は「1. 見出し」→「（1）小見出し」の二段
 *  - 本文の字下げは全角スペース1つ（実物に合わせる）
 *  - 参考資料は Ⅰ.関連法令（条文全文）→ Ⅱ.資料（番号・命題・引用文・出典）
 */

import "server-only";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import type { ExportData } from "./data";
import { EMPTY_CITATION, SIDE_LABELS, verificationNotice } from "./data";

/** 日本語の本文。ゼミ生のWordに確実にある書体を選ぶ */
const FONT = "游明朝";
const BODY_SIZE = 21; // half-point = 10.5pt

function body(text: string, indent = 1): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        // 実物は全角スペースで字下げしている。Wordのインデント機能ではなく
        // 文字として入れることで、コピー&ペーストしても崩れない
        text: "　".repeat(indent) + text,
        font: FONT,
        size: BODY_SIZE,
      }),
    ],
    spacing: { after: 120 },
  });
}

function heading(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, font: FONT, size: BODY_SIZE, bold: true })],
    spacing: { before: 240, after: 120 },
    heading: HeadingLevel.HEADING_2,
  });
}

function blank(): Paragraph {
  return new Paragraph({ children: [] });
}

/** 表紙相当のヘッダー。実物は「チーム名　側立論」＋メンバー名の2行 */
function titleBlock(data: ExportData, kind: "立論" | "参考資料"): Paragraph[] {
  const team = data.teamName || "（チーム名未設定）";
  return [
    new Paragraph({
      children: [
        new TextRun({
          text: `${team}　${SIDE_LABELS[data.side]}側${kind}`,
          font: FONT,
          size: 24,
          bold: true,
        }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: data.members.join("　"),
          font: FONT,
          size: BODY_SIZE,
        }),
      ],
      spacing: { after: 240 },
    }),
  ];
}

/** AI生成であることの注記。文末に小さく、しかし必ず入れる */
function noticeBlock(data: ExportData): Paragraph[] {
  return [
    blank(),
    new Paragraph({
      children: [
        new TextRun({
          text: verificationNotice(data.allVerified),
          font: FONT,
          size: 18,
          italics: true,
        }),
      ],
      alignment: AlignmentType.RIGHT,
    }),
  ];
}

/** 立論（§2.1） */
export async function buildCaseDocx(data: ExportData): Promise<Buffer> {
  const c = data.debateCase;
  const children: Paragraph[] = [...titleBlock(data, "立論")];

  children.push(heading("Ⅰ. 主張"), body(c.claim));
  children.push(heading("Ⅱ. 理由"));

  c.sections.forEach((section, i) => {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `${i + 1}. ${section.title}`,
            font: FONT,
            size: BODY_SIZE,
            bold: true,
          }),
        ],
        spacing: { before: 200, after: 100 },
      }),
    );

    section.subsections.forEach((sub, j) => {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `　（${j + 1}）${sub.title}`,
              font: FONT,
              size: BODY_SIZE,
              bold: true,
            }),
          ],
          spacing: { before: 120, after: 80 },
        }),
      );
      // 本文中の【資料N参照】はそのまま残す。実物でも本文に書かれている
      children.push(body(sub.claim, 2));
      if (sub.warrant) children.push(body(sub.warrant, 2));
      if (sub.impact) children.push(body(sub.impact, 2));
    });
  });

  children.push(heading("Ⅲ. 結論"), body(c.conclusion));
  children.push(...noticeBlock(data));

  return Packer.toBuffer(
    new Document({ sections: [{ children }] }),
  ) as Promise<Buffer>;
}

/** 参考資料（§2.3） */
export async function buildSourcesDocx(data: ExportData): Promise<Buffer> {
  const children: Paragraph[] = [...titleBlock(data, "参考資料")];

  children.push(heading("Ⅰ. 関連法令"));
  if (data.relatedLaws.length === 0) {
    children.push(body("（関連法令が登録されていません）"));
  } else {
    // 同じ法令の条文をまとめる。実物も「1. 日本国憲法」の下に各条が並ぶ
    const byName = new Map<string, typeof data.relatedLaws>();
    for (const law of data.relatedLaws) {
      byName.set(law.name, [...(byName.get(law.name) ?? []), law]);
    }
    let n = 1;
    for (const [name, laws] of byName) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `${n++}. ${name}`,
              font: FONT,
              size: BODY_SIZE,
              bold: true,
            }),
          ],
          spacing: { before: 160, after: 80 },
        }),
      );
      for (const law of laws) {
        children.push(
          body(
            law.fullText
              ? `${law.article}　${law.fullText}`
              : // 条文はAIに書かせていない。未取得なら空欄であることを隠さない
                `${law.article}　（条文未登録：e-Gov法令検索から本文を貼り付けてください）`,
          ),
        );
      }
    }
  }

  children.push(heading("Ⅱ. 資料"));
  if (data.sources.length === 0) {
    children.push(body("（資料が登録されていません）"));
  }

  for (const s of data.sources) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `${s.number}. ${s.provesWhat}`,
            font: FONT,
            size: BODY_SIZE,
            bold: true,
          }),
        ],
        spacing: { before: 160, after: 80 },
      }),
    );

    if (s.quote) {
      // 実物の書式: 「引用文」［下線はディベーターによる。］
      children.push(
        body(`「${s.quote}」${s.modificationNote ?? ""}`, 1),
      );
    }
    // 未登録は空欄で出す（§12）。埋め忘れが紙の上で見えるようにする
    children.push(body(s.citation ?? EMPTY_CITATION, 1));
  }

  children.push(...noticeBlock(data));

  return Packer.toBuffer(
    new Document({ sections: [{ children }] }),
  ) as Promise<Buffer>;
}

/** ファイル名。Wordで開いたときに何か分かるようにする */
export function exportFileName(data: ExportData, kind: string): string {
  const team = data.teamName || "ディベート";
  return `${team}_${SIDE_LABELS[data.side]}側${kind}.docx`;
}
