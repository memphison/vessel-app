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
    bboxKey: string | null;
    positionsByKey: Map<string, AisPosition>;

    // tiny debug helpers (safe)
    lastRaw?: string | null;
    lastParsedType?: string | null;
    lastParsedKeys?: string[] | null;
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

      lastRaw: null,
      lastParsedType: null,
      lastParsedKeys: null,
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

  // TIGHTER Savannah River box (SW, NE) using your provided corners
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

function normStr(v: any) {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}

function pickMmsi(parsed: any, msg: any, pr: any, sd: any) {
  // AISStream often includes MMSI in MetaData
  return (
    normStr(parsed?.MetaData?.MMSI) ||
    normStr(pr?.MMSI) ||
    normStr(msg?.MMSI) ||
    normStr(sd?.MMSI) ||
    normStr(sd?.UserID) ||
    normStr(parsed?.UserID) ||
    null
  );
}

function pickImo(msg: any, pr: any, sd: any) {
  // IMO is usually present in ShipStaticData (ImoNumber), sometimes also as IMO
  const imo =
    normStr(sd?.ImoNumber) ||
    normStr(sd?.IMO) ||
    normStr(msg?.IMO) ||
    normStr(pr?.IMO) ||
    null;

  return imo && /^\d{7}$/.test(imo) ? imo : null;
}

function pickLatLon(pr: any) {
  const lat = Number(pr?.Latitude ?? pr?.lat ?? pr?.latitude);
  const lon = Number(pr?.Longitude ?? pr?.lon ?? pr?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function pickSogCog(pr: any) {
  const sogRaw = pr?.Sog ?? pr?.sog ?? pr?.SpeedOverGround;
  const cogRaw = pr?.Cog ?? pr?.cog ?? pr?.CourseOverGround;

  const sog = sogRaw != null && sogRaw !== "" ? Number(sogRaw) : null;
  const cog = cogRaw != null && cogRaw !== "" ? Number(cogRaw) : null;

  return {
    sog: Number.isFinite(sog as number) ? (sog as number) : null,
    cog: Number.isFinite(cog as number) ? (cog as number) : null,
  };
}

async function connectIfNeeded(bbox: BBox) {
  const store = ensureStore();

  const key = process.env.AISSTREAM_API_KEY;
  if (!key) throw new Error("Missing AISSTREAM_API_KEY in environment.");

  const nextKey = JSON.stringify(bbox);

  if (store.bboxKey && store.bboxKey !== nextKey) {
    closeWs(store);
    store.positionsByKey.clear();
    store.lastMessageISO = null;
    store.lastError = null;
  }

  store.bboxKey = nextKey;

  if (store.ws && (store.ws.readyState === 0 || store.ws.readyState === 1)) return;

  const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
  store.ws = ws;
  store.lastConnectISO = new Date().toISOString();
  store.lastError = null;

  ws.addEventListener("open", () => {
    ws.send(
      JSON.stringify({
        APIKey: key,
        BoundingBoxes: bbox,
        FilterMessageTypes: ["PositionReport", "ShipStaticData"],
      })
    );
  });

  ws.addEventListener("message", (evt) => {
    store.lastMessageISO = new Date().toISOString();

    try {
     let raw = "";

// Node WebSocket often delivers Buffer or ArrayBuffer
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const d: any = (evt as any).data;

if (typeof d === "string") {
  raw = d;
} else if (d && typeof d === "object") {
  // Buffer (common in Node)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const maybeBuffer: any = d;
  if (typeof maybeBuffer?.toString === "function") {
    raw = maybeBuffer.toString("utf8");
  } else if (d instanceof ArrayBuffer) {
    raw = Buffer.from(d).toString("utf8");
  } else if (ArrayBuffer.isView(d)) {
    raw = Buffer.from(d.buffer).toString("utf8");
  }
}

if (!raw) {
  store.lastRaw = null;
  store.lastParsedType = null;
  store.lastParsedKeys = null;
  return;
}

store.lastRaw = raw;

const parsed = JSON.parse(raw);

      const mt = String(parsed?.MessageType || "").trim();
      store.lastParsedType = mt || null;

      const msg = parsed?.Message;
      if (!mt || !msg) return;

      // Helpful for debugging what the message shape is
      store.lastParsedKeys = msg ? Object.keys(msg) : null;

      // AISStream layouts:
      // - Message.PositionReport.{Latitude,Longitude,Sog,Cog...}
      // - Message.ShipStaticData.{MMSI,ImoNumber...}
      const pr = msg?.PositionReport ?? null;
      const sd = msg?.ShipStaticData ?? null;

      if (mt === "PositionReport") {
        const prObj = pr ?? msg; // fallback if provider ever flattens fields
        const ll = pickLatLon(prObj);
        if (!ll) return;

        const mmsi = pickMmsi(parsed, msg, prObj, null);
        if (!mmsi || !/^\d{9}$/.test(mmsi)) return;

        const keyId = `MMSI:${mmsi}`;
        const prev = store.positionsByKey.get(keyId);

        const { sog, cog } = pickSogCog(prObj);

        store.positionsByKey.set(keyId, {
          imo: prev?.imo,
          mmsi,
          lat: ll.lat,
          lon: ll.lon,
          sog: sog != null ? sog : prev?.sog,
          cog: cog != null ? cog : prev?.cog,
          lastSeenISO: new Date().toISOString(),
        });
      }

      if (mt === "ShipStaticData") {
        const sdObj = sd ?? msg;

        const mmsi = pickMmsi(parsed, msg, null, sdObj);
        const imo = pickImo(msg, null, sdObj);

        if (!mmsi || !/^\d{9}$/.test(mmsi)) return;

        const mmsiKey = `MMSI:${mmsi}`;
        const rec = store.positionsByKey.get(mmsiKey);

        // If we already have a position for this MMSI, attach IMO and also mirror under IMO key
        if (rec) {
          const patched = { ...rec, mmsi, imo: imo ?? rec.imo };
          store.positionsByKey.set(mmsiKey, patched);

          if (imo) {
            store.positionsByKey.set(`IMO:${imo}`, patched);
          }
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

    const debug = searchParams.get("debug") === "1";

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

      ...(debug
        ? {
            debug: {
              lastParsedType: store.lastParsedType,
              lastParsedKeys: store.lastParsedKeys,
              lastRawPreview: store.lastRaw ? store.lastRaw.slice(0, 280) : null,
            },
          }
        : null),
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
