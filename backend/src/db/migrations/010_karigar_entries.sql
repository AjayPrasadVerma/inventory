-- 010_karigar_entries.sql — karigar material movement as an ordered log, not
-- paired jobs.
--
-- A job forced every receipt to hang off an issue: you could not record goods
-- coming IN unless material had already gone OUT against that job. Real work does
-- not queue that way — the owner records what happened, in the order it happened,
-- and IN and OUT are independent events.
--
-- So a karigar's khata becomes a chronological log of entries. Each entry is one
-- direction (in or out), one date, one remark, and a set of lines.
--
-- The old jobs / job_issues / job_receipts tables are NOT dropped. They hold real
-- history and every existing report reads them; this migration copies their lines
-- into the new log for display and leaves the originals in place. Crucially it
-- does NOT re-create stock movements for the copied rows — those movements already
-- exist, and writing them again would double every historical quantity.

-- ---------- Size and design as separate fields on a finished variant ----------
-- product_variants.variant was a single text field whose comment read "size /
-- design", so the two were jammed into one value. The new form asks for them
-- separately. `variant` stays as the composed display label so nothing that reads
-- it breaks.
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS size   TEXT;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS design TEXT;

-- Existing values were size-like in practice ("2x3", "21x10.5", "Small").
UPDATE product_variants SET size = variant WHERE size IS NULL;

-- ---------- The log ----------
CREATE TABLE IF NOT EXISTS karigar_entries (
  id          SERIAL PRIMARY KEY,
  karigar_id  INTEGER NOT NULL REFERENCES karigars(id),
  direction   TEXT NOT NULL CHECK (direction IN ('in','out')),
  entry_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  remark      TEXT,
  created_by  INTEGER REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Set only on rows carried over from the old job tables. Kept as provenance so
  -- a migrated line can always be traced back, and used by the backfill below to
  -- join without matching on remark text.
  legacy_job_id INTEGER REFERENCES jobs(id)
);

-- Ordered by the day it happened, then by insertion — two entries on the same
-- date keep the order they were recorded in, which is what "stack" means here.
CREATE INDEX IF NOT EXISTS idx_karigar_entries_log
  ON karigar_entries (karigar_id, entry_date DESC, id DESC);

