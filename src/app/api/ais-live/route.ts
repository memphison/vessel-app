import { NextResponse } from "next/server";

export const runtime = "nodejs"; // WebSocket not supported in Edge

// Default: City Hall, Savannah (approx)
const CITY_HALL_DEFAULT = { lat: 32.08077, lon: -81.0903 };

// Bounding-box presets for easy testing
const PRESETS: Record<
  string,
  { cityHall: { lat: number; lon: number }; bbox: [[[number, number], [number, number]]] }
> = {
  // Savannah-ish wide area (yours)
  sav: {
    cityHall: { lat: 32.08077, lon: -81.0903 },
    bbox: [[[31.35613231884058, -81.94553130944576], [32.80540768115942, -80.23506869055424]]],
  },

  // NYC harbor test box (busy)
  ny: {
    cityHall: { lat: 40.7128, lon: -74.006 },
    bbox: [[[40.45, -74.35], [40.95, -73.6]]],
  },

  // Optional: Charleston-ish
  chs: {
    cityHall: { lat: 32.7765, lon: -79.9311 },
    bbox: [[[32.55, -80.25], [33.05, -79.55]]],
  },

  // Optional: Jacksonville-ish
  jax: {
    cityHall: { lat: 30.3322, lon: -81.6557 },
    bbox: [[[30.10, -82.10], [30.70, -81.10]]],
  },
};

type AisPosition = {
  imo?: string;
  mmsi?: string;
  lat: number;
  lon: number;
  sog?: number; // knots
  cog?: number; // degrees
  lastSeenISO: string;
};

type SnapshotRow = AisPosition & {
  distanceMi: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __AISSTREAM__: {
    ws: WebSocket | null;
    lastConnectISO: string | null;
    lastMessageISO: string | null;
    lastError: string | null;
    wsReadyState: number | null;
    positionsByKey: Map<string, AisPosition>;
    staticByMmsi: Map<string, { imo?: string; name?: string }>;
    activePreset: string;
  } | undefined;
}

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 3958.7613;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function ensureStore() {
  if (!globalThis.__AISSTREAM__) {
    globalThis.__AISSTREAM__ = {
      ws: null,
      lastConnectISO: null,
      lastMessageISO: null,
      lastError: null,
      wsReadyState: null,
      positionsByKey: new Map<string, AisPosition>(),
      staticByMmsi: new Map<string, { imo?: string; name?: string }>(),
      activePreset: "sav",
    };
  }
  return globalThis.__AISSTREAM__!;
}

function getPresetFromUrl(req: Request) {
  const url = new URL(req.url);
  const preset = (url.searchParams.get("preset") || "").toLowerCase();
  return PRESETS[preset] ? preset : null;
}

