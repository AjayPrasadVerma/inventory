"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { useToast } from "@/components/ui/toast";

interface ListResponse<T> {
  data: T[];
  total?: number;
}

/**
 * Server-side paginated list. Sends filters + page + pageSize to the API and drives
 * the UI off the returned `total`, so the browser only ever holds ONE page of rows.
 * `filters` should be a stable object (wrap in useMemo). Changing any filter resets to page 1.
 */
export function useServerList<T>(path: string, filters: Record<string, unknown>) {
  const { toast } = useToast();
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const filterKey = JSON.stringify(filters);

  // Any filter change goes back to page 1 (avoids landing on an empty page).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset paging when filters change
    setPage(1);
  }, [filterKey]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, pageSize };
      for (const [k, v] of Object.entries(JSON.parse(filterKey) as Record<string, unknown>)) {
        if (v !== "" && v != null) params[k] = typeof v === "number" ? v : String(v);
      }
      const r = await api<ListResponse<T>>(path, { params });
      setRows(r.data);
      setTotal(r.total ?? r.data.length);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }, [path, filterKey, page, pageSize, toast]);

  // Debounce so typing in a search box doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  return useMemo(
    () => ({ rows, total, loading, page, setPage, pageSize, setPageSize, reload: load }),
    [rows, total, loading, page, pageSize, load],
  );
}
