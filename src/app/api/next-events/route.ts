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

  // IMO/Lloyd's ID (7 digits) when available
  lloyds_id?: string;

  // Estimated times
  eta_date?: string;
  eta_time?: string;
  etd_date?: string;
  etd_time?: string;

  // Actual times (when available)
  ata_date?: string;
  ata_time?: string;
  atd_date?: string;
  atd_time?: string;
};

type VesselEvent = {
  type: "ARRIVAL" | "DEPARTURE";
  timeISO: string;
  timeLabel: string; // M/D/YY h:mm AM/PM in TZ
  timeType: "ACTUAL" | "ESTIMATED";
  vesselName: string;
  imo?: string; // 7-digit IMO (from lloyds_id)
  service?: string;
  operator?: string;
  berth?: string;
  status?: string;
};

function parseDT(dateStr?: string, timeStr?: string): DateTime | null {
  const d = (dateStr || "").trim();
  const t = (timeStr || "").trim();
  if (!d || !t) return null;

  const dt = DateTime.fromFormat(`${d} ${t}`, "MM/dd/yy HH:mm", { zone: TZ });
  return dt.isValid ? dt : null;
}

// Prefer actual date/time when valid; otherwise fall back to estimated.
function bestDT(
  actualDate?: string,
  actualTime?: string,
  estDate?: string,
  estTime?: string
): { dt: DateTime | null; timeType: "ACTUAL" | "ESTIMATED" | null } {
  const actual = parseDT(actualDate, actualTime);
  if (actual) return { dt: actual, timeType: "ACTUAL" };

  const estimated = parseDT(estDate, estTime);
  if (estimated) return { dt: estimated, timeType: "ESTIMATED" };

  return { dt: null, timeType: null };
}

function hoursFromWindow(window: string): number {
  if (window === "24h") return 24;
  if (window === "3h") return 3;
  if (window === "2h") return 2;
  return 1;
}

function normalizeIMO(lloydsId?: string): string | undefined {
  const imo = (lloydsId || "").trim();
  return /^\d{7}$/.test(imo) ? imo : undefined;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const window = (searchParams.get("window") || "1h").toLowerCase();
  const dir = (searchParams.get("dir") || "next").toLowerCase(); // "next" | "past"

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
  const hours = hoursFromWindow(window);

  const windowStart = dir === "past" ? now.minus({ hours }) : now;
  const windowEnd = dir === "past" ? now : now.plus({ hours });

  const events: VesselEvent[] = [];

  for (const row of rows) {
    const imo = normalizeIMO(row.lloyds_id);

    // ARRIVAL: ATA first, else ETA
    const arr = bestDT(row.ata_date, row.ata_time, row.eta_date, row.eta_time);
    if (arr.dt && arr.timeType && arr.dt >= windowStart && arr.dt <= windowEnd) {
      events.push({
        type: "ARRIVAL",
        timeISO: arr.dt.toISO()!,
        timeLabel: arr.dt.toFormat("M/d/yy h:mm a"),
        timeType: arr.timeType,
        vesselName: row.name || "Unknown",
        imo,
        service: row.service,
        operator: row.vsl_operator,
        berth: row.berth,
        status: row.status,
      });
    }

    // DEPARTURE: ATD first, else ETD
    const dep = bestDT(row.atd_date, row.atd_time, row.etd_date, row.etd_time);
    if (dep.dt && dep.timeType && dep.dt >= windowStart && dep.dt <= windowEnd) {
      events.push({
        type: "DEPARTURE",
        timeISO: dep.dt.toISO()!,
        timeLabel: dep.dt.toFormat("M/d/yy h:mm a"),
        timeType: dep.timeType,
        vesselName: row.name || "Unknown",
        imo,
        service: row.service,
        operator: row.vsl_operator,
        berth: row.berth,
        status: row.status,
      });
    }
  }

  events.sort((a, b) => (a.timeISO < b.timeISO ? -1 : 1));

  return NextResponse.json({
    dir,
    window,
    now: now.toISO(),
    windowStart: windowStart.toISO(),
    windowEnd: windowEnd.toISO(),
    events,
    totalInWindow: events.length,
  });
}
