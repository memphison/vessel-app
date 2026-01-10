import Database from "better-sqlite3";

export const db = new Database("ais.db");

// Run once on startup
db.exec(`
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
