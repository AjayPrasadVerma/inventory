-- 005_payment_purchase_link.sql — tie a payment voucher to the purchase it settles.
-- Before this, "which bill was this payment for?" lived only in the free-text ref_note,
-- so the vendor khata could not show bill-wise pending. Nullable on purpose:
-- a payment may settle the opening balance (no purchase) or be a general on-account payment.
-- ON DELETE SET NULL — deleting a purchase must NOT delete the money that was paid.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS purchase_id INTEGER REFERENCES purchases(id) ON DELETE SET NULL;

-- Used to sum payments per bill when building the vendor ledger.
CREATE INDEX IF NOT EXISTS idx_payments_purchase ON payments (purchase_id);
