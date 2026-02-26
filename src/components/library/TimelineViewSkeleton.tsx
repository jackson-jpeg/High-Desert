"use client";

export function TimelineViewSkeleton() {
  return (
    <div className="w98-raised-dark bg-raised-surface animate-slide-up">
      <div className="px-3 py-2">
        <div className="h-[9px] bg-bevel-dark/10 rounded w-[60px] mb-2 animate-skeleton" />
        <div className="space-y-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-[16px] w98-inset-dark bg-inset-well animate-skeleton"
              style={{ animationDelay: `${i * 80}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}