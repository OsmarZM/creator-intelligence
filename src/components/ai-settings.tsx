"use client";
import { useState } from "react";
import { Check, Eye, EyeOff, RefreshCw, PlugZap, Save } from "lucide-react";
import {
  providerPresets,
  type AISettings,
  type ProviderInput,
  type PublicProvider,
} from "@/lib/ai-config";
import { Button } from "./ui/button";

type Draft = ProviderInput & { hasKey?: boolean };
const blank: Draft = {
  provider: "freellmapi",
  baseUrl: providerPresets.freellmapi.baseUrl,
  model: "",
  apiKey: "",
};
async function request<T>(route: string, data: unknown): Promise<T> {
  const response = await fetch(`/api/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "A operação falhou.");
  return result;
}
function payload(draft: Draft): ProviderInput {
  const { hasKey: _hasKey, ...input } = draft;
  void _hasKey;
  return input;
}
function ProviderForm({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: Draft;
  onChange: (value: Draft) => void;
  disabled: boolean;
}) {
  const [models, setModels] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState(""),
    [visible, setVisible] = useState(false);
  function change(next: Draft) {
    onChange(next);
    setResult("");
    setError("");
  }
  async function action(kind: "models" | "test") {
    setBusy(true);
    setError("");
    setResult("");
    try {
      const input = payload({ ...value, model: value.model || "list-models" });
      if (kind === "models") {
        const data = await request<{ models: string[] }>("ai/models", {
          connection: input,
          slot: label === "Principal" ? "primary" : "fallback",
        });
        setModels(data.models);
        setResult(
          `${data.models.length} modelos disponíveis. Selecione um ou informe manualmente.`,
        );
      } else {
        const data = await request<{ latencyMs: number; warning?: string }>(
          "ai/test",
          {
            connection: input,
            slot: label === "Principal" ? "primary" : "fallback",
          },
        );
        setResult(
          data.warning ??
            `Conexão validada com ${value.model} em ${data.latencyMs} ms.`,
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const locked = disabled || busy;
  return (
    <fieldset className="provider-form" disabled={locked}>
      <legend>{label}</legend>
      <div className="form-grid">
        <label>
          Provedor
          <select
            aria-label={`${label}: provedor`}
            value={value.provider}
            onChange={(e) => {
              const provider = e.target.value as Draft["provider"];
              setModels([]);
              change({
                ...blank,
                provider,
                baseUrl: providerPresets[provider].baseUrl,
              });
            }}
          >
            {Object.entries(providerPresets).map(([id, p]) => (
              <option key={id} value={id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          URL-base
          <input
            aria-label={`${label}: URL-base`}
            value={value.baseUrl}
            onChange={(e) => {
              setModels([]);
              change({ ...value, baseUrl: e.target.value });
            }}
            placeholder={providerPresets[value.provider].baseUrl}
            required
          />
        </label>
      </div>
      <label>
        Chave da API
        <div className="secret-field">
          <input
            aria-label={`${label}: chave da API`}
            type={visible ? "text" : "password"}
            autoComplete="off"
            value={value.apiKey || ""}
            onChange={(e) =>
              change({ ...value, apiKey: e.target.value, clearKey: false })
            }
            placeholder={
              value.hasKey
                ? "Chave protegida já salva. Deixe vazio para manter."
                : "Informe a chave do seu provedor"
            }
          />
          <Button
            type="button"
            variant="ghost"
            aria-label={visible ? "Ocultar chave" : "Mostrar chave"}
            onClick={() => setVisible(!visible)}
          >
            {visible ? <EyeOff size={16} /> : <Eye size={16} />}
          </Button>
        </div>
      </label>
      {value.hasKey && (
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={!!value.clearKey}
            onChange={(e) =>
              change({ ...value, clearKey: e.target.checked, apiKey: "" })
            }
          />
          Remover a chave salva ao salvar
        </label>
      )}
      <label>
        Modelo
        <input
          aria-label={`${label}: modelo`}
          list={`${label}-models`}
          value={value.model}
          onChange={(e) => change({ ...value, model: e.target.value })}
          placeholder="Busque os modelos ou informe o identificador"
          required
        />
        <datalist id={`${label}-models`}>
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      <div className="provider-actions">
        <Button
          type="button"
          variant="outline"
          onClick={() => void action("models")}
        >
          <RefreshCw size={14} />
          Buscar modelos
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!value.model}
          onClick={() => void action("test")}
        >
          <PlugZap size={14} />
          Testar conexão
        </Button>
        {busy && <span className="muted">Conectando…</span>}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {result && (
        <p role="status" className="success">
          <Check size={14} />
          {result}
        </p>
      )}
    </fieldset>
  );
}
export default function AISettingsForm({
  settings,
  onSaved,
}: {
  settings: AISettings;
  onSaved: (settings: AISettings) => void;
}) {
  const toDraft = (p: PublicProvider): Draft => ({ ...p, apiKey: "" });
  const [primary, setPrimary] = useState<Draft>(() =>
      toDraft(settings.primary),
    ),
    [fallback, setFallback] = useState<Draft>(() =>
      settings.fallback ? toDraft(settings.fallback) : blank,
    ),
    [useFallback, setUseFallback] = useState(!!settings.fallback),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const result = await request<AISettings>("settings", {
        primary: payload(primary),
        fallback: useFallback ? payload(fallback) : null,
      });
      setPrimary(toDraft(result.primary));
      if (result.fallback) setFallback(toDraft(result.fallback));
      onSaved(result);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="ai-settings-form" onSubmit={save}>
      <p className="muted">
        Configure, busque modelos e teste antes de salvar. A chave fica
        protegida pelo usuário do Windows e não é devolvida ao navegador. As
        alterações entram em vigor sem reiniciar.
      </p>
      <ProviderForm
        label="Principal"
        value={primary}
        onChange={(v) => {
          setPrimary(v);
          setSaved(false);
        }}
        disabled={saving}
      />
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={useFallback}
          onChange={(e) => {
            setUseFallback(e.target.checked);
            setSaved(false);
          }}
        />
        Usar provedor de reserva em falhas técnicas
      </label>
      {useFallback && (
        <ProviderForm
          label="Reserva"
          value={fallback}
          onChange={(v) => {
            setFallback(v);
            setSaved(false);
          }}
          disabled={saving}
        />
      )}
      <p className="notice">
        Um gateway local pode encaminhar dados a serviços remotos. CSV/XLSX
        padronizados são lidos por código; texto livre utiliza o modelo
        escolhido.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="success">
          Configurações salvas. As próximas chamadas já usarão esta conexão.
        </p>
      )}
      <div className="modal-footer">
        <span className="muted">
          {settings.saved ? "Configuração local" : "Primeira configuração"}
        </span>
        <Button
          type="submit"
          disabled={
            saving || !primary.model || (useFallback && !fallback.model)
          }
        >
          <Save size={15} />
          {saving ? "Salvando…" : "Salvar configurações"}
        </Button>
      </div>
    </form>
  );
}
