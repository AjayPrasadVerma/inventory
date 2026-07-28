-- Diamond Box Wala — Phase 2: Karigar Jobs
-- Material issue -> finished goods receipt, finished-goods stock, labour on karigar ledger.

-- ---------- Jobs (order given to a karigar/thekedaar) ----------
CREATE TABLE IF NOT EXISTS jobs (
  id            SERIAL PRIMARY KEY,
  karigar_id    INTEGER NOT NULL REFERENCES karigars(id),
  job_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_note TEXT,                                    -- kya banwana hai
  labour_amount NUMERIC(14,2) NOT NULL DEFAULT 0,        -- thekedaar ko poore order ka dena
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  notes         TEXT,
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jobs_karigar ON jobs (karigar_id);
CREATE INDEX IF NOT EXISTS idx_jobs_date ON jobs (job_date);

-- Raw material issued to the karigar (goes OUT of raw stock).
CREATE TABLE IF NOT EXISTS job_issues (
  id         SERIAL PRIMARY KEY,
  job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  item_id    INTEGER NOT NULL REFERENCES items(id),
  variant_id INTEGER REFERENCES item_variants(id),
  unit       TEXT NOT NULL,
  qty        NUMERIC(14,3) NOT NULL CHECK (qty > 0),
  issued_on  DATE NOT NULL DEFAULT CURRENT_DATE
);
CREATE INDEX IF NOT EXISTS idx_job_issues_job ON job_issues (job_id);

-- Finished goods received back from the karigar (comes IN to finished stock).
CREATE TABLE IF NOT EXISTS job_receipts (
  id          SERIAL PRIMARY KEY,
  job_id      INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  variant_id  INTEGER REFERENCES product_variants(id),
  qty         NUMERIC(14,3) NOT NULL CHECK (qty > 0),
  received_on DATE NOT NULL DEFAULT CURRENT_DATE
);
CREATE INDEX IF NOT EXISTS idx_job_receipts_job ON job_receipts (job_id);

-- Finished-goods stock movements (signed): +in (job receipt), -out (sale, Phase 3).
CREATE TABLE IF NOT EXISTS finished_stock_movements (
  id         SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  variant_id INTEGER REFERENCES product_variants(id),
  qty        NUMERIC(14,3) NOT NULL,
  reason     TEXT NOT NULL CHECK (reason IN ('job_receipt','sale','adjustment')),
  ref_id     INTEGER,
  moved_on   DATE NOT NULL DEFAULT CURRENT_DATE,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_stock_product ON finished_stock_movements (product_id, variant_id);

-- Note: returned raw material is recorded in stock_movements with reason 'job_return'
-- (already allowed by the 001 CHECK constraint), ref_id = job_id.
