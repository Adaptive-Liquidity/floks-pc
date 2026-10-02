import { z } from "zod";
import { type Computer } from "../../../src/lib/computers/index";
import { userFromRequest } from "../auth/request-session";
import { getSeatStore } from "../billing/seats";
import { getComputerService } from "../desks/runtime";
import {
  dashboardStatus,
  formatLastActive,
  lifecycleActionsFor,
  type DashboardStatus,
} from "./dashboard";

export {
  DASHBOARD_STATUSES,
  dashboardStatus,
  dashboardStatusFromDesk,
  formatLastActive,
  lifecycleActionsFor,
  REBUILD_WARNING,
  RESTART_NOTE,
} from "./dashboard";
export type { DashboardStatus } from "./dashboard";

export const ComputerIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9:_-]+$/);

export const LifecycleActionSchema = z.object({
  action: z.enum(["pause", "resume", "restart"]),
  confirmRebuild: z.boolean().optional(),
});

export type LifecycleAction = z.infer<typeof LifecycleActionSchema>["action"];

export async function computerOwnedByEmail(email: string, computerId: string): Promise<boolean> {
  const seats = await getSeatStore().listByEmail(email);
  return seats.some(
    (seat) => seat.computerId === computerId || seat.computerIds.includes(computerId),
  );
}

export async function requireOwnedComputer(
  request: Request,
  computerIdRaw: string,
): Promise<
  | { ok: true; computer: Computer; computerId: string }
  | { ok: false; status: 400 | 401 | 403 | 404; body: { ok: false; message: string } }
> {
  const parsed = ComputerIdSchema.safeParse(computerIdRaw);
  if (!parsed.success) {
    return { ok: false, status: 400, body: { ok: false, message: "Invalid computer." } };
  }
  const { user } = await userFromRequest(request);
  if (!user) {
    return { ok: false, status: 401, body: { ok: false, message: "Sign in required" } };
  }
  const computerId = parsed.data;
  if (!(await computerOwnedByEmail(user.email, computerId))) {
    return {
      ok: false,
      status: 403,
      body: { ok: false, message: "That computer is not on this account." },
    };
  }
  try {
    const service = await getComputerService();
    await service.reloadIfRevisionChanged();
    const computer = await service.get(computerId);
    return { ok: true, computer, computerId };
  } catch {
    return { ok: false, status: 404, body: { ok: false, message: "Computer not found." } };
  }
}

export function ownerComputerPayload(computer: Computer): {
  computerId: string;
  status: DashboardStatus;
  lastActiveAt: string | null;
  lastActiveLabel: string;
  actions: { pause: boolean; resume: boolean; restart: boolean };
} {
  const status = dashboardStatus(computer.state);
  const lastActiveAt = computer.lastActiveAt ? computer.lastActiveAt.toISOString() : null;
  return {
    computerId: computer.id,
    status,
    lastActiveAt,
    lastActiveLabel: formatLastActive(lastActiveAt),
    actions: lifecycleActionsFor(status),
  };
}

export async function runOwnerLifecycleAction(
  computerId: string,
  action: LifecycleAction,
  confirmRebuild = false,
): Promise<Computer> {
  const service = await getComputerService();
  await service.reloadIfRevisionChanged();
  if (action === "pause") return service.pauseThisComputer(computerId);
  if (action === "resume") return service.wakeThisComputer(computerId);
  return service.restartThisComputer(computerId, { confirmRebuild });
}

function computerErrorCode(err: unknown): { code: string; message: string } | null {
  if (!err || typeof err !== "object") return null;
  const code = "code" in err && typeof err.code === "string" ? err.code : "";
  const message = "message" in err && typeof err.message === "string" ? err.message : "";
  if (!code) return null;
  return { code, message };
}

export function lifecycleFailure(err: unknown): {
  status: number;
  body: {
    ok: false;
    code: string;
    message: string;
    needsRebuildConfirm?: true;
  };
} {
  const typed = computerErrorCode(err);
  if (typed?.code === "REBUILD_CONFIRM_REQUIRED") {
    return {
      status: 409,
      body: {
        ok: false,
        code: typed.code,
        message: typed.message,
        needsRebuildConfirm: true,
      },
    };
  }
  if (typed) {
    const status = typed.code === "ILLEGAL_STATE_TRANSITION" ? 409 : 400;
    return { status, body: { ok: false, code: typed.code, message: typed.message } };
  }
  return {
    status: 500,
    body: { ok: false, code: "LIFECYCLE_FAILED", message: "That action did not complete." },
  };
}
