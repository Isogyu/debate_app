/**
 * 到達確認用。中身は返さない。
 *
 * navigator.onLine は「端末が何かに繋がっているか」しか見ない。
 * 大学Wi-Fiのように、繋がっているのにサーバーへ届かない状況が
 * この運用では一番起きやすいので、実際に叩いて確かめる。
 */

export const dynamic = "force-dynamic";

export function GET() {
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}
