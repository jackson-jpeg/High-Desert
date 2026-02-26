"use client";

export function SmartPlaylistsSkeleton() {
  return (
    <div className="w98-raised-dark bg-raised-surface animate-slide-up">
      <div className="px-3 py-2">
        <div className="h-[9px] bg-bevel-dark/10 rounded w-[100px] mb-2 animate-skeleton" />
        <div className="flex flex-col gap-0.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-2 px-2 py-2.5 md:py-1.5 animate-skeleton"
              style={{ animationDelay: `${i * 100}ms` }}
            >
              <div className="h-[12px] w-[12px] bg-bevel-dark/10 rounded" />
              <div className="h-[9px] bg-bevel-dark/10 rounded w-[80px] flex-1" />
              <div className="h-[9px] bg-bevel-dark/10 rounded w-[20px]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}