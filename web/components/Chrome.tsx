"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type ChromeState = {
  authed: boolean;
  setAuthed: (value: boolean) => void;
};

const ChromeContext = createContext<ChromeState>({
  authed: false,
  setAuthed: () => undefined,
});

export function ChromeProvider({
  children,
  initialAuthed = false,
}: {
  children: ReactNode;
  initialAuthed?: boolean;
}) {
  const [authed, setAuthed] = useState(initialAuthed);
  useEffect(() => {
    setAuthed(initialAuthed);
  }, [initialAuthed]);
  const value = useMemo(() => ({ authed, setAuthed }), [authed]);
  return <ChromeContext.Provider value={value}>{children}</ChromeContext.Provider>;
}

export function useChrome(): ChromeState {
  return useContext(ChromeContext);
}
