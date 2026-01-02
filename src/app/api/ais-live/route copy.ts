import { NextResponse } from "next/server";

export const runtime = "nodejs"; // required (WebSocket not supported in Edge)

// City Hall, Savannah (approx)
const CITY_HALL = { lat: 32.08077, lon: -81.09030 };

// A loose Savannah area bounding box.
// Adjust later if you want wider coverage.
const BBOX = [
  [
    [32.03, -81.16], // south-west (lat, lon)
    [32.12, -81.02], // north-east (lat, lon)
  ],
];

type AisPosition = {
  imo?: string;
  mmsi?: string;
  lat: number;
  lon: number;
  sog?: number; // speed over ground (knots)
  cog?: number; // course over ground (degrees)
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
    positionsByKey: Map<string, AisPosition>;
  } | undefined;
}

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 3958.7613; // Earth radius miles
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
      positionsByKey: new Map<string, AisPosition>(),
    };
  }
  return globalThis.__AISSTREAM__!;
}

async function connectIfNeeded() {
  const store = ensureStore();
  if (store.ws) return;

  const key = process.env.AISSTREAM_API_KEY;
  if (!key) {
    throw new Error("Missing AISSTREAM_API_KEY in environment.");
  }

  // WebSocket is available in Node 18+ (Next.js Node runtime).
  const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");

  store.ws = ws;
  store.lastConnectISO = new Date().toISOString();

  ws.addEventListener("open", () => {
    const msg = {
      APIKey: key,
      BoundingBoxes: BBOX,
      FilterMessageTypes: ["PositionReport", "ShipStaticData"],
    };
    ws.send(JSON.stringify(msg));
  });

  ws.addEventListener("message", (evt) => {
    try {
      const raw = typeof evt.data === "string" ? evt.data : "";
      if (!raw) return;

      const parsed = JSON.parse(raw);

      // AISStream typically returns an object with MessageType + Message
      const messageType: string | undefined = parsed?.MessageType;
      const msg = parsed?.Message;

      if (!messageType || !msg) return;

      if (messageType === "PositionReport") {
        const lat = Number(msg?.Latitude);
        const lon = Number(msg?.Longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

        const imo = msg?.IMO ? String(msg.IMO).trim() : undefined;
        const mmsi = msg?.MMSI ? String(msg.MMSI).trim() : undefined;

        const keyId = (imo && /^\d{7}$/.test(imo)) ? `IMO:${imo}` : (mmsi ? `MMSI:${mmsi}` : null);
        if (!keyId) return;

        const prev = store.positionsByKey.get(keyId);

        store.positionsByKey.set(keyId, {
          imo,
          mmsi,
          lat,
          lon,
          sog: msg?.Sog != null ? Number(msg.Sog) : prev?.sog,
          cog: msg?.Cog != null ? Number(msg.Cog) : prev?.cog,
          lastSeenISO: new Date().toISOString(),
        });
      }

      if (messageType === "ShipStaticData") {
        // Optional: enrich a position record with IMO if a MMSI keyed record exists.
        const imo = msg?.IMO ? String(msg.IMO).trim() : undefined;
        const mmsi = msg?.MMSI ? String(msg.MMSI).trim() : undefined;
        if (!mmsi) return;

        const mmsiKey = `MMSI:${mmsi}`;
        const rec = store.positionsByKey.get(mmsiKey);
        if (rec && imo && /^\d{7}$/.test(imo)) {
          const imoKey = `IMO:${imo}`;
          store.positionsByKey.set(imoKey, { ...rec, imo, mmsi });
        }
      }
    } catch {
      // ignore parse errors
    }
  });

  ws.addEventListener("close", () => {
    // allow reconnect on next request
    store.ws = null;
  });

  ws.addEventListener("error", () => {
    // allow reconnect on next request
    store.ws = null;
  });
}

export async function GET() {
  try {
    await connectIfNeeded();
    const store = ensureStore();

    // Build snapshot sorted by distance
    const rows: SnapshotRow[] = [];
    for (const v of store.positionsByKey.values()) {
      const distanceMi = haversineMiles(CITY_HALL.lat, CITY_HALL.lon, v.lat, v.lon);
      rows.push({ ...v, distanceMi });
    }

    rows.sort((a, b) => a.distanceMi - b.distanceMi);

    return NextResponse.json({
      ok: true,
      cityHall: CITY_HALL,
      bbox: BBOX,
      lastConnectISO: store.lastConnectISO,
      count: rows.length,
      vessels: rows.slice(0, 200), // keep payload reasonable
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "AIS stream error" },
      { status: 500 }
    );
  }
}
