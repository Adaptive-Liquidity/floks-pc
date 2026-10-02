"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  OAUTH_ALREADY,
  OAUTH_BODY,
  OAUTH_ERROR,
  OAUTH_INVALID,
  OAUTH_LOADING,
  OAUTH_NO_COMPUTER,
  OAUTH_TITLE,
} from "@/lib/copy";
import { CONNECTOR } from "@/lib/config";
import { oauthUiFromPreflight, parseAuthorizePreflightBody, type AuthorizeComputer } from "@/lib/oauth-ui";
import type { OauthUiState } from "@/lib/types";

function redirectHost(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return "invalid";
  }
}

export function AuthorizeCard() {
  const search = useSearchParams();
  const query = search.toString();
  const params = new URLSearchParams(query);
  const [state, setState] = useState<OauthUiState>("loading");
  const [detail, setDetail] = useState<string | null>(null);
  const [needsComputer, setNeedsComputer] = useState(false);
  const [botName, setBotName] = useState<string | null>(null);
  const [computers, setComputers] = useState<AuthorizeComputer[]>([]);

  useEffect(() => {
    const next = new URLSearchParams(query);
    const clientId = next.get("client_id");
    if (!clientId) {
      setState("invalid_client");
      return;
    }
    const href = `${CONNECTOR.authorizeUrl}?${query}`;
    void fetch(href, { headers: { Accept: "application/json" }, credentials: "include" })
      .then(async (res) => {
        const text = await res.text();
        const raw = parseAuthorizePreflightBody(text);
        const nextState = oauthUiFromPreflight(res.ok, raw);
        setDetail(nextState.detail);
        setNeedsComputer(raw?.needsComputer === true);
        setBotName(raw?.clientName ?? null);
        setComputers(raw?.computers ?? []);
        setState(nextState.state);
      })
      .catch(() => {
        const failed = oauthUiFromPreflight(false, null);
        setDetail(failed.detail);
        setState(failed.state);
      });
  }, [query]);

  const redirectUri = params.get("redirect_uri");
  const cancelHref =
    state === "ready" && redirectUri
      ? `${redirectUri}${redirectUri.includes("?") ? "&" : "?"}error=access_denied`
      : "/";

  return (
    <section className="stage">
      <div className="card">
        <h1 className="question">{OAUTH_TITLE}</h1>
        <p className="lede">{OAUTH_BODY}</p>
        {params.get("redirect_uri") ? (
          <p className="note">Redirect host: {redirectHost(params.get("redirect_uri") ?? "")}</p>
        ) : null}
        {state === "loading" ? <p className="note">{OAUTH_LOADING}</p> : null}
        {state === "invalid_client" ? <p className="fail">{OAUTH_INVALID}</p> : null}
        {state === "already_allowed" ? <p className="note">{OAUTH_ALREADY}</p> : null}
        {state === "signed_out" ? (
          <p className="note">
            <a href={`/login?return=${encodeURIComponent(`/oauth/authorize?${query}`)}`}>Sign in</a>
          </p>
        ) : null}
        {state === "no_plan" ? (
          <p className="note">
            <a href="/pricing">See plans</a>
          </p>
        ) : null}
        {state === "error" ? <p className="fail">{detail ?? OAUTH_ERROR}</p> : null}
        {state === "ready" ? (
          <form className="actions" method="post" action={CONNECTOR.authorizeUrl}>
            {Array.from(params.entries()).map(([key, value]) => (
              <input key={key} type="hidden" name={key} value={value} />
            ))}
            {botName ? <p className="note">Bot: {botName}</p> : null}
            {computers.length > 0 ? (
              <fieldset className="note">
                <legend>Computer</legend>
                {computers.map((computer) => (
                  <label key={computer.id}>
                    <input
                      type="radio"
                      name="computer_id"
                      value={computer.id}
                      defaultChecked={computer.id === computers[0]?.id}
                      required
                    />
                    {computer.label ?? computer.id}
                    {computer.plan ? ` · ${computer.plan}` : ""}
                    {computer.status ? ` · ${computer.status}` : ""}
                    {computer.in_use_by_bot ? (
                      <span>{` This replaces ${computer.in_use_by_bot} on ${computer.label ?? "Computer"}.`}</span>
                    ) : null}
                  </label>
                ))}
              </fieldset>
            ) : null}
            {needsComputer && computers.length === 0 ? <p className="note">{OAUTH_NO_COMPUTER}</p> : null}
            <button className="key wide" type="submit" name="allow" value="1">
              Allow
            </button>
            <a className="ghost wide" href={cancelHref}>
              Cancel
            </a>
          </form>
        ) : null}
      </div>
    </section>
  );
}
