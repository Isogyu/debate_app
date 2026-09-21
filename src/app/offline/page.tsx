/**
 * オフラインで、まだ端末に残っていない画面を開いたときの案内。
 * 「真っ白」や「接続できません」で終わらせない。
 */

export const metadata = { title: "オフライン | ディベート支援" };

export default function OfflinePage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10 text-center">
      <h1 className="mb-3 text-xl font-bold">この画面はまだ読み込まれていません</h1>
      <p className="mb-5 text-[var(--muted)]">
        オフラインで開けるのは、電波のあるときに一度開いた画面だけです。
      </p>
      <div className="rounded border border-[var(--line)] p-4 text-left text-sm">
        <p className="mb-2 font-bold">練習前にやっておくこと</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Wi-Fiのある場所でアプリを開く</li>
          <li>
            使う論題の「立論」「資料要件」「ブロック集」「質疑フロー」を一度ずつ開く
          </li>
          <li>「本番モード」も開いておく</li>
        </ol>
        <p className="mt-3 text-[var(--muted)]">
          これで、電波がなくてもその内容を見られます。
        </p>
      </div>
    </main>
  );
}
