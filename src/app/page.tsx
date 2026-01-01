"use client";

import { useEffect, useState } from "react";

type VesselEvent = {
  type: "ARRIVAL" | "DEPARTURE";
  timeISO: string;
  timeLabel: string;
  timeType: "ACTUAL" | "ESTIMATED";
  vesselName: string;
  service?: string;
  operator?: string;
  berth?: string;
  status?: string;
};


function formatDateTime(iso: string) {
  const d = new Date(iso);

  const date = `${d.getMonth() + 1}/${d.getDate()}/${String(
    d.getFullYear()
  ).slice(-2)}`;

  const time = d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  return `${date} • ${time}`;
}


export default function HomePage() {
  const [events, setEvents] = useState<VesselEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [window, setWindow] = useState<"1h" | "3h" | "24h">("1h");

  async function load(w: "1h" | "3h" | "24h" = window) {
    setLoading(true);
    try {
      setError(null);

      const resp = await fetch(`/api/next-events?window=${w}`, {
        cache: "no-store",
      });
      const data = await resp.json();

      if (!resp.ok) {
        setEvents([]);
        setError(data?.error || "Failed to load.");
        return;
      }

      setEvents(data?.events || []);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch {
      setEvents([]);
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(window);
    const id = setInterval(() => load(window), 60_000);
    return () => clearInterval(id);
  }, [window]);

  const windowLabel =
    window === "1h"
      ? "next hour"
      : window === "3h"
      ? "next 3 hours"
      : "next 24 hours";

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 880 }}>
      <h1 style={{ margin: 0 }}>Savannah Vessel Watch</h1>
      <p style={{ marginTop: 8, opacity: 0.75 }}>
        All arrivals or departures in the {windowLabel}. Refreshes every minute.
      </p>

      <div style={{ marginTop: 8, opacity: 0.6, fontSize: 14 }}>
        {lastUpdated ? `Last updated: ${lastUpdated}` : "Last updated: —"}
      </div>

      <div style={{ marginTop: 6, opacity: 0.6, fontSize: 14 }}>
        {events.length} total moves in the {windowLabel}.
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {(["1h", "3h", "24h"] as const).map((w) => (
          <button
            key={w}
            onClick={() => {
              if (w === window) {
                load(w); // re-fetch if user clicks the same button again
              } else {
                setWindow(w);
              }
            }}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: window === w ? "#111" : "#fff",
              color: window === w ? "#fff" : "#111",
              cursor: "pointer",
            }}
          >
            {w === "1h"
              ? "Next 1 hour"
              : w === "3h"
              ? "Next 3 hours"
              : "Next 24 hours"}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        {loading && <p>Loading...</p>}

        {!loading && error && (
          <p style={{ color: "crimson" }}>{error} Try refreshing the page.</p>
        )}

        {!loading && !error && events.length === 0 && (
          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 16,
              background: "#fafafa",
            }}
          >
            <strong>No moves in the {windowLabel}.</strong>
            <div style={{ marginTop: 6, opacity: 0.8 }}>
              Try a shorter or longer window.
            </div>
          </div>
        )}

        {!loading && !error && events.length > 0 && (
          <div style={{ display: "grid", gap: 12 }}>
            {events.map((e, i) => (
              <div
                key={`${e.type}-${e.timeISO}-${i}`}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: 12,
                  padding: 16,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
  <strong>{e.type}</strong>

  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
    <span
      style={{
        fontSize: 12,
        padding: "2px 6px",
        borderRadius: 6,
        background: e.timeType === "ACTUAL" ? "#e6f4ea" : "#f3f3f3",
        color: e.timeType === "ACTUAL" ? "#137333" : "#555",
        fontWeight: 600,
      }}
    >
      {e.timeType}
    </span>

    <strong>{formatDateTime(e.timeISO)}</strong>
  </div>
</div>


                <div style={{ marginTop: 6, fontSize: 18 }}>
                  {e.vesselName}
                </div>

                <div style={{ marginTop: 6, opacity: 0.8 }}>
                  {e.operator && <span>{e.operator}</span>}
                  {e.service && <span> • {e.service}</span>}
                  {e.berth && <span> • Berth {e.berth}</span>}
                  {e.status && <span> • {e.status}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
