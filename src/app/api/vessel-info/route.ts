import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const imo = (searchParams.get("imo") || "").trim();

  if (!/^\d{7}$/.test(imo)) {
    return NextResponse.json(
      { error: "Invalid IMO (expected 7 digits)." },
      { status: 400 }
    );
  }

  // Public vessel particulars page by IMO (dimensions often available)
  const url = `https://www.vesselfinder.com/vessels/details/${imo}`;

  const resp = await fetch(url, {
    headers: {
      // Helps avoid simple bot blocks
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
    cache: "no-store",
  });

  if (!resp.ok) {
    return NextResponse.json(
      { error: `Failed to fetch vessel page: ${resp.status}` },
      { status: 502 }
    );
  }

  const html = await resp.text();

    // Very lightweight parsing: look for “Label ... </td><td>VALUE</td>”
  // Note: In JS strings, regex escapes like \s must be written as \\s.
  function pick(label: string) {
    const re = new RegExp(
      `${label}[\\s\\S]{0,220}?</td>\\s*<td[^>]*>\\s*([^<]+)\\s*<`,
      "i"
    );
    const m = html.match(re);
    return m ? m[1].trim() : null;
  }

  function pickTdText(label: string) {
    const re = new RegExp(
      `${label}[\\s\\S]{0,220}?</td>\\s*<td[^>]*>([\\s\\S]{0,400}?)</td>`,
      "i"
    );
    const m = html.match(re);
    if (!m) return null;

    const inner = m[1]
      .replace(/<[^>]*>/g, " ")  // remove tags
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    return inner || null;
  }



  // Extract 1 or 2 meter values from strings like:
  // "262 / 32 m", "262m / 32m", "262.0 m / 32.2 m"
  function extractMetersPair(
    v?: string | null
  ): { a: string | null; b: string | null } {
    if (!v) return { a: null, b: null };

    const nums = (v.match(/\d+(?:\.\d+)?/g) || []).slice(0, 2);
    const a = nums[0] ? `${nums[0]}m` : null;
    const b = nums[1] ? `${nums[1]}m` : null;
    return { a, b };
  }

  // Try common variants across different VF layouts:
  const rawLengthOverall = pick("Length Overall");
  const rawBeam = pick("Beam");

  // Some pages use a combined label like "Length / Beam"
  const rawLenBeam =
    pick("Length / Beam") ||
    pick("Length/Beam") ||
    pick("Length / Breadth") ||
    pick("Length/Breadth");

  // Parse meters from combined field first (most reliable for "262 / 32 m")
  const combo = extractMetersPair(rawLenBeam);

  // Parse meters from separate fields as a fallback
  const lengthOnly = extractMetersPair(rawLengthOverall).a;
  const beamOnly = extractMetersPair(rawBeam).a;

  const lengthM = combo.a || lengthOnly;
  const widthM = combo.b || beamOnly;

  // Optional particulars
  const vesselType = pick("Vessel Type");
  const yearBuilt = pick("Year Built");
  const grossTonnage = pick("Gross Tonnage");
  const flag = pickTdText("Flag") ?? pick("Flag");


  return NextResponse.json({
    ok: true,
    imo,
    source: "vesselfinder-html",

    // Preferred in UI
    lengthM,
    widthM,

    // Back-compat with earlier UI keys
    loa: lengthM,
    beam: widthM,

    vesselType,
    yearBuilt,
    grossTonnage,
    flag,

    note:
      "Particulars are scraped from a public page. Live position (lat/lon) will require an AIS provider/API.",
  });
}
