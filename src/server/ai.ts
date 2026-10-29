import {
  publicSettings,
  readRuntimeSettings,
  resolveDraft,
  type RuntimeProvider as Config,
} from "./secure-settings";
import { draftRequestSchema } from "@/lib/ai-config";
import { ProviderError, retryInference } from "./inference-retry";
import type { AgentTask } from "@/lib/agent";
import { agentSettings } from "./agent/settings";
import { runHermes } from "./agent/hermes";
const cooldowns = new Map<string, number>();
type HistoryMessage = { role: "user" | "assistant"; content: string };
function providerFailure(status: number) {
  const details: Record<number, string> = {
    401: "Chave rejeitada. Informe uma chave válida nas Configurações.",
    403: "A chave não tem permissão para este recurso/modelo.",
    404: "Endpoint ou modelo não encontrado. Confira a URL-base e o modelo.",
    429: "Limite de uso do provedor atingido. Tente novamente mais tarde.",
  };
  return new ProviderError(
    `HTTP ${status}: ${details[status] || "O provedor não conseguiu processar a solicitação."}`,
    status === 429 || status >= 500,
  );
}
function headersFor(c: Config): Record<string, string> {
  if (c.provider === "anthropic")
    return {
      "Content-Type": "application/json",
      "x-api-key": c.key,
      "anthropic-version": "2023-06-01",
    };
  if (c.provider === "gemini")
    return { "Content-Type": "application/json", "x-goog-api-key": c.key };
  return {
    "Content-Type": "application/json",
    ...(c.key ? { Authorization: `Bearer ${c.key}` } : {}),
  };
}
async function completeOnce(
  c: Config,
  system: string,
  prompt: string,
  maxTokens: number,
  history: HistoryMessage[] = [],
) {
  const conversation: HistoryMessage[] = [];
  for (const message of [
    ...history,
    { role: "user" as const, content: prompt },
  ]) {
    if (!message.content.trim()) continue;
    const previous = conversation.at(-1);
    if (previous?.role === message.role)
      previous.content += "\n\n" + message.content;
    else conversation.push({ ...message });
  }
  let endpoint = `${c.baseUrl}/chat/completions`;
  let body: unknown = {
    model: c.model,
    ...(c.provider === "openai"
      ? { max_completion_tokens: maxTokens }
      : { temperature: 0, max_tokens: maxTokens }),
    stream: false,
    messages: [{ role: "system", content: system }, ...conversation],
  };
  let headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(c.key ? { Authorization: `Bearer ${c.key}` } : {}),
  };
  if (c.provider === "anthropic") {
    endpoint = `${c.baseUrl}/messages`;
    headers = {
      "Content-Type": "application/json",
      "x-api-key": c.key,
      "anthropic-version": "2023-06-01",
    };
    body = {
      model: c.model,
      max_tokens: maxTokens,
      system,
      messages: conversation,
    };
  }
  if (c.provider === "gemini") {
    endpoint = `${c.baseUrl}/models/${encodeURIComponent(c.model)}:generateContent`;
    headers = { "Content-Type": "application/json", "x-goog-api-key": c.key };
    body = {
      systemInstruction: { parts: [{ text: system }] },
      generationConfig: { maxOutputTokens: maxTokens },
      contents: conversation.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      })),
    };
  }
  let data;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
      redirect: "error",
    });
    if (!response.ok) {
      const payload = (await response.text()).slice(0, 20000);
      if (
        [400, 413].includes(response.status) &&
        /context|token.*limit|too.*long|maximum.*length/i.test(payload)
      )
        throw new ProviderError(
          "O modelo recusou o tamanho do contexto. O bloco precisa ser dividido.",
          false,
          "context_limit",
        );
      const error = providerFailure(response.status);
      if (response.status === 429) {
        const retry = response.headers.get("retry-after");
        const reported =
          retry && /^\d+$/.test(retry)
            ? Number(retry) * 1000
            : retry
              ? Date.parse(retry) - Date.now()
              : 30000;
        error.retryAfterMs = Number.isFinite(reported)
          ? Math.max(1000, reported)
          : 30000;
        cooldowns.set(c.baseUrl, Date.now() + error.retryAfterMs);
      }
      throw error;
    }
    data = await response.json();
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (error instanceof SyntaxError)
      throw new ProviderError(
        "O provedor retornou um formato incompatível. Confira o endpoint nas Configurações.",
        false,
      );
    throw new ProviderError(
      "Provedor de IA indisponível ou tempo de resposta excedido (60s). Nova tentativa automática esgotada.",
      true,
    );
  }
  const finish =
    data.choices?.[0]?.finish_reason ??
    data.stop_reason ??
    data.candidates?.[0]?.finishReason;
  if (["length", "max_tokens", "MAX_TOKENS"].includes(finish))
    throw new ProviderError(
      "O modelo encerrou a geração antes de concluir a saída desta etapa.",
      false,
      "output_limit",
    );
  const result =
    c.provider === "anthropic"
      ? data.content?.find((p: { type: string }) => p.type === "text")?.text
      : c.provider === "gemini"
        ? data.candidates?.[0]?.content?.parts?.[0]?.text
        : data.choices?.[0]?.message?.content;
  if (typeof result !== "string" || !result)
    throw new ProviderError(
      "Provedor retornou uma resposta vazia ou incompatível.",
      false,
    );
  return {
    text: result,
    inputTokens:
      data.usage?.prompt_tokens ??
      data.usage?.input_tokens ??
      data.usageMetadata?.promptTokenCount ??
      null,
    outputTokens:
      data.usage?.completion_tokens ??
      data.usage?.output_tokens ??
      data.usageMetadata?.candidatesTokenCount ??
      null,
  };
}
async function complete(
  c: Config,
  system: string,
  prompt: string,
  maxTokens = 4096,
  history: HistoryMessage[] = [],
) {
  return retryInference(() =>
    completeOnce(c, system, prompt, maxTokens, history),
  );
}
export async function askAI(
  system: string,
  prompt: string,
  options: {
    task?: AgentTask;
    maxTokens?: number;
    onProgress?: (message: string) => Promise<void>;
    history?: HistoryMessage[];
  } = {},
) {
  if (
    options.task &&
    system.length +
      prompt.length +
      (options.history?.reduce(
        (sum, message) => sum + message.content.length,
        0,
      ) ?? 0) >
      24000
  )
    throw new ProviderError(
      "Contexto acima do orçamento desta etapa.",
      false,
      "context_limit",
    );
  const runtime = await readRuntimeSettings();
  const routing = options.task ? await agentSettings() : null;
  const auxiliary =
    options.task &&
    options.task !== "answer" &&
    routing?.auxiliaryConnection === "fallback" &&
    runtime.fallback;
  const selected = auxiliary ? runtime.fallback! : runtime.primary;
  const model = options.task && routing ? routing[`${options.task}Model`] : "";
  const primary = { ...selected, model: model || selected.model };
  const backup = auxiliary ? runtime.primary : runtime.fallback;
  const hermes = routing?.engine === "hermes" && options.task !== "extractor";
  const tokens =
    options.maxTokens ??
    (options.task === "answer"
      ? routing!.answerTokens
      : options.task === "router"
        ? hermes
          ? 4096
          : 500
        : options.task === "summary"
          ? hermes
            ? 4096
            : 500
          : options.task === "extractor"
            ? 1400
            : 4096);
  async function invoke(config: Config) {
    const until = cooldowns.get(config.baseUrl) ?? 0;
    if (until > Date.now())
      throw new ProviderError(
        "O modelo está em espera após limite de uso. Retome quando o intervalo terminar.",
        true,
        "transient",
        until - Date.now(),
      );
    const ceiling =
      options.maxTokens !== undefined
        ? tokens
        : hermes
          ? 8192
          : options.task === "extractor"
            ? 4096
            : options.task === "summary"
              ? 2000
              : options.task === "router"
                ? 1500
                : tokens;
    for (let budget = tokens; ; budget = Math.min(ceiling, budget * 2)) {
      try {
        let attempt = 0;
        return routing?.engine === "hermes" && options.task !== "extractor"
          ? await retryInference(async () => {
              if (attempt++) await options.onProgress?.(
                "A conexão falhou. Reenviando somente esta etapa; os trechos concluídos continuam salvos…",
              );
              return runHermes(
              config,
              system,
              prompt,
              budget,
              options.history ?? [],
              routing,
              options.onProgress,
              );
            })
          : await complete(config, system, prompt, budget, options.history);
      } catch (error) {
        if (
          error instanceof ProviderError &&
          error.kind === "output_limit" &&
          budget >= ceiling
        )
          throw new ProviderError(
            `O modelo não concluiu a geração desta etapa dentro do limite de ${ceiling} tokens. As etapas concluídas foram preservadas; retome a análise ou escolha outro modelo nas Configurações.`,
            false,
            "output_limit",
          );
        if (
          !(error instanceof ProviderError) ||
          error.kind !== "output_limit" ||
          budget >= ceiling
        )
          throw error;
        await options.onProgress?.(
          `Ajustando o limite de geração desta etapa · ${Math.min(ceiling, budget * 2)} tokens`,
        );
      }
    }
  }
  try {
    return {
      ...(await invoke(primary)),
      provider: primary.provider,
      model: primary.model,
      fallback: false,
      engine: hermes ? ("hermes" as const) : ("direct" as const),
    };
  } catch (e) {
    if (
      !(e instanceof ProviderError) ||
      (!e.retryable && e.kind !== "output_limit") ||
      !backup
    )
      throw e;
    return {
      ...(await invoke(backup)),
      provider: backup.provider,
      model: backup.model,
      fallback: true,
      engine: hermes ? ("hermes" as const) : ("direct" as const),
    };
  }
}
export const aiInfo = publicSettings;
export async function testProvider(input: unknown) {
  const draft = draftRequestSchema.parse(input);
  const config = await resolveDraft(draft.connection, draft.slot),
    start = Date.now();
  let warning: string | undefined;
  try {
    await complete(
      config,
      "Responda apenas OK.",
      "Teste de conexão sem dados pessoais.",
      config.provider === "openai" ? 256 : 32,
    );
  } catch (error) {
    // A parsed HTTP-success response with a length stop proves connectivity,
    // but does not qualify the model's ability to finish a real task.
    if (!(error instanceof ProviderError) || error.kind !== "output_limit")
      throw error;
    warning =
      "Conexão aceita pelo provedor. O modelo atingiu o limite curto deste teste; para análises, confira o modelo e os tokens por etapa.";
  }
  return {
    provider: config.provider,
    model: config.model,
    latencyMs: Date.now() - start,
    ...(warning ? { warning } : {}),
  };
}
export async function listModels(input: unknown) {
  const draft = draftRequestSchema.parse(input);
  const config = await resolveDraft(draft.connection, draft.slot);
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/models`, {
      headers: headersFor(config),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
  } catch {
    throw new Error(
      "Não foi possível acessar a lista de modelos. Confira o endpoint e se o serviço está iniciado.",
    );
  }
  if (!response.ok) throw providerFailure(response.status);
  const data = await response.json();
  const models = config.provider === "gemini" ? data.models : data.data;
  if (!Array.isArray(models))
    throw new Error(
      "O provedor não retornou uma lista de modelos compatível. Você pode informar o modelo manualmente.",
    );
  return {
    models: models
      .map((m: { id?: string; name?: string }) =>
        config.provider === "gemini" ? m.name?.replace(/^models\//, "") : m.id,
      )
      .filter((id: unknown): id is string => typeof id === "string")
      .sort()
      .slice(0, 500),
  };
}
export function parseAIJson(text: string): unknown {
  return JSON.parse(
    text
      .trim()
      .replace(/^```(?:json)?\s*/, "")
      .replace(/\s*```$/, ""),
  );
}
