import type { Metadata } from "next";
import { Suspense } from "react";
import { SetupDesk } from "@/components/SetupDesk";
import { SetupGate } from "@/components/SetupGate";
import { SetupSessionUpgrade } from "@/components/SetupSessionUpgrade";
import { gateFromSearch, previewSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Setup",
  description: "Open the magic link from your billing email. Typing an email is not enough.",
  robots: { index: false, follow: false },
};

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{
    session_id?: string;
    error?: string;
    link?: string;
    preview?: string;
  }>;
}) {
  const query = await searchParams;
  const preview = query.preview ? previewSession(query.preview) : null;
  if (preview) {
    return <SetupDesk session={preview} preview />;
  }
  const { gate, sessionId } = gateFromSearch(query);
  return (
    <>
      <SetupGate gate={gate} sessionId={sessionId} />
      <Suspense fallback={null}>
        <SetupSessionUpgrade />
      </Suspense>
    </>
  );
}
