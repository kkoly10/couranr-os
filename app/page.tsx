import Link from "next/link";

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/80">
      {children}
    </span>
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
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
      <div className="mb-3 text-sm text-white/70">{title}</div>
      <div className="text-white/90">{desc}</div>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="relative overflow-hidden">
      {/* Background glows */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-fuchsia-500/20 blur-3xl" />
        <div className="absolute top-24 right-[-160px] h-[420px] w-[420px] rounded-full bg-cyan-400/15 blur-3xl" />
        <div className="absolute bottom-[-200px] left-[-160px] h-[520px] w-[520px] rounded-full bg-emerald-400/10 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-6xl px-6 py-16 sm:py-20">
        {/* Top chips */}
        <div className="flex flex-wrap gap-2">
          <Chip>Couranr Auto</Chip>
          <Chip>Couranr Courier</Chip>
          <Chip>Unified OS</Chip>
          <Chip>Stafford • Fredericksburg • DMV</Chip>
        </div>

        {/* Hero */}
        <div className="mt-8 grid gap-10 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-7">
            <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
              One platform to run{" "}
              <span className="bg-gradient-to-r from-fuchsia-400 via-cyan-300 to-emerald-300 bg-clip-text text-transparent">
                rentals + deliveries
              </span>{" "}
              with confidence.
            </h1>

            <p className="mt-5 max-w-xl text-pretty text-lg text-white/70">
              Couranr OS powers Auto Rentals and Courier Delivery under one roof:
              customer checkout, verification, payments, ops dashboards, and admin tools.
              Built to scale locally — fast.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/auto"
                className="inline-flex items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-semibold text-zinc-950 shadow-lg shadow-white/10 hover:bg-white/90"
              >
                Explore Auto Rentals
              </Link>
              <Link
                href="/courier"
                className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10"
              >
                Get a Courier Quote
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-transparent px-5 py-3 text-sm font-semibold text-white/80 hover:bg-white/5"
              >
                Log in
              </Link>
            </div>

            {/* Quick stats */}
            <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                ["Secure Checkout", "Stripe-ready"],
                ["Verification", "ID + files"],
                ["Ops Dashboards", "Customer/Admin/Driver"],
                ["Automations", "Notifications + logs"],
              ].map(([k, v]) => (
                <div
                  key={k}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4"
                >
                  <div className="text-sm font-semibold text-white">{k}</div>
                  <div className="mt-1 text-xs text-white/65">{v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Hero “product card” */}
          <div className="lg:col-span-5">
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 shadow-2xl shadow-black/50">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-white">Live Operations Preview</div>
                <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs text-emerald-200">
                  Online
                </span>
              </div>

              <div className="mt-5 space-y-3">
                <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="text-xs text-white/60">Auto Rentals</div>
                  <div className="mt-1 text-sm text-white/90">
                    Book • Verify • Sign agreement • Pay
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="text-xs text-white/60">Courier Delivery</div>
                  <div className="mt-1 text-sm text-white/90">
                    Quote • Checkout • Assign driver • Track status
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="text-xs text-white/60">Admin Console</div>
                  <div className="mt-1 text-sm text-white/90">
                    Approvals • Deposits • Evidence bundles • Refunds
                  </div>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-3">
                <Link
                  href="/dashboard"
                  className="rounded-xl border border-white/12 bg-white/5 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-white/10"
                >
                  Customer Dashboard
                </Link>
                <Link
                  href="/admin"
                  className="rounded-xl border border-white/12 bg-white/5 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-white/10"
                >
                  Admin Portal
                </Link>
              </div>

              <p className="mt-4 text-xs text-white/55">
                Note: Dashboards require login.
              </p>
            </div>
          </div>
        </div>

        {/* Features grid */}
        <div className="mt-16">
          <div className="flex items-end justify-between gap-6">
            <div>
              <div className="text-sm text-white/60">Why this feels premium</div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                Built like a real operations product.
              </h2>
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Feature
              title="Clean customer flow"
              desc="Fast checkout, clear next steps, and self-serve dashboards."
            />
            <Feature
              title="Operator-grade admin"
              desc="Approve rentals, handle deposits, manage disputes and refunds."
            />
            <Feature
              title="Driver experience"
              desc="Assignments, proof-of-pickup, and delivery status updates."
            />
            <Feature
              title="Risk controls"
              desc="Verification uploads, evidence bundles, and audit-friendly logs."
            />
            <Feature
              title="Payments ready"
              desc="Stripe flows designed for real-world operations."
            />
            <Feature
              title="Designed to scale"
              desc="Add Docs and new services without redesigning everything."
            />
          </div>
        </div>

        {/* CTA */}
        <div className="mt-16 rounded-3xl border border-white/10 bg-gradient-to-r from-white/[0.06] to-white/[0.02] p-8">
          <div className="grid gap-6 lg:grid-cols-12 lg:items-center">
            <div className="lg:col-span-8">
              <h3 className="text-xl font-semibold">
                Ready to use Couranr today?
              </h3>
              <p className="mt-2 text-white/70">
                Start with Auto or Courier. Add Docs when you’re ready.
              </p>
            </div>
            <div className="lg:col-span-4 lg:flex lg:justify-end">
              <Link
                href="/signup"
                className="inline-flex w-full items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-semibold text-zinc-950 hover:bg-white/90 lg:w-auto"
              >
                Create an account
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}