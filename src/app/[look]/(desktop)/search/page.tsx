"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAdminStore } from "@/stores/admin-store";
import { SearchPanel } from "@/components/search/SearchPanel";
import { WidgetErrorBoundary } from "@/components/WidgetErrorBoundary";

export default function SearchPage() {
  const router = useRouter();
  const isAdmin = useAdminStore((s) => s.isAdmin);

  useEffect(() => {
    if (!isAdmin) router.replace("/library");
  }, [isAdmin, router]);

  if (!isAdmin) return null;

  return (
    <WidgetErrorBoundary name="SearchPanel">
      <SearchPanel />
    </WidgetErrorBoundary>
  );
}
