import { NextResponse } from "next/server";
import { DateTime } from "luxon";

// This is the next-events route file

const SOURCE_URL =
  "https://gaports.com/wp-content/uploads/ftp-files/vessel_gct_data.json";

const TZ = "America/New_York";
const LATE_GRACE_MINUTES = 120;

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

function cleanStr(v?: string | null): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function parseDT(dateStr?: string, timeStr?: string): DateTime | null {
  const d = cleanStr(dateStr);
  const t = cleanStr(timeStr);
  if (!d || !t) return null;

  // GA Ports format appears to be "MM/dd/yy" and "HH:mm"
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
  // Supported: 1h, 3h, 24h
  if (window === "24h") return 24;
  if (window === "3h") return 3;
  return 1;
}

function normalizeIMO(lloydsId?: string): string | undefined {
  const imo = cleanStr(lloydsId);
  return imo && /^\d{7}$/.test(imo) ? imo : undefined;
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

    // Grace period: keep missed scheduled times in "next" for a bit
  // Also exclude that same grace window from "past" so late ships do not appear in both lists.
  const windowStart =
    dir === "past"
      ? now.minus({ hours })
      : now.minus({ minutes: LATE_GRACE_MINUTES });

  const windowEnd =
    dir === "past"
      ? now.minus({ minutes: LATE_GRACE_MINUTES })
      : now.plus({ hours });



  const events: VesselEvent[] = [];

  for (const row of rows) {
    const imo = normalizeIMO(row.lloyds_id);

    const vesselName = cleanStr(row.name) || "Unknown";
    const service = cleanStr(row.service);
    const operator = cleanStr(row.vsl_operator);
    const berth = cleanStr(row.berth);
    const status = cleanStr(row.status);

    // ARRIVAL: ATA first, else ETA
    const arr = bestDT(row.ata_date, row.ata_time, row.eta_date, row.eta_time);
    if (arr.dt && arr.timeType && arr.dt >= windowStart && arr.dt <= windowEnd) {
      events.push({
        type: "ARRIVAL",
        timeISO: arr.dt.toISO()!,
        timeLabel: arr.dt.toFormat("M/d/yy h:mm a"),
        timeType: arr.timeType,
        vesselName,
        imo,
        service,
        operator,
        berth,
        status,
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
        vesselName,
        imo,
        service,
        operator,
        berth,
        status,
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
