import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Roam",
  description: "Voice-first US travel concierge — multi-agent demo",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      {/* Grammarly can add body attributes before React hydrates. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
