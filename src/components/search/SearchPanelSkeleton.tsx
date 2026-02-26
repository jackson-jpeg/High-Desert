"use client";

export function SearchPanelSkeleton() {
  return (
    <div className="flex flex-col gap-[3px] px-3 py-3">
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className="p-3 w98-raised-dark bg-card-surface animate-skeleton"
          style={{ animationDelay: `${i * 100}ms` }}
        >
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0">
              <div className="w-12 h-12 bg-bevel-dark/20 animate-skeleton" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="h-[11px] w-[70%] bg-bevel-dark/20 mb-1.5" />
              <div className="h-[9px] w-[45%] bg-bevel-dark/20 mb-2" />
              <div className="h-[8px] w-[90%] bg-bevel-dark/10 mb-1" />
              <div className="h-[8px] w-[80%] bg-bevel-dark/10 mb-1" />
              <div className="h-[8px] w-[60%] bg-bevel-dark/10" />
            </div>
          </div>
          <div className="flex items-center justify-between mt-3 pt-2 border-t border-bevel-dark/10">
            <div className="flex gap-2">
              <div className="h-[7px] w-[40px] bg-bevel-dark/10" />
              <div className="h-[7px] w-[30px] bg-bevel-dark/10" />
            </div>
            <div className="h-[7px] w-[50px] bg-bevel-dark/10" />
          </div>
        </div>
      ))}
    </div>
  );
}