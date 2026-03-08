"use client";

import { useState, useCallback, useEffect } from "react";
import { Dialog, Button } from "@/components/win98";
import { clearAudioCache, getCacheSize } from "@/audio/cache";
import { toast } from "@/stores/toast-store";

interface ClearCacheDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ClearCacheDialog({ open, onClose }: ClearCacheDialogProps) {
  const [clearing, setClearing] = useState(false);
  const [cacheSize, setCacheSize] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      getCacheSize().then(setCacheSize);
    } else {
      setCacheSize(null);
    }
  }, [open]);

  const handleClear = useCallback(async () => {
    setClearing(true);
    try {
      await clearAudioCache();
      toast.success("Audio cache cleared");
    } finally {
      setClearing(false);
      onClose();
    }
  }, [onClose]);

  return (
    <Dialog open={open} onClose={onClose} title="Clear Audio Cache" width="320px">
      <div className="p-4 flex flex-col gap-4">
        <div className="text-hd-11 text-desktop-gray">
          Remove all cached audio files from local storage?
          {cacheSize != null && (
            <span className="block mt-1 text-bevel-dark">
              Cache size: {(cacheSize / 1024 / 1024).toFixed(1)} MB
            </span>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="dark" onClick={handleClear} disabled={clearing}>
            {clearing ? "Clearing..." : "Clear Cache"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
