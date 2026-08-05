import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Training Power Trace Explorer",
    template: "%s · Training Power Trace Explorer",
  },
  description: "Collect, review, and explore LLM training GPU power traces.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
