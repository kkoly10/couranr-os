import Link from "next/link";

export default function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-zinc-200/70 bg-white/70 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-zinc-950 text-sm font-semibold text-white">
            C
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-zinc-950">Couranr OS</div>
            <div className="text-xs text-zinc-500">Auto • Courier</div>
          </div>
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          <Link className="text-sm font-medium text-zinc-700 hover:text-zinc-950" href="/auto">
            Auto
          </Link>
          <Link className="text-sm font-medium text-zinc-700 hover:text-zinc-950" href="/courier">
            Courier
          </Link>
          <Link
            className="text-sm font-medium text-zinc-700 hover:text-zinc-950"
            href="/dashboard/home"
          >
            Dashboard
          </Link>
          <Link className="text-sm font-medium text-zinc-700 hover:text-zinc-950" href="/admin">
            Admin
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="hidden rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50 sm:inline-flex"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="inline-flex rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            Sign up
          </Link>
        </div>
      </div>
    </header>
  );
}