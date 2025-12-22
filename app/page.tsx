import Link from "next/link";

export default function HomePage() {
  return (
    <>
      {/* Header */}
      <header className="header">
        <div className="container header-inner">
          <Link href="/" className="logo">
            Couranr<span className="logo-dot">.</span>
          </Link>

          <nav className="nav">
            <div className="nav-services">
              <a href="#courier">Courier</a>
              <a href="#rentals">Rentals</a>
              <a href="#pack-ship">Pack & Ship</a>
              <a href="#documents">Documents</a>
              <a href="#detailing">Detailing</a>
            </div>

            <Link href="/login" className="nav-account">
              Login / Account
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="hero">
        <div className="container">
          <h1>
            One platform.<br />
            Multiple services.
          </h1>
          <p>
            Couranr brings delivery, rentals, document services, packing, and
            detailing together in one professional system. One account. Clear
            pricing. Full transparency.
          </p>
        </div>
      </section>

      {/* Courier */}
      <section id="courier" className="section alt">
        <div className="container">
          <h2>Courier Services</h2>
          <p>
            On-demand, hub-based delivery with distance pricing, photo
            documentation, and optional signature confirmation.
          </p>

          <div className="services">
            <div className="card">
              <h3>Local & Regional</h3>
              <p>
                Starting at a base rate. Final pricing depends on distance,
                weight, and urgency. Exact price shown before checkout.
              </p>
              <Link href="/login">
                <button>Create Delivery</button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Rentals */}
      <section id="rentals" className="section">
        <div className="container">
          <h2>Vehicle Rentals</h2>
          <p>
            Daily vehicle rentals with reservation fees, insurance
            requirements, and documented vehicle condition at pickup and
            return.
          </p>

          <div className="services">
            <div className="card">
              <h3>Daily Rentals</h3>
              <p>
                Rates vary by vehicle. Reservation fee applies and is credited
                toward the rental.
              </p>
              <Link href="/login">
                <button>Reserve Vehicle</button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Pack & Ship */}
      <section id="pack-ship" className="section alt">
        <div className="container">
          <h2>Pack & Ship</h2>
          <p>
            Prepare shipments in advance by ordering boxes and supplies online,
            then pick up or drop off at our storefront.
          </p>

          <div className="services">
            <div className="card">
              <h3>Pre-Order Supplies</h3>
              <p>
                Service fees start at a flat rate. Shipping costs vary by
                carrier and weight.
              </p>
              <Link href="/login">
                <button>Prepare Shipment</button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Documents */}
      <section id="documents" className="section">
        <div className="container">
          <h2>Document Services</h2>
          <p>
            Upload documents online for secure processing and in-store pickup.
            Government fees not included.
          </p>

          <div className="services">
            <div className="card">
              <h3>Assistance Requests</h3>
              <p>
                Flat assistance fees per request. Upload PDFs or images
                directly.
              </p>
              <Link href="/login">
                <button>Upload Documents</button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Detailing */}
      <section id="detailing" className="section alt">
        <div className="container">
          <h2>Auto Detailing</h2>
          <p>
            Appointment-only light detailing services performed at our
            professional facility.
          </p>

          <div className="services">
            <div className="card">
              <h3>By Appointment</h3>
              <p>
                Pricing confirmed in-store. Appointments available on a rolling
                7-day window.
              </p>
              <Link href="/login">
                <button>Book Appointment</button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="footer">
        <div className="container">
          <p>
            © {new Date().getFullYear()} Couranr. All services require an
            account. Pricing varies by location and service details.
          </p>
        </div>
      </footer>
    </>
  );
}
