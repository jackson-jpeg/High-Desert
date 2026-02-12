"use client";

import { cn } from "@/lib/utils/cn";
import { MenuBar, StatusBar, Dialog, Button } from "@/components/win98";
import type { Menu } from "@/components/win98";
import { useRouter, usePathname } from "next/navigation";
import { ReactNode, useCallback, useState } from "react";

interface DesktopShellProps {
  children: ReactNode;
  player?: ReactNode;
  episodeCount?: number;
  className?: string;
}

const NAV_ITEMS = [
  { label: "Library", path: "/library" },
  { label: "Scanner", path: "/scanner" },
  { label: "Search", path: "/search" },
] as const;

export function DesktopShell({ children, player, episodeCount = 0, className }: DesktopShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [aboutOpen, setAboutOpen] = useState(false);

  const handleAbout = useCallback(() => setAboutOpen(true), []);
  const handleCloseAbout = useCallback(() => setAboutOpen(false), []);

  const menus: Menu[] = [
    {
      label: "File",
      items: [
        { label: "Open Folder...", shortcut: "Ctrl+O", onClick: () => {} },
        { separator: true, label: "" },
        { label: "Exit", onClick: () => window.close() },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Select All", shortcut: "Ctrl+A", onClick: () => {} },
        { label: "Copy", shortcut: "Ctrl+C", onClick: () => {} },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Compact View", onClick: () => {} },
        { label: "Expanded View", onClick: () => {} },
        { separator: true, label: "" },
        { label: "Sort by Date", onClick: () => {} },
        { label: "Sort by Name", onClick: () => {} },
      ],
    },
    {
      label: "Library",
      items: [
        {
          label: "Scan Folder...",
          shortcut: "Ctrl+Shift+S",
          onClick: () => router.push("/scanner"),
        },
        {
          label: "Search Archive...",
          onClick: () => router.push("/search"),
        },
        { separator: true, label: "" },
        { label: "Clear Library", onClick: () => {} },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "About High Desert", onClick: handleAbout },
        { label: "Keyboard Shortcuts", shortcut: "Ctrl+/", onClick: () => {} },
      ],
    },
  ];

  return (
    <div
      className={cn(
        "flex flex-col h-screen w-screen bg-midnight overflow-hidden",
        className,
      )}
    >
      {/* Top menu bar */}
      <MenuBar menus={menus} variant="dark" className="flex-shrink-0" />

      {/* Navigation tabs */}
      <nav className="flex-shrink-0 flex items-center gap-0 bg-midnight border-b border-bevel-dark/20 px-2">
        {NAV_ITEMS.map(({ label, path }) => {
          const isActive = pathname === path;
          return (
            <button
              key={path}
              onClick={() => router.push(path)}
              className={cn(
                "w98-font text-[10px] px-3 py-1.5 cursor-pointer select-none transition-colors-fast",
                isActive
                  ? "text-desktop-gray border-b border-desert-amber"
                  : "text-bevel-dark hover:text-desktop-gray border-b border-transparent",
              )}
            >
              {label}
            </button>
          );
        })}
      </nav>

      {/* Main content area */}
      <main className="flex-1 overflow-auto">{children}</main>

      {/* Mini player slot */}
      {player && <div className="flex-shrink-0">{player}</div>}

      {/* Bottom status bar */}
      <StatusBar
        variant="dark"
        panels={[
          { content: "Ready", flex: 1 },
          { content: `${episodeCount} episode${episodeCount !== 1 ? "s" : ""}`, width: "140px" },
        ]}
        className="flex-shrink-0"
      />

      {/* About dialog */}
      <Dialog
        open={aboutOpen}
        onClose={handleCloseAbout}
        title="About High Desert"
        width="360px"
      >
        <div className="flex flex-col items-center gap-4 p-4 text-center">
          <div className="text-lg font-bold text-desert-amber">
            High Desert
          </div>
          <div className="text-sm text-desktop-gray">
            Art Bell Radio Archive
          </div>
          <div className="text-xs text-bevel-dark">
            v0.2.0 &mdash; The Midnight Desert
          </div>
          <Button onClick={handleCloseAbout}>OK</Button>
        </div>
      </Dialog>
    </div>
  );
}
