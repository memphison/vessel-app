import { getDb } from "@/src/lib/db";

export async function pruneOldAisSnapshots() {
  const db = getDb();

  // 24 hours ago in milliseconds
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;

  await db.query(
    `
    DELETE FROM ais_snapshots
    WHERE updated_at < $1
    `,
    [cutoff]
  );
}
