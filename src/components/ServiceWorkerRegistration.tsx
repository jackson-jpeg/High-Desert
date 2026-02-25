"use client";

import { useEffect, useState } from "react";

export function ServiceWorkerRegistration() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").then((reg) => {
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
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

  return (
    updateAvailable && (
      <div className="fixed bottom-4 right-4 bg-gray-800 text-white p-4 rounded shadow-lg z-50">
        <p className="mb-2">New content available!</p>
        <button
          onClick={handleReload}
          className="bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded text-sm"
        >
          Reload
        </button>
      </div>
    )
  );
}
