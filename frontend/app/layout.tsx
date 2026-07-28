import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { ToastProvider } from "@/components/ui/toast";

export const metadata: Metadata = {
  title: "Acronix — Inventory & Ledger",
  description: "Inventory & ledger — raw material, karigar jobs, products & sales",
  icons: {
    icon: [
      { url: "/favicon/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    shortcut: "/favicon/favicon.ico",
    apple: [{ url: "/favicon/apple-touch-icon.png", sizes: "180x180" }],
  },
  manifest: "/favicon/site.webmanifest",
};

// Set theme class before paint to avoid a flash of the wrong theme.
const themeInit = `
(function(){try{
  var t = localStorage.getItem('dbw-theme');
  if(!t){t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';}
  if(t === 'dark'){document.documentElement.classList.add('dark');}
}catch(e){}})();
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="min-h-full flex flex-col">
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
