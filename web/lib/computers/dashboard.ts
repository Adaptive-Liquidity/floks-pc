import { isRestartableState, type ComputerState } from "../../../src/lib/computers/types";
import type { DeskState } from "../types";

export const DASHBOARD_STATUSES = ["running", "paused", "starting", "stopped", "working"] as const;
export type DashboardStatus = (typeof DASHBOARD_STATUSES)[number];

const STARTING = new Set<ComputerState>(["requested", "provisioning", "waking"]);
const WORKING = new Set<ComputerState>(["recovering", "checkpointing"]);
const TERMINAL = new Set<ComputerState>([
  "error",
  "restore_failed",
  "cleanup_needed",
  "deleting",
  "deleted",
]);

export function dashboardStatus(state: ComputerState): DashboardStatus {
  if (state === "ready" || state === "running") return "running";
  if (state === "paused") return "paused";
  if (TERMINAL.has(state)) return "stopped";
  if (WORKING.has(state)) return "working";
  if (STARTING.has(state)) return "starting";
  return "stopped";
}

export function dashboardStatusLabel(status: DashboardStatus): string {
  return status === "working" ? "working on it" : status;
}

export function dashboardStatusFromDesk(state: DeskState): DashboardStatus {
  if (state === "running") return "running";
  if (state === "sleeping") return "paused";
  if (state === "provisioning") return "starting";
  return "stopped";
}

export function lifecycleActionsForState(state: ComputerState): {
  pause: boolean;
  resume: boolean;
  restart: boolean;
} {
  return {
    pause: state === "ready" || state === "running",
    resume: state === "paused" || state === "stopped",
    restart: isRestartableState(state),
  };
}

export function lifecycleActionsFor(status: DashboardStatus): {
  pause: boolean;
  resume: boolean;
  restart: boolean;
} {
  return {
    pause: status === "running",
    resume: status === "paused" || status === "stopped",
    restart: status === "running" || status === "paused" || status === "stopped",
  };
}

export function formatLastActive(iso: string | null, nowMs = Date.now()): string {
  if (!iso) return "never";
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "never";
  const delta = Math.max(0, nowMs - at);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return `${iso} · just now`;
  if (minutes < 60) return `${iso} · ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${iso} · ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${iso} · ${days}d ago`;
}

export const REBUILD_WARNING =
  "This restart would rebuild the computer and delete its files. Confirm only if you accept that loss.";

export const RESTART_NOTE =
  "Restart reboots this computer and keeps files when the disk can be resumed. Pause and resume use suspend/resume.";
