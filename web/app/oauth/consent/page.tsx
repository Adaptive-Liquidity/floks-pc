import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthorizeCard } from "@/components/AuthorizeCard";
import { OAUTH_LOADING } from "@/lib/copy";

export const metadata: Metadata = {
  title: "Allow Staxions",
  robots: { index: false, follow: false },
};

export default function ConsentPage() {
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
