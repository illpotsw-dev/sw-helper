// One row only (id fixed to 1); flavor text, not numeric.
export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS nation_profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT NOT NULL DEFAULT '',
    history TEXT NOT NULL DEFAULT '',
    politics TEXT NOT NULL DEFAULT '',
    goals TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS army_units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    strength INTEGER NOT NULL DEFAULT 0,
    upkeep REAL NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS navy_ships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_model TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    upkeep REAL NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS stockpile_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_type TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS budget_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_type TEXT NOT NULL CHECK (entry_type IN ('income', 'expense')),
    label TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0
  )`,
]
