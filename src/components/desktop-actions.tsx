"use client";
import { useSyncExternalStore } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "./ui/button";
import DesktopUpdates from "./desktop-updates";
import type { DesktopUpdateState } from "@/lib/desktop-update";
declare global {
  interface Window {
    creatorDesktop?: {
      openBrowser: () => Promise<void>;
      setTheme: (theme: "light" | "dark") => Promise<void>;
      version: string;
      updates?: {
        status: () => Promise<DesktopUpdateState>;
        check: () => Promise<DesktopUpdateState>;
        download: () => Promise<DesktopUpdateState>;
        install: () => Promise<DesktopUpdateState>;
        subscribe: (
          callback: (state: DesktopUpdateState) => void,
        ) => () => void;
      };
    };
  }
}
const subscribe = () => () => {};
export default function DesktopActions() {
  const desktop = useSyncExternalStore(
    subscribe,
    () => !!window.creatorDesktop,
    () => false,
  );
  if (!desktop) return null;
  return (
    <>
      <Button
        variant="outline"
        aria-label="Abrir no navegador"
        onClick={() => void window.creatorDesktop?.openBrowser()}
      >
        <ExternalLink size={15} />
        <span className="hide-mobile">Abrir no navegador</span>
      </Button>
      <DesktopUpdates />
    </>
  );
}
