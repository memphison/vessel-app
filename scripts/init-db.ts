import { getDb } from "@/lib/db";

async function init() {
  const db = getDb();

  await db.query(`
    CREATE TABLE IF NOT EXISTS ais_snapshots (
      mmsi TEXT PRIMARY KEY,
      imo TEXT,
      name TEXT,
      ship_type INTEGER,
      lat DOUBLE PRECISION NOT NULL,
      lon DOUBLE PRECISION NOT NULL,
      sog DOUBLE PRECISION,
      cog DOUBLE PRECISION,
      last_seen TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS vessel_identity (
      mmsi TEXT PRIMARY KEY,
      imo TEXT,
      name TEXT,
      first_seen TIMESTAMPTZ NOT NULL,
      last_seen TIMESTAMPTZ NOT NULL
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_ais_recent
      ON ais_snapshots(updated_at);

    CREATE INDEX IF NOT EXISTS idx_ais_location
      ON ais_snapshots(lat, lon);
  `);

  console.log("✅ Database initialized");
  process.exit(0);
}

init().catch((e) => {
  console.error(e);
  process.exit(1);
});
