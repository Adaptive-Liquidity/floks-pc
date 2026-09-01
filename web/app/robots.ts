import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/join", "/legal"],
      disallow: ["/setup", "/callback", "/oauth"],
    },
  };
}
