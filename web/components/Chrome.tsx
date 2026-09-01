"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type ChromeState = {
  authed: boolean;
  setAuthed: (value: boolean) => void;
};

const ChromeContext = createContext<ChromeState>({
  authed: false,
  setAuthed: () => undefined,
});

export function ChromeProvider({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(false);
  const value = useMemo(() => ({ authed, setAuthed }), [authed]);
  return <ChromeContext.Provider value={value}>{children}</ChromeContext.Provider>;
}

export function useChrome(): ChromeState {
  return useContext(ChromeContext);
}
