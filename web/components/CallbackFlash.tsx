"use client";

import { useEffect } from "react";
import { CALLBACK_FLASH } from "@/lib/copy";
import { callbackFinishPlan, finishCallback } from "@/lib/setup-client";

export function CallbackFlash() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const plan = callbackFinishPlan(params);
    // session_id-only is just-paid check-inbox, not a magic-link finish — do not POST.
    if (!plan.shouldPost) {
      window.location.replace(plan.nextHref);
      return;
    }

    void (async () => {
      try {
        await finishCallback(params);
      } finally {
        window.location.replace(plan.nextHref);
      }
    })();
  }, []);

  return (
    <section className="flash">
      <p>{CALLBACK_FLASH}</p>
    </section>
  );
}
