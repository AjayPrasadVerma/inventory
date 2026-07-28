import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { ToastProvider } from "@/components/ui/toast";

export const metadata: Metadata = {
  title: "Diamond Box Wala",
  description: "Inventory & ledger — jewellery box, stand & products",
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
