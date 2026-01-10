import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function init() {
  await pool.query(`
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS vessel_identity (
      mmsi TEXT PRIMARY KEY,
      imo TEXT,
      name TEXT,
      first_seen TIMESTAMPTZ NOT NULL,
      last_seen TIMESTAMPTZ NOT NULL
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ais_recent
      ON ais_snapshots(updated_at);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ais_location
      ON ais_snapshots(lat, lon);
  `);

  console.log("✅ Database initialized");
  await pool.end();
}

init().catch((err) => {
  console.error(err);
  process.exit(1);
});
