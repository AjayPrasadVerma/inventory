import type { SVGProps } from "react";

function Svg(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export const Icon = {
  Dashboard: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <rect x="3" y="3" width="7" height="9" />
      <rect x="14" y="3" width="7" height="5" />
      <rect x="14" y="12" width="7" height="9" />
      <rect x="3" y="16" width="7" height="5" />
    </Svg>
  ),
  Vendor: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M3 9l1.5-5h15L21 9" />
      <path d="M4 9h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
      <path d="M9 20v-5h6v5" />
    </Svg>
  ),
  Karigar: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M14 7l6 6" />
      <path d="M4 20l7-7" />
      <path d="M9 8l3-3 5 5-3 3z" />
    </Svg>
  ),
  Item: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M21 8l-9-5-9 5 9 5 9-5z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <path d="M12 13v8" />
    </Svg>
  ),
  Product: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <rect x="3" y="8" width="18" height="13" rx="1" />
      <path d="M3 8l2-4h14l2 4" />
      <path d="M12 4v17" />
    </Svg>
  ),
  Purchase: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <circle cx="9" cy="20" r="1" />
      <circle cx="18" cy="20" r="1" />
      <path d="M2 3h3l2.4 12.3a1 1 0 0 0 1 .7h9.2a1 1 0 0 0 1-.8L22 7H6" />
    </Svg>
  ),
  Job: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V3h6v1" />
      <path d="M9 10h6M9 14h4" />
    </Svg>
  ),
  Sale: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M4 4h4l2 12h8l2-8H7" />
      <circle cx="10" cy="20" r="1" />
      <circle cx="18" cy="20" r="1" />
      <path d="M14 8h4M16 6v4" />
    </Svg>
  ),
  Users: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16.5 5.2a3.5 3.5 0 0 1 0 6.6" />
      <path d="M18 14.4a6.5 6.5 0 0 1 3.5 5.6" />
    </Svg>
  ),
  Key: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <circle cx="8" cy="15" r="4" />
      <path d="M10.9 12.1 20 3" />
      <path d="M17 6l2.5 2.5" />
    </Svg>
  ),
  Customer: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 20a6 6 0 0 0-3-5.2" />
    </Svg>
  ),
  Report: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M4 20V4M20 20H4" />
      <rect x="7" y="12" width="3" height="5" />
      <rect x="12" y="8" width="3" height="9" />
      <rect x="17" y="5" width="3" height="12" />
    </Svg>
  ),
  Ledger: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M4 4h13a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2z" />
      <path d="M8 8h7M8 12h7" />
    </Svg>
  ),
  Search: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </Svg>
  ),
  Plus: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  ),
  Edit: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </Svg>
  ),
  Trash: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
    </Svg>
  ),
  Sun: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
    </Svg>
  ),
  Moon: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </Svg>
  ),
  Menu: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M3 6h18M3 12h18M3 18h18" />
    </Svg>
  ),
  History: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M3 3v5h5" />
      <path d="M3.05 13a9 9 0 1 0 2.6-6.4L3 8" />
      <path d="M12 7v5l3 2" />
    </Svg>
  ),
  ArrowLeft: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </Svg>
  ),
  Logout: (p: SVGProps<SVGSVGElement>) => (
    <Svg {...p}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </Svg>
  ),
};
