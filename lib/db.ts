import Database from "better-sqlite3";

let _db: Database.Database | null = null;

export function getDb() {
  if (_db) return _db;

  const dbPath =
    process.env.AIS_DB_PATH ||
    (process.env.VERCEL
      ? "/tmp/ais.db" // ✅ REQUIRED for Vercel
      : "ais.db");    // ✅ local dev

  _db = new Database(dbPath);

  // Run once on first open
  _db.exec(`
    CREATE TABLE IF NOT EXISTS ais_snapshots (
      mmsi TEXT PRIMARY KEY,
      imo TEXT,
      name TEXT,
      shipType INTEGER,
      lat REAL,
      lon REAL,
      sog REAL,
      cog REAL,
      lastSeenISO TEXT,
      updatedAt INTEGER
    );

    CREATE TABLE IF NOT EXISTS vessel_identity (
      imo TEXT,
      mmsi TEXT,
      name TEXT,
      firstSeenAt INTEGER,
      lastSeenAt INTEGER,
      UNIQUE(imo),
      UNIQUE(mmsi)
    );
  `);

  return _db;
}
