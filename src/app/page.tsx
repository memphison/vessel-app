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

type Dir = "next" | "past";
type WindowVal = "1h" | "2h" | "3h" | "24h";

export default function HomePage() {
  const [events, setEvents] = useState<VesselEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // Default view
  const [dir, setDir] = useState<Dir>("next");
  const [window, setWindow] = useState<WindowVal>("24h");

  async function load(
    d: Dir = dir,
    w: WindowVal = window
  ) {
    setLoading(true);
    try {
      setError(null);

      const resp = await fetch(`/api/next-events?dir=${d}&window=${w}`, {
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
    load(dir, window);
    const id = setInterval(() => load(dir, window), 60_000);
    return () => clearInterval(id);
  }, [dir, window]);

  const windowLabel =
    window === "1h"
      ? "1 hour"
      : window === "2h"
      ? "2 hours"
      : window === "3h"
      ? "3 hours"
      : "24 hours";

  const dirLabel = dir === "past" ? "past" : "next";

  function select(d: Dir, w: WindowVal) {
    // If user clicks the currently-selected button again, re-fetch
    if (d === dir && w === window) {
      load(d, w);
      return;
    }

    setDir(d);
    setWindow(w);
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 880 }}>
      <h1 style={{ margin: 0 }}>Savannah Vessel Watch</h1>

      <p style={{ marginTop: 8, opacity: 0.75 }}>
        All arrivals or departures in the {dirLabel} {windowLabel}. Will refresh every minute.
      </p>

      <div style={{ marginTop: 8, opacity: 0.6, fontSize: 14 }}>
        {lastUpdated ? `Last updated: ${lastUpdated}` : "Last updated: —"}
      </div>

      <div style={{ marginTop: 6, opacity: 0.6, fontSize: 14 }}>
        {events.length} total moves in the {dirLabel} {windowLabel}.
      </div>

      {/* Row 1: NEXT */}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          onClick={() => select("next", "1h")}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: dir === "next" && window === "1h" ? "#111" : "#fff",
            color: dir === "next" && window === "1h" ? "#fff" : "#111",
            cursor: "pointer",
          }}
        >
          Next 1 hour
        </button>

        <button
          onClick={() => select("next", "3h")}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: dir === "next" && window === "3h" ? "#111" : "#fff",
            color: dir === "next" && window === "3h" ? "#fff" : "#111",
            cursor: "pointer",
          }}
        >
          Next 3 hours
        </button>

        <button
          onClick={() => select("next", "24h")}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: dir === "next" && window === "24h" ? "#111" : "#fff",
            color: dir === "next" && window === "24h" ? "#fff" : "#111",
            cursor: "pointer",
          }}
        >
          Next 24 hours
        </button>
      </div>

      {/* Row 2: PAST */}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          onClick={() => select("past", "1h")}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: dir === "past" && window === "1h" ? "#111" : "#fff",
            color: dir === "past" && window === "1h" ? "#fff" : "#111",
            cursor: "pointer",
          }}
        >
          Past 1 hour
        </button>

        <button
          onClick={() => select("past", "2h")}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: dir === "past" && window === "2h" ? "#111" : "#fff",
            color: dir === "past" && window === "2h" ? "#fff" : "#111",
            cursor: "pointer",
          }}
        >
          Past 2 hours
        </button>

        <button
          onClick={() => select("past", "24h")}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: dir === "past" && window === "24h" ? "#111" : "#fff",
            color: dir === "past" && window === "24h" ? "#fff" : "#111",
            cursor: "pointer",
          }}
        >
          Past 24 hours
        </button>
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
              color: "#111",
            }}
          >
            <strong>No moves in the {dirLabel} {windowLabel}.</strong>
            <div style={{ marginTop: 6, color: "#555" }}>
              Try a different window.
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
                  background: "#fff",
                  color: "#111",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <strong>{e.type}</strong>

                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span
                      style={{
                        fontSize: 12,
                        padding: "2px 6px",
                        borderRadius: 6,
                        background:
                          e.timeType === "ACTUAL" ? "#e6f4ea" : "#f3f3f3",
                        color: e.timeType === "ACTUAL" ? "#137333" : "#555",
                        fontWeight: 600,
                      }}
                    >
                      {e.timeType === "ACTUAL" ? "Actual" : "Estimated"}
                    </span>

                    <strong>{formatDateTime(e.timeISO)}</strong>
                  </div>
                </div>

                <div style={{ marginTop: 6, fontSize: 18 }}>{e.vesselName}</div>

                <div style={{ marginTop: 6, color: "#555" }}>
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
