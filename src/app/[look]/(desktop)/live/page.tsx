"use client";

import { LiveStation } from "@/components/live/LiveStation";
import { WidgetErrorBoundary } from "@/components/WidgetErrorBoundary";

export default function LivePage() {
  return (
    <WidgetErrorBoundary>
      <LiveStation />
    </WidgetErrorBoundary>
  );
}
