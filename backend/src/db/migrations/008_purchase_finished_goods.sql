-- 008_purchase_finished_goods.sql — let a purchase line be a finished product,
-- not only a raw material.
--
-- The shop does not always buy raw material and make the goods itself; ready-made
-- stock can be bought from a vendor and resold. Until now purchase_items.item_id
-- pointed at items only, so that transaction could not be recorded at all.
--
-- A line is one kind or the other, never both — enforced by a CHECK rather than
-- left to application code, because a line with neither (or both) set would make
-- the stock side ambiguous.

ALTER TABLE purchase_items
  ALTER COLUMN item_id DROP NOT NULL;

ALTER TABLE purchase_items
  ADD COLUMN IF NOT EXISTS product_id         INTEGER REFERENCES products(id),
  ADD COLUMN IF NOT EXISTS product_variant_id INTEGER REFERENCES product_variants(id);

-- Exactly one of item_id / product_id, and a variant may only belong to its own kind.
ALTER TABLE purchase_items DROP CONSTRAINT IF EXISTS purchase_items_one_kind;
ALTER TABLE purchase_items ADD CONSTRAINT purchase_items_one_kind CHECK (
  (item_id IS NOT NULL AND product_id IS NULL AND product_variant_id IS NULL)
  OR
  (product_id IS NOT NULL AND item_id IS NULL AND variant_id IS NULL)
);

-- Finished stock can now arrive from a vendor purchase, so 'purchase' joins the
-- allowed reasons. Every finished-stock report SUMs all reasons, so the new rows
-- count immediately with no report changes.
ALTER TABLE finished_stock_movements DROP CONSTRAINT finished_stock_movements_reason_check;
ALTER TABLE finished_stock_movements ADD CONSTRAINT finished_stock_movements_reason_check
  CHECK (reason IN ('job_receipt', 'sale', 'adjustment', 'purchase'));

-- Which vendor a bought-in finished good came from — the mirror of
-- stock_movements.vendor_id, used by the product stock account.
ALTER TABLE finished_stock_movements
  ADD COLUMN IF NOT EXISTS vendor_id INTEGER REFERENCES vendors(id);

CREATE INDEX IF NOT EXISTS idx_purchase_items_product ON purchase_items (product_id);
CREATE INDEX IF NOT EXISTS idx_fin_stock_vendor       ON finished_stock_movements (vendor_id);
