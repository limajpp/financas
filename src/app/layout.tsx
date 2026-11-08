import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { ServiceWorker } from "@/components/pwa/service-worker";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Finanças",
  description: "Registre cada gasto na hora e entenda o seu mês.",
  applicationName: "Finanças",
  // Opened from the iPhone's home screen: full screen, the status bar over the app's background.
  appleWebApp: { capable: true, title: "Finanças", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      {/* viewport-fit=cover: the page reaches under the notch, so it pads itself back in. */}
      <body className="flex min-h-full flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
        <ServiceWorker>{children}</ServiceWorker>
      </body>
    </html>
  );
}
