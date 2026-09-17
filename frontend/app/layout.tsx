import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = "https://eib-knowledge-graph.vercel.app";
const DESCRIPTION =
  "Interactive knowledge graph of financial news: LLM-extracted relationships " +
  "between companies, sectors and instruments across 15 years of market news, " +
  "with graph-neural-network link predictions, a news factor model, and live " +
  "STOXX Europe 600 and S&P 100 corpora. Built at Columbia University (IEOR " +
  "4737) for the European Investment Bank.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "EIB Knowledge Graph — financial news as a graph",
    template: "%s · EIB Knowledge Graph",
  },
  description: DESCRIPTION,
  keywords: [
    "financial knowledge graph",
    "financial news analysis",
    "LLM triplet extraction",
    "graph neural network",
    "GAT link prediction",
    "GraphSAGE",
    "news factor model",
    "STOXX Europe 600",
    "S&P 100",
    "FNSPID",
    "European Investment Bank",
    "Columbia University IEOR",
  ],
  authors: [
    { name: "Alexandra Paiz" },
    { name: "Pierre Pujol" },
    { name: "Ruiwen Wang" },
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "EIB Knowledge Graph",
    title: "EIB Knowledge Graph — financial news as a graph",
    description: DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "EIB Knowledge Graph — financial news as a graph",
    description: DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
};

// Structured data: describes the app and its dataset lineage to search
// engines. Rendered once in the root layout.
const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "EIB Knowledge Graph",
  url: SITE_URL,
  description: DESCRIPTION,
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  creator: {
    "@type": "Organization",
    name: "Columbia University IEOR 4737 — EIB sponsor project",
  },
  about: {
    "@type": "Dataset",
    name: "FNSPID financial news knowledge graph (2009–2024)",
    description:
      "54,563 financial news articles processed by a three-LLM extraction, " +
      "judging and refinement chain into monthly knowledge-graph snapshots " +
      "with rolling-window GAT link predictions.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans bg-background text-foreground">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
