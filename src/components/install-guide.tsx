"use client";

/**
 * 「ホーム画面に追加」の案内（④）
 *
 * オフライン運用の生命線なのに、手順書は管理者しか読まない。
 * ゼミ生が実際に目にする場所に出す必要がある。
 * 一度閉じたら出し続けない（毎回出ると邪魔になって無視される）。
 */

import { useEffect, useState } from "react";

const DISMISSED_KEY = "debate_install_guide_dismissed";

export function InstallGuide() {
  const [show, setShow] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    // すでにホーム画面から起動しているなら案内は不要
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOSのSafariは独自のフラグを持つ
      (window.navigator as { standalone?: boolean }).standalone === true;
    if (standalone) return;

    try {
      if (localStorage.getItem(DISMISSED_KEY)) return;
    } catch {
      // プライベートモードなどで読めないことがある。その場合は出す
    }

    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    setShow(true);
  }, []);

  if (!show) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // 保存できなくても閉じられれば困らない
    }
    setShow(false);
  };

  return (
    <section className="mb-5 rounded border-2 border-[var(--accent)] p-4">
      <h2 className="mb-2 font-bold">
        練習の前に「ホーム画面に追加」してください
      </h2>
      <p className="mb-3 text-sm">
        追加しておくと、<b>電波がない場所でも</b>立論・ブロック集・質疑練習を開けます。
        大学のWi-Fiが繋がらないときや、移動中でも使えます。
      </p>
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm">
        {ios ? (
          <>
            <li>画面下の共有ボタン（□に↑）を押す</li>
            <li>「ホーム画面に追加」を選ぶ</li>
          </>
        ) : (
          <>
            <li>ブラウザのメニュー（⋮）を開く</li>
            <li>「ホーム画面に追加」または「アプリをインストール」を選ぶ</li>
          </>
        )}
        <li>
          追加したら、使う論題の<b>立論・資料要件・ブロック集・質疑フロー・本番モード</b>
          を一度ずつ開いておく
        </li>
      </ol>
      <button
        onClick={dismiss}
        className="min-h-11 rounded border border-[var(--line)] px-4 text-sm"
      >
        追加した・あとでやる
      </button>
    </section>
  );
}
