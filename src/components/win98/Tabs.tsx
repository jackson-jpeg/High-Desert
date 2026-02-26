"use client";

import { cn } from "@/lib/utils/cn";
import { ReactNode, useState } from "react";

export interface Tab {
  label: string;
  content: ReactNode;
}

export interface TabsProps {
  tabs: Tab[];
  defaultIndex?: number;
  className?: string;
}

export function Tabs({ tabs, defaultIndex = 0, className }: TabsProps) {
  const [activeIndex, setActiveIndex] = useState(defaultIndex);

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Tab headers */}
      <div className="flex">
        {tabs.map((tab, i) => (
          <button
            key={tab.label}
            onClick={() => setActiveIndex(i)}
            className={cn(
              "w98-font text-[11px] px-3 py-1 relative cursor-pointer select-none",
              "border-t-2 border-l-2 border-r-2",
              "focus:outline-dotted focus:outline-1 focus:outline-offset-[-2px] focus:outline-title-bar-blue",
              i === activeIndex
                ? [
                    "bg-raised-surface text-desktop-gray z-10",
                    "border-t-bevel-light border-l-bevel-light border-r-bevel-dark",
                    "mb-[-1px] pb-[5px]",
                  ]
                : [
                    "bg-inset-well text-bevel-dark",
                    "border-t-bevel-dark border-l-bevel-dark border-r-[#0A0E1A]",
                    "mt-[2px]",
                  ],
            )}
            role="tab"
            tabIndex={i === activeIndex ? 0 : -1}
            aria-selected={i === activeIndex}
            aria-controls={`tabpanel-${i}`}
            id={`tab-${i}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {/* Tab content */}
      <div 
        className="w98-raised-dark bg-raised-surface p-3"
        role="tabpanel"
        id={`tabpanel-${activeIndex}`}
        aria-labelledby={`tab-${activeIndex}`}
        tabIndex={0}
      >
        {tabs[activeIndex]?.content}
      </div>
    </div>
  );
}
