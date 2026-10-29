"use client";
import { useEffect, useState } from "react";
import type { AgentSettings } from "@/lib/agent";
import { Button } from "./ui/button";
export default function AgentSettingsForm() {
  const [settings, setSettings] = useState<AgentSettings | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    fetch("/api/agent/settings")
      .then((r) => r.json())
      .then(setSettings)
      .catch(() =>
        setNotice("Não foi possível carregar a configuração das etapas."),
      );
  }, []);
  if (!settings)
    return <p className="muted">{notice || "Carregando etapas…"}</p>;
  return (
    <form
      className="agent-settings"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setNotice("");
        try {
          const response = await fetch("/api/agent/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(settings),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error);
          setSettings(result);
          setNotice("Etapas salvas. Os próximos envios usarão estes modelos.");
        } catch (error) {
          setNotice((error as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Conversa e processamento</h3>
      <label>
        Motor da conversa
        <select
          value={settings.engine}
          onChange={(event) =>
            setSettings({
              ...settings,
              engine: event.target.value as AgentSettings["engine"],
            })
          }
        >
          <option value="hermes">Hermes local</option>
          <option value="direct">Orquestrador direto</option>
        </select>
      </label>
      {settings.engine === "hermes" && (
        <>
          <p className="muted">
            O aplicativo Windows inclui Hermes e Python, sem instalação
            separada. O perfil e o histórico pertencem a este app. A conexão de
            IA continua sendo a configurada abaixo. Ferramentas de terminal,
            navegador e acesso livre a arquivos ficam desativadas.
          </p>
          <Button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setNotice("");
              try {
                const response = await fetch("/api/agent/runtime", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(settings),
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error);
                setNotice(
                  "Arquivos do motor disponíveis. O teste da conexão de IA fica na configuração do provedor.",
                );
              } catch (error) {
                setNotice((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Verificar arquivos do motor
          </Button>
        </>
      )}
      <h3>Modelos por etapa</h3>
      <p className="muted">
        Deixe vazio para usar o modelo da conexão. Você pode distribuir tarefas
        entre modelos disponíveis no seu gateway. Os nomes precisam existir no
        provedor; o app não cria cotas gratuitas.
      </p>
      <label>
        Conexão para triagem, extração e resumo
        <select
          value={settings.auxiliaryConnection}
          onChange={(event) =>
            setSettings({
              ...settings,
              auxiliaryConnection: event.target.value as "primary" | "fallback",
            })
          }
        >
          <option value="primary">Principal</option>
          <option value="fallback">Reserva, quando configurada</option>
        </select>
      </label>
      {(
        [
          ["routerModel", "Triagem"],
          ["extractorModel", "Extração de dados"],
          ["summaryModel", "Resumo de contexto"],
          ["answerModel", "Resposta · conexão principal"],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          {label}
          <input
            value={settings[key]}
            maxLength={200}
            placeholder="Usar modelo da conexão"
            onChange={(event) =>
              setSettings({ ...settings, [key]: event.target.value })
            }
          />
        </label>
      ))}
      <div className="form-grid">
        <label>
          Caracteres por bloco
          <input
            type="number"
            min={2000}
            max={8000}
            step={500}
            value={settings.chunkChars}
            onChange={(event) =>
              setSettings({
                ...settings,
                chunkChars: Number(event.target.value),
              })
            }
          />
        </label>
        <label>
          Tokens máximos por parte da resposta
          <input
            type="number"
            min={300}
            max={8192}
            step={100}
            value={settings.answerTokens}
            onChange={(event) =>
              setSettings({
                ...settings,
                answerTokens: Number(event.target.value),
              })
            }
          />
        </label>
      </div>
      <p className="muted">
        Execução sequencial para respeitar limites. Respostas são curtas por
        etapa; textos maiores usam vários blocos com checkpoints locais. A
        estimativa por caracteres não é uma contagem exata de tokens.
      </p>
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <Button disabled={busy} type="submit">
        {busy ? "Salvando…" : "Salvar etapas"}
      </Button>
    </form>
  );
}
