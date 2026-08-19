-- 006_payment_job_link.sql — tie a karigar payment to the job it was for.
-- Mirrors 005 (payments.purchase_id) on the karigar side: without it, "kis job ka
-- paisa diya?" is unanswerable and a karigar's khata can only show a running total.
-- Nullable on purpose — a lump sum may not belong to any single job.
-- ON DELETE SET NULL — deleting a job must NOT delete the money already paid.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL;

-- Used to group payments per job when building the karigar khata.
CREATE INDEX IF NOT EXISTS idx_payments_job ON payments (job_id);
