import { NextResponse } from "next/server";
import { z } from "zod";
import { csrfOk, requestOrigin } from "../../../../../../lib/auth/cookies";
import { userFromRequest } from "../../../../../../lib/auth/request-session";
import {
  emailOwnsComputer,
  issueOwnerDesktopToken,
  readOwnerDesktopToken,
  revokeOwnerDesktopToken,
  rotateOwnerDesktopToken,
} from "../../../../../../lib/desks/desktop-access";
import { getComputerService } from "../../../../../../lib/desks/runtime";

function errorCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  if (!("code" in err)) return null;
  return typeof err.code === "string" ? err.code : null;
}

function errorState(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  if (!("details" in err) || !err.details || typeof err.details !== "object") return null;
  const state = (err.details as { state?: unknown }).state;
  return typeof state === "string" ? state : null;
}

const ActActionSchema = z.object({
  type: z.enum(["click_coordinates", "type", "key", "scroll"]),
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  text: z.string().min(1).max(2000).optional(),
  key: z.string().min(1).max(32).optional(),
});

const BodySchema = z.object({
  action: z.enum(["open", "wake", "screen", "take_control", "hand_back", "act", "close"]),
  token: z.string().min(1).optional(),
  actions: z.array(ActActionSchema).min(1).max(20).optional(),
});

function fail(status: number, message: string, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ ok: false, message, ...extra }, { status });
}

function tokenDenied(reason: "invalid" | "expired" | "revoked" | "mismatch"): NextResponse {
  if (reason === "expired") return fail(401, "That screen session expired.", { reason });
  if (reason === "revoked") return fail(401, "That screen session was handed back.", { reason });
  return fail(403, "That screen session is not valid.", { reason });
}

function publicState(state: string): { state: string; needsWake: boolean; viewable: boolean } {
  const needsWake = state === "paused" || state === "stopped";
  return {
    state,
    needsWake,
    viewable: state === "ready" || state === "running",
  };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!csrfOk(request, requestOrigin(request.url))) {
    return fail(403, "Origin mismatch");
  }
  const { user } = await userFromRequest(request);
  if (!user) return fail(401, "Sign in required");
  const { id: computerId } = await context.params;
  if (!computerId) return fail(404, "Computer not found.");
  const owned = await emailOwnsComputer(user.email, computerId);
  if (!owned) return fail(403, "That computer is not on this account.");

  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await request.json());
  } catch {
    return fail(400, "Invalid desktop request.");
  }

  const service = await getComputerService();
  const email = user.email.trim().toLowerCase();

  try {
    if (parsed.action === "open") {
      const status = await service.ownerDesktopStatus(computerId);
      const issued = await issueOwnerDesktopToken({
        computerId,
        email,
        subject: user.id,
        mode: "view",
      });
      if (!issued.ok) return fail(503, "Screen sessions are not configured.");
      service.noteOwnerDesktop({
        computerId,
        operation: "owner-view-start",
        success: true,
      });
      return NextResponse.json({
        ok: true,
        token: issued.token,
        expiresAt: issued.payload.exp,
        mode: issued.payload.mode,
        ...publicState(status.computer.state),
      });
    }

    if (parsed.action === "wake") {
      await service.wakeThisComputer(computerId);
      const status = await service.ownerDesktopStatus(computerId);
      return NextResponse.json({ ok: true, ...publicState(status.computer.state) });
    }

    if (!parsed.token) return fail(401, "Screen session required.");
    const session = await readOwnerDesktopToken({
      token: parsed.token,
      computerId,
      email,
      subject: user.id,
    });
    if (!session.ok) return tokenDenied(session.reason);

    if (parsed.action === "screen") {
      const watched = await service.ownerDesktopWatch(computerId);
      if (!watched.ok) {
        return NextResponse.json({
          ok: true,
          ...publicState(watched.state),
          mode: session.payload.mode,
        });
      }
      const body: Record<string, unknown> = {
        ok: true,
        ...publicState(watched.state),
        mode: session.payload.mode,
        screenWidth: watched.screen.screenWidth,
        screenHeight: watched.screen.screenHeight,
        hasScreenshot: watched.screen.hasScreenshot,
      };
      if (watched.screen.activeWindow) body.activeWindow = watched.screen.activeWindow;
      if (watched.screen.screenshotBase64) body.screenshot = watched.screen.screenshotBase64;
      return NextResponse.json(body);
    }

    if (parsed.action === "take_control") {
      const rotated = await rotateOwnerDesktopToken({
        token: parsed.token,
        computerId,
        email,
        subject: user.id,
        mode: "control",
      });
      if (!rotated.ok) return tokenDenied(rotated.reason);
      service.noteOwnerDesktop({
        computerId,
        operation: "owner-takeover-start",
        success: true,
      });
      return NextResponse.json({
        ok: true,
        token: rotated.token,
        expiresAt: rotated.payload.exp,
        mode: "control",
      });
    }

    if (parsed.action === "hand_back") {
      const rotated = await rotateOwnerDesktopToken({
        token: parsed.token,
        computerId,
        email,
        subject: user.id,
        mode: "view",
      });
      if (!rotated.ok) return tokenDenied(rotated.reason);
      service.noteOwnerDesktop({
        computerId,
        operation: "owner-takeover-stop",
        success: true,
      });
      return NextResponse.json({
        ok: true,
        token: rotated.token,
        expiresAt: rotated.payload.exp,
        mode: "view",
      });
    }

    if (parsed.action === "act") {
      if (session.payload.mode !== "control") {
        return fail(403, "Take control before using the keyboard or mouse.");
      }
      if (!parsed.actions) return fail(400, "Invalid desktop request.");
      const result = await service.ownerDesktopAct(computerId, {
        actions: parsed.actions.map((row) => {
          const action: {
            type: "click_coordinates" | "type" | "key" | "scroll";
            x?: number;
            y?: number;
            text?: string;
            key?: string;
          } = { type: row.type };
          if (typeof row.x === "number") action.x = row.x;
          if (typeof row.y === "number") action.y = row.y;
          if (typeof row.text === "string") action.text = row.text;
          if (typeof row.key === "string") action.key = row.key;
          return action;
        }),
      });
      return NextResponse.json({ ok: result.ok, results: result.results });
    }

    if (parsed.action === "close") {
      const wasControl = session.payload.mode === "control";
      await revokeOwnerDesktopToken(parsed.token);
      if (wasControl) {
        service.noteOwnerDesktop({
          computerId,
          operation: "owner-takeover-stop",
          success: true,
        });
      }
      service.noteOwnerDesktop({
        computerId,
        operation: "owner-view-stop",
        success: true,
      });
      return NextResponse.json({ ok: true });
    }

    return fail(400, "Invalid desktop request.");
  } catch (err) {
    const code = errorCode(err);
    if (code === "COMPUTER_NOT_FOUND") return fail(404, "Computer not found.");
    if (code === "OBSERVE_RETRYABLE") {
      return NextResponse.json({ ok: true, ...publicState(errorState(err) ?? "unknown") });
    }
    if (code === "OWNER_DESKTOP_TIMEOUT") {
      return fail(504, "Watching the screen timed out.", { reason: "timeout" });
    }
    if (code === "OWNER_ACT_DENIED") {
      return fail(400, err instanceof Error ? err.message : "owner desktop does not allow that action");
    }
    if (code === "RECOVERY_FAILED") {
      return fail(502, "This computer could not wake.");
    }
    console.error("[desktop]", err instanceof Error ? err.message : err);
    return fail(500, "The screen is not available.");
  }
}