async function connectIfNeeded(req: Request) {
  const store = ensureStore();

  const forcedPreset = getPresetFromUrl(req);
  const desiredPreset = forcedPreset || store.activePreset || "sav";

  // If connected but preset changed, drop and reconnect with new bbox
  if (store.ws && desiredPreset !== store.activePreset) {
    try {
      store.ws.close();
    } catch {}
    store.ws = null;
  }

  if (store.ws) return;

  const key = process.env.AISSTREAM_API_KEY;
  if (!key) throw new Error("Missing AISSTREAM_API_KEY in environment.");

  const chosen = PRESETS[desiredPreset] || PRESETS.sav;
  store.activePreset = desiredPreset;

  const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
  store.ws = ws;
  store.lastConnectISO = new Date().toISOString();
  store.lastMessageISO = null;
  store.lastError = null;
  store.wsReadyState = ws.readyState;

  ws.addEventListener("open", () => {
    store.wsReadyState = ws.readyState;
    const msg = {
      APIKey: key,
      BoundingBoxes: chosen.bbox,
      FilterMessageTypes: ["PositionReport", "ShipStaticData"],
    };
    ws.send(JSON.stringify(msg));
  });

  ws.addEventListener("message", (evt) => {
    try {
      store.lastMessageISO = new Date().toISOString();

      const raw = typeof evt.data === "string" ? evt.data : "";
      if (!raw) return;

      const parsed = JSON.parse(raw);

      const messageType: string | undefined = parsed?.MessageType;
      const meta = parsed?.MetaData;
      const msg = parsed?.Message;

      if (!messageType || !meta || !msg) return;

      const mmsi = meta?.MMSI != null ? String(meta.MMSI).trim() : undefined;

      // AISStream commonly puts lat/lon here:
      const lat = Number(meta?.latitude);
      const lon = Number(meta?.longitude);

      // Some messages might not include a position; guard it
      const hasPos = Number.isFinite(lat) && Number.isFinite(lon);

      if (messageType === "ShipStaticData") {
        const s = msg?.ShipStaticData;
        // IMO often lives here:
        const imo = s?.ImoNumber != null ? String(s.ImoNumber).trim() : undefined;

        if (mmsi) {
          store.staticByMmsi.set(mmsi, {
            imo: imo && /^\d{7}$/.test(imo) ? imo : undefined,
            name: s?.Name ? String(s.Name).trim() : meta?.ShipName ? String(meta.ShipName).trim() : undefined,
          });

          // If we already have a position keyed by MMSI, mirror it to IMO key too
          const mmsiKey = `MMSI:${mmsi}`;
          const rec = store.positionsByKey.get(mmsiKey);
          if (rec && imo && /^\d{7}$/.test(imo)) {
            store.positionsByKey.set(`IMO:${imo}`, { ...rec, imo, mmsi });
          }
        }

        return;
      }

      if (messageType === "PositionReport") {
        if (!hasPos) return;

        const pr = msg?.PositionReport;

        // Speed/course usually live on PositionReport
        const sog = pr?.Sog != null ? Number(pr.Sog) : undefined;
        const cog = pr?.Cog != null ? Number(pr.Cog) : undefined;

        // Sometimes IMO is not in PositionReport; if we have MMSI we can attach IMO from static cache
        let imo: string | undefined = undefined;
        if (mmsi) {
          const st = store.staticByMmsi.get(mmsi);
          if (st?.imo) imo = st.imo;
        }

        const keyId =
          imo && /^\d{7}$/.test(imo)
            ? `IMO:${imo}`
            : mmsi
            ? `MMSI:${mmsi}`
            : null;

        if (!keyId) return;

        const prev = store.positionsByKey.get(keyId);

        store.positionsByKey.set(keyId, {
          imo: imo || prev?.imo,
          mmsi: mmsi || prev?.mmsi,
          lat,
          lon,
          sog: Number.isFinite(sog) ? sog : prev?.sog,
          cog: Number.isFinite(cog) ? cog : prev?.cog,
          lastSeenISO: new Date().toISOString(),
        });

        // Also keep MMSI key updated so later static messages can upgrade it to IMO
        if (mmsi) {
          store.positionsByKey.set(`MMSI:${mmsi}`, {
            imo: imo || prev?.imo,
            mmsi,
            lat,
            lon,
            sog: Number.isFinite(sog) ? sog : prev?.sog,
            cog: Number.isFinite(cog) ? cog : prev?.cog,
            lastSeenISO: new Date().toISOString(),
          });
        }

        return;
      }
    } catch (e: any) {
      store.lastError = e?.message || "Parse error";
    }
  });

  ws.addEventListener("close", () => {
    store.wsReadyState = ws.readyState;
    store.ws = null;
  });

  ws.addEventListener("error", () => {
    store.wsReadyState = ws.readyState;
    store.ws = null;
    store.lastError = "WebSocket error";
  });
}

export async function GET(req: Request) {
  try {
    await connectIfNeeded(req);
    const store = ensureStore();

    const preset = getPresetFromUrl(req) || store.activePreset || "sav";
    const chosen = PRESETS[preset] || PRESETS.sav;

    const rows: SnapshotRow[] = [];
    for (const v of store.positionsByKey.values()) {
      const distanceMi = haversineMiles(chosen.cityHall.lat, chosen.cityHall.lon, v.lat, v.lon);
      rows.push({ ...v, distanceMi });
    }

    rows.sort((a, b) => a.distanceMi - b.distanceMi);

    return NextResponse.json({
      ok: true,
      preset,
      cityHall: chosen.cityHall,
      bbox: chosen.bbox,
      lastConnectISO: store.lastConnectISO,
      lastMessageISO: store.lastMessageISO,
      lastError: store.lastError,
      wsReadyState: store.ws ? store.ws.readyState : store.wsReadyState,
      count: rows.length,
      vessels: rows.slice(0, 200),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "AIS stream error" },
      { status: 500 }
    );
  }
}
