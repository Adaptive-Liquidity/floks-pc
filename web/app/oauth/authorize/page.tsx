import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthorizeCard } from "@/components/AuthorizeCard";
import { OAUTH_LOADING } from "@/lib/copy";

export const metadata: Metadata = {
  title: "Allow FLOKS",
  robots: { index: false, follow: false },
};

export default function AuthorizePage() {
  return (
    <Suspense
      fallback={
        <section className="flash">
          <p>{OAUTH_LOADING}</p>
        </section>
      }
    >
      <AuthorizeCard />
    </Suspense>
  );
}
