"use client";
import { useTheme } from "@/lib/theme";
import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "./ui/button";
export default function ThemeToggle() {
  const theme = useTheme();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <Button
        variant="ghost"
        disabled={busy}
        aria-label={
          theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"
        }
        title={theme === "dark" ? "Tema claro" : "Tema escuro"}
        onClick={() => {
          void (async () => {
            setBusy(true);
            setError("");
            const next = theme === "dark" ? "light" : "dark";
            try {
              const response = await fetch("/api/appearance", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ theme: next }),
              });
              if (!response.ok)
                throw new Error("Não foi possível salvar o tema.");
              document.documentElement.dataset.theme = next;
              await window.creatorDesktop?.setTheme(next);
              window.dispatchEvent(new Event("ci-theme"));
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
      </Button>
      {error && <small role="alert">{error}</small>}
    </>
  );
}
