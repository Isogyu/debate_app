import type { Metadata, Viewport } from "next";
import "./globals.css";
import { OfflineBanner, ServiceWorkerRegistrar } from "@/components/pwa";

export const metadata: Metadata = {
  title: "ディベート支援",
  description: "政策ディベートの準備から模擬戦までを支援します",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "ディベート",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-180.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#1d4ed8",
  // スマホで表を見るときに拡大できないと困るので、拡大は禁止しない
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <OfflineBanner />
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
