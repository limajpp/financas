import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";

import { ServiceWorker } from "@/components/pwa/service-worker";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Finanças",
  description: "Registre cada gasto na hora e entenda o seu mês.",
  applicationName: "Finanças",
  // Opened from the iPhone's home screen: full screen, without Safari's bars. The "default" status
  // bar sits above the page, so the content never goes under the clock.
  appleWebApp: { capable: true, title: "Finanças", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // The browser's and the installed app's bars follow the theme (task 26): the background of each.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${geistSans.variable} h-full antialiased`}>
      {/* viewport-fit=cover: the page reaches under the notch, so it pads itself back in. */}
      <body className="flex min-h-full flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
        <ServiceWorker>{children}</ServiceWorker>
      </body>
    </html>
  );
}
