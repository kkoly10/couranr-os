import Link from "next/link";

export default function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur">
      <div className="mx-auto max-w-6xl px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          {/* Brand */}
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--primary)] text-[var(--primary-contrast)] font-semibold">
              C
            </span>
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-tight">Couranr</div>
              <div className="text-xs text-[var(--muted)]">
                Premium Auto Rentals
              </div>
            </div>
          </Link>

          {/* Nav */}
          <nav className="hidden items-center gap-6 md:flex">
            <Link
              href="/auto"
              className="text-sm font-medium text-[var(--text)] hover:opacity-80"
            >
              Auto
            </Link>
            <Link
              href="/courier"
              className="flex items-center gap-2 text-sm font-medium text-[var(--text)] hover:opacity-80"
            >
              Courier
              <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[10px] text-[var(--muted)]">
                Coming soon
              </span>
            </Link>
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-xl px-3 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface)]"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-xl bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)] hover:opacity-90"
            >
              Sign up
            </Link>
          </div>
        </div>

        {/* Mobile quick links */}
        <div className="mt-3 flex items-center gap-2 md:hidden">
          <Link
            href="/auto"
            className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-center text-sm font-medium"
          >
            Auto
          </Link>
          <Link
            href="/courier"
            className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-center text-sm font-medium"
          >
            Courier
          </Link>
        </div>
      </div>
    </header>
  );
}