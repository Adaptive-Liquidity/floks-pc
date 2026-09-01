import type { Metadata } from "next";
import { Suspense } from "react";
import { SetupClient } from "@/components/SetupClient";

export const metadata: Metadata = {
  title: "Setup",
  robots: { index: false, follow: false },
};

export default function SetupPage() {
  return (
    <Suspense
      fallback={
        <section className="flash">
          <p>Setup</p>
        </section>
      }
    >
      <SetupClient />
    </Suspense>
  );
}
