import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";

export const metadata: Metadata = {
  title: "WORLDVOICE — Presidential Communication",
  description: "Secure multilingual video communication for heads of state and authorized representatives.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#060c1a", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" dir="ltr">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
