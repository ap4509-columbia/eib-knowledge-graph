import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // The static data tree is huge (thousands of JSON snapshots) and
      // meaningless as search results — keep crawlers on the page itself.
      disallow: ["/data/", "/api/"],
    },
    sitemap: "https://eib-knowledge-graph.vercel.app/sitemap.xml",
  };
}
