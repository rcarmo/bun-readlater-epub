import { Database } from "bun:sqlite";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { BuiltEpub, ExtractedArticle } from "../types";

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "article";
}

function ensureCalibreSchema(db: Database) {
  db.exec(`
    PRAGMA journal_mode = DELETE;

    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      sort TEXT,
      timestamp TEXT,
      pubdate TEXT,
      series_index REAL DEFAULT 1.0,
      author_sort TEXT,
      isbn TEXT,
      lccn TEXT,
      path TEXT NOT NULL,
      flags INTEGER DEFAULT 1,
      uuid TEXT,
      has_cover INTEGER DEFAULT 0,
      last_modified TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS authors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sort TEXT,
      link TEXT
    );

    CREATE TABLE IF NOT EXISTS data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book INTEGER NOT NULL,
      format TEXT NOT NULL,
      uncompressed_size INTEGER NOT NULL,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book INTEGER NOT NULL,
      text TEXT
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS books_authors_link (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book INTEGER NOT NULL,
      author INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS books_tags_link (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book INTEGER NOT NULL,
      tag INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS series (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sort TEXT
    );

    CREATE TABLE IF NOT EXISTS books_series_link (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book INTEGER NOT NULL,
      series INTEGER NOT NULL
    );
  `);
}

function upsertAuthor(db: Database, name: string) {
  const existing = db.query("SELECT id FROM authors WHERE name = ? LIMIT 1").get(name) as { id: number } | null;
  if (existing) return existing.id;
  db.query("INSERT INTO authors (name, sort, link) VALUES (?, ?, '')").run(name, name);
  return Number((db.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id);
}

function upsertTag(db: Database, name: string) {
  const existing = db.query("SELECT id FROM tags WHERE name = ? LIMIT 1").get(name) as { id: number } | null;
  if (existing) return existing.id;
  db.query("INSERT INTO tags (name) VALUES (?)").run(name);
  return Number((db.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id);
}

export interface CalibreWriteResult {
  bookPath: string;
  bookId: number;
}

export function storeInArticleLibrary(root: string, article: ExtractedArticle, epub: BuiltEpub, existingBookId?: number | null): CalibreWriteResult {
  mkdirSync(root, { recursive: true });
  const dbPath = join(root, "metadata.db");
  const db = new Database(dbPath, { create: true });
  ensureCalibreSchema(db);

  const authorName = article.author || article.sourceDomain || "Unknown";
  const authorDir = `${authorName}`;

  let bookId = existingBookId ?? null;
  let relativePath = "";
  const now = new Date().toISOString();
  const description = `<p>Saved from <a href="${article.canonicalUrl}">${article.canonicalUrl}</a></p>`;

  if (bookId) {
    const current = db.query("SELECT path FROM books WHERE id = ? LIMIT 1").get(bookId) as { path: string } | null;
    if (!current) bookId = null;
    else relativePath = current.path;
  }

  if (!bookId) {
    relativePath = join(authorDir, `${article.title} (${slugify(randomUUID().slice(0, 8))})`);
    db.query(`
      INSERT INTO books (title, sort, timestamp, pubdate, author_sort, path, uuid, has_cover, last_modified)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(article.title, article.title, now, article.publishedAt || now, authorName, relativePath, randomUUID(), now);
    bookId = Number((db.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id);
  } else {
    db.query(`
      UPDATE books
      SET title = ?, sort = ?, pubdate = ?, author_sort = ?, last_modified = ?
      WHERE id = ?
    `).run(article.title, article.title, article.publishedAt || now, authorName, now, bookId);
    db.query("DELETE FROM books_authors_link WHERE book = ?").run(bookId);
    db.query("DELETE FROM books_tags_link WHERE book = ?").run(bookId);
    db.query("DELETE FROM data WHERE book = ? AND format = 'EPUB'").run(bookId);
    db.query("DELETE FROM comments WHERE book = ?").run(bookId);
  }

  const absoluteDir = join(root, relativePath);
  mkdirSync(absoluteDir, { recursive: true });
  const fileStem = article.title;
  const target = join(absoluteDir, `${fileStem}.epub`);
  copyFileSync(epub.tmpPath, target);

  const authorId = upsertAuthor(db, authorName);
  db.query("INSERT INTO books_authors_link (book, author) VALUES (?, ?)").run(bookId, authorId);

  const tags = [article.sourceDomain, "readlater"].filter(Boolean);
  for (const tag of tags) {
    const tagId = upsertTag(db, tag);
    db.query("INSERT INTO books_tags_link (book, tag) VALUES (?, ?)").run(bookId, tagId);
  }

  db.query("INSERT INTO comments (book, text) VALUES (?, ?)").run(bookId, description);
  db.query("INSERT INTO data (book, format, uncompressed_size, name) VALUES (?, 'EPUB', ?, ?)")
    .run(bookId, Bun.file(target).size, fileStem);
  db.close();

  return {
    bookPath: target,
    bookId,
  };
}
