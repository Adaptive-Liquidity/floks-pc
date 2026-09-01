"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SetupDesk } from "@/components/SetupDesk";
import { SetupGate } from "@/components/SetupGate";
import { loadSetupView } from "@/lib/session";
import type { SetupView } from "@/lib/types";

export function SetupClient() {
  const params = useSearchParams();
  const [view, setView] = useState<SetupView | null>(null);

  useEffect(() => {
    const search: {
      session_id?: string;
      error?: string;
      link?: string;
      preview?: string;
    } = {};
    const sessionId = params.get("session_id");
    const error = params.get("error");
    const link = params.get("link");
    const preview = params.get("preview");
    if (sessionId) search.session_id = sessionId;
    if (error) search.error = error;
    if (link) search.link = link;
    if (preview) search.preview = preview;
    void loadSetupView(search).then(setView);
  }, [params]);

  if (!view) {
    return (
      <section className="flash">
        <p>Setup</p>
      </section>
    );
  }
  if (view.kind === "gate") {
    return <SetupGate gate={view.gate} sessionId={view.sessionId} />;
  }
  return <SetupDesk session={view.session} preview={view.preview} />;
}
