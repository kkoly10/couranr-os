import Link from "next/link";

export default function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="siteFooter">
      <div className="cContainer">
        <div className="footerInner">
          <div>
            © {year} Couranr •{" "}
            <a className="mutedLink" href="mailto:couranr@couranrauto.com">
              couranr@couranrauto.com
            </a>
          </div>

          {/* Semantic <nav> tag added, routing fixed to /portal */}
          <nav className="footerLinks" aria-label="Footer Navigation">
            <Link className="mutedLink" href="/terms">
              Terms
            </Link>
            <Link className="mutedLink" href="/privacy">
              Privacy
            </Link>
            <Link className="mutedLink" href="/portal">
              Customer portal
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
