import { getDb } from "@/src/lib/db";

export type AisSnapshotInput = {
  mmsi: string;
  imo?: string | null;
  name?: string | null;
  shipType?: number | null;
  lat: number;
  lon: number;
  sog?: number | null;
  cog?: number | null;
  lastSeen: Date;
};

export async function writeAisSnapshot(v: AisSnapshotInput) {
  const db = getDb();

  await db.query(
    `
    INSERT INTO ais_snapshots (
      mmsi,
      imo,
      name,
      ship_type,
      lat,
      lon,
      sog,
      cog,
      last_seen,
      updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
    ON CONFLICT (mmsi)
    DO UPDATE SET
      imo         = EXCLUDED.imo,
      name        = EXCLUDED.name,
      ship_type  = EXCLUDED.ship_type,
      lat         = EXCLUDED.lat,
      lon         = EXCLUDED.lon,
      sog         = EXCLUDED.sog,
      cog         = EXCLUDED.cog,
      last_seen  = EXCLUDED.last_seen,
      updated_at = now()
    `,
    [
      v.mmsi,
      v.imo ?? null,
      v.name ?? null,
      v.shipType ?? null,
      v.lat,
      v.lon,
      v.sog ?? null,
      v.cog ?? null,
      v.lastSeen,
    ]
  );
}
