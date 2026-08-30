"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/**
 * "Track a delivery" in the consumer header.
 *
 * There is NO canonical generic `/track` route. PUB-006 is `/track/[token]`,
 * reachable only with the access token Couranr sent to the recipient — so a
 * header link would be a 404 with a friendly label, which is the failure this
 * component exists to avoid.
 *
 * What it does instead: the visitor already holds a Couranr tracking link (in a
 * text message or an email). Paste it, and this navigates locally to the
 * `/track/[token]` path inside it. That is a client-side parse and a router
 * push. It calls no backend, stores nothing, and logs nothing — a delivery
 * access token is exactly the kind of value that must not end up in analytics
 * or a server log, and the safest way to guarantee that is never to send it
 * anywhere.
 *
 * It creates no new canonical screen id. Only the header LABEL is locked copy
 * (MKT-005); everything inside is implementation microcopy, kept literal and
 * non-promotional — it makes no claim about what tracking will show.
 */

/** `/track/<token>` extracted from whatever the visitor pasted, or null. */
export function parseTrackingPath(raw: string): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;

  let pathname: string;
  if (/^https?:\/\//i.test(value)) {
    try {
      pathname = new URL(value).pathname;
    } catch {
      return null;
    }
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    /* Any other scheme — javascript:, data:, mailto: — is refused outright
       rather than coerced into a path. */
    return null;
  } else if (value.startsWith("//")) {
    /* Protocol-relative: an authority wearing a path's clothes. */
    return null;
  } else {
    pathname = value.startsWith("/") ? value : `/${value}`;
  }

  /* One shape only. The token segment is opaque here — this component does not
     decide what a valid token looks like, the token page does — but it must be
     a single path segment with no traversal and nothing after it. */
  const match = /^\/track\/([^/?#]+)\/?$/.exec(pathname);
  if (!match) return null;
  const token = decodeURIComponent(match[1]);
  if (!token || token === "." || token === "..") return null;

  return `/track/${match[1]}`;
}

export function TrackDeliveryLauncher({
  variant = "topbar",
}: {
  variant?: "topbar" | "drawer";
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const panelId = React.useId();

  React.useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const path = parseTrackingPath(value);
    if (!path) {
      setError("That does not look like a Couranr tracking link.");
      return;
    }
    setError(null);
    setOpen(false);
    router.push(path);
  }

  const triggerClass =
    variant === "drawer"
      ? "cr-button cr-button--inverse cr-button--lg"
      : "cr-button cr-button--ghost cr-button--sm";

  return (
    <span className="cr-track-launcher" data-couranr-track-launcher={variant}>
      <button
        type="button"
        className={triggerClass}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((v) => !v);
          setError(null);
        }}
      >
        Track a delivery
      </button>

      {open ? (
        <div className="cr-track-launcher__panel" id={panelId} role="group" aria-label="Track a delivery">
          <form onSubmit={submit}>
            <label className="cr-track-launcher__label" htmlFor={`${panelId}-input`}>
              Paste your Couranr tracking link
            </label>
            <input
              id={`${panelId}-input`}
              ref={inputRef}
              className="cr-input"
              type="text"
              inputMode="url"
              autoComplete="off"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(null);
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${panelId}-error` : undefined}
            />
            {error ? (
              <p className="cr-field__error" id={`${panelId}-error`} role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" className="cr-button cr-button--primary cr-button--sm">
              Open tracking
            </button>
          </form>
        </div>
      ) : null}
    </span>
  );
}
