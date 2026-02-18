"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: "error" | "success"; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setLoading(false);

    if (error) {
      setMsg({ type: "error", text: error.message });
      return;
    }

    // Important: refresh so server layout re-renders and hides PublicHeader if needed
    router.push(next);
    router.refresh();
  }

  return (
    <div className="pageShell">
      <div className="pageGlow" aria-hidden="true" />
      <div className="cContainer centerWrap">
        <div className="authCard">
          <h1 className="authTitle">Sign in</h1>
          <p className="authSub">
            Access your portal to manage rentals and deliveries.
          </p>

          {msg && (
            <div className={`noticeBox ${msg.type === "error" ? "error" : "success"}`}>
              {msg.text}
            </div>
          )}

          <form className="formGrid" onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>

            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password"
                required
              />
            </div>

            <div className="formRow">
              <button className="btn btnGold" type="submit" disabled={loading}>
                {loading ? "Signing in..." : "Sign in"}
              </button>

              <Link className="btn btnGhost" href={`/signup?next=${encodeURIComponent(next)}`}>
                Create account
              </Link>
            </div>
          </form>

          <p className="helperLine">
            Having trouble? Email{" "}
            <a href="mailto:couranr@couranrauto.com" style={{ fontWeight: 900 }}>
              couranr@couranrauto.com
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}