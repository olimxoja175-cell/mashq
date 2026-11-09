"use client";

import { Shell } from "@/components/Shell";
import { useRequireAuth } from "@/lib/auth";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  useRequireAuth();
  return <Shell>{children}</Shell>;
}
