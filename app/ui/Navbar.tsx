import Link from "next/link";

const NavLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <Link
    href={href}
    className="rounded-lg px-3 py-2 text-sm text-white/70 hover:bg-white/5 hover:text-white"
  >
    {children}
  </Link>
);

export default function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-zinc-950/70 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-sm font-semibold">
            C
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-white">Couranr OS</div>
            <div className="text-xs text-white/55">Auto • Courier • Docs</div>
          </div>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          <NavLink href="/auto">Auto</NavLink>
          <NavLink href="/courier">Courier</NavLink>
          <NavLink href="/policy/delivery">Policies</NavLink>
          <NavLink href="/terms">Terms</NavLink>
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="rounded-xl border border-white/12 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-white/90"
          >
            Sign up
          </Link>
        </div>
      </div>
    </header>
  );
}