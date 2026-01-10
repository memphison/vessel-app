import { NextResponse } from "next/server";

// This is the ais-live route file
export const runtime = "nodejs"; // WebSocket not supported in Edge

type BBox = [[[number, number], [number, number]]];

type AisPosition = {
  imo?: string;
  mmsi?: string;
  name?: string | null;
  callsign?: string | null;
  shipType?: string | number | null;
  lat: number;
  lon: number;
  sog?: number;
  cog?: number;
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
        positionsByKey: Map<string, AisPosition>;
        imoByMmsi: Map<string, string>;
        staticByMmsi: Map<
          string,
          { name?: string | null; callsign?: string | null; shipType?: any | null }
        >;
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
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
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
      positionsByKey: new Map(),
      imoByMmsi: new Map(),
      staticByMmsi: new Map(),
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
    return {
      preset: "ny",
      cityHall: { lat: 40.7128, lon: -74.006 },
      bbox: [[[40.45, -74.35], [40.95, -73.6]]] as BBox,
    };
  }

  return {
    preset: "sav",
    cityHall: { lat: 32.08077, lon: -81.0903 },
    bbox: [[[31.968366, -81.169962], [32.190078, -80.623403]]] as BBox,
  };
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
  const sog = Number(pr?.Sog ?? pr?.sog ?? pr?.SpeedOverGround);
  const cog = Number(pr?.Cog ?? pr?.cog ?? pr?.CourseOverGround);

  return {
    sog: Number.isFinite(sog) ? sog : undefined,
    cog: Number.isFinite(cog) ? cog : undefined,
  };
}


async function dataToText(d: any): Promise<string> {
  if (typeof d === "string") return d;
  if (d?.text) return await d.text();
  if (d?.toString) return d.toString("utf8");
  return "";
}

async function connectIfNeeded(bbox: BBox) {
  const store = ensureStore();
  const key = process.env.AISSTREAM_API_KEY;
  if (!key) throw new Error("Missing AISSTREAM_API_KEY");

  const bboxKey = JSON.stringify(bbox);
  if (store.bboxKey !== bboxKey) {
    store.ws?.close();
    store.positionsByKey.clear();
    store.imoByMmsi.clear();
    store.staticByMmsi.clear();
    store.bboxKey = bboxKey;
  }

  if (store.ws) return;

  const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
  store.ws = ws;
  store.lastConnectISO = new Date().toISOString();

  ws.addEventListener("open", () => {
    ws.send(
      JSON.stringify({
        APIKey: key,
        BoundingBoxes: bbox,
        FilterMessageTypes: [
          "PositionReport",
          "StandardClassBPositionReport",
          "ExtendedClassBPositionReport",
          "ShipStaticData",
        ],
      })
    );
  });

  ws.addEventListener("message", async (evt) => {
    store.lastMessageISO = new Date().toISOString();
    const raw = await dataToText((evt as any).data);
    if (!raw) return;

    store.lastRaw = raw;
    const parsed = JSON.parse(raw);
    const mt = parsed?.MessageType;
    const msg = parsed?.Message;
    if (!mt || !msg) return;

    if (mt === "ShipStaticData") {
      const mmsi = pickMmsi(parsed, msg, null, msg);
      if (!mmsi) return;

      store.staticByMmsi.set(mmsi, {
        name: normStr(msg?.Name || msg?.ShipName),
        callsign: normStr(msg?.CallSign),
        shipType: msg?.ShipType ?? null,
      });

      const imo = pickImo(msg, null, msg);
      if (imo) store.imoByMmsi.set(mmsi, imo);
      return;
    }

    if (
      mt === "PositionReport" ||
      mt === "StandardClassBPositionReport" ||
      mt === "ExtendedClassBPositionReport"
    ) {
      const ll = pickLatLon(msg);
      if (!ll) return;

      const mmsi = pickMmsi(parsed, msg, msg, null);
      if (!mmsi) return;

      const st = store.staticByMmsi.get(mmsi);
      const { sog, cog } = pickSogCog(msg);

      store.positionsByKey.set(`MMSI:${mmsi}`, {
        mmsi,
        imo: store.imoByMmsi.get(mmsi),
        lat: ll.lat,
        lon: ll.lon,
        sog,
        cog,
        name: st?.name ?? null,
        callsign: st?.callsign ?? null,
        shipType: st?.shipType ?? null,
        lastSeenISO: new Date().toISOString(),
      });
    }
  });

  ws.addEventListener("close", () => {
    store.ws = null;
  });
}

export async function GET(req: Request) {
  const store = ensureStore();
  const { searchParams } = new URL(req.url);
  const { preset, cityHall, bbox } = presetConfig(searchParams.get("preset"));

  await connectIfNeeded(bbox);

  const rows: SnapshotRow[] = [];

  for (const v of store.positionsByKey.values()) {
    const distanceMi = haversineMiles(
      cityHall.lat,
      cityHall.lon,
      v.lat,
      v.lon
    );
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
    wsReadyState: store.ws?.readyState ?? null,
    count: rows.length,
    vessels: rows.slice(0, 200),
  });
}
