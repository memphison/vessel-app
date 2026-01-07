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

  // Dimensions (we now prefer lengthM/widthM, but keep loa/beam for back-compat)
  lengthM?: string | null;
  widthM?: string | null;
  loa?: string | null;
  beam?: string | null;

  vesselType: string | null;
  yearBuilt: string | null;
  grossTonnage: string | null;
  flag: string | null;
  source?: string;
};

type Dir = "next" | "past";
type WindowNext = "1h" | "3h" | "24h";
type WindowPast = "1h" | "3h" | "24h";
type Window = WindowNext | WindowPast;

function formatDateTime(iso: string) {
  const d = new Date(iso);

  const date = `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;

  const time = d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  return `${date} • ${time}`;
}

type AisVessel = {
  imo?: string;
  mmsi?: string;
  lat: number;
  lon: number;
  sog?: number;
  cog?: number;
  lastSeenISO: string;
  distanceMi: number;
};

type AisSnapshot = {
  ok: boolean;
  cityHall: { lat: number; lon: number };
  count: number;
  vessels: AisVessel[];
  lastConnectISO?: string | null;
};

function formatGrossTonnage(gt?: string | null) {
  if (!gt) return null;
  const num = Number(String(gt).replace(/[^\d]/g, ""));
  return Number.isFinite(num) ? num.toLocaleString() : null;
}

// Returns up to two meter values in order, e.g. "262 / 32 m" -> ["262m","32m"]
function metersPair(v?: string | null): string[] {
  if (!v) return [];
  const nums = String(v).match(/\d+(?:\.\d+)?/g) || [];
  const out = nums.slice(0, 2).map((n) => `${n}m`);
  return out;
}

function getLengthWidth(info?: VesselInfo) {
  if (!info) return { length: null as string | null, width: null as string | null };

  // Prefer explicit keys from the API
  let length = info.lengthM ?? null;
  let width = info.widthM ?? null;

  // Fall back to older keys if needed
  if (!length && info.loa) length = info.loa;
  if (!width && info.beam) width = info.beam;

  // If one field contains BOTH numbers (e.g., "262 / 32 m"), split it.
  if (length && !width) {
    const pair = metersPair(length);
    if (pair.length === 2) {
      length = pair[0];
      width = pair[1];
    } else if (pair.length === 1) {
      length = pair[0];
    }
  }

  if (width && !length) {
    const pair = metersPair(width);
    if (pair.length === 2) {
      length = pair[0];
      width = pair[1];
    } else if (pair.length === 1) {
      width = pair[0];
    }
  }

  // Normalize single values to "###m" if they aren't already (rare)
  if (length) {
    const p = metersPair(length);
    if (p.length >= 1) length = p[0];
  }
  if (width) {
    const p = metersPair(width);
    if (p.length >= 1) width = p[0];
  }

  return { length, width };
}

export default function HomePage() {
  const [events, setEvents] = useState<VesselEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const [dir, setDir] = useState<Dir>("next");
  const [timeWindow, setTimeWindow] = useState<Window>("24h");

  const [isDark, setIsDark] = useState(false);

  const [aisByImo, setAisByImo] = useState<Record<string, AisVessel>>({});
  const [aisByMmsi, setAisByMmsi] = useState<Record<string, AisVessel>>({});
  const [aisVessels, setAisVessels] = useState<AisVessel[]>([]);

  const [aisStatus, setAisStatus] = useState<{ lastUpdated: string | null; count: number }>({
    lastUpdated: null,
    count: 0,
  });

  async function loadAis() {
    try {
      const resp = await fetch(`/api/ais-live`, { cache: "no-store" });
      const data: AisSnapshot = await resp.json();

      if (!resp.ok || !data?.ok) return;

      const byImo: Record<string, AisVessel> = {};
      const byMmsi: Record<string, AisVessel> = {};

      for (const v of data.vessels || []) {
        const imo = (v.imo || "").trim();
        const mmsi = (v.mmsi || "").trim();

        if (/^\d{7}$/.test(imo)) byImo[imo] = v;
        if (/^\d{9}$/.test(mmsi)) byMmsi[mmsi] = v;
      }

      setAisByImo(byImo);
      setAisByMmsi(byMmsi);
      setAisVessels(Array.isArray(data.vessels) ? data.vessels : []);

      setAisStatus({
        lastUpdated: new Date().toLocaleTimeString(),
        count: data.count || 0,
      });
    } catch {
      // silent fail
    }
  }

  useEffect(() => {
    loadAis();
    const id = setInterval(loadAis, 10_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const theme = {
    pageText: isDark ? "#f5f5f5" : "#111",
    subText: isDark ? "rgba(245,245,245,0.75)" : "rgba(0,0,0,0.75)",
    metaText: isDark ? "rgba(245,245,245,0.82)" : "rgba(0,0,0,0.72)",
    cardBg: isDark ? "#121212" : "#fff",
    cardBorder: isDark ? "rgba(255,255,255,0.18)" : "#ddd",
    emptyBg: isDark ? "#121212" : "#fafafa",
    emptyBorder: isDark ? "rgba(255,255,255,0.18)" : "#ddd",
  };

  // IMO -> vessel info cache (client-side)
  const [infoByImo, setInfoByImo] = useState<Record<string, VesselInfo>>({});

  const windowLabel = useMemo(() => {
    if (dir === "next") {
      const w = timeWindow as WindowNext;
      return w === "1h" ? "next hour" : w === "3h" ? "next 3 hours" : "next 24 hours";
    } else {
      const w = timeWindow as WindowPast;
      return w === "1h" ? "past hour" : w === "3h" ? "past 3 hours" : "past 24 hours";
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

  function loadVesselInfos(currentEvents: VesselEvent[]) {
    const uniqueImos = Array.from(
      new Set(
        currentEvents
          .map((e) => (e.imo || "").trim())
          .filter((imo) => /^\d{7}$/.test(imo))
      )
    );

    setInfoByImo((prev) => {
      const missing = uniqueImos.filter((imo) => !prev[imo]);
      if (missing.length === 0) return prev;

      Promise.all(
        missing.map(async (imo) => {
          const r = await fetch(`/api/vessel-info?imo=${imo}`, { cache: "no-store" });
          const j = await r.json();
          return j?.ok ? (j as VesselInfo) : null;
        })
      )
        .then((results) => {
          const patch: Record<string, VesselInfo> = {};
          for (const res of results) {
            if (res?.imo) patch[res.imo] = res;
          }
          if (Object.keys(patch).length > 0) {
            setInfoByImo((p) => ({ ...p, ...patch }));
          }
        })
        .catch(() => {
          // Silent fail
        });

      return prev;
    });
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
    { w: "3h", label: "Past 3 hours" },
    { w: "24h", label: "Past 24 hours" },
  ];

  function buttonStyle(active: boolean) {
    return {
      padding: "8px 12px",
      borderRadius: 10,
      border: `1px solid ${theme.cardBorder}`,
      background: active ? (isDark ? "#f5f5f5" : "#111") : theme.cardBg,
      color: active ? (isDark ? "#111" : "#fff") : theme.pageText,
      cursor: "pointer",
    } as const;
  }

  // ✅ AIS-only cards: if AIS sees a vessel in the bbox but GA Ports JSON no longer lists it,
  // we still show it (without duplicating any GA Ports cards).
  const mergedEvents = useMemo(() => {
    const eventImos = new Set(
      events
        .map((ev) => (ev.imo || "").trim())
        .filter((imo) => /^\d{7}$/.test(imo))
    );

    const aisOnly = (aisVessels || []).filter((v) => {
      const imo = (v.imo || "").trim();
      if (!/^\d{7}$/.test(imo)) return false; // keep dedupe safe: only show AIS-only when IMO is known
      return !eventImos.has(imo);
    });

    const aisOnlyEvents: VesselEvent[] = aisOnly.map((v) => ({
      type: "ARRIVAL", // placeholder; UI will label as "AIS"
      timeISO: v.lastSeenISO,
      timeLabel: "",
      timeType: "ACTUAL",
      vesselName: "AIS Track",
      imo: (v.imo || "").trim(),
      service: undefined,
      operator: undefined,
      berth: undefined,
      status: "AIS-only (not in GA Ports list)",
    }));

    return [...aisOnlyEvents, ...events];
  }, [events, aisVessels]);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 880 }}>
      <h1 style={{ margin: 0, color: theme.pageText }}>The Waving Girl</h1>

      <p style={{ marginTop: 8, color: theme.subText }}>
        Live ship movements on the Savannah River in the {windowLabel}. Updated every minute.
      </p>

      <div style={{ marginTop: 8, color: theme.subText, fontSize: 14 }}>
        {lastUpdated ? `Last updated: ${lastUpdated}` : "Last updated: —"}
      </div>

      <div style={{ marginTop: 6, color: theme.subText, fontSize: 14 }}>
        AIS: {aisStatus.count} vessels in range
        {aisStatus.lastUpdated ? ` • Updated: ${aisStatus.lastUpdated}` : ""}
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

        {!loading && error && <p style={{ color: "crimson" }}>{error} Try refreshing the page.</p>}

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
            <div style={{ marginTop: 6, color: theme.subText }}>Try a different time window.</div>
          </div>
        )}

        {!loading && !error && events.length > 0 && (
          <div style={{ display: "grid", gap: 12 }}>
            {mergedEvents.map((e, i) => {
              const info = e.imo ? infoByImo[e.imo] : undefined;

              const eImo = (e.imo || "").trim();
              const infoImo = (info?.imo || "").trim();
              const infoMmsi = String((info as any)?.mmsi || "").trim();

              const ais =
                (eImo ? aisByImo[eImo] : undefined) ??
                (infoImo ? aisByImo[infoImo] : undefined) ??
                (infoMmsi ? aisByMmsi[infoMmsi] : undefined);

              const nearNow = ais && Number.isFinite(ais.distanceMi) ? ais.distanceMi <= 1.0 : false; // 1 mile threshold

              const geoLine = ais
                ? `Distance ${ais.distanceMi.toFixed(2)} mi • Speed ${
                    ais.sog != null ? ais.sog.toFixed(1) : "—"
                  } kn • Course ${ais.cog != null ? Math.round(ais.cog) + "°" : "—"}`
                : null;

              const geoSub = ais
                ? `Lat ${ais.lat.toFixed(5)} • Lon ${ais.lon.toFixed(5)} • Seen ${new Date(
                    ais.lastSeenISO
                  ).toLocaleTimeString()}`
                : null;

              const { length, width } = getLengthWidth(info);
              const dims =
                length || width
                  ? `${length ? `Length ${length}` : ""}${length && width ? " / " : ""}${width ? `Width ${width}` : ""}`
                  : null;

              const formattedGT = formatGrossTonnage(info?.grossTonnage);

              const particulars =
                info && (info.vesselType || info.yearBuilt || info.flag || formattedGT)
                  ? `${info.vesselType || ""}${info.vesselType && info.yearBuilt ? " • " : ""}${
                      info.yearBuilt ? `Built ${info.yearBuilt}` : ""
                    }${(info.vesselType || info.yearBuilt) && info.flag ? " • " : ""}${
                      info.flag ? `Flag: ${info.flag}` : ""
                    }${(info.vesselType || info.yearBuilt || info.flag) && formattedGT ? " • " : ""}${
                      formattedGT ? `Gross Tonnage ${formattedGT}` : ""
                    }`.trim()
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
                    <strong>{e.status === "AIS-only (not in GA Ports list)" ? "UNDERWAY" : e.type}</strong>

                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span
                        style={{
                          fontSize: 12,
                          padding: "2px 6px",
                          borderRadius: 6,
                          background: isDark
                            ? e.timeType === "ACTUAL"
                              ? "rgba(19,115,51,0.25)"
                              : "rgba(255,255,255,0.12)"
                            : e.timeType === "ACTUAL"
                            ? "#e6f4ea"
                            : "#f3f3f3",
                          color: isDark
                            ? e.timeType === "ACTUAL"
                              ? "#b7f5c9"
                              : "rgba(245,245,245,0.85)"
                            : e.timeType === "ACTUAL"
                            ? "#137333"
                            : "#555",
                          fontWeight: 600,
                        }}
                      >
                        {e.timeType === "ACTUAL" ? "Actual" : "Estimated"}
                      </span>

                      <strong>{formatDateTime(e.timeISO)}</strong>
                    </div>
                  </div>

                  <div style={{ marginTop: 6, fontSize: 18 }}>
                    {e.imo ? (
                      <a
                        href={`https://www.vesselfinder.com/?imo=${e.imo}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          color: "#000080",
                          textDecoration: "underline",
                          fontWeight: 600,
                        }}
                      >
                        {e.vesselName}
                        <span style={{ fontSize: 12, opacity: 0.6, marginLeft: 6 }}>
                        ↗ details
                         </span>
                      </a>
                    ) : (
                      <span>{e.vesselName}</span>
                    )}
                  </div>

                  <div style={{ marginTop: 6, color: theme.metaText, fontSize: 14 }}>
                    {e.operator && <span>{e.operator}</span>}
                    {e.service && <span> • {e.service}</span>}
                    {e.berth && <span> • Berth {e.berth}</span>}
                    {e.status && <span> • {e.status}</span>}
                    {e.imo && <span> • IMO {e.imo}</span>}
                  </div>

                  {geoLine && (
                    <div style={{ marginTop: 6, color: theme.metaText, fontSize: 14 }}>
                      {nearNow ? "Near River St now • " : ""}
                      {geoLine}
                    </div>
                  )}

                  {geoSub && (
                    <div style={{ marginTop: 4, color: theme.subText, fontSize: 13 }}>{geoSub}</div>
                  )}

                  {e.imo && !info && (
                    <div style={{ marginTop: 6, color: theme.subText, fontSize: 13 }}>
                      Loading vessel details…
                    </div>
                  )}

                  {dims && (
                    <div style={{ marginTop: 6, color: theme.metaText, fontSize: 14 }}>{dims}</div>
                  )}

                  {particulars && (
                    <div style={{ marginTop: 6, color: theme.metaText, fontSize: 14 }}>
                      {particulars}
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