CREATE TABLE IF NOT EXISTS karigar_entry_lines (
  id         SERIAL PRIMARY KEY,
  entry_id   INTEGER NOT NULL REFERENCES karigar_entries(id) ON DELETE CASCADE,

  -- An OUT line is raw material leaving; an IN line is a finished thing arriving.
  -- Exactly one side is set, and the route enforces that it matches the entry's
  -- direction. Two columns rather than one polymorphic id so the foreign keys are
  -- real and a deleted catalogue row cannot strand a line.
  item_id    INTEGER REFERENCES items(id),
  product_id INTEGER REFERENCES products(id),

  -- Free text as typed in the form. The owner asked for the unit to live in Size
  -- ("meter", "2x3"), so this column carries both ideas. They are also normalised
  -- into item_units / item_variants / product_variants on write, which is what
  -- keeps the existing stock queries — all keyed on those tables — working.
  size       TEXT,
  design     TEXT,

  qty        NUMERIC(14,3) NOT NULL CHECK (qty > 0),

  CONSTRAINT karigar_entry_line_one_side CHECK ((item_id IS NOT NULL) <> (product_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_karigar_entry_lines_entry ON karigar_entry_lines (entry_id);

-- ---------- Stock movements from an entry ----------
-- New reasons rather than reusing job_issue / job_receipt: ref_id would otherwise
-- point at either a job or an entry with no way to tell which, and the stock
-- report's badge would label an entry as a job.
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_reason_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_reason_check
  CHECK (reason IN ('purchase','adjustment','job_issue','job_return','karigar_out','karigar_in'));

ALTER TABLE finished_stock_movements DROP CONSTRAINT IF EXISTS finished_stock_movements_reason_check;
ALTER TABLE finished_stock_movements ADD CONSTRAINT finished_stock_movements_reason_check
  CHECK (reason IN ('job_receipt','sale','adjustment','purchase','karigar_in','karigar_out'));

-- ---------- Advance paid with an entry ----------
-- The form takes an advance and a mode on its first row. Payments already carry a
-- polymorphic party plus an optional document link; this is one more document.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS karigar_entry_id INTEGER;

-- Party-aware, exactly as 009 did for purchases and jobs: MATCH SIMPLE skips the
-- check when karigar_entry_id is NULL, so a vendor payment is never tested against
-- this table. ON DELETE SET NULL (column) needs Postgres 15+; this server is 18.
ALTER TABLE karigar_entries ADD CONSTRAINT karigar_entries_id_karigar_key UNIQUE (id, karigar_id);

ALTER TABLE payments
  ADD CONSTRAINT payments_karigar_entry_party_fkey
    FOREIGN KEY (karigar_entry_id, party_id) REFERENCES karigar_entries (id, karigar_id)
    ON DELETE SET NULL (karigar_entry_id);

-- ---------- Carry the existing job history into the log ----------
-- Display only. No stock movements are written here: the movements for these rows
-- already exist against their jobs, and re-creating them would double the stock.

-- Each issue date becomes one OUT entry per job+date.
WITH made AS (
  INSERT INTO karigar_entries (karigar_id, direction, entry_date, remark, legacy_job_id)
  SELECT j.karigar_id, 'out', ji.issued_on, j.expected_note, j.id
  FROM job_issues ji
  JOIN jobs j ON j.id = ji.job_id
  GROUP BY j.karigar_id, ji.issued_on, j.expected_note, j.id
  RETURNING id, entry_date, legacy_job_id
)
INSERT INTO karigar_entry_lines (entry_id, item_id, size, design, qty)
SELECT m.id, ji.item_id, ji.unit, iv.color, ji.qty
FROM made m
JOIN job_issues ji ON ji.job_id = m.legacy_job_id AND ji.issued_on = m.entry_date
LEFT JOIN item_variants iv ON iv.id = ji.variant_id;

-- Each receipt date becomes one IN entry per job+date.
WITH made AS (
  INSERT INTO karigar_entries (karigar_id, direction, entry_date, remark, legacy_job_id)
  SELECT j.karigar_id, 'in', jr.received_on, j.expected_note, j.id
  FROM job_receipts jr
  JOIN jobs j ON j.id = jr.job_id
  GROUP BY j.karigar_id, jr.received_on, j.expected_note, j.id
  RETURNING id, entry_date, legacy_job_id
)
INSERT INTO karigar_entry_lines (entry_id, product_id, size, design, qty)
SELECT m.id, jr.product_id, pv.size, pv.design, jr.qty
FROM made m
JOIN job_receipts jr ON jr.job_id = m.legacy_job_id AND jr.received_on = m.entry_date
LEFT JOIN product_variants pv ON pv.id = jr.variant_id;

-- Returned raw material was recorded straight onto stock_movements against the
-- job, never onto job_issues, so it needs its own pass. It is material coming
-- back, which is an IN.
WITH made AS (
  INSERT INTO karigar_entries (karigar_id, direction, entry_date, remark, legacy_job_id)
  SELECT j.karigar_id, 'in', sm.moved_on, 'Material returned', j.id
  FROM stock_movements sm
  JOIN jobs j ON j.id = sm.ref_id
  WHERE sm.reason = 'job_return'
  GROUP BY j.karigar_id, sm.moved_on, j.id
  RETURNING id, entry_date, legacy_job_id
)
INSERT INTO karigar_entry_lines (entry_id, item_id, size, design, qty)
SELECT m.id, sm.item_id, sm.unit, iv.color, ABS(sm.qty)
FROM made m
JOIN stock_movements sm ON sm.ref_id = m.legacy_job_id
  AND sm.reason = 'job_return' AND sm.moved_on = m.entry_date
LEFT JOIN item_variants iv ON iv.id = sm.variant_id;
