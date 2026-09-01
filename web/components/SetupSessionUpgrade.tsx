"use client";

import { useEffect, useState } from "react";
import { SetupDesk } from "@/components/SetupDesk";
import { parseSeatSession } from "@/lib/session";
import type { SeatSession } from "@/lib/types";

/** If the host later returns JSON for an authenticated /setup, replace the gate. */
export function SetupSessionUpgrade() {
  const [session, setSession] = useState<SeatSession | null>(null);

  useEffect(() => {
    void fetch("/setup", {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "include",
    })
      .then(async (res) => {
        if (!res.ok) return;
        const contentType = res.headers.get("content-type") ?? "";
        if (!contentType.includes("application/json")) return;
        const parsed = parseSeatSession(await res.json());
        if (parsed) setSession(parsed);
      })
      .catch(() => {
        /* stay on the server-rendered gate */
      });
  }, []);

  if (!session) return null;
  return <SetupDesk session={session} preview={false} />;
}
