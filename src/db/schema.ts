import { Database } from "bun:sqlite";

export function openDatabase(path: string) {
  const db = new Database(path, { create: true });
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      submitted_url TEXT NOT NULL,
      canonical_url TEXT,
      status TEXT NOT NULL,
      title TEXT,
      author TEXT,
      published_at TEXT,
      source_domain TEXT,
      source_url TEXT,
      fallback_url TEXT,
      content_hash TEXT,
      unread INTEGER NOT NULL DEFAULT 1,
      queued INTEGER NOT NULL DEFAULT 1,
      calibre_book_id INTEGER,
      calibre_book_path TEXT,
      last_error TEXT,
      duplicate_of_item_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_attempted_at TEXT,
      last_saved_at TEXT,
      last_refetched_at TEXT,
      refetch_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE UNIQUE INDEX IF NOT EXISTS items_canonical_url_idx
      ON items(canonical_url)
      WHERE canonical_url IS NOT NULL;

    CREATE TABLE IF NOT EXISTS item_attempts (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      attempt_kind TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT
    );
  `);

  const columns = db.query("PRAGMA table_info(items)").all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));
  if (!columnNames.has("duplicate_of_item_id")) {
    db.exec("ALTER TABLE items ADD COLUMN duplicate_of_item_id TEXT");
  }

  return db;
}
