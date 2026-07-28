-- Diamond Box Wala — Phase 3: Sales
-- Customer auto-created/found by mobile at sale time; per-item price; finished stock goes out.

CREATE TABLE IF NOT EXISTS sales (
  id              SERIAL PRIMARY KEY,
  customer_id     INTEGER REFERENCES customers(id),      -- NULL for walk-in without mobile
  sale_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  type            TEXT NOT NULL DEFAULT 'retail' CHECK (type IN ('retail','wholesale')),
  total_amount    NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_received NUMERIC(14,2) NOT NULL DEFAULT 0,       -- cash = full; credit = partial/0
  payment_mode    TEXT NOT NULL DEFAULT 'cash' CHECK (payment_mode IN ('cash','credit')),
  notes           TEXT,
  created_by      INTEGER REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales (customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales (sale_date);

CREATE TABLE IF NOT EXISTS sale_items (
  id         SERIAL PRIMARY KEY,
  sale_id    INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  variant_id INTEGER REFERENCES product_variants(id),
  qty        NUMERIC(14,3) NOT NULL CHECK (qty > 0),
  price      NUMERIC(14,2) NOT NULL DEFAULT 0,            -- entered by hand per item
  amount     NUMERIC(14,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items (sale_id);
