import Link from "next/link";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="text-xl font-semibold">{value}</div>
      <div className="mt-1 text-sm text-[var(--muted)]">{label}</div>
    </div>
  );
}

function Feature({
  title,
  desc,
}: {
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
      <div className="text-base font-semibold">{title}</div>
      <p className="mt-2 text-sm text-[var(--muted)]">{desc}</p>
    </div>
  );
}

export default function HomePage() {
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        {/* Premium background */}
        <div className="absolute inset-0">
          <div className="h-full w-full bg-[var(--bg)]" />
          <div className="absolute -top-24 right-[-10%] h-80 w-80 rounded-full bg-[var(--accent)]/20 blur-3xl" />
          <div className="absolute -bottom-24 left-[-10%] h-80 w-80 rounded-full bg-[var(--primary)]/15 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-6xl px-4 py-14 md:py-20">
          <div className="grid items-center gap-10 md:grid-cols-2">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs text-[var(--muted)]">
                <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
                Premium rentals • Fast pickup • Trusted support
              </div>

              <h1 className="mt-4 text-4xl font-semibold tracking-tight md:text-5xl">
                Premium Auto Rentals,
                <span className="text-[var(--primary)]"> built for real life.</span>
              </h1>

              <p className="mt-4 max-w-xl text-base text-[var(--muted)] md:text-lg">
                Book quickly, verify securely, and hit the road with confidence.
                Courier + Docs are coming soon — built into the same Couranr platform.
              </p>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/auto/available"
                  className="inline-flex items-center justify-center rounded-2xl bg-[var(--primary)] px-5 py-3 text-sm font-semibold text-[var(--primary-contrast)] hover:opacity-90"
                >
                  View available cars
                </Link>
                <Link
                  href="/auto"
                  className="inline-flex items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-3 text-sm font-semibold text-[var(--text)] hover:bg-[var(--surface-2)]"
                >
                  How it works
                </Link>
              </div>

              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                <Stat label="Quick verification flow" value="Minutes" />
                <Stat label="Transparent pricing" value="Clear" />
                <Stat label="Support-first operations" value="Trusted" />
              </div>
            </div>

            {/* Visual card (no images needed yet) */}
            <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">Couranr Auto</div>
                  <div className="text-xs text-[var(--muted)]">
                    Premium rentals • Local-first
                  </div>
                </div>
                <div className="rounded-full bg-[var(--accent)] px-3 py-1 text-xs font-semibold text-[var(--accent-contrast)]">
                  Ready now
                </div>
              </div>

              <div className="mt-6 grid gap-3">
                <div className="rounded-2xl bg-[var(--surface-2)] p-4">
                  <div className="text-sm font-semibold">1) Choose your vehicle</div>
                  <div className="mt-1 text-sm text-[var(--muted)]">
                    Browse availability and confirm pickup details.
                  </div>
                </div>
                <div className="rounded-2xl bg-[var(--surface-2)] p-4">
                  <div className="text-sm font-semibold">2) Verify & sign</div>
                  <div className="mt-1 text-sm text-[var(--muted)]">
                    ID verification, agreement signing, and payment in one flow.
                  </div>
                </div>
                <div className="rounded-2xl bg-[var(--surface-2)] p-4">
                  <div className="text-sm font-semibold">3) Pickup & go</div>
                  <div className="mt-1 text-sm text-[var(--muted)]">
                    Fast handoff with condition photos for clarity.
                  </div>
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-[var(--border)] bg-white p-4">
                <div className="text-xs text-[var(--muted)]">Coming soon</div>
                <div className="mt-1 text-sm font-semibold">Courier + Docs</div>
                <div className="mt-1 text-sm text-[var(--muted)]">
                  Delivery workflows will be integrated — but Auto stays the priority.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust / value */}
      <section className="mx-auto max-w-6xl px-4 py-12 md:py-16">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              Built for trust, not just bookings
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
              A premium rental experience depends on clarity: verification, agreements,
              condition photos, and straightforward policies.
            </p>
          </div>
          <Link
            href="/auto/agreement"
            className="inline-flex items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold hover:bg-[var(--surface-2)]"
          >
            View rental agreement
          </Link>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <Feature
            title="Premium feel, real protections"
            desc="Clear policies, condition photos, and verified identities — designed to reduce disputes and keep rentals smooth."
          />
          <Feature
            title="Operations-ready platform"
            desc="Customer dashboards, admin review flows, and driver workflows — built as you scale."
          />
          <Feature
            title="Courier is staged correctly"
            desc="Delivery is coming soon, but it won’t dilute the rental experience. Auto stays front and center."
          />
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-16">
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--primary)] p-8 text-[var(--primary-contrast)] md:p-10">
          <div className="grid gap-6 md:grid-cols-2 md:items-center">
            <div>
              <h3 className="text-2xl font-semibold tracking-tight">
                Ready to rent with Couranr?
              </h3>
              <p className="mt-2 text-sm text-white/80">
                Browse availability and start your rental in minutes.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
              <Link
                href="/auto/available"
                className="inline-flex items-center justify-center rounded-2xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--accent-contrast)] hover:opacity-90"
              >
                View available cars
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10"
              >
                Log in
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}