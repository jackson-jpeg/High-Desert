"use client";

import { useState, useCallback } from "react";
import { Dialog, Button } from "@/components/win98";
import { db } from "@/db";
import { toast } from "@/stores/toast-store";

interface ClearLibraryDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ClearLibraryDialog({ open, onClose }: ClearLibraryDialogProps) {
  const [clearing, setClearing] = useState(false);

  const handleClear = useCallback(async () => {
    setClearing(true);
    try {
      await db.episodes.clear();
      await db.scanSessions.clear();
      toast.success("Library cleared");
    } finally {
      setClearing(false);
      onClose();
    }
  }, [onClose]);

  return (
    <Dialog open={open} onClose={onClose} title="Clear Library" width="320px">
      <div className="p-4 flex flex-col gap-4">
        <div className="text-hd-11 text-desktop-gray">
          Remove all episodes and scan sessions from the library? This cannot be undone.
        </div>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="dark" onClick={handleClear} disabled={clearing}>
            {clearing ? "Clearing..." : "Clear"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
