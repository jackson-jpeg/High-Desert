"use client";

import { useState, useCallback } from "react";
import { Dialog, Button } from "@/components/win98";
import { clearLibrary } from "@/services/episodes/management";
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
      // One transaction over every dependent table — see clearLibrary().
      await clearLibrary();
      toast.success("Library cleared");
    } catch (err) {
      console.warn("[clear-library] failed, nothing was removed:", err);
      toast.error("Could not clear the library. Nothing was removed");
    } finally {
      setClearing(false);
      onClose();
    }
  }, [onClose]);

  return (
    <Dialog open={open} onClose={onClose} title="Clear Library" urgent width="320px">
      <div className="p-4 flex flex-col gap-4">
        <div className="text-hd-11 text-desktop-gray">
          Remove all episodes, listening history, bookmarks, playlists and scan sessions? This cannot be undone.
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
