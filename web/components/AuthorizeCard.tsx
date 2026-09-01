"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  OAUTH_ALREADY,
  OAUTH_BODY,
  OAUTH_ERROR,
  OAUTH_INVALID,
  OAUTH_LOADING,
  OAUTH_TITLE,
} from "@/lib/copy";
import { CONNECTOR } from "@/lib/config";
import type { OauthUiState } from "@/lib/types";

export function AuthorizeCard() {
  const search = useSearchParams();
  const query = search.toString();
  const params = new URLSearchParams(query);
  const [state, setState] = useState<OauthUiState>("loading");
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    const next = new URLSearchParams(query);
    const clientId = next.get("client_id");
    if (!clientId || clientId !== CONNECTOR.clientId) {
      setState("invalid_client");
      return;
    }
    const href = `${CONNECTOR.authorizeUrl}?${query}`;
    void fetch(href, { headers: { Accept: "application/json" }, credentials: "include" })
      .then(async (res) => {
        const text = await res.text();
        let json: { error?: string; error_description?: string; status?: string } = {};
        try {
          json = JSON.parse(text) as { error?: string; error_description?: string; status?: string };
        } catch {
          json = {};
        }
        if (json.status === "already_allowed" || json.error === "already_allowed") {
          setState("already_allowed");
          return;
        }
        if (json.error === "invalid_client") {
          setState("invalid_client");
          return;
        }
        if (!res.ok && json.error) {
          setState("error");
          setDetail(json.error_description ?? json.error);
          return;
        }
        setState("ready");
      })
      .catch(() => {
        setState("ready");
      });
  }, [query]);

  const cancelHref = params.get("redirect_uri") ?? "https://grok.com";

  return (
    <section className="stage">
      <div className="card">
        <h1 className="question">{OAUTH_TITLE}</h1>
        <p className="lede">{OAUTH_BODY}</p>
        {state === "loading" ? <p className="note">{OAUTH_LOADING}</p> : null}
        {state === "invalid_client" ? <p className="fail">{OAUTH_INVALID}</p> : null}
        {state === "already_allowed" ? <p className="note">{OAUTH_ALREADY}</p> : null}
        {state === "error" ? <p className="fail">{detail ?? OAUTH_ERROR}</p> : null}
        {state === "ready" ? (
          <form className="actions" method="post" action={CONNECTOR.authorizeUrl}>
            {Array.from(params.entries()).map(([key, value]) => (
              <input key={key} type="hidden" name={key} value={value} />
            ))}
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
