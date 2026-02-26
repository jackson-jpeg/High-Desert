"use client";

export function OnThisDaySkeleton() {
  return (
    <div className="w98-raised-dark bg-raised-surface animate-slide-up">
      <div className="px-3 py-2">
        <div className="h-[9px] bg-bevel-dark/10 rounded w-[80px] mb-2 animate-skeleton" />
        <div className="space-y-1">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="p-2 w98-raised-dark bg-card-surface animate-skeleton"
              style={{ animationDelay: `${i * 100}ms` }}
            >
              <div className="h-[11px] bg-bevel-dark/10 rounded w-[180px] mb-1" />
              <div className="h-[9px] bg-bevel-dark/10 rounded w-[140px]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}