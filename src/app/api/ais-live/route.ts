import { NextResponse } from "next/server";

type BBox = [[[number, number], [number, number]]];

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

const CITY_HALL = { lat: 32.0809, lon: -81.0912 };

// Your tighter bbox:
// SW: 31.968366, -81.169962
// NE: 32.165465, -80.762266
const BBOX: BBox = [[[31.968366, -81.169962], [32.165465, -80.762266]]];

function haversineMiles(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 3958.7613; // miles
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);

  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);

  const h =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * (sinDLon * sinDLon);

  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function inBbox(lat: number, lon: number) {
  const [[minLat, minLon], [maxLat, maxLon]] = BBOX[0];
  return lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon;
}

export async function GET() {
  const apiKey = process.env.AISSTREAM_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "Missing AISSTREAM_API_KEY" },
      { status: 500 }
    );
  }

  // Collect for a short window so this works on Vercel serverless too.
  const SAMPLE_MS = 2200;

  const positionsByKey: Record<string, AisVessel> = {};
  const nowISO = () => new Date().toISOString();

  const wsUrl = "wss://stream.aisstream.io/v0/stream";

  // NOTE: WebSocket is available in Next.js route handlers (Node runtime).
  const ws = new WebSocket(wsUrl);

  const done = new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      try {
        ws.close();
      } catch {}
      resolve();
    }, SAMPLE_MS);

    ws.onopen = () => {
      const msg = {
        APIKey: apiKey,
        BoundingBoxes: BBOX,
        FilterMessageTypes: ["PositionReport", "ShipStaticData"],
      };
      ws.send(JSON.stringify(msg));
    };

    ws.onmessage = (event) => {
      try {
        const raw = JSON.parse(String(event.data || "{}"));

        // AISStream message shape can vary. We’ll handle the common cases:
        const pr =
          raw?.Message?.PositionReport ??
          raw?.Message?.StandardClassBPositionReport ??
          raw?.Message?.ExtendedClassBPositionReport ??
          raw?.PositionReport ??
          null;

        const sd = raw?.Message?.ShipStaticData ?? raw?.ShipStaticData ?? null;

        // Prefer position report when available
        const lat = pr?.Latitude ?? pr?.lat;
        const lon = pr?.Longitude ?? pr?.lon;

        // Identify vessel
        const mmsi =
          String(pr?.UserID ?? pr?.MMSI ?? sd?.UserID ?? sd?.MMSI ?? "").trim() || undefined;

        // AISStream sometimes supplies IMO in static data
        const imo =
          String(sd?.IMO ?? sd?.ImoNumber ?? sd?.IMO_Number ?? "").trim() || undefined;

        if (typeof lat !== "number" || typeof lon !== "number") return;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        if (!inBbox(lat, lon)) return;

        const sogRaw = pr?.Sog ?? pr?.SpeedOverGround ?? pr?.SOG;
        const cogRaw = pr?.Cog ?? pr?.CourseOverGround ?? pr?.COG;

        const sog =
          typeof sogRaw === "number" && Number.isFinite(sogRaw) ? sogRaw : undefined;

        // Some feeds use 511/3600/etc for invalid. Filter the obvious invalids.
        let cog: number | undefined =
          typeof cogRaw === "number" && Number.isFinite(cogRaw) ? cogRaw : undefined;

        if (cog != null && (cog === 511 || cog < 0 || cog > 360)) cog = undefined;

        const key = imo && /^\d{7}$/.test(imo) ? `imo:${imo}` : mmsi ? `mmsi:${mmsi}` : null;
        if (!key) return;

        positionsByKey[key] = {
          imo: imo && /^\d{7}$/.test(imo) ? imo : undefined,
          mmsi,
          lat,
          lon,
          sog,
          cog,
          lastSeenISO: nowISO(),
          distanceMi: haversineMiles(CITY_HALL, { lat, lon }),
        };
      } catch {
        // ignore bad frames
      }
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      try {
        ws.close();
      } catch {}
      resolve();
    };

    ws.onclose = () => {
      clearTimeout(timeout);
      resolve();
    };
  });

  await done;

  const vessels = Object.values(positionsByKey);

  return NextResponse.json({
    ok: true,
    cityHall: CITY_HALL,
    count: vessels.length,
    vessels,
    lastConnectISO: new Date().toISOString(),
  });
}
