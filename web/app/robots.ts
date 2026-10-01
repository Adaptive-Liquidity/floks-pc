import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  if (process.env.SITE_INDEXABLE !== "1") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/join", "/pricing", "/product", "/how", "/now", "/faq", "/legal"],
      disallow: ["/setup", "/callback", "/login", "/signup", "/logout", "/oauth", "/api"],
    },
  };
}
