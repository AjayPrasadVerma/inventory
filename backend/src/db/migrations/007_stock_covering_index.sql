-- 007_stock_covering_index.sql — keep the on-hand sums index-only.
-- The palette search shows current stock next to each material/product, which
-- means a SUM(qty) per result. The existing idx_stock_item / idx_fin_stock_product
-- narrow to the right rows but still fetch qty from the heap; INCLUDE(qty) lets
-- these aggregates be answered from the index alone. Costs a few KB and matters
-- as the movement tables grow (they are the fastest-growing tables in the schema).
CREATE INDEX IF NOT EXISTS idx_stock_item_qty
  ON stock_movements (item_id, unit) INCLUDE (qty);

CREATE INDEX IF NOT EXISTS idx_fin_stock_product_qty
  ON finished_stock_movements (product_id) INCLUDE (qty);
