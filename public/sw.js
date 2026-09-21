/**
 * Service Worker（REQUIREMENTS.md §12 本番パック）
 *
 * 大学Wi-Fi・テザリング・電波なし、のどれでも練習できるようにするための要。
 * 一度オンラインで開いた内容を端末に残し、以後オフラインでも起動させる。
 *
 * オフラインで使える範囲は「閲覧＋質疑練習」。
 * 生成と編集はサーバーとClaude APIが要るので、オンライン時のみ。
 *
 * 【最優先の原則】Service Workerがページを壊してはいけない。
 * ここで respondWith に失敗した Promise を渡すと、サーバーが正常に
 * 200を返していてもブラウザ側は ERR_FAILED になる。実際にこれで
 * CSSが読めず、画面が崩れた。しかもゼミ生には直せない（サイトデータの
 * 削除が要る）。したがって、迷ったら必ず素通しさせる。
 */

const VERSION = "v1";
const SHELL = `shell-${VERSION}`;
const PAGES = `pages-${VERSION}`;

/** オフラインでも開けるようにするページ（閲覧系のみ） */
const OFFLINE_PATTERNS = [
  /^\/$/,
  /^\/projects\/[^/]+$/,
  /^\/projects\/[^/]+\/(case|sources|blocks|crossexam|rebuttal)$/,
  /^\/live\/[^/]+$/,
];

/** 保存してはいけないもの。生成・ログイン・ダウンロードは常に実サーバーへ */
const NEVER_CACHE = [
  /^\/api\//,
  /^\/login$/,
  /\/export\//,
  // 質疑練習はAIとのやり取りが要るので、保存しても使えない
  /\/simulator/,
];

function isOfflinePage(pathname) {
  return (
    OFFLINE_PATTERNS.some((re) => re.test(pathname)) &&
    !NEVER_CACHE.some((re) => re.test(pathname))
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(["/offline", "/manifest.webmanifest"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.endsWith(VERSION))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function serveNavigation(request, url) {
  try {
    const response = await fetch(request);
    if (response.ok && isOfflinePage(url.pathname)) {
      const copy = response.clone();
      caches
        .open(PAGES)
        .then((c) => c.put(request, copy))
        .catch(() => {});
    }
    return response;
  } catch {
    // つながらないときだけ、保存したページを出す
    const cached = await caches.match(request).catch(() => undefined);
    if (cached) return cached;
    const offline = await caches.match("/offline").catch(() => undefined);
    return (
      offline ??
      new Response("オフラインです。電波のある場所で開き直してください。", {
        status: 504,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })
    );
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER_CACHE.some((re) => re.test(url.pathname))) return;

  // ページ本体: つながるときは最新を取り、駄目なら保存したものを出す。
  // 準備中に内容が変わるので、オンライン時に古い内容を見せたくない
  if (request.mode === "navigate") {
    event.respondWith(serveNavigation(request, url));
    return;
  }

  // JS・CSS・画像: 一度取れたら使い回す。これがないとオフラインで画面が壊れる。
  // ただし、何があっても素通しに戻れるようにする
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/")
  ) {
    event.respondWith(serveStatic(request));
  }
});

async function serveStatic(request) {
  // 保存済みがあればそれを返す（オフラインでも画面が保つ）
  try {
    const cached = await caches.match(request);
    if (cached) return cached;
  } catch {
    // キャッシュが読めなくても、通信で取れれば問題ない
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      // 保存に失敗しても表示には影響させない
      caches
        .open(SHELL)
        .then((c) => c.put(request, copy))
        .catch(() => {});
    }
    return response;
  } catch (err) {
    // ここで例外を投げると、サーバーが正常でもブラウザには
    // ERR_FAILED として見える。最後にもう一度だけ素通しを試す
    try {
      return await fetch(request);
    } catch {
      // それでも駄目なら、オフラインで未保存のファイル。
      // 504を返して「通信できなかった」ことを正しく伝える
      return new Response("", { status: 504, statusText: "offline" });
    }
  }
}
