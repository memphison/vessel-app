import { NextResponse } from "next/server";

export const runtime = "nodejs"; // required (WebSocket not supported in Edge)

// City Hall, Savannah (hard-coded anchor point for now)
const CITY_HALL = { lat: 32.08077, lon: -81.0903 };

// TEMP: flip to true to test against a busy AIS area (NY Harbor)
const TEST_BUSY_AREA = true;


// Bounding box (lat, lon) pairs inside a list of boxes:
// [ [ [minLat, minLon], [maxLat, maxLon] ] ]
const BBOX = TEST_BUSY_AREA
  ? [
      [
        [40.45, -74.35], // NY Harbor SW
        [40.95, -73.60], // NY Harbor NE
      ],
    ]
  : [
      [
        [31.35613231884058, -81.94553130944576], // Savannah SW
        [32.80540768115942, -80.23506869055424], // Savannah NE
      ],
    ];




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
  var __AISSTREAM__:
    | {
        ws: WebSocket | null;
        lastConnectISO: string | null;
        lastMessageISO: string | null;
        lastError: string | null;
        positionsByKey: Map<string, AisPosition>;
      }
    | undefined;
}

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 3958.7613; // miles
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
      positionsByKey: new Map<string, AisPosition>(),
    };
  }
  return globalThis.__AISSTREAM__!;
}

function pickNumber(...vals: any[]): number | null {
  for (const v of vals) {
    const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pickString(...vals: any[]): string | undefined {
  for (const v of vals) {
    const s = v == null ? "" : String(v).trim();
    if (s) return s;
  }
  return undefined;
}

function normalizeImo(imo?: string) {
  if (!imo) return undefined;
  const cleaned = imo.replace(/[^\d]/g, "").trim();
  return /^\d{7}$/.test(cleaned) ? cleaned : undefined;
}

async function connectIfNeeded() {
  const store = ensureStore();
  if (store.ws && store.ws.readyState === WebSocket.OPEN) return;

// if exists but not open, clear it so we reconnect
if (store.ws && store.ws.readyState !== WebSocket.OPEN) {
  try { store.ws.close(); } catch {}
  store.ws = null;
}


  const key = process.env.AISSTREAM_API_KEY;
  if (!key) throw new Error("Missing AISSTREAM_API_KEY in environment.");

  const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
  store.ws = ws;
  store.lastConnectISO = new Date().toISOString();
  store.lastError = null;

  ws.addEventListener("open", () => {
    const sub = {
      APIKey: key,
      BoundingBoxes: BBOX,
      FilterMessageTypes: ["PositionReport", "ShipStaticData"],
    };
    ws.send(JSON.stringify(sub));
  });

 ws.addEventListener("message", async (evt: any) => {
  try {
    let raw = "";

    // In Node, evt.data is often a Buffer or ArrayBuffer, not a string
    if (typeof evt.data === "string") {
      raw = evt.data;
    } else if (evt.data instanceof ArrayBuffer) {
      raw = Buffer.from(evt.data).toString("utf8");
    } else if (Buffer.isBuffer(evt.data)) {
      raw = evt.data.toString("utf8");
    } else if (evt.data?.arrayBuffer) {
      // Some runtimes give a Blob-like object
      const ab = await evt.data.arrayBuffer();
      raw = Buffer.from(ab).toString("utf8");
    } else {
      return;
    }

    if (!raw) return;

    const parsed = JSON.parse(raw);
    store.lastMessageISO = new Date().toISOString();

    if (parsed?.error) {
      store.lastError = String(parsed.error);
      return;
    }

    const messageType: string | undefined = parsed?.MessageType;
    const msg = parsed?.Message;
    const meta = parsed?.MetaData;
    if (!messageType || !msg) return;

    if (messageType === "PositionReport") {
      const lat = pickNumber(meta?.latitude, meta?.Latitude, msg?.Latitude, msg?.latitude);
      const lon = pickNumber(meta?.longitude, meta?.Longitude, msg?.Longitude, msg?.longitude);
      if (lat == null || lon == null) return;

      const pr =
        msg?.PositionReport ||
        msg?.PositionReportClassA ||
        msg?.PositionReportClassB ||
        msg;

      const mmsi = pickString(meta?.MMSI, pr?.MMSI, pr?.UserID, pr?.userid);
      const imo = normalizeImo(pickString(pr?.IMONumber, pr?.ImoNumber, pr?.IMO, pr?.imo));

      const keyId = imo ? `IMO:${imo}` : mmsi ? `MMSI:${mmsi}` : null;
      if (!keyId) return;

      const prev = store.positionsByKey.get(keyId);

      const sog = pickNumber(pr?.Sog, pr?.SOG, pr?.SpeedOverGround);
      const cog = pickNumber(pr?.Cog, pr?.COG, pr?.CourseOverGround);

      store.positionsByKey.set(keyId, {
        imo,
        mmsi,
        lat,
        lon,
        sog: sog ?? prev?.sog,
        cog: cog ?? prev?.cog,
        lastSeenISO: new Date().toISOString(),
      });
    }

    if (messageType === "ShipStaticData") {
      const ssd = msg?.ShipStaticData || msg;
      const mmsi = pickString(meta?.MMSI, ssd?.MMSI, ssd?.UserID);
      const imo = normalizeImo(pickString(ssd?.IMONumber, ssd?.ImoNumber, ssd?.IMO));
      if (!mmsi || !imo) return;

      const mmsiKey = `MMSI:${mmsi}`;
      const rec = store.positionsByKey.get(mmsiKey);
      if (rec) store.positionsByKey.set(`IMO:${imo}`, { ...rec, imo, mmsi });
    }
  } catch {
    // ignore
  }
});


  ws.addEventListener("close", () => {
    store.ws = null;
  });

  ws.addEventListener("error", () => {
    store.ws = null;
  });
}

export async function GET() {
  try {
    await connectIfNeeded();
    const store = ensureStore();

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
      lastMessageISO: store.lastMessageISO,
      lastError: store.lastError,
      wsReadyState: store.ws ? store.ws.readyState : null,
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
