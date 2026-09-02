"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import {
  Alert,
  Button,
  Stack,
  Text,
} from "@/components/couranr/primitives";
import { Field, Input } from "@/components/couranr/forms";
import {
  CardSkeleton,
  ErrorState,
  LoadingState,
  SuccessState,
} from "@/components/couranr/states";
import { classifyAuthError, type AuthFailure } from "./authCopy";
import { fetchLanding } from "./session";

/**
 * PUB-002 — sign in.
 *
 * One branded entry point for merchants, drivers and Couranr Operations. The
 * form does NOT decide where anyone lands: it signs in, then asks
 * `/api/couranr/me/landing`, which revalidates the token and derives the
 * destination from `profiles.role` and membership server-side.
 *
 * That split is the point. A browser that could choose its own destination
 * could send itself to `/operations`; the guard there would refuse it, but the
 * merchant would see a flash of an operator shell first.
 */
export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");

  const [checkingSession, setCheckingSession] = React.useState(true);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<AuthFailure | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [signedIn, setSignedIn] = React.useState(false);

  /** Already-signed-in redirect: never show the form to someone who has a session. */
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const landing = await fetchLanding(next);
      if (cancelled) return;
      if (landing.ok) {
        setSignedIn(true);
        router.replace(landing.value.destination);
        return;
      }
      // 401 is the expected case here — no session, so show the form.
      setCheckingSession(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [next, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFailure(null);

    const problems: Record<string, string> = {};
    if (!email.trim()) problems.email = "Enter your email address.";
    if (password === "") problems.password = "Enter your password.";
    setFieldErrors(problems);
    if (Object.keys(problems).length > 0) return;

    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setBusy(false);
      setFailure(classifyAuthError(error));
      return;
    }

    // Signed in. Where to is the server's decision, not this component's.
    const landing = await fetchLanding(next);
    setBusy(false);

    if (!landing.ok) {
      // The credentials were right but the session did not survive the round
      // trip. Say so plainly rather than redirecting into a page that will
      // bounce straight back here.
      setFailure({
        kind: "unknown",
        title: "Signed in, but your session did not stick",
        body: "This can happen if cookies are blocked. Enable cookies for this site and try again.",
      });
      return;
    }

    setSignedIn(true);
    router.replace(landing.value.destination);
    router.refresh();
  }

  if (checkingSession) {
    return (
      <LoadingState label="Checking your session">
        <CardSkeleton lines={3} />
      </LoadingState>
    );
  }

  if (signedIn) {
    return (
      <SuccessState title="Signed in" body="Taking you to your Couranr workspace…" />
    );
  }

  return (
    <form className="cr-auth-form" onSubmit={onSubmit} noValidate>
      <Stack gap={6}>
        {failure ? <ErrorState title={failure.title} body={failure.body} /> : null}

        {failure?.kind === "email_not_confirmed" ? (
          <Alert tone="warning" title="Waiting on your confirmation email">
            If it never arrived, sign up again with the same address to have
            Couranr resend it.
          </Alert>
        ) : null}

        <Stack gap={4}>
          <Field label="Email" required error={fieldErrors.email}>
            {(p) => (
              <Input
                {...p}
                type="email"
                autoComplete="email"
                placeholder="you@business.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <Field label="Password" required error={fieldErrors.password}>
            {(p) => (
              <Input
                {...p}
                type="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
        </Stack>

        <Button variant="primary" type="submit" loading={busy} block>
          Sign in
        </Button>

        <Text size="sm" muted className="cr-auth-form__support">
          New to Couranr? <Link href="/sign-up">Set up your business</Link>.
        </Text>
      </Stack>
    </form>
  );
}
