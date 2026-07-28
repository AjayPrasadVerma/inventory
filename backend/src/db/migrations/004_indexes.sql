-- 004_indexes.sql — performance indexes (DBA audit 2026-07-26)
-- Goal: keep every hot query index-backed so the app stays fast on slow internet
-- as the shop accumulates history. The two movement ledgers grow fastest.

-- CRITICAL: look up stock movements by their source document.
-- Used by every purchase/sale/job edit & delete (DELETE ... WHERE ref_id=$1 AND reason=...)
-- and by the item/product stock-account joins. Without these, each edit/delete
-- full-scans the fastest-growing tables.
CREATE INDEX IF NOT EXISTS idx_stock_ref     ON stock_movements (ref_id, reason);
CREATE INDEX IF NOT EXISTS idx_fin_stock_ref ON finished_stock_movements (ref_id, reason);

-- HIGH: unindexed FK used by the "raw material by vendor" report + item stock account.
CREATE INDEX IF NOT EXISTS idx_stock_vendor  ON stock_movements (vendor_id);

-- HIGH: karigar-issued report date range + the dashboard's "issued today" count
-- (purchases.purchase_date and sales.sale_date were already indexed; job_issues was missed).
CREATE INDEX IF NOT EXISTS idx_job_issues_date ON job_issues (issued_on);

-- MEDIUM: index-ordered list pagination (all lists sort by date DESC, id DESC).
CREATE INDEX IF NOT EXISTS idx_sales_date_id       ON sales (sale_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_date_id   ON purchases (purchase_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_date_id        ON jobs (job_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_payments_party_date ON payments (party_type, party_id, pay_date DESC, id DESC);
