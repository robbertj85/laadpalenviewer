import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const UMAMI_SRC = process.env.NEXT_PUBLIC_UMAMI_SRC;
const UMAMI_WEBSITE_ID = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Laadpalenviewer - Laadpunten voor personenauto's en logistiek in Nederland",
  description:
    "Interactieve kaart van laadpunten in Nederland: personenauto-laadpunten (NDW OCPI) en logistieke/vracht-laadpunten (Milence, WattHub, megawatt charging) per gemeente, met gemeente- en provinciegrenzen van PDOK/CBS.",
  openGraph: {
    title: "Laadpalenviewer",
    description:
      "Laadpunten voor personenauto's en logistiek/vracht in Nederland op een interactieve kaart per gemeente.",
    type: "website",
    locale: "nl_NL",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="nl">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
        {/* Self-hosted analytics (Umami) when configured */}
        {UMAMI_SRC && UMAMI_WEBSITE_ID && (
          <Script src={UMAMI_SRC} data-website-id={UMAMI_WEBSITE_ID} strategy="afterInteractive" />
        )}
      </body>
    </html>
  );
}
