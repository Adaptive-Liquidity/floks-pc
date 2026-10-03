"use client";

import { useCallback, useEffect, useState } from "react";
import {
  formatLastActive,
  lifecycleActionsFor,
  type DashboardStatus,
} from "@/lib/computers/dashboard";
import { ComputerActivityLog, type ActivityRow } from "./ComputerActivityLog";
import { ComputerLifecyclePanel } from "./ComputerLifecyclePanel";
import "./computer-manage.css";

type LifecyclePayload = {
  ok?: boolean;
  status?: DashboardStatus;
  lastActiveAt?: string | null;
  lastActiveLabel?: string;
  actions?: { pause: boolean; resume: boolean; restart: boolean };
  message?: string;
  code?: string;
  needsRebuildConfirm?: boolean;
};

type ActivityPayload = {
  ok?: boolean;
  events?: ActivityRow[];
  nextCursor?: string | null;
};

const PREVIEW_EVENTS: ActivityRow[] = [
  {
    id: "preview-1",
    at: "2026-10-02T12:00:00.000Z",
    operation: "observe",
    success: true,
    errorCode: null,
  },
  {
    id: "preview-2",
    at: "2026-10-02T12:00:04.000Z",
    operation: "act",
    success: true,
    errorCode: null,
  },
];

function asStatus(value: unknown): DashboardStatus | null {
  if (value === "running" || value === "paused" || value === "starting" || value === "stopped") {
    return value;
  }
  return null;
}

export function ComputerManageSection({
  computerId,
  preview = false,
  initialStatus = "stopped",
}: {
  computerId: string;
  preview?: boolean;
  initialStatus?: DashboardStatus;
}) {
  const [status, setStatus] = useState<DashboardStatus>(initialStatus);
  const [lastActiveLabel, setLastActiveLabel] = useState(
    formatLastActive(preview ? "2026-10-02T12:00:00.000Z" : null),
  );
  const [actions, setActions] = useState(lifecycleActionsFor(initialStatus));
  const [events, setEvents] = useState<ActivityRow[]>(preview ? PREVIEW_EVENTS : []);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showRebuildWarning, setShowRebuildWarning] = useState(false);
  const [acceptedRebuild, setAcceptedRebuild] = useState(false);

  const applyLifecycle = useCallback((payload: LifecyclePayload) => {
    const next = asStatus(payload.status);
    if (next) {
      setStatus(next);
      setActions(payload.actions ?? lifecycleActionsFor(next));
    }
    if (typeof payload.lastActiveLabel === "string") setLastActiveLabel(payload.lastActiveLabel);
    else if (payload.lastActiveAt !== undefined) setLastActiveLabel(formatLastActive(payload.lastActiveAt ?? null));
    if (payload.needsRebuildConfirm) {
      setShowRebuildWarning(true);
    }
  }, []);

  const load = useCallback(async () => {
    if (preview) return;
    const [lifeRes, actRes] = await Promise.all([
      fetch(`/api/setup/computer-lifecycle/${encodeURIComponent(computerId)}`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      }),
      fetch(`/api/setup/computer-activity/${encodeURIComponent(computerId)}?limit=20`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      }),
    ]);
    if (lifeRes.ok) applyLifecycle((await lifeRes.json()) as LifecyclePayload);
    if (actRes.ok) {
      const page = (await actRes.json()) as ActivityPayload;
      setEvents(Array.isArray(page.events) ? page.events : []);
      setNextCursor(page.nextCursor ?? null);
    }
  }, [applyLifecycle, computerId, preview]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runAction(action: "pause" | "resume" | "restart"): Promise<void> {
    if (preview) {
      const next: DashboardStatus =
        action === "pause" ? "paused" : action === "resume" ? "running" : "running";
      setStatus(next);
      setActions(lifecycleActionsFor(next));
      setLastActiveLabel(formatLastActive(new Date().toISOString()));
      setMessage(action === "restart" ? "Preview restart. Files would be kept." : null);
      return;
    }
    if (action === "restart" && showRebuildWarning && !acceptedRebuild) {
      setMessage("Confirm to rebuild and lose files.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/setup/computer-lifecycle/${encodeURIComponent(computerId)}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          action,
          confirmRebuild: action === "restart" && acceptedRebuild,
        }),
      });
      const payload = (await res.json()) as LifecyclePayload;
      if (payload.needsRebuildConfirm) {
        setShowRebuildWarning(true);
        setAcceptedRebuild(false);
        setMessage(payload.message ?? "Confirm to rebuild and lose files.");
        return;
      }
      if (!res.ok) {
        setMessage(payload.message ?? "That action did not complete.");
        return;
      }
      applyLifecycle(payload);
      setShowRebuildWarning(false);
      setAcceptedRebuild(false);
      await load();
    } catch {
      setMessage("That action did not complete.");
    } finally {
      setBusy(false);
    }
  }

  async function loadOlder(): Promise<void> {
    if (preview || !nextCursor) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/setup/computer-activity/${encodeURIComponent(computerId)}?limit=20&cursor=${encodeURIComponent(nextCursor)}`,
        { credentials: "include", headers: { Accept: "application/json" } },
      );
      if (!res.ok) return;
      const page = (await res.json()) as ActivityPayload;
      const more = Array.isArray(page.events) ? page.events : [];
      setEvents((current) => [...current, ...more]);
      setNextCursor(page.nextCursor ?? null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="computer-manage" aria-label="Computer status and activity">
      <ComputerLifecyclePanel
        status={status}
        lastActiveLabel={lastActiveLabel}
        actions={actions}
        busy={busy}
        message={message}
        showRebuildWarning={showRebuildWarning}
        acceptedRebuild={acceptedRebuild}
        onAction={(action) => {
          void runAction(action);
        }}
        onToggleRebuild={setAcceptedRebuild}
      />
      <ComputerActivityLog
        events={events}
        nextCursor={nextCursor}
        busy={busy}
        onOlder={() => {
          void loadOlder();
        }}
      />
    </section>
  );
}
