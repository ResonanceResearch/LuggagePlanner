PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE,
  icon TEXT NOT NULL DEFAULT '📦',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_active_name
  ON categories(name)
  WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE,
  category_id TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  default_quantity INTEGER NOT NULL DEFAULT 1 CHECK (default_quantity > 0),
  is_essential INTEGER NOT NULL DEFAULT 0 CHECK (is_essential IN (0, 1)),
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_items_active_name_category
  ON items(name, category_id)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_id);
CREATE INDEX IF NOT EXISTS idx_items_archived ON items(archived_at);

CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  destination TEXT NOT NULL DEFAULT '',
  start_date TEXT,
  end_date TEXT,
  travel_mode TEXT NOT NULL DEFAULT 'solo' CHECK (travel_mode IN ('solo', 'family')),
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trips_status_dates ON trips(status, start_date, created_at);

CREATE TABLE IF NOT EXISTS travelers (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color_index INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_travelers_trip ON travelers(trip_id, sort_order);

CREATE TABLE IF NOT EXISTS bags (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  owner_traveler_id TEXT,
  name TEXT NOT NULL,
  bag_type TEXT NOT NULL DEFAULT 'custom' CHECK (
    bag_type IN ('carry_on', 'checked_luggage', 'personal_item', 'medication_kit', 'custom')
  ),
  is_shared INTEGER NOT NULL DEFAULT 0 CHECK (is_shared IN (0, 1)),
  capacity_note TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_traveler_id) REFERENCES travelers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_bags_trip ON bags(trip_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_bags_owner ON bags(owner_traveler_id);

CREATE TABLE IF NOT EXISTS trip_items (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  bag_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  is_packed INTEGER NOT NULL DEFAULT 0 CHECK (is_packed IN (0, 1)),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT,
  FOREIGN KEY (bag_id) REFERENCES bags(id) ON DELETE CASCADE,
  UNIQUE (trip_id, item_id, bag_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_items_trip ON trip_items(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_items_bag ON trip_items(bag_id);
CREATE INDEX IF NOT EXISTS idx_trip_items_item ON trip_items(item_id);
