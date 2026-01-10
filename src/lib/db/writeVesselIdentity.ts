import { getDb } from "@/src/lib/db";

export async function writeVesselIdentity(
  mmsi: string,
  imo: string | null,
  name: string | null
) {
  const db = getDb();

  await db.query(
    `
    INSERT INTO vessel_identity (
      mmsi,
      imo,
      name,
      first_seen,
      last_seen
    )
    VALUES (
      $1,
      $2,
      $3,
      now(),
      now()
    )
    ON CONFLICT (mmsi)
    DO UPDATE SET
      imo       = EXCLUDED.imo,
      name      = EXCLUDED.name,
      last_seen = now();
    `,
    [mmsi, imo, name]
  );
}
