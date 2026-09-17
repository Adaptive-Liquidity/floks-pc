import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/join", "/product", "/how", "/now", "/faq", "/legal"],
      disallow: ["/setup", "/callback", "/login", "/logout", "/oauth", "/api"],
    },
  };
}
