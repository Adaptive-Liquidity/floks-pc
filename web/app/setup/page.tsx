import type { Metadata } from "next";
import { SetupDesk } from "@/components/SetupDesk";
import { SetupGate } from "@/components/SetupGate";
import { ACCOUNT_HOME_LINE } from "@/lib/copy";
import { resolveSetupView } from "@/lib/setup-server";

export const metadata: Metadata = {
  title: "Account",
  description: ACCOUNT_HOME_LINE,
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
  const view = await resolveSetupView(query);
  if (view.kind === "desk") {
    return <SetupDesk session={view.session} preview={view.preview} />;
  }
  return <SetupGate gate={view.gate} sessionId={view.sessionId} />;
}
