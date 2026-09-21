/**
 * Service Worker（REQUIREMENTS.md §12 本番パック）
 *
 * 大学Wi-Fi・テザリング・電波なし、のどれでも練習できるようにするための要。
 * 一度オンラインで開いた内容を端末に残し、以後オフラインでも起動させる。
 *
 * オフラインで使える範囲は「閲覧＋質疑練習」。
 * 生成と編集はサーバーとClaude APIが要るので、オンライン時のみ。
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

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER_CACHE.some((re) => re.test(url.pathname))) return;

  // ページ本体: つながるときは最新を取り、駄目なら保存したものを出す。
  // 準備中に内容が変わるので、オンライン時に古い内容を見せたくない
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && isOfflinePage(url.pathname)) {
            const copy = response.clone();
            caches.open(PAGES).then((c) => c.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request, { ignoreSearch: false });
          return cached ?? caches.match("/offline");
        }),
    );
    return;
  }

  // JS・CSS・画像: 一度取れたら使い回す。これがないとオフラインで画面が壊れる
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/")
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(SHELL).then((c) => c.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
