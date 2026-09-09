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

  // The nation's weapon catalog, mirroring weapons.yml. Keyed by name and
  // referenced by name for the same reason unit_types is: the exact-match rule
  // of mvp-stockpile.md §2.1 is then a foreign key rather than a convention,
  // and a near miss fails loudly instead of minting a second arsenal.
  `CREATE TABLE IF NOT EXISTS weapons (
    name TEXT PRIMARY KEY,
    class TEXT NOT NULL CHECK (class IN ('small_arm', 'gun')),
    origin TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT ''
  )`,

  // What is in the pile: one quantity per catalog weapon, and nothing else.
  // A row exists for every weapon, at zero when none are spare, so a movement
  // is always an UPDATE and never has to decide whether to insert.
  //
  // The CHECK is the guarantee from mvp-stockpile.md §9 that stock is never
  // negative "at any point, including mid-operation" — SQLite evaluates it per
  // statement, so a transaction that would overdraw fails and rolls back
  // whole. Movements must therefore credit returns before debiting draws.
  `CREATE TABLE IF NOT EXISTS weapon_stock (
    weapon TEXT PRIMARY KEY
      REFERENCES weapons (name) ON UPDATE CASCADE ON DELETE RESTRICT,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0)
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

  // Raised units. Strength lives here rather than on the type, so a unit can
  // sit below full strength without affecting its siblings; what it carries
  // lives in oob_unit_weapons below. ON DELETE RESTRICT stops a catalog entry
  // being removed while units still reference it.
  `CREATE TABLE IF NOT EXISTS oob_units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    formation_id INTEGER NOT NULL
      REFERENCES oob_formations (id) ON DELETE CASCADE,
    unit_type TEXT NOT NULL
      REFERENCES unit_types (name) ON UPDATE CASCADE ON DELETE RESTRICT,
    designation TEXT NOT NULL,
    men INTEGER NOT NULL DEFAULT 0,
    weapons INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    -- At most one of the two carries the unit's strength. Both at zero is a
    -- paper unit: on the books with nobody in it, which is how a wiped-out
    -- battalion keeps its designation and its place in the tree. Which
    -- measure is correct for this unit_type is checked in the app, since a
    -- CHECK cannot read the referenced row.
    CHECK (men >= 0 AND weapons >= 0 AND (men = 0 OR weapons = 0))
  )`,
  `CREATE INDEX IF NOT EXISTS oob_units_formation
    ON oob_units (formation_id)`,

  // What a unit is actually carrying, and how many of them. A row per holding
  // rather than a column on oob_units so that mixed arming — two patterns in
  // one battalion — is a UI change later and not a schema migration, per
  // mvp-stockpile.md §2.2. The MVP limit of one holding per unit is enforced
  // in the app: a schema that forbade a second row would reject a file rather
  // than explain what is wrong with it.
  //
  // The quantity is not decorative. It is the number of physical weapons that
  // left the pile, and the other half of the ledger:
  //
  //     owned(w) = weapon_stock(w) + sum of holdings across the LIVE design
  //
  // Holdings on a saved design are intentions, not property, so every ledger
  // query joins up to oob_designs and filters on is_live.
  `CREATE TABLE IF NOT EXISTS oob_unit_weapons (
    unit_id INTEGER NOT NULL REFERENCES oob_units (id) ON DELETE CASCADE,
    weapon TEXT NOT NULL
      REFERENCES weapons (name) ON UPDATE CASCADE ON DELETE RESTRICT,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    PRIMARY KEY (unit_id, weapon)
  )`,

  `CREATE TABLE IF NOT EXISTS navy_ships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_model TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    upkeep REAL NOT NULL DEFAULT 0
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
