import type { Metadata } from "next";
import { Geist_Mono, Wix_Madefor_Display, Wix_Madefor_Text } from "next/font/google";
import { AppProviders } from "@/components/providers/app-providers";
import { AppShell } from "@/components/shell/app-shell";
import "./globals.css";

const wixDisplay = Wix_Madefor_Display({
  variable: "--font-wix-display",
  subsets: ["latin"],
  weight: ["500", "600"],
  display: "swap",
});

const wixText = Wix_Madefor_Text({
  variable: "--font-wix-text",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "MediaHub — Personal Media Workspace",
  description:
    "Single-owner, provider-neutral media operations workspace for video hosts, collections, jobs, and workflows.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${wixDisplay.variable} ${wixText.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body suppressHydrationWarning className="min-h-full">
        <AppProviders>
          <AppShell>{children}</AppShell>
        </AppProviders>
      </body>
    </html>
  );
}
