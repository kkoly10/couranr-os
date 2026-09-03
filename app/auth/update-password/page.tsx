"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { CouranrLogo } from "@/components/brand/CouranrLogo";

/**
 * Set-a-new-password page for the recovery flow.
 *
 * The password-reset email links to /auth/confirm?type=recovery&next=/auth/update-password.
 * That route calls verifyOtp server-side (cross-browser: works wherever the link
 * is opened) and establishes a session, then redirects here. This page requires
 * that session, then calls updateUser to set the new password.
 */
export default function UpdatePasswordPage() {
  const [status, setStatus] = useState<"checking" | "ready" | "expired">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data, error }) => {
      if (!active) return;
      setStatus(data?.user && !error ? "ready" : "expired");
    });
    return () => {
      active = false;
    };
  }, []);

  const handleSave = async () => {
    setError(null);
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setSaving(false);
      return;
    }
    window.location.assign("/app/business");
  };

  return (
    <main className="authWrap">
      <div className="bgGlow" aria-hidden="true" />
      <div className="authCard">
        <div className="authTop">
          <Link className="brandRow" href="/" aria-label="Couranr home">
            <CouranrLogo variant="primary" width={140} priority />
          </Link>
          <Link className="btn btnGhost" href="/login">
            Sign in
          </Link>
        </div>

        <h1 className="authTitle">Set a new password</h1>

        {status === "checking" && <p className="authSub">Checking your link…</p>}

        {status === "expired" && (
          <>
            <p className="authSub">
              This reset link has expired or was already used. Request a new one from the sign-in page.
            </p>
            <div style={{ marginTop: 14 }}>
              <Link href="/login" className="btn btnPrimary">
                Back to sign in
              </Link>
            </div>
          </>
        )}

        {status === "ready" && (
          <>
            <p className="authSub">Choose a new password for your Couranr account.</p>

            <div className="field">
              <div className="label">New password</div>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </div>

            <div className="field">
              <div className="label">Confirm new password</div>
              <input
                className="input"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </div>

            {error && <div className="noticeErr">{error}</div>}

            <div style={{ marginTop: 14 }}>
              <button onClick={handleSave} disabled={saving} className="btn btnPrimary">
                {saving ? "Saving…" : "Save new password"}
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
