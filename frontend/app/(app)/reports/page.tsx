"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Reports live as individual pages in the sidebar now — send /reports to the first one.
export default function ReportsIndex() {
  const router = useRouter();
   
  useEffect(() => { router.replace("/reports/sales"); }, [router]);
  return null;
}
