"use client";
import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, Check, Paperclip, Plus, RefreshCw } from "lucide-react";
import type { AgentMessage, AgentEvent } from "@/lib/agent";
import type { ChartConfig } from "@/lib/domain";
import { Button } from "./ui/button";
import WorkbookReportCard from "./workbook-report-card";
import { ChatVisuals } from "./chat-visuals";
import type { WorkbookReportView } from "@/lib/workbook-report";
function MessageBody({ message }: { message: AgentMessage }) {
  const [expanded, setExpanded] = useState(false);
  const large = message.role === "user" && message.text.length > 1800;
  return (
    <>
      <div className="message-text">
        <Markdown
          remarkPlugins={[remarkGfm]}
          skipHtml
          components={{ img: () => null }}
        >
          {large && !expanded
            ? message.text.slice(0, 1200) + "\n\n…"
            : message.text}
        </Markdown>
      </div>
      {large && (
        <button className="text-action" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Recolher texto" : "Ver texto completo"}
        </button>
      )}
    </>
  );
}
export default function AgentChat({
  period,
  currency,
  charts,
  revision,
  onCreator,
  onBatch,
  onCharts,
  onBusy,
  onDataset,
  disabled,
}: {
  period: { from: string; to: string };
  currency: string;
  charts: ChartConfig[];
  revision: number;
  onCreator: (id: string) => void;
  onBatch: (id: string) => void;
  onCharts: (charts: ChartConfig[]) => void;
  onBusy: (busy: boolean) => void;
  onDataset: (
    report: Pick<WorkbookReportView, "hash" | "period" | "currency">,
  ) => void;
  disabled: boolean;
}) {
  const [messages, setMessages] = useState<AgentMessage[]>([]),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [error, setError] = useState(""),
    [loaded, setLoaded] = useState(false),
    [activeJob, setActiveJob] = useState<string>(),
    [retryUntil, setRetryUntil] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null),
    scrollArea = useRef<HTMLDivElement>(null),
    inFlight = useRef(false),
    following = useRef(true),
    restoredDataset = useRef(""),
    submissions = useRef(
      new Map<
        string,
        {
          message: string;
          file?: File;
          period: { from: string; to: string };
          currency: string;
          charts: ChartConfig[];
          timeZone: string;
        }
      >(),
    );
  useEffect(() => {
    if (retryUntil > 0) {
      const timer = setTimeout(
        () => setRetryUntil(0),
        Math.min(2147483647, retryUntil - Date.now()),
      );
      return () => clearTimeout(timer);
    }
  }, [retryUntil]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/agent/session", { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        return data;
      })
      .then((data) => {
        setMessages(data.messages);
        setActiveJob(data.activeJobId);
        setLoaded(true);
        if (
          data.lastWorkbook &&
          restoredDataset.current !== data.lastWorkbook.hash
        ) {
          restoredDataset.current = data.lastWorkbook.hash;
          onDataset(data.lastWorkbook);
        }
        if (data.creatorId) onCreator(data.creatorId);
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setError(error.message);
          setLoaded(true);
        }
      });
    return () => controller.abort();
  }, [revision, onCreator, onDataset]);
  useEffect(() => {
    if (following.current && scrollArea.current)
      scrollArea.current.scrollTop = scrollArea.current.scrollHeight;
  }, [messages, progress]);
  async function execute(
    id: string,
    resume = false,
    message = "",
    file?: File,
  ) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    setProgress("Preparando envio…");
    setActiveJob(id);
    following.current = true;
    if (!resume)
      submissions.current.set(id, {
        message,
        file,
        period: { ...period },
        currency,
        charts,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
    if (!resume) {
      setText("");
      setMessages((items) => [
        ...items,
        {
          id: `u-${id}`,
          role: "user",
          text: file
            ? `Arquivo: ${file.name}${message ? "\n" + message : ""}`
            : message,
          jobId: id,
        },
        { id: `a-${id}`, role: "assistant", text: "", jobId: id },
      ]);
    } else
      setMessages((items) =>
        items.map((m) => (m.id === `a-${id}` ? { ...m, error: undefined } : m)),
      );
    try {
      const form = new FormData();
      form.set("jobId", id);
      const source = submissions.current.get(id);
      if (resume && !source) form.set("resume", "1");
      else {
        const input = source ?? {
          message,
          file,
          period,
          currency,
          charts,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
        form.set("message", input.message);
        form.set("from", input.period.from);
        form.set("to", input.period.to);
        form.set("currency", input.currency);
        form.set("charts", JSON.stringify(input.charts));
        form.set("timeZone", input.timeZone);
        if (input.file) form.set("file", input.file);
      }
      const response = await fetch("/api/agent/turn", {
        method: "POST",
        body: form,
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Não foi possível iniciar a análise.");
      }
      if (!response.body)
        throw new Error("Conexão sem conteúdo. Retome este envio.");
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let buffer = "",
        finished = false,
        failed = false;
      function handle(event: AgentEvent) {
        if (event.type === "progress") {
          setProgress(event.text ?? "");
          return;
        }
        if (event.creatorId) onCreator(event.creatorId);
        if (event.type === "reply" || event.type === "complete")
          setMessages((items) => {
            const next: AgentMessage = {
              id: `a-${id}`,
              role: "assistant",
              text: event.text ?? "",
              jobId: id,
              creatorId: event.creatorId,
              charts: event.charts,
              visuals: event.visuals,
              report: event.report,
              error: undefined,
              meta: event.meta,
            };
            return items.some((m) => m.id === next.id)
              ? items.map((m) => (m.id === next.id ? next : m))
              : [...items, next];
          });
        if (event.type === "complete") {
          submissions.current.delete(id);
          finished = true;
          setActiveJob(undefined);
          if (event.batchId) onBatch(event.batchId);
        }
        if (event.type === "error") {
          if (event.retryAfterMs)
            setRetryUntil(Date.now() + event.retryAfterMs);
          failed = true;
          finished = true;
          setMessages((items) =>
            items.map((m) =>
              m.id === `a-${id}`
                ? {
                    ...m,
                    error:
                      event.text ?? "A etapa falhou. Retome para continuar.",
                  }
                : m,
            ),
          );
        }
      }
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (line.trim()) handle(JSON.parse(line));
        }
        if (done) break;
      }
      if (buffer.trim()) handle(JSON.parse(buffer));
      if (!finished)
        throw new Error(
          "A conexão foi interrompida. As etapas concluídas estão salvas; retome este envio.",
        );
      if (!failed) setProgress("");
    } catch (error) {
      const message = (error as Error).message;
      setMessages((items) =>
        items.map((m) => (m.id === `a-${id}` ? { ...m, error: message } : m)),
      );
      setError(message);
    } finally {
      inFlight.current = false;
      setBusy(false);
      onBusy(false);
      setProgress("");
    }
  }
  async function newConversation() {
    if (inFlight.current) return;
    try {
      const response = await fetch("/api/agent/new", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setMessages([]);
      submissions.current.clear();
      onCreator("");
      setRetryUntil(0);
      setActiveJob(undefined);
      setError("");
      setText("");
    } catch (error) {
      setError((error as Error).message);
    }
  }
  const blocked = busy || disabled || !loaded;
  return (
    <section
      className="chat-panel"
      aria-label="Conversa"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file && !blocked)
          void execute(crypto.randomUUID(), false, text.trim(), file);
      }}
    >
      <div className="conversation-toolbar">
        <span>Conversa</span>
        <button
          title="Nova conversa"
          aria-label="Nova conversa"
          disabled={blocked}
          onClick={() => void newConversation()}
        >
          <Plus size={17} />
        </button>
      </div>
      <div
        className="messages"
        ref={scrollArea}
        onScroll={() => {
          const area = scrollArea.current;
          if (area)
            following.current =
              area.scrollHeight - area.scrollTop - area.clientHeight < 100;
        }}
      >
        {!messages.length && (
          <div className="conversation-welcome">
            <span className="eyebrow">DADOS, COM CONTEXTO</span>
            <h2>O que vamos descobrir?</h2>
            <p>
              Conte de qual criador você está falando, envie seus dados ou faça
              uma pergunta. Eu organizo a leitura em etapas e pergunto quando
              faltar contexto.
            </p>
          </div>
        )}
        {messages.map((message) => (
          <article key={message.id} className={`message ${message.role}`}>
            <span className="message-label">
              {message.role === "user" ? "VOCÊ" : "CREATOR"}
            </span>
            {message.report ? (
              <>
                <WorkbookReportCard
                  report={message.report}
                  disabled={blocked}
                  onApplied={(report) => {
                    setMessages((items) =>
                      items.map((item) =>
                        item.id === message.id ? { ...item, report } : item,
                      ),
                    );
                    restoredDataset.current = report.hash;
                    onDataset(report);
                  }}
                />
                <details className="message-details">
                  <summary>Ver a leitura textual desta conversa</summary>
                  <MessageBody message={message} />
                </details>
              </>
            ) : (
              <MessageBody message={message} />
            )}
            {message.visuals?.length ? (
              <ChatVisuals visuals={message.visuals} />
            ) : null}
            {message.meta && (
              <details className="message-details">
                <summary>Contexto desta resposta</summary>
                {message.meta}
              </details>
            )}
            {message.error && (
              <div role="alert" className="message-failure">
                <p>{message.error}</p>
                <Button
                  variant="outline"
                  disabled={blocked || retryUntil > 0}
                  onClick={() => void execute(message.jobId!, true)}
                >
                  <RefreshCw size={15} />
                  {retryUntil > 0
                    ? "Aguardando limite do provedor…"
                    : "Retomar análise"}
                </Button>
                <small>As etapas concluídas são reaproveitadas.</small>
              </div>
            )}
            {message.charts?.length ? (
              <Button
                variant="outline"
                onClick={() => onCharts(message.charts!)}
              >
                <Check size={14} />
                Aplicar gráficos propostos
              </Button>
            ) : null}
          </article>
        ))}
        {busy && (
          <div className="thinking" role="status">
            <span />
            {progress || "Continuando a análise…"}
            <button
              className="text-action"
              onClick={() => {
                void fetch("/api/agent/pause", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ jobId: activeJob }),
                })
                  .then(async (response) => {
                    if (!response.ok)
                      throw new Error(
                        (await response.json()).error ||
                          "Não foi possível pausar.",
                      );
                    setProgress("Pausando após a etapa atual…");
                  })
                  .catch((failure) => setError(failure.message));
              }}
            >
              Pausar após etapa
            </button>
          </div>
        )}
        {activeJob &&
          !busy &&
          !messages.some(
            (message) => message.jobId === activeJob && message.error,
          ) && (
            <Button
              variant="outline"
              disabled={blocked}
              onClick={() => void execute(activeJob, true)}
            >
              <RefreshCw size={15} />
              Continuar análise salva
            </Button>
          )}
      </div>
      <div className="chat-bottom">
        {error && !messages.some((message) => message.error === error) && (
          <p className="composer-error" role="alert">
            {error}
          </p>
        )}
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim() && !blocked)
              void execute(crypto.randomUUID(), false, text.trim());
          }}
        >
          <textarea
            aria-label="Mensagem para o assistente"
            placeholder="Pergunte ou traga novos dados…"
            value={text}
            disabled={blocked}
            maxLength={180000}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (text.trim() && !blocked)
                  void execute(crypto.randomUUID(), false, text.trim());
              }
            }}
          />
          <div className="composer-bottom">
            <button
              type="button"
              className="attach-button"
              aria-label="Anexar arquivo"
              disabled={blocked}
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip size={19} />
              <span>Anexar</span>
            </button>
            <small>Enter envia · Shift + Enter quebra linha</small>
            <button
              type="submit"
              className="send-button"
              aria-label="Enviar mensagem"
              disabled={blocked || !text.trim()}
            >
              <ArrowUp size={21} />
            </button>
          </div>
        </form>
        <input
          ref={fileInput}
          type="file"
          hidden
          accept=".csv,.xlsx,.txt,.md"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file && !blocked)
              void execute(crypto.randomUUID(), false, text.trim(), file);
            event.target.value = "";
          }}
        />
      </div>
    </section>
  );
}
