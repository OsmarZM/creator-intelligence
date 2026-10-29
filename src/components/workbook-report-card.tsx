"use client";
import { useState } from "react";
import { Check, Database, RefreshCw } from "lucide-react";
import type { WorkbookReportView } from "@/lib/workbook-report";
import { ChatVisuals } from "./chat-visuals";
import { Button } from "./ui/button";
const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    value,
  );
export default function WorkbookReportCard({
  report,
  onApplied,
  disabled,
}: {
  report: WorkbookReportView;
  onApplied: (report: WorkbookReportView) => void;
  disabled: boolean;
}) {
  const [applying, setApplying] = useState(false),
    [error, setError] = useState("");
  async function apply() {
    setApplying(true);
    setError("");
    try {
      const response = await fetch("/api/agent/workbook/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: report.jobId,
          hash: report.hash,
          confirm: true,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Não foi possível aplicar os dados.");
      onApplied(result);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setApplying(false);
    }
  }
  const applied = report.status === "applied";
  return (
    <div className="workbook-report-card">
      <header>
        <span className="report-status">
          <Database size={16} />
          {applied ? "Base atualizada" : "Importação estruturada"}
        </span>
        <strong>{report.filename}</strong>
        <small>
          Origem: {report.source} ·{" "}
          {report.period.from.split("-").reverse().join("/")} a{" "}
          {report.period.to.split("-").reverse().join("/")}
        </small>
      </header>
      {!applied && (
        <Button onClick={() => void apply()} disabled={disabled || applying}>
          <Database size={16} />
          {applying ? (
            <>
              <RefreshCw size={15} />
              Aplicando dados…
            </>
          ) : (
            "Criar creators e aplicar vendas validadas"
          )}
        </Button>
      )}
      <ChatVisuals
        visuals={[
          {
            type: "stats",
            title: applied
              ? "Dados disponíveis no painel"
              : "Pronto para alimentar o painel",
            items: [
              {
                label: "Creators identificados",
                value: String(report.profiles.length),
                detail: `${report.profiles.filter((p) => p.validated).length} com vínculo comercial validado`,
              },
              { label: "Pedidos validados", value: String(report.orders) },
              { label: "Valor pago validado", value: money(report.paid) },
              {
                label: "Pedidos em revisão",
                value: String(report.pendingOrders),
                detail: money(report.pendingPaid) + " fora dos indicadores",
              },
            ],
          },
          {
            type: "flow",
            title: "Do arquivo aos indicadores",
            steps: [
              { title: "Arquivo lido", detail: "Abas e campos reconhecidos" },
              {
                title: "Vínculos conferidos",
                detail: "Associações divergentes separadas",
              },
              {
                title: applied ? "Registros aplicados" : "Aplicar registros",
                detail: applied
                  ? `${report.applied?.insertedSales ?? 0} vendas novas · ${report.applied?.duplicateSales ?? 0} já existentes`
                  : "Criação dos creators e vendas com rastreabilidade",
              },
              {
                title: "Painel conectado",
                detail: applied
                  ? "Indicadores consultam a base atualizada"
                  : "Atualização automática após aplicar",
              },
            ],
          },
          {
            type: "bars",
            title: "Maiores valores por creator · 8 primeiros do arquivo",
            unit: "BRL",
            items: [...report.profiles]
              .filter((p) => p.orders > 0)
              .sort((a, b) => b.paid - a.paid)
              .slice(0, 8)
              .map((p) => ({ label: p.handle, value: p.paid })),
          },
          {
            type: "table",
            title: "Mapeamento dos creators",
            columns: ["Creator", "Pedidos válidos", "Valor pago", "Vínculo"],
            rows: report.profiles.map((p) => [
              p.handle,
              p.orders,
              money(p.paid),
              p.validated
                ? "Validado"
                : `${p.pendingOrders} pedido(s) em revisão`,
            ]),
          },
        ]}
      />
      <p className="report-footnote">
        Os CSVs cobrem períodos diferentes. Os valores acima representam a base
        importada, sem equiparar o desempenho comercial entre os perfis.
      </p>
      <details className="report-observations">
        <summary>Métricas sociais informadas no arquivo</summary>
        <p>
          Valores de referência do documento. A data exata da coleta não está
          confirmada; estes números não entram na evolução diária.
        </p>
        <ChatVisuals
          visuals={[
            {
              type: "table",
              title: "Comunidade e engajamento informados",
              columns: [
                "Creator",
                "Seguidores IG",
                "Seguidores TikTok",
                "Engajamento IG",
              ],
              rows: report.profiles.map((p) => [
                p.handle,
                p.followersIG,
                p.followersTikTok,
                p.engagementPercent === null
                  ? null
                  : `${p.engagementPercent.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`,
              ]),
            },
          ]}
        />
      </details>
      <details className="report-observations">
        <summary>Origem, critérios e pendências</summary>
        <ul>
          {report.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      </details>
      {applied && (
        <p className="report-applied">
          <Check size={17} /> {report.applied?.createdCreators ?? 0} creators
          criados · {report.applied?.reusedCreators ?? 0} reutilizados · pedidos
          repetidos não foram duplicados.
        </p>
      )}
      {error && (
        <p role="alert" className="composer-error">
          {error}
        </p>
      )}
    </div>
  );
}
