"use client";

import { useEffect, useState } from "react";

/**
 * Adaptive polling interval helper (PRD 6.2 & 14.2):
 * Pauses polling completely when the browser tab is hidden to conserve Worker requests.
 */
export function useVisibilityPolling(active: boolean, activeMs = 5_000, idleMs = 30_000): number | false {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  if (!visible) return false;
  return active ? activeMs : idleMs;
}
