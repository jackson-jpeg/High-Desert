"use client";

import { useEffect, useState } from "react";
import { toast } from "@/stores/toast-store";

export function ServiceWorkerRegistration() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").then((reg) => {
        reg?.addEventListener("updatefound", () => {
          const newWorker = reg?.installing;
          if (newWorker) {
            newWorker.addEventListener("statechange", () => {
              if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                setUpdateAvailable(true);
                setWaitingWorker(newWorker);
              }
            });
          }
        });
      }).catch((err) => {
        console.warn("[SW] Registration failed:", err);
      });

      // Listen for messages from service worker
      navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data && event.data.type === "SKIP_WAITING") {
          window.location.reload();
        }
      });
    }
  }, []);

  const handleReload = () => {
    if (waitingWorker) {
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
    }
  };

  useEffect(() => {
    if (updateAvailable) {
      toast.info(
        "New content available!",
        {
          duration: Infinity,
          action: {
            label: "Reload",
            onClick: handleReload,
          },
        }
      );
    }
  }, [updateAvailable]);

  return null;
}
