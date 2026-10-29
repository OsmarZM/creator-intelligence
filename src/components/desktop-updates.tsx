"use client";
import { useEffect, useState } from "react";
import { Download, RefreshCw, X } from "lucide-react";
import type { DesktopUpdateState } from "@/lib/desktop-update";
import { Button } from "./ui/button";
export default function DesktopUpdates() {
  const [open, setOpen] = useState(false),
    [state, setState] = useState<DesktopUpdateState | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const updates = window.creatorDesktop?.updates;
    if (!updates) return;
    let mounted = true;
    void updates
      .status()
      .then((value) => {
        if (mounted) setState(value);
      })
      .catch(() => {
        if (mounted) setError("Não foi possível consultar as atualizações.");
      });
    const unsubscribe = updates.subscribe((value) => {
      if (mounted) setState(value);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);
  if (!state) return null;
  const pending = ["checking", "downloading", "installing"].includes(
    state.phase,
  );
  const message = {
    idle: "Consulte as novas versões publicadas no GitHub.",
    checking: "Consultando as releases…",
    available: `A versão ${state.version} está disponível.`,
    current: "Você está usando a versão mais recente.",
    downloading: `Baixando atualização · ${Math.round(state.percent ?? 0)}%`,
    downloaded: `Versão ${state.version} pronta para instalar.`,
    installing: "Preparando a instalação…",
    error: "Não foi possível concluir a consulta ou o download.",
    unavailable: "Use o aplicativo Windows instalado para atualizar.",
  }[state.phase];
  const action =
    state.phase === "available"
      ? "download"
      : state.phase === "downloaded"
        ? "install"
        : "check";
  return (
    <>
      <Button
        variant="ghost"
        aria-label="Atualizações do aplicativo"
        onClick={() => setOpen(true)}
      >
        <Download size={16} />
        <span className="hide-mobile">Atualizações</span>
        {state.phase === "available" && <span className="update-dot" />}
      </Button>
      {open && (
        <div className="modal-backdrop">
          <section
            className="modal desktop-update"
            role="dialog"
            aria-modal="true"
            aria-labelledby="update-title"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">CREATOR INTELLIGENCE</span>
                <h2 id="update-title">Atualizações</h2>
              </div>
              <Button
                variant="ghost"
                aria-label="Fechar atualizações"
                disabled={state.phase === "installing"}
                onClick={() => setOpen(false)}
              >
                <X size={18} />
              </Button>
            </div>
            <p className="muted">Versão instalada: {state.currentVersion}</p>
            <p role="status" className="update-message">
              {message}
            </p>
            {state.phase === "downloading" && (
              <progress
                max={100}
                value={state.percent ?? 0}
                aria-label="Progresso do download"
              />
            )}
            <p className="muted">
              Antes de instalar, o aplicativo aguarda as gravações terminarem,
              faz um backup local e reabre com seus dados e configurações.
            </p>
            {(error || state.message) && (
              <p className="notice" role="alert">
                {error || state.message}
              </p>
            )}
            <div className="modal-footer">
              <Button
                disabled={busy || pending || state.phase === "unavailable"}
                onClick={() =>
                  void (async () => {
                    setBusy(true);
                    setError("");
                    try {
                      const updates = window.creatorDesktop?.updates;
                      if (updates) setState(await updates[action]());
                    } catch (failure) {
                      setError((failure as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  })()
                }
              >
                {busy || pending ? (
                  <RefreshCw size={15} className="spin" />
                ) : (
                  <Download size={15} />
                )}{" "}
                {busy && action === "install"
                  ? "Preparando backup…"
                  : action === "download"
                    ? "Baixar atualização"
                    : action === "install"
                      ? "Reiniciar e instalar"
                      : "Verificar atualizações"}
              </Button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
