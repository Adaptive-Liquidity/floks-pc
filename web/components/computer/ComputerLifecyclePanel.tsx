"use client";

import { REBUILD_WARNING, RESTART_NOTE, type DashboardStatus } from "@/lib/computers/owner";

export function ComputerLifecyclePanel({
  status,
  lastActiveLabel,
  actions,
  busy,
  message,
  showRebuildWarning,
  acceptedRebuild,
  onAction,
  onToggleRebuild,
}: {
  status: DashboardStatus;
  lastActiveLabel: string;
  actions: { pause: boolean; resume: boolean; restart: boolean };
  busy: boolean;
  message: string | null;
  showRebuildWarning: boolean;
  acceptedRebuild: boolean;
  onAction: (action: "pause" | "resume" | "restart") => void;
  onToggleRebuild: (value: boolean) => void;
}) {
  return (
    <div>
      <h3>Computer</h3>
      <div className="computer-status-row">
        <span className="computer-status">{status}</span>
        <span className="meta">Last active {lastActiveLabel}</span>
      </div>
      <p className="note">{RESTART_NOTE}</p>
      <div className="computer-actions">
        <button
          className="ghost"
          type="button"
          disabled={busy || !actions.pause}
          onClick={() => onAction("pause")}
        >
          Pause
        </button>
        <button
          className="ghost"
          type="button"
          disabled={busy || !actions.resume}
          onClick={() => onAction("resume")}
        >
          Resume
        </button>
        <button
          className="ghost"
          type="button"
          disabled={busy || !actions.restart}
          onClick={() => onAction("restart")}
        >
          Restart
        </button>
      </div>
      {showRebuildWarning ? (
        <div className="banner danger">
          <p>{REBUILD_WARNING}</p>
          <label>
            <input
              type="checkbox"
              checked={acceptedRebuild}
              onChange={(event) => onToggleRebuild(event.target.checked)}
            />{" "}
            I understand files will be deleted
          </label>
        </div>
      ) : null}
      {message ? <p className="note">{message}</p> : null}
    </div>
  );
}
