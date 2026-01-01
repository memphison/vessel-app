import { NextResponse } from "next/server";

type VesselInfo = {
  ok: boolean;
  imo: string;
  source: "vesselfinder-html";
  loa: string | null;
  beam: string | null;
  vesselType: string | null;
  yearBuilt: string | null;
  grossTonnage: string | null;
  flag: string | null;
  note: string;
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const imo = (searchParams.get("imo") || "").trim();

  if (!/^\d{7}$/.test(imo)) {
    return NextResponse.json(
      { error: "Invalid IMO (expected 7 digits)." },
      { status: 400 }
    );
  }

  // Public vessel particulars page by IMO (dimensions and particulars often available)
  const url = `https://www.vesselfinder.com/vessels/details/${imo}`;

  const resp = await fetch(url, {
    headers: {
      // Helps avoid simple bot blocks
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
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

  // Lightweight parsing: look for a table row that contains a label and then a value cell.
  function pick(label: string) {
    const safe = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `${safe}[\s\S]{0,260}?</td>\s*<td[^>]*>\s*([^<]+)\s*<`,
      "i"
    );
    const m = html.match(re);
    return m ? m[1].trim() : null;
  }

  function metersOnly(val: string | null) {
  if (!val) return null;

  // Try to capture the FIRST number (e.g. "262", "262.5")
  const m = val.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;

  return `${m[1]}m`;
}


  function pickAny(labels: string[]) {
    for (const l of labels) {
      const v = pick(l);
      if (v) return v;
    }
    return null;
  }

  const loa = metersOnly(pick("Length Overall"));
const beam = metersOnly(pick("Beam"));


  const vesselType = pickAny(["Vessel type", "Vessel Type", "Type"]);
  const yearBuilt = pickAny(["Year Built", "Built"]);
  const grossTonnage = pickAny(["Gross Tonnage", "Gross tonnage", "GT"]);
  const flag = pickAny(["Flag"]);

  const payload: VesselInfo = {
    ok: true,
    imo,
    source: "vesselfinder-html",
    loa,
    beam,
    vesselType,
    yearBuilt,
    grossTonnage,
    flag,
    note:
      "This is static vessel particulars scraped from a public page. Live position requires an AIS provider/API.",
  };

  return NextResponse.json(payload);
}
