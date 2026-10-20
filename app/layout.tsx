import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Paperstreet — Live Market Paper Trading",
  description: "Practice Indian equities, futures and options with broker market data and virtual funds.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
