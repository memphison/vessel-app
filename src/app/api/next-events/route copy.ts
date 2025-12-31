import { NextResponse } from "next/server";
import { DateTime } from "luxon";

const SOURCE_URL =
  "https://gaports.com/wp-content/uploads/ftp-files/vessel_gct_data.json";

const TZ = "America/New_York";

type VesselRow = {
  name?: string;
  service?: string;
  vsl_operator?: string;
  berth?: string;
  status?: string;
  eta_date?: string;
  eta_time?: string;
  etd_date?: string;
  etd_time?: string;
};

type VesselEvent = {
  type: "ARRIVAL" | "DEPARTURE";
  timeISO: string;
  timeLabel: string;
  vesselName: string;
  service?: string;
  operator?: string;
  berth?: string;
  status?: string;
};

function parseDT(dateStr?: string, timeStr?: string): DateTime | null {
  const d = (dateStr || "").trim();
  const t = (timeStr || "").trim();
  if (!d || !t) return null;

  const dt = DateTime.fromFormat(`${d} ${t}`, "MM/dd/yy HH:mm", {
    zone: TZ,
  });

  return dt.isValid ? dt : null;
}


export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const window = (searchParams.get("window") || "1h").toLowerCase();

  const resp = await fetch(SOURCE_URL, { cache: "no-store" });

  if (!resp.ok) {
    return NextResponse.json(
      { error: `Failed to fetch source JSON: ${resp.status}` },
      { status: 500 }
    );
  }

  const payload = await resp.json();
  const rows: VesselRow[] = payload?.data || [];

  const now = DateTime.now().setZone(TZ);

  let windowEnd: DateTime;
  if (window === "3h") {
    windowEnd = now.plus({ hours: 3 });
  } else if (window === "today") {
    windowEnd = now.endOf("day");
  } else {
    windowEnd = now.plus({ hours: 1 });
  }

  const events: VesselEvent[] = [];

  for (const row of rows) {
    const eta = parseDT(row.eta_date, row.eta_time);
    const etd = parseDT(row.etd_date, row.etd_time);

    if (eta && eta >= now && eta <= windowEnd) {
      events.push({
        type: "ARRIVAL",
        timeISO: eta.toISO()!,
        timeLabel: eta.toFormat("h:mm a"),
        vesselName: row.name || "Unknown",
        service: row.service,
        operator: row.vsl_operator,
        berth: row.berth,
        status: row.status,
      });
    }

    if (etd && etd >= now && etd <= windowEnd) {
      events.push({
        type: "DEPARTURE",
        timeISO: etd.toISO()!,
        timeLabel: etd.toFormat("h:mm a"),
        vesselName: row.name || "Unknown",
        service: row.service,
        operator: row.vsl_operator,
        berth: row.berth,
        status: row.status,
      });
    }
  }

  events.sort((a, b) => (a.timeISO < b.timeISO ? -1 : 1));

  return NextResponse.json({
    window,
    now: now.toISO(),
    windowEnd: windowEnd.toISO(),
    nextFive: events.slice(0, 5),
    totalInWindow: events.length,
  });
}

