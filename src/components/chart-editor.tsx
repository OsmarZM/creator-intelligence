"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { chartSchema, type ChartConfig } from "@/lib/domain";
import { Button } from "./ui/button";
export default function ChartEditor({
  chart,
  onClose,
  onSave,
}: {
  chart: ChartConfig;
  onClose: () => void;
  onSave: (config: ChartConfig) => void;
}) {
  const [draft, setDraft] = useState(chart),
    [error, setError] = useState("");
  function field<K extends keyof ChartConfig>(key: K, value: ChartConfig[K]) {
    setDraft({ ...draft, [key]: value });
  }
  return (
    <div className="modal-backdrop">
      <form
        className="modal editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-title"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = chartSchema.safeParse(draft);
          if (!parsed.success)
            return setError(
              parsed.error.issues.map((i) => i.message).join(". "),
            );
          onSave(parsed.data);
        }}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">CHART BUILDER</span>
            <h2 id="editor-title">Configure sua visualização</h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            aria-label="Fechar editor"
            onClick={onClose}
          >
            <X size={18} />
          </Button>
        </div>
        <label>
          Título
          <input
            value={draft.title}
            onChange={(e) => field("title", e.target.value)}
            maxLength={120}
            required
          />
        </label>
        <div className="form-grid">
          <label>
            Tipo
            <select
              value={draft.type}
              onChange={(e) =>
                field("type", e.target.value as ChartConfig["type"])
              }
            >
              {[
                ["bar", "Barras"],
                ["line", "Linha"],
                ["area", "Área"],
                ["pie", "Pizza"],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Métrica
            <select
              value={draft.metric}
              onChange={(e) => {
                const metric = e.target.value as ChartConfig["metric"];
                setDraft({
                  ...draft,
                  metric,
                  aggregation: ["followers", "views"].includes(metric)
                    ? "latest"
                    : metric === "orders"
                      ? "count"
                      : "sum",
                  groupBy: "creator",
                });
              }}
            >
              {[
                ["revenue", "Receita"],
                ["orders", "Pedidos"],
                ["followers", "Seguidores (snapshot)"],
                ["views", "Visualizações (snapshot)"],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Agrupar por
            <select
              value={draft.groupBy}
              onChange={(e) =>
                field("groupBy", e.target.value as ChartConfig["groupBy"])
              }
            >
              {[
                ["day", "Dia"],
                ["week", "Semana"],
                ["month", "Mês"],
                ["creator", "Criador"],
                ["entity", "Perfil / conteúdo"],
                ["product", "Produto"],
                ["campaign", "Campanha"],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Agregação
            <select
              value={draft.aggregation}
              onChange={(e) =>
                field(
                  "aggregation",
                  e.target.value as ChartConfig["aggregation"],
                )
              }
            >
              {[
                ["sum", "Soma"],
                ["average", "Média"],
                ["count", "Contagem"],
                ["max", "Máximo"],
                ["min", "Mínimo"],
                ["latest", "Última por entidade"],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Cor
            <input
              type="color"
              value={draft.color}
              onChange={(e) => field("color", e.target.value)}
            />
          </label>
          <label>
            Largura
            <select
              value={draft.width}
              onChange={(e) =>
                field("width", e.target.value as "half" | "full")
              }
            >
              <option value="half">Meia largura</option>
              <option value="full">Largura inteira</option>
            </select>
          </label>
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={draft.legend}
            onChange={(e) => field("legend", e.target.checked)}
          />{" "}
          Mostrar legenda
        </label>
        <p className="notice">
          Snapshots usam a última medição por entidade e origem em cada grupo.
          Período e moeda seguem os filtros do painel.
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit">Aplicar ao painel</Button>
        </div>
      </form>
    </div>
  );
}
