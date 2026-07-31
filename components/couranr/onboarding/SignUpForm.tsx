"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Stack,
  Text,
} from "@/components/couranr/primitives";
import { Field, Input } from "@/components/couranr/forms";
import { ErrorState, SuccessState } from "@/components/couranr/states";

/**
 * PUB-003 — business sign up.
 *
 * Creates the SIGN-IN only. The workspace is created on the next screen
 * (MER-002), because a merchant who abandons onboarding should still be able
 * to sign back in and finish rather than being locked out of a half-made
 * account.
 *
 * No business details are collected here, and nothing about pricing, hours,
 * markets or payment appears — those are Decision Registry concerns.
 */
export function SignUpForm() {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldError, setFieldError] = React.useState<Record<string, string>>({});
  const [checkEmail, setCheckEmail] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldError({});

    const problems: Record<string, string> = {};
    if (!email.trim()) problems.email = "Enter your work email address.";
    // Supabase enforces its own minimum; this is only to fail fast in the UI.
    if (password.length < 8) problems.password = "Use at least 8 characters.";
    if (Object.keys(problems).length > 0) {
      setFieldError(problems);
      return;
    }

    setBusy(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });
    setBusy(false);

    if (signUpError) {
      // Supabase auth messages are user-facing by design and carry no schema
      // detail, unlike a PostgREST error.
      setError(signUpError.message);
      return;
    }

    if (data.session) {
      // Confirmation is off, or this address was already confirmed: Supabase
      // returned a live session, so go straight on.
      router.push("/business/onboarding");
      router.refresh();
      return;
    }
    // No session. That means confirmation is required for this project — which
    // is a runtime property of the Supabase Auth configuration, not something
    // this code should assert. Branch on what was actually returned.
    setCheckEmail(true);
  }

  if (checkEmail) {
    return (
      <SuccessState
        title="Check your email"
        body="Couranr sent a confirmation link to that address. Open it, then sign in to finish setting up your business."
        action={{ label: "Go to sign in", href: "/sign-in" }}
      />
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Stack gap={6}>
        {error ? <ErrorState title="Sign up did not complete" body={error} /> : null}

        <Card>
          <CardHeader
            title="Create your Couranr sign-in"
            description="One more short step after this and you can send your first delivery."
          />
          <Stack gap={3}>
            <Field label="Work email" required error={fieldError.email}>
              {(p) => (
                <Input
                  {...p}
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
            </Field>
            <Field label="Password" required error={fieldError.password}>
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Field>
          </Stack>
        </Card>

        <Alert tone="info" title="No payment details needed">
          Couranr does not ask for a card to create an account.
        </Alert>

        <Button variant="primary" type="submit" loading={busy} block>
          Create account
        </Button>

        <Text size="sm" muted>
          Already have a Couranr account? <Link href="/sign-in">Sign in</Link>.
        </Text>
      </Stack>
    </form>
  );
}
