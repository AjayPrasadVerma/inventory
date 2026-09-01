-- 012_case_insensitive_parts.sql — one spelling per unit, colour, size and design.
--
-- Case is not part of what a unit or a colour IS, but the unique keys treated it
-- as though it were: (item_id, unit) let "meter", "Meter" and "METER" coexist on
-- one item, each holding its own stock. The sheet's dropdowns made it easy to
-- produce — they offer every spelling the shop has ever used, so a typed "red"
-- and a picked "Red" sat side by side as two buckets of the same thing.
--
-- The resolvers now match without regard to case; these indexes are what stop a
-- second spelling being stored at all. Whichever spelling was recorded first is
-- the one kept.

-- ---------- Fold spellings that already coexist ----------
-- Keep the lowest id per case-insensitive identity and repoint everything that
-- references the others, so no movement or document line is orphaned.

-- item_units has no id of its own that anything references; stock_movements
-- carries the unit as text, so the text is what has to be rewritten.
CREATE TEMP TABLE unit_merge ON COMMIT DROP AS
SELECT u.item_id, u.unit AS dup_unit,
       (SELECT u2.unit FROM item_units u2
         WHERE u2.item_id = u.item_id AND lower(u2.unit) = lower(u.unit)
         ORDER BY u2.id LIMIT 1) AS keep_unit
FROM item_units u;

DELETE FROM unit_merge WHERE dup_unit = keep_unit;

UPDATE stock_movements sm SET unit = m.keep_unit
FROM unit_merge m WHERE sm.item_id = m.item_id AND sm.unit = m.dup_unit;

UPDATE job_issues ji SET unit = m.keep_unit
FROM unit_merge m WHERE ji.item_id = m.item_id AND ji.unit = m.dup_unit;

UPDATE purchase_items pi SET unit = m.keep_unit
FROM unit_merge m WHERE pi.item_id = m.item_id AND pi.unit = m.dup_unit;

DELETE FROM item_units u USING unit_merge m
WHERE u.item_id = m.item_id AND u.unit = m.dup_unit;

-- item_variants IS referenced by id.
CREATE TEMP TABLE colour_merge ON COMMIT DROP AS
SELECT v.id AS dup_id,
       MIN(v.id) OVER (PARTITION BY v.item_id, lower(v.color)) AS keep_id
FROM item_variants v;

DELETE FROM colour_merge WHERE dup_id = keep_id;

UPDATE stock_movements sm SET variant_id = m.keep_id
FROM colour_merge m WHERE sm.variant_id = m.dup_id;
UPDATE job_issues ji SET variant_id = m.keep_id
FROM colour_merge m WHERE ji.variant_id = m.dup_id;
UPDATE purchase_items pi SET variant_id = m.keep_id
FROM colour_merge m WHERE pi.variant_id = m.dup_id;

DELETE FROM item_variants v USING colour_merge m WHERE v.id = m.dup_id;

-- product_variants, same shape as 011's merge but case-folded.
CREATE TEMP TABLE pv_merge ON COMMIT DROP AS
SELECT pv.id AS dup_id,
       MIN(pv.id) OVER (
         PARTITION BY pv.product_id, lower(COALESCE(pv.size,'')), lower(COALESCE(pv.design,''))
       ) AS keep_id
FROM product_variants pv;

DELETE FROM pv_merge WHERE dup_id = keep_id;

UPDATE finished_stock_movements f SET variant_id = m.keep_id
FROM pv_merge m WHERE f.variant_id = m.dup_id;
UPDATE job_receipts jr SET variant_id = m.keep_id
FROM pv_merge m WHERE jr.variant_id = m.dup_id;
UPDATE job_issues ji SET variant_id = m.keep_id
FROM pv_merge m WHERE ji.variant_id = m.dup_id;
UPDATE sale_items si SET variant_id = m.keep_id
FROM pv_merge m WHERE si.variant_id = m.dup_id;
UPDATE purchase_items pi SET product_variant_id = m.keep_id
FROM pv_merge m WHERE pi.product_variant_id = m.dup_id;

DELETE FROM product_variants pv USING pv_merge m WHERE pv.id = m.dup_id;

-- ---------- Swap the keys ----------
ALTER TABLE item_units DROP CONSTRAINT IF EXISTS item_units_item_id_unit_key;
CREATE UNIQUE INDEX IF NOT EXISTS item_units_identity_key
  ON item_units (item_id, lower(unit));

ALTER TABLE item_variants DROP CONSTRAINT IF EXISTS item_variants_item_id_color_key;
CREATE UNIQUE INDEX IF NOT EXISTS item_variants_identity_key
  ON item_variants (item_id, lower(color));

DROP INDEX IF EXISTS product_variants_identity_key;
CREATE UNIQUE INDEX IF NOT EXISTS product_variants_identity_key
  ON product_variants (product_id, lower(COALESCE(size, '')), lower(COALESCE(design, '')));
