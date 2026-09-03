// Applied on every connection open. Statements are ordered so referenced
// tables exist before the tables that point at them.
export const SCHEMA_STATEMENTS = [
  // SQLite ignores foreign keys unless this is enabled, per connection.
  // The unit_type reference in oob_units depends on it.
  `PRAGMA foreign_keys = ON`,

  // One row only (id fixed to 1); flavor text, not numeric.
  `CREATE TABLE IF NOT EXISTS nation_profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT NOT NULL DEFAULT '',
    history TEXT NOT NULL DEFAULT '',
    politics TEXT NOT NULL DEFAULT '',
    goals TEXT NOT NULL DEFAULT ''
  )`,

  // The eight NATO echelon tiers. Structure (symbol, level) is fixed; only
  // name is renameable per nation. Seeded with defaults below.
  `CREATE TABLE IF NOT EXISTS echelons (
    symbol TEXT PRIMARY KEY,
    level INTEGER NOT NULL UNIQUE,
    name TEXT NOT NULL
  )`,

  // The nation's unit catalog, mirroring land-units.yml. Keyed by name
  // because oob_units references it by name — an OOB import resolves
  // against these rows exactly or fails.
  `CREATE TABLE IF NOT EXISTS unit_types (
    name TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN (
      'infantry', 'mountain_infantry', 'elite_infantry', 'cavalry',
      'light_cavalry', 'artillery', 'support_weapons'
    )),
    description TEXT NOT NULL DEFAULT '',
    recruit_cost REAL NOT NULL DEFAULT 0,
    upkeep_per_turn REAL NOT NULL DEFAULT 0,
    build_time_turns INTEGER NOT NULL DEFAULT 0,
    men INTEGER NOT NULL DEFAULT 0,
    weapons INTEGER NOT NULL DEFAULT 0,
    -- A type is measured in men or in guns, never both.
    CHECK (
      (type IN ('artillery', 'support_weapons') AND men = 0 AND weapons > 0)
      OR
      (type NOT IN ('artillery', 'support_weapons') AND weapons = 0 AND men > 0)
    )
  )`,

  // The live OOB plus any saved designs. Exactly one row may be live.
  `CREATE TABLE IF NOT EXISTS oob_designs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    is_live INTEGER NOT NULL DEFAULT 0 CHECK (is_live IN (0, 1))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS one_live_design
    ON oob_designs (is_live) WHERE is_live = 1`,

  // Formation tree. parent_id NULL means an independent top-level formation;
  // a design may have several (e.g. a field army and a separate garrison).
  `CREATE TABLE IF NOT EXISTS oob_formations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    design_id INTEGER NOT NULL REFERENCES oob_designs (id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES oob_formations (id) ON DELETE CASCADE,
    echelon TEXT NOT NULL REFERENCES echelons (symbol),
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS oob_formations_design
    ON oob_formations (design_id)`,
  `CREATE INDEX IF NOT EXISTS oob_formations_parent
    ON oob_formations (parent_id)`,

  // Raised units. Strength and equipment live here rather than on the type,
  // so a unit can sit below full strength and two units of the same type can
  // be equipped differently. ON DELETE RESTRICT stops a catalog entry being
  // removed while units still reference it.
  `CREATE TABLE IF NOT EXISTS oob_units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    formation_id INTEGER NOT NULL
      REFERENCES oob_formations (id) ON DELETE CASCADE,
    unit_type TEXT NOT NULL
      REFERENCES unit_types (name) ON UPDATE CASCADE ON DELETE RESTRICT,
    designation TEXT NOT NULL,
    men INTEGER NOT NULL DEFAULT 0,
    weapons INTEGER NOT NULL DEFAULT 0,
    equipment TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    -- Exactly one of the two carries the unit's strength, and it must be
    -- non-zero. Which one is correct for this unit_type is checked in the
    -- app, since a CHECK cannot read the referenced row.
    CHECK ((men = 0) <> (weapons = 0))
  )`,
  `CREATE INDEX IF NOT EXISTS oob_units_formation
    ON oob_units (formation_id)`,

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

  // Default tier names, per mvp-army-oob.md. OR IGNORE so a nation that has
  // renamed a tier keeps its own name across reloads.
  `INSERT OR IGNORE INTO echelons (symbol, level, name) VALUES
    ('XXXXX', 8, 'Theatre'),
    ('XXXX', 7, 'Army'),
    ('XXX', 6, 'Corps'),
    ('XX', 5, 'Division'),
    ('X', 4, 'Brigade'),
    ('III', 3, 'Regiment'),
    ('II', 2, 'Battalion'),
    ('I', 1, 'Company')`,
]
