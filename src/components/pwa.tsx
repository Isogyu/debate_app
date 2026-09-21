"use client";

/**
 * オフライン対応の土台（REQUIREMENTS.md §12）
 *
 * 大学Wi-Fi・テザリング・電波なしのどれでも練習できるようにする。
 * 一度オンラインで開けば、以後は端末に残った内容で起動する。
 */

import { useEffect, useState } from "react";

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      // 登録できなくてもオンラインでは普通に使えるので、画面は壊さない
      console.warn("オフライン対応を有効にできませんでした:", err);
    });
  }, []);
  return null;
}

/** サーバーに届くかを実際に確かめる間隔 */
const REACHABILITY_INTERVAL_MS = 20000;

/**
 * サーバーに届くかどうか。編集系のボタンを止めるのに使う。
 *
 * navigator.onLine だけでは足りない。大学Wi-Fiのように
 * 「端末は繋がっているがサーバーへ届かない」状況がこの運用では一番多く、
 * そのとき編集ボタンが押せてしまうと、黙って保存に失敗する。
 */
export function useOnline(): boolean {
  // サーバー描画時とハイドレート直後はオンライン扱いにする。
  // 実際はオンラインなのに一瞬「オフライン」と出るのを避けるため
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let alive = true;

    const check = async () => {
      if (!navigator.onLine) {
        if (alive) setOnline(false);
        return;
      }
      try {
        await fetch("/api/health", {
          method: "GET",
          cache: "no-store",
          signal: AbortSignal.timeout(4000),
        });
        if (alive) setOnline(true);
      } catch {
        // 届かない＝編集はできない。回線の有無に関わらずオフライン扱いにする
        if (alive) setOnline(false);
      }
    };

    check();
    const timer = setInterval(check, REACHABILITY_INTERVAL_MS);
    window.addEventListener("online", check);
    window.addEventListener("offline", check);

    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("online", check);
      window.removeEventListener("offline", check);
    };
  }, []);

  return online;
}

/**
 * オフライン中であることを常時知らせる。
 * 黙って編集が失敗するのが一番たちが悪いので、先に理由を見せる。
 */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-50 bg-[var(--neg)] px-4 py-2 text-center text-sm text-white"
    >
      サーバーに接続できません。<b>閲覧と質疑練習だけ</b>使えます（編集・生成は電波のある場所で）。
    </div>
  );
}
