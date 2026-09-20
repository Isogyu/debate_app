import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ディベート支援",
  description: "政策ディベートの準備から本番までを支援します",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
