-- 009_payment_party_integrity.sql — make a payment's linked document prove it
-- belongs to the same party.
--
-- payments.party_id is polymorphic (vendor / karigar / customer), so the
-- single-column FKs on purchase_id and job_id could only check "this purchase
-- exists", never "this purchase is THIS vendor's". A route check was the only
-- thing stopping a vendor payment from being attached to another vendor's bill,
-- and nothing at all stopped an UPDATE moving a paid bill to a different vendor —
-- which stranded the payment: it stayed with the payer while the bill left their
-- khata, so the money was readable by nobody and Outstanding came out wrong.
--
-- Composite FKs close that. MATCH SIMPLE (the default) skips the check when any
-- referencing column is NULL, so a karigar payment (purchase_id NULL) is never
-- checked against purchases and vice versa — exactly the polymorphic behaviour
-- needed, enforced by the database instead of by a route.
--
-- ON DELETE SET NULL (column) needs Postgres 15+; this server is 18.4. Without
-- the column list it would try to null party_id too, which is NOT NULL, and the
-- delete would fail.

-- A composite FK needs a matching unique key. id is already the primary key, so
-- these are trivially satisfied and exist only to be referenced.
ALTER TABLE purchases ADD CONSTRAINT purchases_id_vendor_key UNIQUE (id, vendor_id);
ALTER TABLE jobs      ADD CONSTRAINT jobs_id_karigar_key     UNIQUE (id, karigar_id);

-- Replace the single-column FKs with party-aware ones.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_purchase_id_fkey;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_job_id_fkey;

ALTER TABLE payments
  ADD CONSTRAINT payments_purchase_party_fkey
    FOREIGN KEY (purchase_id, party_id) REFERENCES purchases (id, vendor_id)
    ON DELETE SET NULL (purchase_id);

ALTER TABLE payments
  ADD CONSTRAINT payments_job_party_fkey
    FOREIGN KEY (job_id, party_id) REFERENCES jobs (id, karigar_id)
    ON DELETE SET NULL (job_id);
