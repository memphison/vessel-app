import { NextResponse } from "next/server";

// -----------------------------
// Simple in-memory cache
// -----------------------------

type CacheEntry = {
  data: any;
  expiresAt: number;
};

const TTL = 24 * 60 * 60 * 1000; // 24 hours
const vesselInfoCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<any>>();

// -----------------------------
// Helpers
// -----------------------------

function extractText(html: string, regex: RegExp): string | null {
  const m = html.match(regex);
  return m && m[1] ? m[1].trim() : null;
}

// -----------------------------
// Route
// -----------------------------

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const imo = (searchParams.get("imo") || "").trim();

    if (!/^\d{7}$/.test(imo)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const now = Date.now();

    // 1) Serve from cache if valid
    const cached = vesselInfoCache.get(imo);
    if (cached && cached.expiresAt > now) {
      return NextResponse.json(cached.data);
    }

    // 2) If already fetching this IMO, wait for it
    if (inflight.has(imo)) {
      const data = await inflight.get(imo)!;
      return NextResponse.json(data);
    }

    // 3) Fetch + parse VesselFinder (wrapped)
    const fetchPromise = (async () => {
      const resp = await fetch(
        `https://www.vesselfinder.com/vessels/details/${imo}`,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
          },
        }
      );

      if (!resp.ok) {
        throw new Error("VesselFinder request failed");
      }

      const html = await resp.text();

      // -----------------------------
      // Parsing (same approach you had)
      // -----------------------------

      const lengthM =
        extractText(html, /Length overall<\/td>\s*<td[^>]*>(.*?)<\/td>/i) ??
        null;

      const widthM =
        extractText(html, /Breadth<\/td>\s*<td[^>]*>(.*?)<\/td>/i) ??
        null;

      const vesselType =
        extractText(html, /Vessel type<\/td>\s*<td[^>]*>(.*?)<\/td>/i) ??
        null;

      const yearBuilt =
        extractText(html, /Year of build<\/td>\s*<td[^>]*>(.*?)<\/td>/i) ??
        null;

      const grossTonnage =
        extractText(html, /Gross tonnage<\/td>\s*<td[^>]*>(.*?)<\/td>/i) ??
        null;

      const flag =
        extractText(html, /Flag<\/td>\s*<td[^>]*>(.*?)<\/td>/i) ??
        null;

      const result = {
        ok: true,
        imo,
        lengthM,
        widthM,
        vesselType,
        yearBuilt,
        grossTonnage,
        flag,
      };

      // Cache successful result
      vesselInfoCache.set(imo, {
        data: result,
        expiresAt: Date.now() + TTL,
      });

      return result;
    })();

    inflight.set(imo, fetchPromise);

    try {
      const data = await fetchPromise;
      return NextResponse.json(data);
    } finally {
      inflight.delete(imo);
    }
  } catch (err) {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
