"use client";

import { useEffect } from "react";
import { CALLBACK_FLASH } from "@/lib/copy";
import { finishCallback } from "@/lib/setup-client";

export function CallbackFlash() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const timer = window.setTimeout(() => {
      window.location.replace("/setup");
    }, 900);
    if ([...params.keys()].some((key) => key !== "session_id")) {
      void finishCallback(params).finally(() => {
        window.clearTimeout(timer);
        window.location.replace("/setup");
      });
    }
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <section className="flash">
      <p>{CALLBACK_FLASH}</p>
    </section>
  );
}
