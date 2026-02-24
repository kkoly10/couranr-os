"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ServiceKey =
  | "printing_delivery"
  | "data_entry"
  | "dmv_doc_help"
  | "resume_typing"
  | "immigration_prep_help"
  | "general_typing";

const SERVICES: {
  key: ServiceKey;
  label: string;
  desc: string;
}[] = [
  {
    key: "printing_delivery",
    label: "Printing + Delivery",
    desc: "Upload files, choose print options, and we print/deliver locally.",
  },
  {
    key: "data_entry",
    label: "Business Data Entry Help",
    desc: "Clerical support for backlogs (typing, transferring, organizing records).",
  },
  {
    key: "dmv_doc_help",
    label: "DMV Document Prep Help",
    desc: "Administrative support for document readiness and checklist review.",
  },
  {
    key: "resume_typing",
    label: "Resume Review + Typing",
    desc: "Formatting, cleanup, and typing support (not job placement).",
  },
  {
    key: "immigration_prep_help",
    label: "Immigration Document Assistance",
    desc: "Administrative prep support only (no legal advice).",
  },
  {
    key: "general_typing",
    label: "General Typing / Document Help",
    desc: "Typing, editing, formatting, and basic document organization.",
  },
];

export default function DocsRequestPage() {
  const router = useRouter();

  const [authLoading, setAuthLoading] = useState(true);
  const [isAuthed, setIsAuthed] = useState(false);

  const [serviceType, setServiceType] = useState<ServiceKey>("printing_delivery");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [city, setCity] = useState("");
  const [rush, setRush] = useState(false);

  // Printing-specific
  const [pages, setPages] = useState<number | "">("");
  const [copies, setCopies] = useState<number | "">(1);
  const [color, setColor] = useState(false);
  const [doubleSided, setDoubleSided] = useState(false);
  const [deliveryNeeded, setDeliveryNeeded] = useState(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeService = useMemo(
    () => SERVICES.find((s) => s.key === serviceType),
    [serviceType]
  );

  useEffect(() => {
    let mounted = true;

    async function boot() {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;

      const authed = !!data.session;
      setIsAuthed(authed);
      setAuthLoading(false);

      if (!authed) {
        const next = "/docs/request";
        router.push(`/login?next=${encodeURIComponent(next)}`);
      }
    }

    boot();

    return () => {
      mounted = false;
    };
  }, [router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Please enter a short request title.");
      return;
    }

    if (!notes.trim()) {
      setError("Please describe what you need.");
      return;
    }

    if (serviceType === "printing_delivery") {
      const p = Number(pages || 0);
      const c = Number(copies || 0);

      if (!Number.isFinite(p) || p <= 0) {
        setError("Please enter the estimated number of pages.");
        return;
      }

      if (!Number.isFinite(c) || c <= 0) {
        setError("Please enter the number of copies.");
        return;
      }
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    const token = session?.access_token;
    if (!token) {
      setError("Please log in again.");
      return;
    }

    setLoading(true);

    try {
      const payload = {
        // send multiple aliases so older/newer API versions both work
        serviceType,
        requestType: serviceType,
        category: serviceType,

        title: title.trim(),
        requestTitle: title.trim(),

        notes: notes.trim(),
        description: notes.trim(),

        contactPhone: contactPhone.trim() || null,
        city: city.trim() || null,
        rush,

        printing: serviceType === "printing_delivery"
          ? {
              pages: Number(pages || 0),
              copies: Number(copies || 1),
              color,
              doubleSided,
              deliveryNeeded,
            }
          : null,

        intake: {
          serviceType,
          serviceLabel: activeService?.label ?? serviceType,
          contactPhone: contactPhone.trim() || null,
          city: city.trim() || null,
          rush,
          printing:
            serviceType === "printing_delivery"
              ? {
                  pages: Number(pages || 0),
                  copies: Number(copies || 1),
                  color,
                  doubleSided,
                  deliveryNeeded,
                }
              : null,
        },
      };

      const res = await fetch("/api/docs/create-request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || "Failed to create request");
      }

      const requestId =
        data?.requestId ||
        data?.id ||
        data?.request?.id ||
        data?.docsRequest?.id ||
        null;

      // Best UX: go to detail page if it exists, otherwise dashboard docs
      if (requestId) {
        router.push(`/dashboard/docs/${requestId}`);
      } else {
        router.push("/dashboard/docs");
      }
    } catch (err: any) {
      setError(err?.message || "Unable to create request");
    } finally {
      setLoading(false);
    }
  }

  if (authLoading) {
    return (
      <main className="page">
        <div className="cContainer">
          <p>Loading…</p>
        </div>
      </main>
    );
  }

  if (!isAuthed) {
    return (
      <main className="page">
        <div className="cContainer">
          <p>Redirecting to login…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="bgGlow" aria-hidden="true" />

      <div className="cContainer" style={{ maxWidth: 980 }}>
        <div className="pageHeader">
          <div>
            <h1 className="pageTitle">New Docs Request</h1>
            <p className="pageSub">
              Submit a request for printing, document prep help, typing, or admin support.
            </p>
          </div>
        </div>

        <div className="notice" style={{ marginBottom: 14 }}>
          <strong>Important:</strong> Couranr Docs provides clerical/administrative assistance only.
          We do <strong>not</strong> provide legal advice and are not affiliated with the DMV or USCIS.
        </div>

        <form onSubmit={handleSubmit} className="card">
          <div className="field" style={{ marginBottom: 12 }}>
            <label className="fieldLabel">Service type</label>
            <select
              className="fieldInput"
              value={serviceType}
              onChange={(e) => setServiceType(e.target.value as ServiceKey)}
            >
              {SERVICES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
            <p className="finePrint" style={{ marginTop: 6 }}>
              {activeService?.desc}
            </p>
          </div>

          <div className="formGrid">
            <div className="field">
              <label className="fieldLabel">Request title</label>
              <input
                className="fieldInput"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Example: Print packet + deliver to Stafford"
              />
            </div>

            <div className="field">
              <label className="fieldLabel">Contact phone (optional)</label>
              <input
                className="fieldInput"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="(540) 555-1234"
              />
            </div>
          </div>

          <div className="formGrid" style={{ marginTop: 12 }}>
            <div className="field">
              <label className="fieldLabel">City / Area (optional)</label>
              <input
                className="fieldInput"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Stafford / Fredericksburg / etc."
              />
            </div>

            <div className="field">
              <label className="fieldLabel">Priority</label>
              <div className="check" style={{ height: 44 }}>
                <input
                  type="checkbox"
                  checked={rush}
                  onChange={() => setRush((v) => !v)}
                  id="docs-rush"
                />
                <label htmlFor="docs-rush" style={{ cursor: "pointer" }}>
                  Rush request (faster handling if available)
                </label>
              </div>
            </div>
          </div>

          {serviceType === "printing_delivery" && (
            <div
              style={{
                marginTop: 14,
                border: "1px solid var(--border)",
                borderRadius: 16,
                padding: 14,
                background: "rgba(255,255,255,0.65)",
              }}
            >
              <h3 style={{ margin: "0 0 10px 0" }}>Printing details</h3>

              <div className="formGrid">
                <div className="field">
                  <label className="fieldLabel">Estimated pages</label>
                  <input
                    className="fieldInput"
                    type="number"
                    min={1}
                    value={pages}
                    onChange={(e) =>
                      setPages(e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder="10"
                  />
                </div>

                <div className="field">
                  <label className="fieldLabel">Copies</label>
                  <input
                    className="fieldInput"
                    type="number"
                    min={1}
                    value={copies}
                    onChange={(e) =>
                      setCopies(e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder="1"
                  />
                </div>
              </div>

              <div className="checkRow">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={color}
                    onChange={() => setColor((v) => !v)}
                  />
                  Color print
                </label>

                <label className="check">
                  <input
                    type="checkbox"
                    checked={doubleSided}
                    onChange={() => setDoubleSided((v) => !v)}
                  />
                  Double-sided
                </label>

                <label className="check">
                  <input
                    type="checkbox"
                    checked={deliveryNeeded}
                    onChange={() => setDeliveryNeeded((v) => !v)}
                  />
                  Delivery needed
                </label>
              </div>
            </div>
          )}

          <div className="field" style={{ marginTop: 14 }}>
            <label className="fieldLabel">Describe what you need</label>
            <textarea
              className="fieldInput"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Describe the documents, what you need typed/organized, any deadlines, and any special instructions."
              style={{
                height: 130,
                paddingTop: 10,
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />
          </div>

          {error && <div className="errorText">{error}</div>}

          <div className="dashActions" style={{ marginTop: 14 }}>
            <button type="submit" className="btn btnGold" disabled={loading}>
              {loading ? "Creating request…" : "Create request"}
            </button>

            <button
              type="button"
              className="btn btnGhost"
              onClick={() => router.push("/dashboard/docs")}
              disabled={loading}
            >
              Back to Docs Dashboard
            </button>

            <button
              type="button"
              className="btn btnGhost"
              onClick={() => router.push("/docs/pricing")}
              disabled={loading}
            >
              View pricing
            </button>
          </div>

          <p className="finePrint">
            After creating the request, you can track status in your Docs dashboard and upload files
            (if required) from the request detail page.
          </p>
        </form>
      </div>
    </main>
  );
}