import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ネイティブモジュール・Node専用のライブラリはバンドルに入れず、実行時に読み込む
  serverExternalPackages: [
    "better-sqlite3",
    "@resvg/resvg-js",
    "unpdf",
    "mammoth",
    "linkedom",
  ],
  experimental: {
    serverActions: {
      // 立論と資料のファイル（.docx / PDF）を2つまとめて送る。1ファイル15MBまで
      bodySizeLimit: "32mb",
    },
    // proxy（ログイン確認）を通るリクエストの上限。アップロードが途中で切れないようにする
    proxyClientMaxBodySize: "32mb",
  },
};

export default nextConfig;
