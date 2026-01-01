"use client";

import { useEffect, useMemo, useState } from "react";

type VesselEvent = {
  type: "ARRIVAL" | "DEPARTURE";
  timeISO: string;
  timeLabel: string;
  timeType: "ACTUAL" | "ESTIMATED";
  vesselName: string;
  imo?: string;
  service?: string;
  operator?: string;
  berth?: string;
  status?: string;
};

type VesselInfo = {
  ok: boolean;
  imo: string;
  loa: string | null;
  beam: string | null;
  source?: string;
};

type Dir = "next" | "past";
type WindowNext = "1h" | "3h" | "24h";
type WindowPast = "1h" | "2h" | "24h";
type Window = WindowNext | WindowPast;

function formatDateTime(iso: string) {
  const d = new Date(iso);

  const date = `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(
    -2
  )}`;

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

  const [dir, setDir] = useState<Dir>("next");
  const [timeWindow, setTimeWindow] = useState<Window>("24h");

  const [isDark, setIsDark] = useState(false);

  // IMO -> vessel info cache (client-side)
  const [infoByImo, setInfoByImo] = useState<Record<string, VesselInfo>>({});

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;

    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setIsDark(e.matches);

    setIsDark(mql.matches);

    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }

    // Safari fallback
    // @ts-ignore
    mql.addListener(onChange);
    // @ts-ignore
    return () => mql.removeListener(onChange);
  }, []);

  const theme = useMemo(() => {
    return {
      pageBg: isDark ? "#0b0b0b" : "#ffffff",

      pageText: isDark ? "#f5f5f5" : "#111",
      subText: isDark ? "rgba(245,245,245,0.75)" : "rgba(0,0,0,0.75)",
      metaText: isDark ? "rgba(245,245,245,0.82)" : "rgba(0,0,0,0.72)",

      cardBg: isDark ? "#121212" : "#fff",
      cardBorder: isDark ? "rgba(255,255,255,0.18)" : "#ddd",

      emptyBg: isDark ? "#121212" : "#fafafa",
      emptyBorder: isDark ? "rgba(255,255,255,0.18)" : "#ddd",

      buttonBorder: isDark ? "rgba(255,255,255,0.22)" : "#ddd",
      buttonBg: isDark ? "#151515" : "#fff",
      buttonText: isDark ? "#f5f5f5" : "#111",
      buttonActiveBg: isDark ? "#f5f5f5" : "#111",
      buttonActiveText: isDark ? "#111" : "#fff",
    };
  }, [isDark]);

  const windowLabel = useMemo(() => {
    if (dir === "next") {
      const w = timeWindow as WindowNext;
      return w === "1h" ? "next hour" : w === "3h" ? "next 3 hours" : "next 24 hours";
    } else {
      const w = timeWindow as WindowPast;
      return w === "1h" ? "past hour" : w === "2h" ? "past 2 hours" : "past 24 hours";
    }
  }, [dir, timeWindow]);

  async function load(d: Dir = dir, w: Window = timeWindow) {
    setLoading(true);
    try {
      setError(null);

      const resp = await fetch(`/api/next-events?window=${w}&dir=${d}`, {
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

  async function loadVesselInfos(currentEvents: VesselEvent[]) {
    const uniqueImos = Array.from(
      new Set(
        currentEvents
          .map((e) => (e.imo || "").trim())
          .filter((imo) => /^\d{7}$/.test(imo))
      )
    );

    const missing = uniqueImos.filter((imo) => !infoByImo[imo]);
    if (missing.length === 0) return;

    try {
      const results = await Promise.all(
        missing.map(async (imo) => {
          const r = await fetch(`/api/vessel-info?imo=${imo}`, { cache: "no-store" });
          const j = await r.json();
          return j?.ok ? (j as VesselInfo) : null;
        })
      );

      const patch: Record<string, VesselInfo> = {};
      for (const res of results) {
        if (res?.imo) patch[res.imo] = res;
      }

      if (Object.keys(patch).length > 0) {
        setInfoByImo((prev) => ({ ...prev, ...patch }));
      }
    } catch {
      // Silent fail. Dimensions are a nice-to-have.
    }
  }

  useEffect(() => {
    load(dir, timeWindow);
    const id = setInterval(() => load(dir, timeWindow), 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, timeWindow]);

  useEffect(() => {
    if (events.length > 0) loadVesselInfos(events);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  const nextButtons: Array<{ w: WindowNext; label: string }> = [
    { w: "1h", label: "Next 1 hour" },
    { w: "3h", label: "Next 3 hours" },
    { w: "24h", label: "Next 24 hours" },
  ];

  const pastButtons: Array<{ w: WindowPast; label: string }> = [
    { w: "1h", label: "Past 1 hour" },
    { w: "2h", label: "Past 2 hours" },
    { w: "24h", label: "Past 24 hours" },
  ];

  function buttonStyle(active: boolean) {
    return {
      padding: "8px 12px",
      borderRadius: 10,
      border: `1px solid ${theme.buttonBorder}`,
      background: active ? theme.buttonActiveBg : theme.buttonBg,
      color: active ? theme.buttonActiveText : theme.buttonText,
      cursor: "pointer",
    } as const;
  }

  function pillStyle(timeType: "ACTUAL" | "ESTIMATED") {
    const isActual = timeType === "ACTUAL";

    // Keep the pill readable on both dark and light backgrounds.
    if (isDark) {
      return {
        fontSize: 12,
        padding: "2px 6px",
        borderRadius: 6,
        background: isActual ? "rgba(19,115,51,0.25)" : "rgba(255,255,255,0.12)",
        color: isActual ? "#9be7b0" : "rgba(245,245,245,0.85)",
        fontWeight: 600,
      } as const;
    }

    return {
      fontSize: 12,
      padding: "2px 6px",
      borderRadius: 6,
      background: isActual ? "#e6f4ea" : "#f3f3f3",
      color: isActual ? "#137333" : "#555",
      fontWeight: 600,
    } as const;
  }

  return (
    <main
      style={{
        padding: 24,
        fontFamily: "system-ui",
        maxWidth: 880,
        background: theme.pageBg,
        minHeight: "100vh",
      }}
    >
      <h1 style={{ margin: 0, color: theme.pageText }}>Savannah Vessel Watch</h1>

      <p style={{ marginTop: 8, color: theme.subText }}>
        All arrivals or departures in the {windowLabel}. Refreshes every minute.
      </p>

      <div style={{ marginTop: 8, color: theme.subText, fontSize: 14 }}>
        {lastUpdated ? `Last updated: ${lastUpdated}` : "Last updated: —"}
      </div>

      <div style={{ marginTop: 6, color: theme.subText, fontSize: 14 }}>
        {events.length} total moves in the {windowLabel}.
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {nextButtons.map(({ w, label }) => {
          const active = dir === "next" && timeWindow === w;
          return (
            <button
              key={`next-${w}`}
              onClick={() => {
                if (active) load("next", w);
                else {
                  setDir("next");
                  setTimeWindow(w);
                }
              }}
              style={buttonStyle(active)}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        {pastButtons.map(({ w, label }) => {
          const active = dir === "past" && timeWindow === w;
          return (
            <button
              key={`past-${w}`}
              onClick={() => {
                if (active) load("past", w);
                else {
                  setDir("past");
                  setTimeWindow(w);
                }
              }}
              style={buttonStyle(active)}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: 16 }}>
        {loading && <p style={{ color: theme.pageText }}>Loading...</p>}

        {!loading && error && (
          <p style={{ color: "crimson" }}>{error} Try refreshing the page.</p>
        )}

        {!loading && !error && events.length === 0 && (
          <div
            style={{
              border: `1px solid ${theme.emptyBorder}`,
              borderRadius: 12,
              padding: 16,
              background: theme.emptyBg,
              color: theme.pageText,
            }}
          >
            <strong>No moves in the {windowLabel}.</strong>
            <div style={{ marginTop: 6, color: theme.subText }}>
              Try a different time window.
            </div>
          </div>
        )}

        {!loading && !error && events.length > 0 && (
          <div style={{ display: "grid", gap: 12 }}>
            {events.map((e, i) => {
              const info = e.imo ? infoByImo[e.imo] : undefined;
              const dims =
                info && (info.loa || info.beam)
                  ? `${info.loa ? `LOA ${info.loa}` : ""}${
                      info.loa && info.beam ? " • " : ""
                    }${info.beam ? `Beam ${info.beam}` : ""}`
                  : null;

              return (
                <div
                  key={`${e.type}-${e.timeISO}-${i}`}
                  style={{
                    border: `1px solid ${theme.cardBorder}`,
                    borderRadius: 12,
                    padding: 16,
                    background: theme.cardBg,
                    color: theme.pageText,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <strong>{e.type}</strong>

                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={pillStyle(e.timeType)}>
                        {e.timeType === "ACTUAL" ? "Actual" : "Estimated"}
                      </span>

                      <strong>{formatDateTime(e.timeISO)}</strong>
                    </div>
                  </div>

                  <div style={{ marginTop: 6, fontSize: 18 }}>{e.vesselName}</div>

                  <div style={{ marginTop: 6, color: theme.metaText, fontSize: 14 }}>
                    {e.operator && <span>{e.operator}</span>}
                    {e.service && <span> • {e.service}</span>}
                    {e.berth && <span> • Berth {e.berth}</span>}
                    {e.status && <span> • {e.status}</span>}
                    {e.imo && <span> • IMO {e.imo}</span>}
                  </div>

                  {dims && (
                    <div style={{ marginTop: 6, color: theme.metaText, fontSize: 14 }}>
                      {dims}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
