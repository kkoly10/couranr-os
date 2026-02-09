import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-zinc-200 bg-white">
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-sm font-semibold text-zinc-900">Couranr OS</div>
            <p className="mt-2 text-sm leading-relaxed text-zinc-600">
              Unified platform powering Couranr Auto Rentals and Couranr Courier delivery operations.
            </p>
          </div>

          <div>
            <div className="text-sm font-semibold text-zinc-900">Services</div>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link className="text-zinc-600 hover:text-zinc-900" href="/auto">
                  Auto Rentals
                </Link>
              </li>
              <li>
                <Link className="text-zinc-600 hover:text-zinc-900" href="/courier">
                  Courier Delivery
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <div className="text-sm font-semibold text-zinc-900">Portals</div>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link className="text-zinc-600 hover:text-zinc-900" href="/dashboard/home">
                  Customer Dashboard
                </Link>
              </li>
              <li>
                <Link className="text-zinc-600 hover:text-zinc-900" href="/admin">
                  Admin
                </Link>
              </li>
              <li>
                <Link className="text-zinc-600 hover:text-zinc-900" href="/driver">
                  Driver
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <div className="text-sm font-semibold text-zinc-900">Legal</div>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link className="text-zinc-600 hover:text-zinc-900" href="/privacy">
                  Privacy
                </Link>
              </li>
              <li>
                <Link className="text-zinc-600 hover:text-zinc-900" href="/terms">
                  Terms
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-zinc-200 pt-6 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Couranr. All rights reserved.</p>
          <p className="text-zinc-500">Built with Next.js + Tailwind.</p>
        </div>
      </div>
    </footer>
  );
}