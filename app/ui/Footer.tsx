import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-[var(--border)] bg-[var(--surface)]">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="grid gap-8 md:grid-cols-4">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--primary)] text-[var(--primary-contrast)] font-semibold">
                C
              </span>
              <div>
                <div className="font-semibold">Couranr</div>
                <div className="text-sm text-[var(--muted)]">
                  Premium auto rentals today. Courier + Docs coming soon.
                </div>
              </div>
            </div>

            <div className="mt-4 text-sm text-[var(--muted)]">
              Built for speed, reliability, and customer trust — from booking to
              pickup to return.
            </div>
          </div>

          <div>
            <div className="text-sm font-semibold">Services</div>
            <ul className="mt-3 space-y-2 text-sm text-[var(--muted)]">
              <li>
                <Link className="hover:opacity-80" href="/auto">
                  Auto Rentals
                </Link>
              </li>
              <li>
                <Link className="hover:opacity-80" href="/courier">
                  Courier Delivery (Coming soon)
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <div className="text-sm font-semibold">Legal</div>
            <ul className="mt-3 space-y-2 text-sm text-[var(--muted)]">
              <li>
                <Link className="hover:opacity-80" href="/privacy">
                  Privacy
                </Link>
              </li>
              <li>
                <Link className="hover:opacity-80" href="/terms">
                  Terms
                </Link>
              </li>
              <li>
                <Link className="hover:opacity-80" href="/policy/delivery">
                  Delivery Policy
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-[var(--border)] pt-6 text-sm text-[var(--muted)] md:flex-row md:items-center md:justify-between">
          <div>© {new Date().getFullYear()} Couranr. All rights reserved.</div>
          <div className="flex gap-4">
            <Link className="hover:opacity-80" href="/login">
              Log in
            </Link>
            <Link className="hover:opacity-80" href="/signup">
              Sign up
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}