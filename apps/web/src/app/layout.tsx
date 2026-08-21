import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Concierge",
  description: "Voice-first US travel concierge — multi-agent demo",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
