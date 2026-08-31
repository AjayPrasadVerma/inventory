-- 011_variant_identity.sql — make a finished variant unique on what identifies
-- it, not on how it is spelled.
--
-- product_variants was unique on (product_id, variant), where `variant` is the
-- display label "size · design". But every lookup matches on (size, design).
-- Two different keys for one row, and when they disagreed the INSERT ... ON
-- CONFLICT (product_id, variant) DO UPDATE returned the row that already held
-- the label and rewrote its size and design.
--
-- That silently merged two buckets and wrote off the difference. A karigar
-- receipt of 12 recorded as design "Golden" collided with a later line of size
-- "Golden": both resolved to the same variant, the sheet read the existing 12,
-- and booked -9 "Stock corrected" to reach the 3 it thought it was setting. Nine
-- finished pieces disappeared and the save reported success.
--
-- Uniqueness moves to (product_id, size, design). `variant` stays as the label
-- and is no longer an identity, so a size containing " · " can no longer be
-- mistaken for a size-and-design pair.

-- ---------- Merge any rows the old key already let through ----------
-- Keep the lowest id per real identity and repoint everything that references
-- the others at it, so no movement or document line is orphaned.
CREATE TEMP TABLE variant_merge ON COMMIT DROP AS
SELECT pv.id AS dup_id,
       MIN(pv.id) OVER (
         PARTITION BY pv.product_id, COALESCE(pv.size,''), COALESCE(pv.design,'')
       ) AS keep_id
FROM product_variants pv;

DELETE FROM variant_merge WHERE dup_id = keep_id;

UPDATE finished_stock_movements f SET variant_id = m.keep_id
FROM variant_merge m WHERE f.variant_id = m.dup_id;

UPDATE job_receipts jr SET variant_id = m.keep_id
FROM variant_merge m WHERE jr.variant_id = m.dup_id;

UPDATE job_issues ji SET variant_id = m.keep_id
FROM variant_merge m WHERE ji.variant_id = m.dup_id;

UPDATE sale_items si SET variant_id = m.keep_id
FROM variant_merge m WHERE si.variant_id = m.dup_id;

UPDATE purchase_items pi SET product_variant_id = m.keep_id
FROM variant_merge m WHERE pi.product_variant_id = m.dup_id;

DELETE FROM product_variants pv USING variant_merge m WHERE pv.id = m.dup_id;

-- ---------- Swap the key ----------
ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_product_id_variant_key;

-- An expression index rather than UNIQUE (product_id, size, design): NULLs are
-- distinct under a plain UNIQUE, so two rows with a null design would both be
-- allowed and the mismatch would come straight back.
CREATE UNIQUE INDEX IF NOT EXISTS product_variants_identity_key
  ON product_variants (product_id, COALESCE(size, ''), COALESCE(design, ''));
