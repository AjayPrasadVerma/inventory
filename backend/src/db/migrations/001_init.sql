-- Diamond Box Wala — Phase 1 schema
-- Masters, Purchase + raw stock, Vendor ledger foundation.

-- ---------- Users (auth) ----------
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  mobile        TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner', 'staff')),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Vendors ----------
CREATE TABLE IF NOT EXISTS vendors (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  phone           TEXT,
  address         TEXT,
  city            TEXT,
  gst_no          TEXT,
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,   -- amount payable to vendor at start
  notes           TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendors_name ON vendors (lower(name));

-- ---------- Karigars / Thekedaars ----------
CREATE TABLE IF NOT EXISTS karigars (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  phone           TEXT,
  product_types   TEXT[] NOT NULL DEFAULT '{}',       -- e.g. {box, stand}
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes           TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_karigars_name ON karigars (lower(name));

-- ---------- Customers (auto-created at sale time, keyed by mobile) ----------
CREATE TABLE IF NOT EXISTS customers (
  id              SERIAL PRIMARY KEY,
  mobile          TEXT UNIQUE,
  name            TEXT,
  type            TEXT NOT NULL DEFAULT 'retail' CHECK (type IN ('retail', 'wholesale')),
  credit_allowed  BOOLEAN NOT NULL DEFAULT FALSE,
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Raw materials (items) — dynamic ----------
CREATE TABLE IF NOT EXISTS items (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  category      TEXT,                                 -- free text, dynamic autocomplete
  low_stock_qty NUMERIC(14,3),                        -- optional alert threshold
  notes         TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_items_name ON items (lower(name));

-- Units an item can be bought/stocked in (meter / roll / kilo …)
CREATE TABLE IF NOT EXISTS item_units (
  id         SERIAL PRIMARY KEY,
  item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  unit       TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (item_id, unit)
);

-- Colour / variant of an item
CREATE TABLE IF NOT EXISTS item_variants (
  id      SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  color   TEXT NOT NULL,
  UNIQUE (item_id, color)
);

-- ---------- Finished products ----------
CREATE TABLE IF NOT EXISTS products (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  category      TEXT,
  low_stock_qty NUMERIC(14,3),
  notes         TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_name ON products (lower(name));

CREATE TABLE IF NOT EXISTS product_variants (
  id         SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant    TEXT NOT NULL,                            -- size / design
  UNIQUE (product_id, variant)
);

-- ---------- Purchases (vendor → raw material) ----------
CREATE TABLE IF NOT EXISTS purchases (
  id            SERIAL PRIMARY KEY,
  vendor_id     INTEGER NOT NULL REFERENCES vendors(id),
  bill_no       TEXT,
  purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_paid   NUMERIC(14,2) NOT NULL DEFAULT 0,      -- advance paid at purchase time
  notes         TEXT,
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_purchases_vendor ON purchases (vendor_id);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases (purchase_date);

CREATE TABLE IF NOT EXISTS purchase_items (
  id          SERIAL PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  item_id     INTEGER NOT NULL REFERENCES items(id),
  variant_id  INTEGER REFERENCES item_variants(id),
  unit        TEXT NOT NULL,
  qty         NUMERIC(14,3) NOT NULL CHECK (qty > 0),
  rate        NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount      NUMERIC(14,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items (purchase_id);

-- ---------- Raw material stock movements (ledger) ----------
-- qty is signed: +in (purchase / return), -out (job issue / adjustment).
CREATE TABLE IF NOT EXISTS stock_movements (
  id         SERIAL PRIMARY KEY,
  item_id    INTEGER NOT NULL REFERENCES items(id),
  variant_id INTEGER REFERENCES item_variants(id),
  unit       TEXT NOT NULL,
  qty        NUMERIC(14,3) NOT NULL,                   -- signed
  reason     TEXT NOT NULL CHECK (reason IN ('purchase','adjustment','job_issue','job_return')),
  ref_id     INTEGER,                                  -- e.g. purchase_id / job_id
  vendor_id  INTEGER REFERENCES vendors(id),           -- source vendor for inbound
  moved_on   DATE NOT NULL DEFAULT CURRENT_DATE,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_item ON stock_movements (item_id, variant_id, unit);

-- ---------- Payments (vendor / karigar / customer) ----------
CREATE TABLE IF NOT EXISTS payments (
  id         SERIAL PRIMARY KEY,
  party_type TEXT NOT NULL CHECK (party_type IN ('vendor','karigar','customer')),
  party_id   INTEGER NOT NULL,
  direction  TEXT NOT NULL CHECK (direction IN ('paid','received')),
  amount     NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method     TEXT NOT NULL DEFAULT 'cash',
  pay_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  ref_note   TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_party ON payments (party_type, party_id);
