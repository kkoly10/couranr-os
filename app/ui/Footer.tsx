import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-white/10 bg-zinc-950">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="text-sm font-semibold text-white">Couranr</div>
          <p className="mt-2 text-sm text-white/65">
            Unified platform powering Couranr Auto Rentals and Courier Delivery.
          </p>
          <p className="mt-4 text-xs text-white/45">© {new Date().getFullYear()} Couranr.</p>
        </div>

        <div>
          <div className="text-sm font-semibold text-white">Services</div>
          <div className="mt-3 flex flex-col gap-2 text-sm">
            <Link className="text-white/65 hover:text-white" href="/auto">Auto Rentals</Link>
            <Link className="text-white/65 hover:text-white" href="/courier">Courier Delivery</Link>
          </div>
        </div>

        <div>
          <div className="text-sm font-semibold text-white">Portals</div>
          <div className="mt-3 flex flex-col gap-2 text-sm">
            <Link className="text-white/65 hover:text-white" href="/dashboard">Customer Dashboard</Link>
            <Link className="text-white/65 hover:text-white" href="/driver">Driver</Link>
            <Link className="text-white/65 hover:text-white" href="/admin">Admin</Link>
          </div>
          <p className="mt-3 text-xs text-white/45">
            Dashboards require login.
          </p>
        </div>

        <div>
          <div className="text-sm font-semibold text-white">Legal</div>
          <div className="mt-3 flex flex-col gap-2 text-sm">
            <Link className="text-white/65 hover:text-white" href="/privacy">Privacy</Link>
            <Link className="text-white/65 hover:text-white" href="/terms">Terms</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}