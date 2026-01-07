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
  var __AISSTREAM__:
    | {
        ws: WebSocket | null;
        lastConnectISO: string | null;
        lastMessageISO: string | null;
        lastError: string | null;
        bboxKey: string | null;

        // Positions keyed by MMSI and sometimes mirrored under IMO
        positionsByKey: Map<string, AisPosition>;

        // Static mapping so ShipStaticData can arrive before PositionReport
        imoByMmsi: Map<string, string>;

        // debug
        lastRaw?: string | null;
        lastParsedType?: string | null;
        lastParsedKeys?: string[] | null;
      }
    | undefined;
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
      imoByMmsi: new Map<string, string>(),
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

  // Savannah bbox (SW, NE) in [lat, lon] pairs
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

// Normalize evt.data into a UTF-8 string
async function dataToText(d: any): Promise<string> {
  if (typeof d === "string") return d;

  // Blob (common in some runtimes)
  if (d && typeof d === "object" && typeof d.text === "function") {
    return await d.text();
  }

  // Buffer or ArrayBuffer
  if (d && typeof d?.toString === "function") {
    return d.toString("utf8");
  }
  if (d instanceof ArrayBuffer) {
    return Buffer.from(d).toString("utf8");
  }
  if (ArrayBuffer.isView(d)) {
    return Buffer.from(d.buffer).toString("utf8");
  }

  return "";
}

async function connectIfNeeded(bbox: BBox) {
  const store = ensureStore();

  const key = process.env.AISSTREAM_API_KEY;
  if (!key) throw new Error("Missing AISSTREAM_API_KEY in environment.");

  const nextKey = JSON.stringify(bbox);

  if (store.bboxKey && store.bboxKey !== nextKey) {
    closeWs(store);
    store.positionsByKey.clear();
    store.imoByMmsi.clear();
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
    try {
      ws.send(
        JSON.stringify({
          APIKey: key,

          // IMPORTANT: AISStream expects an array of bboxes, each bbox is [[swLat,swLon],[neLat,neLon]]
          // Your bbox var is already that shape.
          BoundingBoxes: bbox,

          // FIX 1: include Class B position reports so we don't miss vessels like 431332000
          FilterMessageTypes: [
            "PositionReport",
            "StandardClassBPositionReport",
            "ExtendedClassBPositionReport",
            "ShipStaticData",
          ],
        })
      );
    } catch {
      store.lastError = "Failed to send subscription";
    }
  });

  ws.addEventListener("message", async (evt) => {
    store.lastMessageISO = new Date().toISOString();

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d: any = (evt as any).data;
      const raw = await dataToText(d);

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

      store.lastParsedKeys = msg ? Object.keys(msg) : null;

      const prA = msg?.PositionReport ?? null;
      const prB = msg?.StandardClassBPositionReport ?? null;
      const prBext = msg?.ExtendedClassBPositionReport ?? null;
      const sd = msg?.ShipStaticData ?? null;

      if (mt === "ShipStaticData") {
        const sdObj = sd ?? msg;
        const mmsi = pickMmsi(parsed, msg, null, sdObj);
        const imo = pickImo(msg, null, sdObj);

        if (mmsi && /^\d{9}$/.test(mmsi) && imo) {
          store.imoByMmsi.set(mmsi, imo);

          // If we already have position under MMSI, patch it + mirror under IMO
          const mmsiKey = `MMSI:${mmsi}`;
          const rec = store.positionsByKey.get(mmsiKey);
          if (rec) {
            const patched = { ...rec, mmsi, imo };
            store.positionsByKey.set(mmsiKey, patched);
            store.positionsByKey.set(`IMO:${imo}`, patched);
          }
        }

        return;
      }

      // FIX 2: handle PositionReport + BOTH Class B position report types
      if (
        mt === "PositionReport" ||
        mt === "StandardClassBPositionReport" ||
        mt === "ExtendedClassBPositionReport"
      ) {
        const prObj = prA ?? prB ?? prBext ?? msg;

        const ll = pickLatLon(prObj);
        if (!ll) return;

        const mmsi = pickMmsi(parsed, msg, prObj, null);
        if (!mmsi || !/^\d{9}$/.test(mmsi)) return;

        const keyId = `MMSI:${mmsi}`;
        const prev = store.positionsByKey.get(keyId);

        const { sog, cog } = pickSogCog(prObj);

        const imoFromStatic = store.imoByMmsi.get(mmsi) || null;

        const next: AisPosition = {
          imo: imoFromStatic || prev?.imo,
          mmsi,
          lat: ll.lat,
          lon: ll.lon,
          sog: sog != null ? sog : prev?.sog,
          cog: cog != null ? cog : prev?.cog,
          lastSeenISO: new Date().toISOString(),
        };

        store.positionsByKey.set(keyId, next);

        if (next.imo && /^\d{7}$/.test(next.imo)) {
          store.positionsByKey.set(`IMO:${next.imo}`, next);
        }

        return;
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

    // FIX 3: dedupe so we don't return duplicates from MMSI + IMO mirrored entries
    // Prefer MMSI records, and attach IMO if we have it.
    const byMmsi = new Map<string, AisPosition>();

    for (const [k, v] of store.positionsByKey.entries()) {
      // Only use MMSI:* as the canonical row
      if (!k.startsWith("MMSI:")) continue;
      const mmsi = (v.mmsi || "").trim();
      if (!/^\d{9}$/.test(mmsi)) continue;

      const imo = store.imoByMmsi.get(mmsi) || v.imo;
      byMmsi.set(mmsi, { ...v, mmsi, imo });
    }

    const rows: SnapshotRow[] = [];
    for (const v of byMmsi.values()) {
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
