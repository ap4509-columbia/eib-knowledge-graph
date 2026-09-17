import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://eib-knowledge-graph.vercel.app",
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      url: "https://eib-knowledge-graph.vercel.app/report.pdf",
      lastModified: new Date("2026-09-06"),
      changeFrequency: "yearly",
      priority: 0.6,
    },
  ];
}
