"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // The build id is part of the script URL so every deploy installs a fresh
    // worker, which derives a per-build cache name and purges the previous one.
    const buildId = process.env.NEXT_PUBLIC_BUILD_ID || "dev";
    navigator.serviceWorker
      .register(`/sw.js?v=${encodeURIComponent(buildId)}`)
      .catch((err) => {
        console.warn("[SW] Registration failed:", err);
      });
  }, []);

  return null;
}
