"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent, type WheelEvent } from "react";

type DesktopMode = "view" | "control";

function desktopUrl(computerId: string): string {
  return `/api/setup/computers/${encodeURIComponent(computerId)}/desktop`;
}

async function desktopPost(
  computerId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(desktopUrl(computerId), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
}

function mapKey(event: KeyboardEvent): { type: "key" | "type"; key?: string; text?: string } | null {
  if (event.ctrlKey || event.metaKey) {
    const letter = event.key.toLowerCase();
    const combo = `ctrl+${letter}`;
    if (["ctrl+l", "ctrl+t", "ctrl+w", "ctrl+r", "ctrl+a", "ctrl+c", "ctrl+v"].includes(combo)) {
      return { type: "key", key: combo };
    }
    return null;
  }
  switch (event.key) {
    case "Enter":
      return { type: "key", key: "Return" };
    case "Backspace":
      return { type: "key", key: "BackSpace" };
    case "Escape":
      return { type: "key", key: "Escape" };
    case "Tab":
      return { type: "key", key: "Tab" };
    case " ":
      return { type: "key", key: "space" };
    case "Delete":
      return { type: "key", key: "Delete" };
    case "ArrowUp":
      return { type: "key", key: "Up" };
    case "ArrowDown":
      return { type: "key", key: "Down" };
    case "ArrowLeft":
      return { type: "key", key: "Left" };
    case "ArrowRight":
      return { type: "key", key: "Right" };
    case "Home":
      return { type: "key", key: "Home" };
    case "End":
      return { type: "key", key: "End" };
    case "F5":
      return { type: "key", key: "F5" };
    default:
      if (event.key.length === 1) return { type: "type", text: event.key };
      return null;
  }
}

export function ComputerScreen({
  computerId,
  label,
  initialState,
  needsWake: initialNeedsWake,
}: {
  computerId: string;
  label: string;
  initialState: string;
  needsWake: boolean;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [mode, setMode] = useState<DesktopMode>("view");
  const [state, setState] = useState(initialState);
  const [needsWake, setNeedsWake] = useState(initialNeedsWake);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [screenWidth, setScreenWidth] = useState(1440);
  const [screenHeight, setScreenHeight] = useState(900);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const tokenRef = useRef<string | null>(null);
  const modeRef = useRef<DesktopMode>("view");

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const applyStatus = useCallback((body: { state?: unknown; needsWake?: unknown }) => {
    if (typeof body.state === "string") setState(body.state);
    if (typeof body.needsWake === "boolean") setNeedsWake(body.needsWake);
  }, []);

  const openSession = useCallback(async () => {
    const res = await desktopPost(computerId, { action: "open" });
    const body = (await res.json()) as {
      ok?: boolean;
      token?: string;
      mode?: DesktopMode;
      message?: string;
      state?: string;
      needsWake?: boolean;
    };
    if (!res.ok || !body.token) {
      setMessage(body.message ?? "Could not open the screen.");
      return;
    }
    setToken(body.token);
    setMode(body.mode === "control" ? "control" : "view");
    applyStatus(body);
  }, [applyStatus, computerId]);

  const pullScreen = useCallback(async () => {
    const current = tokenRef.current;
    if (!current) return;
    const res = await desktopPost(computerId, { action: "screen", token: current });
    const body = (await res.json()) as {
      ok?: boolean;
      message?: string;
      reason?: string;
      screenshot?: string;
      screenWidth?: number;
      screenHeight?: number;
      state?: string;
      needsWake?: boolean;
    };
    if (res.status === 401 && (body.reason === "expired" || body.reason === "revoked")) {
      setToken(null);
      setMode("view");
      setMessage(body.message ?? "That screen session expired.");
      return;
    }
    if (!res.ok) {
      setMessage(body.message ?? "The screen is not available.");
      return;
    }
    applyStatus(body);
    if (typeof body.screenshot === "string") setScreenshot(body.screenshot);
    if (typeof body.screenWidth === "number") setScreenWidth(body.screenWidth);
    if (typeof body.screenHeight === "number") setScreenHeight(body.screenHeight);
  }, [applyStatus, computerId]);

  useEffect(() => {
    void openSession();
  }, [openSession]);

  useEffect(() => {
    if (!token || needsWake) return;
    void pullScreen();
    const id = window.setInterval(() => {
      void pullScreen();
    }, 1500);
    return () => window.clearInterval(id);
  }, [needsWake, pullScreen, token]);

  useEffect(() => {
    return () => {
      const current = tokenRef.current;
      if (!current) return;
      void desktopPost(computerId, { action: "close", token: current });
    };
  }, [computerId]);

  async function wake(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await desktopPost(computerId, { action: "wake" });
      const body = (await res.json()) as { ok?: boolean; message?: string; state?: string; needsWake?: boolean };
      if (!res.ok) {
        setMessage(body.message ?? "This computer could not wake.");
        return;
      }
      applyStatus(body);
    } finally {
      setBusy(false);
    }
  }

  async function toggleControl(): Promise<void> {
    const current = tokenRef.current;
    if (!current || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const action = modeRef.current === "control" ? "hand_back" : "take_control";
      const res = await desktopPost(computerId, { action, token: current });
      const body = (await res.json()) as {
        ok?: boolean;
        token?: string;
        mode?: DesktopMode;
        message?: string;
      };
      if (!res.ok || !body.token) {
        setMessage(body.message ?? "Could not change control.");
        return;
      }
      setToken(body.token);
      setMode(body.mode === "control" ? "control" : "view");
    } finally {
      setBusy(false);
    }
  }

  async function sendActions(actions: Array<Record<string, unknown>>): Promise<void> {
    const current = tokenRef.current;
    if (!current || modeRef.current !== "control") return;
    await desktopPost(computerId, { action: "act", token: current, actions });
  }

  function onFrameClick(event: MouseEvent<HTMLDivElement>): void {
    if (mode !== "control") return;
    const box = frameRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0 || box.height <= 0) return;
    const x = Math.floor(((event.clientX - box.left) / box.width) * screenWidth);
    const y = Math.floor(((event.clientY - box.top) / box.height) * screenHeight);
    void sendActions([{ type: "click_coordinates", x, y }]);
  }

  function onFrameWheel(event: WheelEvent<HTMLDivElement>): void {
    if (mode !== "control") return;
    event.preventDefault();
    const y = event.deltaY > 0 ? 3 : event.deltaY < 0 ? -3 : 0;
    if (y === 0) return;
    void sendActions([{ type: "scroll", x: 0, y }]);
  }

  useEffect(() => {
    if (mode !== "control") return;
    const onKey = (event: KeyboardEvent) => {
      const mapped = mapKey(event);
      if (!mapped) return;
      event.preventDefault();
      void sendActions([mapped]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  const stateLabel = state.replaceAll("_", " ");

  return (
    <div className="paper rack">
      <section className="bay">
        <p className="kicker">Computer</p>
        <h1>{label}</h1>
        <p>{stateLabel}</p>
        {mode === "control" ? (
          <p className="banner" role="status">
            You have control
          </p>
        ) : (
          <p>Viewing only</p>
        )}
        {needsWake ? (
          <>
            <p>This computer is asleep. Wake it to watch the screen.</p>
            <button className="key wide" type="button" disabled={busy} onClick={() => void wake()}>
              Wake
            </button>
          </>
        ) : (
          <>
            <div
              ref={frameRef}
              className={mode === "control" ? "screen-frame control" : "screen-frame"}
              onClick={onFrameClick}
              onWheel={onFrameWheel}
            >
              {screenshot ? (
                <img src={`data:image/png;base64,${screenshot}`} alt="Live computer screen" />
              ) : (
                <p className="screen-wait">Waiting for the screen</p>
              )}
            </div>
            <button className="ghost wide" type="button" disabled={busy || !token} onClick={() => void toggleControl()}>
              {mode === "control" ? "Hand back" : "Take control"}
            </button>
          </>
        )}
        <a className="ghost wide" href="/setup">
          Back to account
        </a>
        {message ? <p className="note">{message}</p> : null}
      </section>
    </div>
  );
}
