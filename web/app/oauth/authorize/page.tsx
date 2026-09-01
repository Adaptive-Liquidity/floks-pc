import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthorizeCard } from "@/components/AuthorizeCard";

export const metadata: Metadata = {
  title: "Allow FLOKS",
  robots: { index: false, follow: false },
};

export default function AuthorizePage() {
  return (
    <Suspense
      fallback={
        <section className="flash">
          <p>Allow FLOKS</p>
        </section>
      }
    >
      <AuthorizeCard />
    </Suspense>
  );
}
