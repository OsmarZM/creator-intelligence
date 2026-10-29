"use client";
import { useSyncExternalStore } from "react";
function subscribe(callback: () => void) {
  window.addEventListener("ci-theme", callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener("ci-theme", callback);
    window.removeEventListener("storage", callback);
  };
}
export function useTheme() {
  return useSyncExternalStore(
    subscribe,
    () => document.documentElement.dataset.theme || "dark",
    () => "dark",
  );
}
