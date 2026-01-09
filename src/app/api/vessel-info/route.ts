import { NextResponse } from "next/server";

type VesselInfo = {
  ok: boolean;
  imo?: string;
  mmsi?: string;

  lengthM?: string | null;
  widthM?: string | null;

  loa?: string | null;
  beam?: string | null;

  vesselType?: string | null;
  yearBuilt?: string | null;
  grossTonnage?: string | null;
  flag?: string | null;
};

// -------------------------
// Server-side cache (24h)
// -------------------------
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const cache = new Map<
  string,
  {
    ts: number;
    data: VesselInfo;
  }
>();

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const imo = searchParams.get("imo")?.trim() || null;
  const mmsi = searchParams.get("mmsi")?.trim() || null;

  if (!imo && !mmsi) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const cacheKey = imo ? `imo:${imo}` : `mmsi:${mmsi}`;

  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return NextResponse.json(cached.data);
  }

  try {
    const url = imo
      ? `https://www.vesselfinder.com/vessels/details/${imo}`
      : `https://www.vesselfinder.com/vessels/details/mmsi/${mmsi}`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": "The-Waving-Girl/1.0",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error("VesselFinder request failed");
    }

    const html = await res.text();

    const extract = (label: string) => {
      const re = new RegExp(
        `${label}\\s*</td>\\s*<td[^>]*>([^<]+)`,
        "i"
      );
      const m = html.match(re);
      return m ? m[1].trim() : null;
    };

    const rawSize = extract("Size");

    let lengthM: string | null = null;
    let widthM: string | null = null;

    if (rawSize) {
      const nums = rawSize.match(/\d+(?:\.\d+)?/g);
      if (nums && nums.length >= 2) {
        lengthM = `${nums[0]}m`;
        widthM = `${nums[1]}m`;
      }
    }

    const data: VesselInfo = {
      ok: true,
      imo: imo ?? undefined,
      mmsi: mmsi ?? undefined,

      // Normalized size (used by UI)
      lengthM,
      widthM,

      // Raw fields preserved for fallback
      loa: extract("Length overall"),
      beam: extract("Beam"),

      vesselType: extract("Vessel Type"),
      yearBuilt: extract("Built"),
      grossTonnage: extract("Gross Tonnage"),
      flag: extract("Flag"),
    };

    cache.set(cacheKey, {
      ts: Date.now(),
      data,
    });

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        imo,
        mmsi,
      },
      { status: 500 }
    );
  }
}
