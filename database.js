
const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "pefa-giving.db"));

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS donations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    checkout_request_id TEXT UNIQUE,
    merchant_request_id TEXT,
    phone_number TEXT NOT NULL,
    amount INTEGER NOT NULL,
    giving_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    result_code INTEGER,
    result_description TEXT,
    mpesa_receipt_number TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS church_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    event_date TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    poster_url TEXT NOT NULL DEFAULT '',
    published INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS church_announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    poster_url TEXT NOT NULL DEFAULT '',
    published INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
module.exports = db;
