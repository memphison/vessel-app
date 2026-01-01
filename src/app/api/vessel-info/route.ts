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

  // NOTE: This is a best-effort HTML scrape of a public page.
  // Some sites may block automated requests. For production, use an AIS/data provider API.
  const url = `https://www.vesselfinder.com/vessels/details/${imo}`;

  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: {
        // Helps avoid simple bot blocks
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch vessel page (network error)." },
      { status: 502 }
    );
  }

  if (!resp.ok) {
    return NextResponse.json(
      { error: `Failed to fetch vessel page: ${resp.status}` },
      { status: 502 }
    );
  }

  const html = await resp.text();

  // Very lightweight parsing: look for "Length Overall" and "Beam"
  function pick(label: string) {
    // Matches: Label ... </td><td>VALUE</td>
    const re = new RegExp(
      `${label}[\s\S]{0,400}?</td>\s*<td[^>]*>\s*([^<]+)\s*<`,
      "i"
    );
    const m = html.match(re);
    return m ? m[1].trim() : null;
  }

  const loa = pick("Length Overall");
  const beam = pick("Beam");

  return NextResponse.json({
    ok: true,
    imo,
    source: "vesselfinder-html",
    loa,
    beam,
    note:
      "Dimensions only from a public page. Live position will require an AIS provider or API.",
  });
}
