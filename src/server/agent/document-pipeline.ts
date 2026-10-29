import { ProviderError } from "../inference-retry";
import { splitText } from "./budget";
import { digest } from "./store";

export type DocumentNode = {
  id: string;
  text: string;
  before?: string;
  summary?: string;
  method?: "model" | "literal" | "structured";
  children?: DocumentNode[];
};
export type DocumentCheckpoint = {
  version: 2;
  sourceHash: string;
  nodes: DocumentNode[];
  reductions: Record<string, DocumentNode>;
  context?: string;
};

/** Prefer section/paragraph boundaries; splitText still bounds oversized sections. */
export function documentSections(text: string, limit: number): string[] {
  const sections = text.split(
    /\n(?=#{1,4}\s|(?:Instagram|TikTok|Informações gerais|Métricas privadas|Vendas|Pedidos|Receita|Audiência)\s*(?:\n|:))/i,
  );
  const result: string[] = [];
  for (const section of sections) {
    let remaining = section.trim();
    while (remaining.length > limit) {
      const last = [
        ...remaining.slice(0, limit).matchAll(/(?:[.!?]\s+|\n+)/g),
      ].at(-1);
      const end = last ? last.index! + last[0].length : 0;
      if (end >= limit / 3) {
        result.push(remaining.slice(0, end).trim());
        remaining = remaining.slice(end).trimStart();
      } else {
        const part = splitText(remaining.slice(0, limit * 2), limit)[0];
        result.push(part);
        remaining = remaining.slice(part.length).trimStart();
      }
    }
    if (remaining) result.push(remaining);
  }
  if (result.length > 96)
    throw new Error(
      "Documento acima do orçamento de 96 trechos. Separe-o em dois envios.",
    );
  return result;
}

export async function processDocument(
  text: string,
  limit: number,
  existing: DocumentCheckpoint | undefined,
  summarize: (text: string, id: string, before?: string) => Promise<string>,
  persist: (checkpoint: DocumentCheckpoint) => Promise<void>,
  progress: (message: string) => Promise<void>,
) {
  const sourceHash = digest(text);
  const checkpoint: DocumentCheckpoint =
    existing?.sourceHash === sourceHash && existing.version === 2
      ? existing
      : {
          version: 2,
          sourceHash,
          nodes: documentSections(text, Math.min(limit, 3000)).map(
            (part, index, parts) => ({
              id: `trecho-${index + 1}`,
              text: part,
              before: index ? parts[index - 1].slice(-350) : undefined,
            }),
          ),
          reductions: {},
        };
  await persist(checkpoint);
  if (checkpoint.context) return checkpoint;
  let calls = 0;
  async function read(node: DocumentNode, depth = 0): Promise<string> {
    if (node.summary !== undefined) return node.summary;
    await progress(`Lendo e salvando contexto · ${node.id}`);
    if (node.text.length < 160 && !node.children) {
      node.summary = `[Fonte literal ${node.id}] ${node.text}`;
      node.method = "literal";
      await persist(checkpoint);
      return node.summary;
    }
    if (!node.children) {
      try {
        if (++calls > 96)
          throw new Error(
            "Orçamento de leitura atingido. Retome para continuar dos trechos salvos.",
          );
        const summary = await summarize(node.text, node.id, node.before);
        if (!summary.trim() || summary.length > 1200)
          throw new ProviderError(
            "Leitura acima do orçamento desta seção.",
            false,
            "output_limit",
          );
        node.summary = summary;
        node.method = "model";
        await persist(checkpoint);
        return node.summary;
      } catch (error) {
        if (
          !(error instanceof ProviderError) ||
          !["output_limit", "context_limit"].includes(error.kind)
        )
          throw error;
        if (node.text.length <= 400 || depth >= 4) {
          // Preserve verbatim evidence when even a tiny section cannot be summarized.
          // This is explicitly NOT a successful semantic interpretation.
          node.summary = `[Fonte literal não interpretada ${node.id}] ${node.text}`;
          node.method = "literal";
          await persist(checkpoint);
          return node.summary;
        }
        node.children = splitText(
          node.text,
          Math.ceil(node.text.length / 2),
        ).map((part, index, parts) => ({
          id: `${node.id}.${index + 1}`,
          text: part,
          before: index ? parts[index - 1].slice(-350) : node.before,
        }));
        await persist(checkpoint);
      }
    }
    const summaries: string[] = [];
    for (const child of node.children!)
      summaries.push(await read(child, depth + 1));
    node.summary = summaries.join("\n");
    await persist(checkpoint);
    return node.summary;
  }
  const summaries: string[] = [];
  for (const node of checkpoint.nodes)
    summaries.push(`[${node.id}] ${await read(node)}`);
  let context = summaries.join("\n\n");
  for (let round = 0; context.length > 6500 && round < 5; round++) {
    await progress(`Compactando contextos salvos · rodada ${round + 1}`);
    const groups = splitText(context, 3000),
      next: string[] = [];
    for (const [index, group] of groups.entries()) {
      const key = digest(group);
      const node = (checkpoint.reductions[key] ??= {
        id: `consolidacao-${round + 1}.${index + 1}`,
        text: group,
      });
      next.push(await read(node));
    }
    const reduced = next.join("\n\n");
    if (reduced.length >= context.length) break;
    context = reduced;
  }
  if (context.length > 6500)
    throw new ProviderError(
      "Os trechos estão salvos, mas o modelo não conseguiu compactar o contexto. Escolha um modelo de resumo e retome.",
      false,
      "context_limit",
    );
  checkpoint.context = context;
  await persist(checkpoint);
  return checkpoint;
}
