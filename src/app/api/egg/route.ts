/**
 * 取説のどこかにある入口から始まる、ちょっとした謎解きの窓口。
 *
 * ヒントの文面・名乗るべき名前・注文の品・合言葉は、すべてサーバーの秘密の設定
 * （環境変数 EGG_CONFIG。JSON を base64 にしたもの）にだけ置いている。
 * ソースを読んでも答えは書いていないので、実際に手を動かして聞き出してください。
 * 設定がない環境では、この窓口は存在しないふりをする。
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

interface EggConfig {
  role: string;
  brew: string[];
  passphrase: string;
  hint1: string;
  hint2: string;
  hint3: string;
}

const COOKIE = "egg_role";

function loadConfig(): EggConfig | null {
  const raw = process.env.EGG_CONFIG;
  if (!raw) return null;
  try {
    const cfg = JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as EggConfig;
    if (!cfg.role || !cfg.passphrase || !Array.isArray(cfg.brew)) return null;
    return cfg;
  } catch {
    return null;
  }
}

function json(body: unknown, status: number): NextResponse {
  const res = NextResponse.json(body, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function notFound(): NextResponse {
  return json({ status: 404, message: "Not Found" }, 404);
}

function forbidden(cfg: EggConfig, setGuest: boolean): NextResponse {
  const res = json(
    {
      status: 403,
      message: "Forbidden. guest に用はありません。",
      hint: "答えは、本文ではなく頭（ヘッダー）に書いてあります。",
    },
    403,
  );
  res.headers.set("X-Hint", encodeURIComponent(cfg.hint1));
  if (setGuest) {
    res.cookies.set(COOKIE, "guest", {
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      httpOnly: false, // 自己申告制なので、ブラウザから書き換えられる必要がある
    });
  }
  return res;
}

export async function GET(request: NextRequest) {
  const cfg = loadConfig();
  if (!cfg) return notFound();
  const role = request.cookies.get(COOKIE)?.value;
  if (role !== cfg.role) return forbidden(cfg, !role);
  return json({ status: 200, message: `ようこそ、${cfg.role}。`, next: cfg.hint2 }, 200);
}

export async function POST(request: NextRequest) {
  const cfg = loadConfig();
  if (!cfg) return notFound();
  if (request.cookies.get(COOKIE)?.value !== cfg.role) return forbidden(cfg, false);

  let brew = "";
  try {
    const body = JSON.parse(await request.text()) as { brew?: unknown };
    brew = typeof body.brew === "string" ? body.brew.trim().toLowerCase() : "";
  } catch {
    return json({ status: 400, message: "注文は JSON でお願いします。" }, 400);
  }
  if (!brew) {
    return json({ status: 400, message: "何を淹れればよいですか？（brew が空です）" }, 400);
  }
  if (/coffee|コーヒー|珈琲|espresso|latte/.test(brew)) {
    return json(
      {
        status: 418,
        message: "I'm a teapot. コーヒーは淹れられないと、最初に申し上げたはずです。",
      },
      418,
    );
  }
  if (!cfg.brew.map((b) => b.toLowerCase()).includes(brew)) {
    return json({ status: 400, message: "そのメニューは、当ティーポットにはございません。" }, 400);
  }
  return json(
    {
      status: 200,
      message: "お待たせしました。",
      secret: Buffer.from(cfg.passphrase, "utf8").toString("base64"),
      next: cfg.hint3,
    },
    200,
  );
}
