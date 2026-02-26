"use client";

export function ContinueListeningSkeleton() {
  return (
    <div className="w98-raised-dark bg-raised-surface animate-slide-up">
      <div className="px-3 py-2">
        <div className="flex items-center justify-between mb-1.5">
          <div className="h-[9px] bg-bevel-dark/10 rounded w-[120px] animate-skeleton" />
          <div className="h-[9px] bg-bevel-dark/10 rounded w-[20px] animate-skeleton" />
        </div>
        <div className="flex gap-2 overflow-x-auto">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex-shrink-0 w-[200px] md:w-[180px] p-2 w98-raised-dark bg-card-surface animate-skeleton"
              style={{ animationDelay: `${i * 150}ms` }}
            >
              <div className="h-[11px] bg-bevel-dark/10 rounded w-[160px] mb-1" />
              <div className="h-[9px] bg-bevel-dark/10 rounded w-[120px] mb-2" />
              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1 h-[3px] w98-inset-dark bg-inset-well" />
                <div className="h-[8px] bg-bevel-dark/10 rounded w-[25px]" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}