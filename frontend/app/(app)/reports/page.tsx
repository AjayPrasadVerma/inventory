"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Reports live as individual pages in the sidebar now — send /reports to the first one.
export default function ReportsIndex() {
  const router = useRouter();
  // eslint-disable-next-line react-hooks/set-state-in-effect -- navigation on mount, not a render-time state set
  useEffect(() => { router.replace("/reports/sales"); }, [router]);
  return null;
}
