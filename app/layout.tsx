import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Conversa Gemma4 — Enterprise Meeting Intelligence",
  description: "Transform meetings with AI. Powered by Gemma 4 via Google AI Studio.",
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
