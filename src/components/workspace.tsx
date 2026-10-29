"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronDown,
  Copy,
  Download,
  History,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { defaultCharts, type ChartConfig } from "@/lib/domain";
import { getChartData } from "@/lib/chart-data";
import type {
  Analytics,
  Creator,
  ImportBatch,
  ImportHistory,
} from "@/lib/types";
import { Button } from "./ui/button";
import ImportReview from "./import-review";
import ChartEditor from "./chart-editor";
import AISettingsForm from "./ai-settings";
import AgentSettingsForm from "./agent-settings";
import AgentChat from "./agent-chat";
import ThemeToggle from "./theme-toggle";
import DesktopActions from "./desktop-actions";
import CreatorSelect from "./creator-select";
import DateFilters from "./date-filters";
import type { AISettings as Settings } from "@/lib/ai-config";
import type { WorkbookReportView } from "@/lib/workbook-report";
const Chart = dynamic(() => import("./chart"), {
  ssr: false,
  loading: () => <div className="chart-empty">Carregando gráfico…</div>,
});
type Dashboard = {
  id: string;
  name: string;
  creatorId: string | null;
  config: ChartConfig[];
};
async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${url}`, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Falha na requisição");
  return data;
}
const post = (data: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});
function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function initialPeriod() {
  const now = new Date();
  return {
    from: localDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: localDate(now),
  };
}
export default function Workspace() {
  const [creators, setCreators] = useState<Creator[]>([]),
    [creatorId, setCreatorId] = useState("");
  const [period, setPeriod] = useState(initialPeriod),
    [currency, setCurrency] = useState("BRL"),
    [analyticsData, setAnalytics] = useState<Analytics | null>(null),
    [loadedQuery, setLoadedQuery] = useState("");
  const [charts, setCharts] = useState<ChartConfig[]>(defaultCharts),
    [dashboards, setDashboards] = useState<Dashboard[]>([]),
    [dashboardId, setDashboardId] = useState(""),
    [dashboardName, setDashboardName] = useState("Visão geral");
  const [conversationRevision, setConversationRevision] = useState(0);
  const [dataRevision, setDataRevision] = useState(0);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [batch, setBatch] = useState<ImportBatch | null>(null),
    [editing, setEditing] = useState<ChartConfig | null>(null),
    [modal, setModal] = useState<"creators" | "settings" | "history" | null>(
      null,
    );
  const [creatorName, setCreatorName] = useState(""),
    [settings, setSettings] = useState<Settings | null>(null),
    [history, setHistory] = useState<ImportHistory[]>([]),
    [chatWidth, setChatWidth] = useState(48);
  const loadVersion = useRef(0);
  const onDataset = useCallback(
    (report: Pick<WorkbookReportView, "hash" | "period" | "currency">) => {
      setCreatorId("");
      setPeriod(report.period);
      setCurrency(report.currency);
      setDataRevision((value) => value + 1);
      setNotice(
        "Base sincronizada. O período do painel cobre as datas das vendas importadas.",
      );
    },
    [],
  );
  const query = new URLSearchParams({
    from: period.from,
    to: period.to,
    currency,
    revision: String(dataRevision),
    ...(creatorId ? { creatorId } : {}),
  }).toString();
  const analytics = loadedQuery === query ? analyticsData : null;
  const waiting = loading || loadedQuery !== query;
  const load = useCallback(() => {
    const version = ++loadVersion.current;
    return api<Analytics>(`analytics?${query}`)
      .then((data) => {
        if (version === loadVersion.current) {
          setAnalytics(data);
          setCreators(data.creators);
          setError("");
        }
      })
      .catch((error: unknown) => {
        if (version === loadVersion.current) {
          setError((error as Error).message);
          setAnalytics(null);
        }
      })
      .finally(() => {
        if (version === loadVersion.current) {
          setLoading(false);
          setLoadedQuery(query);
        }
      });
  }, [query]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    api<Settings>("settings")
      .then(setSettings)
      .catch(() => {});
    api<Dashboard[]>("dashboards")
      .then(setDashboards)
      .catch(() => {});
  }, []);
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveDashboard() {
    await run(async () => {
      const saved = await api<Dashboard>(
        "dashboards",
        post({
          ...(dashboardId ? { id: dashboardId } : {}),
          name: dashboardName,
          creatorId: creatorId || null,
          config: charts,
        }),
      );
      setDashboardId(saved.id);
      setDashboards(await api<Dashboard[]>("dashboards"));
      setNotice("Painel salvo no PostgreSQL.");
    });
  }
  function reorder(index: number, direction: number) {
    const next = [...charts];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setCharts(next);
  }
  function resize(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function number(value: number | null | undefined, money = false) {
    if (value == null) return "—";
    return new Intl.NumberFormat(
      "pt-BR",
      money
        ? { style: "currency", currency, maximumFractionDigits: 2 }
        : { maximumFractionDigits: 0 },
    ).format(value);
  }
  const summary = analytics?.summary;
  return (
    <div className="app-shell">
      <div className="app-main">
        <header className="topbar">
          <div className="brand">
            <strong>Creator Intelligence</strong>
          </div>
          <div className="topbar-right">
            <Button
              variant="ghost"
              aria-label="Gerenciar criadores"
              onClick={() => setModal("creators")}
            >
              <Users size={17} />
              <span className="hide-mobile">Criadores</span>
            </Button>
            <Button
              variant="ghost"
              aria-label="Histórico de importações"
              onClick={() => {
                setModal("history");
                void api<ImportHistory[]>("imports")
                  .then(setHistory)
                  .catch((error) => setError(error.message));
              }}
            >
              <History size={17} />
              <span className="hide-mobile">Importações</span>
            </Button>
            <DesktopActions />
            <ThemeToggle />
            <Button
              variant="ghost"
              aria-label="Configurações"
              onClick={() => setModal("settings")}
            >
              <Settings2 size={16} />
              <span className="hide-mobile">Configurações</span>
            </Button>
          </div>
        </header>
        <main
          className="workspace"
          style={{ "--chat-width": `${chatWidth}%` } as React.CSSProperties}
        >
          <AgentChat
            period={period}
            currency={currency}
            charts={charts}
            revision={conversationRevision}
            onCreator={setCreatorId}
            onBatch={(id) => {
              void api<ImportBatch>("imports/" + id)
                .then(setBatch)
                .catch((error) => setError(error.message));
            }}
            onCharts={(value) => {
              setCharts(value);
              setNotice(
                "Gráficos propostos aplicados. Salve o painel para persistir.",
              );
            }}
            onBusy={setBusy}
            onDataset={onDataset}
            disabled={busy}
          />
          <div
            className="resize-handle"
            role="separator"
            aria-label="Redimensionar chat"
            aria-orientation="vertical"
            tabIndex={0}
            onPointerDown={resize}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                const bounds =
                  e.currentTarget.parentElement!.getBoundingClientRect();
                setChatWidth(
                  Math.min(
                    65,
                    Math.max(
                      30,
                      ((e.clientX - bounds.left) / bounds.width) * 100,
                    ),
                  ),
                );
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft")
                setChatWidth(Math.max(30, chatWidth - 2));
              if (e.key === "ArrowRight")
                setChatWidth(Math.min(65, chatWidth + 2));
            }}
          >
            <span />
          </div>
          <section className="dashboard-panel">
            <div className="dashboard-intro">
              <div>
                <div className="eyebrow">PERFORMANCE, COM CONTEXTO</div>
                <h1>
                  Uma visão clara do que importa<span>.</span>
                </h1>
                <p>Conecte seus dados. Encontre o próximo passo.</p>
              </div>
              <Button
                variant="outline"
                onClick={() => void load()}
                disabled={waiting}
                aria-label="Atualizar dados"
              >
                <RefreshCw size={15} className={waiting ? "spin" : ""} />
              </Button>
            </div>
            <div className="filters">
              <CreatorSelect
                creators={creators}
                value={creatorId}
                disabled={busy}
                onChange={setCreatorId}
              />
              <DateFilters period={period} onChange={setPeriod} />
              <select
                aria-label="Moeda"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                <option>BRL</option>
                <option>USD</option>
                <option>EUR</option>
              </select>
            </div>
            {error && (
              <div className="banner error" role="alert">
                <span>{error}</span>
                <button
                  onClick={() => setError("")}
                  aria-label="Dispensar erro"
                >
                  <X size={15} />
                </button>
              </div>
            )}
            {notice && (
              <div className="banner success" role="status">
                {notice}
                <button
                  onClick={() => setNotice("")}
                  aria-label="Dispensar aviso"
                >
                  <X size={15} />
                </button>
              </div>
            )}
            <div className="metrics-grid">
              {[
                {
                  label: "Valor de vendas",
                  value: number(summary?.revenue, true),
                  icon: Wallet,
                  info: "Pedidos válidos · moeda selecionada",
                  accent: "accent",
                },
                {
                  label: "Pedidos",
                  value: number(summary?.orders),
                  icon: BarChart3,
                  info: `Ticket médio ${number(summary?.averageTicket, true)}`,
                  accent: "purple",
                },
                {
                  label: "Variação de seguidores",
                  value: number(summary?.followerDelta),
                  icon: Users,
                  info:
                    summary?.followerPercent != null
                      ? `${summary.followerPercent.toFixed(2)}% entre medições disponíveis`
                      : "Exige duas medições por perfil",
                  accent: "blue",
                },
                {
                  label: "Visualizações",
                  value: number(summary?.views),
                  icon: Activity,
                  info: "Última medição por entidade/origem",
                  accent: "orange",
                },
              ].map((k) => (
                <article className="metric-card" key={k.label}>
                  <div className="metric-top">
                    <span>{k.label}</span>
                    <k.icon size={17} className={`text-${k.accent}`} />
                  </div>
                  <strong>{waiting ? "…" : k.value}</strong>
                  <small>{k.info}</small>
                </article>
              ))}
            </div>
            <div className="dashboard-toolbar">
              <div className="dashboard-name">
                <span className="mini-dot" />
                <input
                  aria-label="Nome do painel"
                  value={dashboardName}
                  onChange={(e) => setDashboardName(e.target.value)}
                  maxLength={100}
                />
                {dashboards.length > 0 && (
                  <select
                    aria-label="Abrir painel salvo"
                    value={dashboardId}
                    onChange={(e) => {
                      const d = dashboards.find((d) => d.id === e.target.value);
                      if (d) {
                        setDashboardId(d.id);
                        setDashboardName(d.name);
                        setCharts(d.config);
                        setCreatorId(d.creatorId ?? "");
                      }
                    }}
                  >
                    <option value="">Abrir salvo…</option>
                    {dashboards.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="toolbar-actions">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDashboardId("");
                    setDashboardName("Novo painel");
                    setCharts(defaultCharts);
                  }}
                  title="Novo painel"
                >
                  <Plus size={14} />
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || !dashboardName.trim()}
                  onClick={() => void saveDashboard()}
                >
                  <Check size={14} />
                  Salvar
                </Button>
                <Button
                  variant="outline"
                  disabled={charts.length >= 12}
                  onClick={() =>
                    setEditing({
                      ...defaultCharts[0],
                      id: crypto.randomUUID(),
                      title: "Novo gráfico",
                      width: "half",
                    })
                  }
                >
                  <Plus size={14} />
                  <span className="hide-mobile">Gráfico</span>
                </Button>
              </div>
            </div>
            <div className="charts-grid">
              {charts.map((chart, index) => (
                <article key={chart.id} className={`chart-card ${chart.width}`}>
                  <div className="chart-heading">
                    <div>
                      <h3>{chart.title}</h3>
                      <small>
                        {
                          {
                            day: "Por dia",
                            week: "Por semana",
                            month: "Por mês",
                            creator: "Por criador",
                            entity: "Por entidade",
                            product: "Por produto",
                            campaign: "Por campanha",
                          }[chart.groupBy]
                        }{" "}
                        ·{" "}
                        {chart.aggregation === "latest"
                          ? "Última medição"
                          : chart.metric === "revenue"
                            ? currency
                            : "Contagem e agregação"}
                      </small>
                    </div>
                    <details className="chart-menu">
                      <summary aria-label={`Opções de ${chart.title}`}>
                        <MoreHorizontal size={19} />
                      </summary>
                      <div>
                        <button onClick={() => setEditing(chart)}>
                          <Settings2 size={13} />
                          Editar
                        </button>
                        <button
                          disabled={charts.length >= 12}
                          onClick={() =>
                            setCharts([
                              ...charts,
                              {
                                ...chart,
                                id: crypto.randomUUID(),
                                title: `${chart.title} (cópia)`,
                              },
                            ])
                          }
                        >
                          <Copy size={13} />
                          Duplicar
                        </button>
                        <button
                          disabled={index === 0}
                          onClick={() => reorder(index, -1)}
                        >
                          <ArrowUp size={13} />
                          Mover acima
                        </button>
                        <button
                          disabled={index === charts.length - 1}
                          onClick={() => reorder(index, 1)}
                        >
                          <ArrowDown size={13} />
                          Mover abaixo
                        </button>
                        <button
                          onClick={() =>
                            setCharts(charts.filter((c) => c.id !== chart.id))
                          }
                        >
                          <X size={13} />
                          Remover
                        </button>
                      </div>
                    </details>
                  </div>
                  <Chart
                    config={chart}
                    data={analytics ? getChartData(analytics, chart) : []}
                    currency={currency}
                  />
                </article>
              ))}
            </div>
            {!creators.length && !waiting && (
              <div className="getting-started">
                <div className="spark-icon">
                  <Plus size={20} />
                </div>
                <div>
                  <h3>Seu primeiro insight começa com um criador</h3>
                  <p>
                    Cadastre um perfil e importe dados reais para construir seu
                    histórico.
                  </p>
                </div>
                <Button onClick={() => setModal("creators")}>
                  Cadastrar criador
                  <ArrowRight size={15} />
                </Button>
              </div>
            )}
            <details className="data-evidence">
              <summary>
                <ShieldCheck size={14} /> Origem, critérios e registros
                consultados <ChevronDown size={14} />
              </summary>
              <p>
                Período: {period.from} a {period.to} · {currency} · Fontes:{" "}
                {analytics?.sources.join(", ") || "nenhuma"}
              </p>
              {analytics?.warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
              <div className="evidence-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Pedido</th>
                      <th>Data</th>
                      <th>Origem</th>
                      <th>Status</th>
                      <th>Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics?.sales.map((s) => (
                      <tr key={s.id}>
                        <td>{s.externalId}</td>
                        <td>{s.date}</td>
                        <td>{s.source}</td>
                        <td>{s.status}</td>
                        <td>{number(s.amount, true)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
            <footer className="dashboard-footer">
              <span>
                <ShieldCheck size={12} /> Base histórica · confirmação
                obrigatória
              </span>
              <span>Creator Intelligence / Ambiente local</span>
            </footer>
          </section>
        </main>
      </div>
      {batch && (
        <ImportReview
          key={batch.id}
          batch={batch}
          creatorName={creators.find((c) => c.id === batch.creatorId)?.name}
          busy={busy}
          onClose={() => setBatch(null)}
          onConfirm={(ids) =>
            void run(async () => {
              await api(`imports/${batch.id}/confirm`, post({ selected: ids }));
              setBatch(null);
              await load();
              setNotice(
                "Registros confirmados. Indicadores e gráficos atualizados.",
              );
              setConversationRevision((value) => value + 1);
            })
          }
        />
      )}
      {editing && (
        <ChartEditor
          chart={editing}
          onClose={() => setEditing(null)}
          onSave={(c) => {
            setCharts(
              charts.some((x) => x.id === c.id)
                ? charts.map((x) => (x.id === c.id ? c : x))
                : [...charts, c],
            );
            setEditing(null);
            setNotice(
              "Gráfico aplicado. Salve o painel para persistir a configuração.",
            );
          }}
        />
      )}
      {modal && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">WORKSPACE LOCAL</span>
                <h2 id="modal-title">
                  {modal === "creators"
                    ? "Seus criadores"
                    : modal === "settings"
                      ? "Conexão de inteligência"
                      : "Histórico de importações"}
                </h2>
              </div>
              <Button
                variant="ghost"
                onClick={() => setModal(null)}
                aria-label="Fechar"
              >
                <X size={18} />
              </Button>
            </div>
            {modal === "creators" && (
              <>
                <p className="muted">
                  Um histórico independente para cada criador.
                </p>
                <form
                  className="creator-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      const c = await api<Creator>(
                        "creators",
                        post({ name: creatorName }),
                      );
                      setCreatorName("");
                      setCreatorId(c.id);
                      setCreators(await api<Creator[]>("creators"));
                      setNotice("Criador cadastrado.");
                    });
                  }}
                >
                  <input
                    placeholder="Nome do criador"
                    aria-label="Nome do novo criador"
                    value={creatorName}
                    onChange={(e) => setCreatorName(e.target.value)}
                    minLength={2}
                    maxLength={100}
                    required
                  />
                  <Button disabled={busy} type="submit">
                    <Plus size={15} />
                    Cadastrar
                  </Button>
                </form>
                <div className="creator-list">
                  {creators.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setCreatorId(c.id);
                        setModal(null);
                      }}
                    >
                      <div className="creator-avatar">
                        {c.name.slice(0, 2).toUpperCase()}
                      </div>
                      <span>{c.name}</span>
                      <ArrowUpRight size={16} />
                    </button>
                  ))}
                </div>
                <a
                  className="template-link"
                  href="/examples/vendas.csv"
                  download
                >
                  <Download size={15} />
                  Baixar CSV modelo de vendas
                </a>
                <a
                  className="template-link"
                  href="/examples/metricas.csv"
                  download
                >
                  <Download size={15} />
                  Baixar CSV modelo de métricas
                </a>
              </>
            )}
            {modal === "settings" &&
              (settings ? (
                <>
                  <AISettingsForm settings={settings} onSaved={setSettings} />
                  <AgentSettingsForm />
                </>
              ) : (
                <p className="notice">Carregando configurações…</p>
              ))}
            {modal === "history" && (
              <div className="history-list">
                {!history.length && (
                  <p className="muted">Nenhuma importação recebida.</p>
                )}
                {history.map((h) => (
                  <div key={h.id}>
                    <div>
                      <b>{h.filename}</b>
                      <small>
                        {new Date(h.createdAt).toLocaleString("pt-BR")} ·{" "}
                        {h.status}
                      </small>
                    </div>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void run(async () =>
                          setBatch(await api<ImportBatch>(`imports/${h.id}`)),
                        )
                      }
                    >
                      Revisar
                    </Button>
                    {h.status === "confirmed" && (
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await api(`imports/${h.id}/revert`, post({}));
                            setHistory(
                              await api<ImportHistory[]>(
                                `imports?${creatorId ? `creatorId=${creatorId}` : ""}`,
                              ),
                            );
                            await load();
                            setNotice(
                              "Lote revertido com histórico de auditoria preservado.",
                            );
                          })
                        }
                      >
                        Reverter
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="success" role="status">
                {notice}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
