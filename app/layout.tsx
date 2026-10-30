import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  const description = "A private, transcript-backed workspace for flowing PF and LD rounds and drafting better ballots.";

  return {
    metadataBase: base,
    title: "JudgeFlow — Debate judging copilot",
    description,
    applicationName: "JudgeFlow",
    openGraph: {
      title: "JudgeFlow",
      description: "Hear the debate. See the decision.",
      type: "website",
      images: [{ url: new URL("/og.png", base).toString(), width: 1744, height: 908, alt: "JudgeFlow — Hear the debate. See the decision." }],
    },
    twitter: {
      card: "summary_large_image",
      title: "JudgeFlow",
      description: "Hear the debate. See the decision.",
      images: [new URL("/og.png", base).toString()],
    },
  };
}

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
