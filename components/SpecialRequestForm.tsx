"use client";

import { useState } from "react";

export default function SpecialRequestForm() {
  const [name, setName] = useState("");
  const [contact, setContact] = useState(""); // phone or email
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(null);

    if (!name || !contact || !message) {
      setError("Please fill name, contact (phone/email), and message.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/special-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, contact, message })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to submit request.");

      setDone("Request received. We’ll get back to you shortly.");
      setName("");
      setContact("");
      setMessage("");
    } catch (err: any) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <h3 style={{ marginBottom: 12 }}>Send a request</h3>

      <label>Your name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} />

      <div style={{ height: 12 }} />

      <label>Phone or email</label>
      <input value={contact} onChange={(e) => setContact(e.target.value)} />

      <div style={{ height: 12 }} />

      <label>What do you need delivered / prepared?</label>
      <textarea
        rows={5}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />

      {error && <p style={{ color: "#dc2626", marginTop: 10 }}>{error}</p>}
      {done && <p style={{ color: "#16a34a", marginTop: 10 }}>{done}</p>}

      <button
        className="btn btn-primary"
        style={{ width: "100%", marginTop: 12 }}
        disabled={loading}
        type="submit"
      >
        {loading ? "Sending…" : "Submit request"}
      </button>

      <p style={{ marginTop: 10, fontSize: 12, color: "var(--muted)" }}>
        For urgent or high-value items, include timeline, size/weight, and pickup/drop-off addresses.
      </p>
    </form>
  );
}
