"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PUBLIC_CHROME_COPY as CHROME } from "@/lib/couranr/public/masterSameDayCopy";

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

/** The page's own host, or null when there is no document (SSR, node tests). */
function currentHost(): string | null {
  return typeof window === "undefined" ? null : window.location.host;
}

/**
 * `/track/<token>` extracted from whatever the visitor pasted, or null.
 *
 * `selfHost` is the host an absolute URL must match. It defaults to the page's
 * own host and is a parameter only so a test can supply one — without it the
 * same-origin rule is unprovable outside a browser, which is how the previous
 * version's defect survived: a passing test asserted the host was DISCARDED
 * and called that "deliberate and safe".
 */
export function parseTrackingPath(
  raw: string,
  selfHost: string | null = currentHost(),
): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;

  let pathname: string;
  if (/^https?:\/\//i.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    /* THE HOST HAS TO MATCH. This read `new URL(value).pathname` and threw the
       origin away, so `https://anywhere.example.com/track/TOKEN` was accepted
       and the visitor was silently navigated to Couranr's own `/track/TOKEN`.
       Gate H requires a non-Couranr URL to be REFUSED — and a link that quietly
       becomes a different link is the wrong answer even when the destination is
       our own.

       Compared against the page's own host rather than a hardcoded domain,
       because the launcher runs on preview deployments and on localhost as well
       as in production and a literal would refuse the real link everywhere but
       one. When there is no host to compare against — SSR, or a caller that
       passes null — the absolute form is refused rather than waved through:
       fail closed, since a relative `/track/…` path still works. */
    if (!selfHost || url.host !== selfHost) return null;
    pathname = url.pathname;
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
        {CHROME.track_a_delivery}
      </button>

      {open ? (
        <div
          className="cr-track-launcher__panel"
          id={panelId}
          role="group"
          aria-label={CHROME.track_a_delivery}
        >
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
