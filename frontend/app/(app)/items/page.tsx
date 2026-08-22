"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Raw materials and finished products are now one list at /products — the owner
 * treats both as stock. This route is kept as a redirect because bookmarks and
 * older links point at it. (/items/stock is unaffected; it is per-record.)
 */
export default function ItemsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/products"); }, [router]);
  return null;
}
