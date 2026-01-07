import { NextResponse } from "next/server";

export const runtime = "nodejs"; // WebSocket not supported in Edge

type BBox = [[[number, number], [number, number]]];

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
    bboxKey: string | null; // to detect preset/bbox changes
    positionsByKey: Map<string, AisPosition>;
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
      bboxKey: null,
      positionsByKey: new Map<string, AisPosition>(),
    };
  }
  return globalThis.__AISSTREAM__!;
}

function presetConfig(presetRaw: string | null) {
  const preset = (presetRaw || "sav").toLowerCase();

  if (preset === "ny") {
    const city = { lat: 40.7128, lon: -74.006 };
    const bbox: BBox = [[[40.45, -74.35], [40.95, -73.6]]];
    return { preset: "ny", cityHall: city, bbox };
  }

  // Savannah (City Hall-ish)
  const city = { lat: 32.08077, lon: -81.0903 };

  // Your tighter box:
  // SW corner: 31.968366, -81.169962
  // NE corner: 32.165465, -80.762266
  const bbox: BBox = [[[31.968366, -81.169962], [32.165465, -80.762266]]];

  return { preset: "sav", cityHall: city, bbox };
}

function closeWs(store: ReturnType<typeof ensureStore>) {
  try {
    store.ws?.close();
  } catch {
    // ignore
  }
  store.ws = null;
}

function toNum(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cleanId(v: any): string | undefined {
  const s = String(v ?? "").trim();
  return s ? s : undefined;
}

async function connectIfNeeded(bbox: BBox) {
  const store = ensureStore();

  const key = process.env.AISSTREAM_API_KEY;
  if (!key) throw new Error("Missing AISSTREAM_API_KEY in environment.");

  const nextKey = JSON.stringify(bbox);

  // If bbox changed, force reconnect + clear old positions
  if (store.bboxKey && store.bboxKey !== nextKey) {
    closeWs(store);
    store.positionsByKey.clear();
    store.lastMessageISO = null;
    store.lastError = null;
  }

  store.bboxKey = nextKey;

  // Already have a WS that is OPEN or CONNECTING
  if (store.ws && (store.ws.readyState === 0 || store.ws.readyState === 1)) return;

  const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
  store.ws = ws;
  store.lastConnectISO = new Date().toISOString();
  store.lastError = null;

  ws.addEventListener("open", () => {
    const msg = {
      APIKey: key,
      BoundingBoxes: bbox,
      FilterMessageTypes: ["PositionReport", "ShipStaticData"],
    };
    ws.send(JSON.stringify(msg));
  });

  ws.addEventListener("message", (evt) => {
    store.lastMessageISO = new Date().toISOString();

    try {
      const raw = typeof evt.data === "string" ? evt.data : "";
      if (!raw) return;

      const parsed = JSON.parse(raw);
      const messageType: string | undefined = parsed?.MessageType;
      const msg = parsed?.Message;

      // Some frames are keepalives/acks without MessageType
      if (!messageType || !msg) return;

      if (messageType === "PositionReport") {
        // Accept BOTH shapes:
        // msg.PositionReport.Latitude OR msg.Latitude
        const pr = msg?.PositionReport ?? msg;

        const lat = toNum(pr?.Latitude ?? pr?.Lat ?? pr?.latitude);
        const lon = toNum(pr?.Longitude ?? pr?.Lon ?? pr?.longitude);
        if (lat == null || lon == null) return;

        const imo = cleanId(pr?.IMO ?? msg?.IMO);
        const mmsi = cleanId(pr?.MMSI ?? msg?.MMSI);

        const keyId =
          imo && /^\d{7}$/.test(imo)
            ? `IMO:${imo}`
            : mmsi && /^\d{9}$/.test(mmsi)
              ? `MMSI:${mmsi}`
              : null;

        if (!keyId) return;

        const prev = store.positionsByKey.get(keyId);

        const sog = toNum(pr?.Sog ?? pr?.SOG ?? pr?.SpeedOverGround);
        const cog = toNum(pr?.Cog ?? pr?.COG ?? pr?.CourseOverGround);

        store.positionsByKey.set(keyId, {
          imo,
          mmsi,
          lat,
          lon,
          sog: sog ?? prev?.sog,
          cog: cog ?? prev?.cog,
          lastSeenISO: new Date().toISOString(),
        });

        return;
      }

      if (messageType === "ShipStaticData") {
        // Accept BOTH shapes:
        // msg.ShipStaticData.IMO OR msg.IMO
        const sd = msg?.ShipStaticData ?? msg;

        const imo = cleanId(sd?.IMO ?? msg?.IMO);
        const mmsi = cleanId(sd?.MMSI ?? msg?.MMSI);

        // If we already have MMSI position, mirror it under IMO key
        if (!mmsi || !/^\d{9}$/.test(mmsi)) return;

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
    store.ws = null;
  });

  ws.addEventListener("error", () => {
    store.lastError = "WebSocket error";
    store.ws = null;
  });
}

export async function GET(req: Request) {
  const store = ensureStore();

  try {
    const { searchParams } = new URL(req.url);
    const { preset, cityHall, bbox } = presetConfig(searchParams.get("preset"));

    await connectIfNeeded(bbox);

    const rows: SnapshotRow[] = [];
    for (const v of store.positionsByKey.values()) {
      const distanceMi = haversineMiles(cityHall.lat, cityHall.lon, v.lat, v.lon);
      rows.push({ ...v, distanceMi });
    }

    rows.sort((a, b) => a.distanceMi - b.distanceMi);

    return NextResponse.json({
      ok: true,
      preset,
      cityHall,
      bbox,
      lastConnectISO: store.lastConnectISO,
      lastMessageISO: store.lastMessageISO,
      lastError: store.lastError,
      wsReadyState: store.ws ? store.ws.readyState : null,
      count: rows.length,
      vessels: rows.slice(0, 200),
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: e?.message || "AIS stream error",
        lastConnectISO: store.lastConnectISO,
        lastMessageISO: store.lastMessageISO,
        lastError: store.lastError,
        wsReadyState: store.ws ? store.ws.readyState : null,
      },
      { status: 500 }
    );
  }
}
