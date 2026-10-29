import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtemp, unlink, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { db } from "../src/server/db";
import { agentStream, runningJob } from "../src/server/agent/orchestrator";
import { readJob, session, saveSession } from "../src/server/agent/store";
import { localDate } from "../src/server/agent/temporal-context";
import { saveAgentSettings } from "../src/server/agent/settings";
import type { AgentEvent } from "../src/lib/agent";
import ExcelJS from "exceljs";
test(
  "agente: checkpoints, retomada, múltiplos modelos, contexto implícito e prévia sem gravar fatos",
  { skip: process.env.RUN_DB_TESTS !== "1" },
  async () => {
    const variables = [
      "CI_DATA_DIR",
      "CI_IGNORE_SAVED_SETTINGS",
      "AI_PROVIDER",
      "AI_BASE_URL",
      "AI_MODEL",
      "AI_API_KEY",
      "AI_FALLBACK_PROVIDER",
      "AI_FALLBACK_BASE_URL",
      "AI_FALLBACK_MODEL",
      "AI_FALLBACK_API_KEY",
    ];
    const saved = Object.fromEntries(
      variables.map((key) => [key, process.env[key]]),
    );
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "creator-agent-test-"),
    );
    process.env.CI_DATA_DIR = directory;
    process.env.CI_IGNORE_SAVED_SETTINGS = "1";
    const requests: {
      model: string;
      system: string;
      part?: number | string;
      messages: { role: string; content: string }[];
      packet: Record<string, unknown>;
    }[] = [];
    let failSecond = true,
      failWorkbook = false,
      extractComplete = false;
    const server = createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw),
        system = body.messages[0].content;
      let packet: Record<string, unknown> = {};
      try {
        packet = JSON.parse(body.messages.at(-1).content);
      } catch {}
      requests.push({
        model: body.model,
        system,
        part: packet.part as number | string | undefined,
        messages: body.messages,
        packet,
      });
      let text = "OK";
      if (
        system.includes("Identifique intenção") &&
        packet.message === "isso, foi no relatório anterior"
      )
        text = JSON.stringify({
          intent: "clarify",
          relation: "continue",
          creatorId: null,
          question:
            "Entendi a referência ao relatório anterior. Você lembra o dia da coleta?",
          sections: [],
        });
      else if (system.includes("Identifique intenção"))
        text = JSON.stringify({
          intent: "answer",
          creatorId: null,
          sections: ["Síntese", "Lacunas", "Próximos passos"],
        });
      else if (system.includes("Resuma somente este trecho")) {
        if (failWorkbook || (packet.part === "trecho-2" && failSecond)) {
          res.writeHead(503);
          res.end("unavailable");
          return;
        }
        text =
          "Resumo do trecho " +
          packet.part +
          ": dados declarados, sem confirmação.";
      } else if (system.includes("Extraia registros"))
        text = JSON.stringify({
          records: extractComplete
            ? [
                {
                  type: "sale",
                  externalId: "order-fixture-1",
                  source: "fixture",
                  date: "2026-10-27",
                  amount: 1200,
                  currency: "BRL",
                  status: "valid",
                },
              ]
            : [],
          notes: extractComplete
            ? "Registro explícito lido."
            : "Qual é a data, a origem e o identificador do pedido?",
        });
      else if (system.includes("TAREFA DESTA CHAMADA"))
        text = JSON.stringify({
          reply:
            "Seção " + packet.section + ". Nenhum dado confirmado disponível.",
          charts: null,
        });
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          choices: [{ finish_reason: "stop", message: { content: text } }],
          usage: { prompt_tokens: 100, completion_tokens: 40 },
        }),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    process.env.AI_PROVIDER = "freellmapi";
    process.env.AI_BASE_URL = `http://127.0.0.1:${address.port}/main`;
    process.env.AI_MODEL = "base";
    process.env.AI_API_KEY = "fixture-primary";
    process.env.AI_FALLBACK_PROVIDER = "openrouter";
    process.env.AI_FALLBACK_BASE_URL = `http://127.0.0.1:${address.port}/aux`;
    process.env.AI_FALLBACK_MODEL = "aux-base";
    process.env.AI_FALLBACK_API_KEY = "fixture-aux";
    const creator = await db().creator.create({
      data: {
        name: "Criador Fixture " + randomUUID().slice(0, 8),
        slug: "agent-" + randomUUID(),
      },
    });
    async function events(response: Response) {
      const text = await response.text();
      return text
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as AgentEvent);
    }
    const input = (message: string) => ({
      message,
      from: "2026-10-01",
      to: "2026-10-27",
      currency: "BRL",
      charts: [],
    });
    try {
      await saveAgentSettings({
        routerModel: "route-fixture",
        summaryModel: "summary-fixture",
        extractorModel: "extract-fixture",
        answerModel: "answer-fixture",
        auxiliaryConnection: "fallback",
        chunkChars: 2000,
        answerTokens: 500,
      });
      const id = randomUUID();
      const first = await events(
        await agentStream(
          id,
          input(
            "Analise os dados de " +
              creator.name +
              ".\n" +
              "Texto de contexto sem métricas confirmadas. ".repeat(150),
          ),
        ),
      );
      assert.equal(first.at(-1)?.type, "error");
      assert.ok((await readJob(id))?.document?.nodes[0].summary);
      assert.equal(
        (await readJob(id))?.plan,
        undefined,
        "A leitura com checkpoints ocorre antes da triagem",
      );
      const firstChunkCalls = requests.filter(
        (request) =>
          request.part === "trecho-1" &&
          request.system.includes("Resuma somente"),
      ).length;
      assert.equal(firstChunkCalls, 1);
      failSecond = false;
      const resumed = await events(await agentStream(id));
      assert.equal(resumed.at(-1)?.type, "complete");
      assert.equal(
        requests.filter(
          (request) =>
            request.part === "trecho-1" &&
            request.system.includes("Resuma somente"),
        ).length,
        1,
        "Não repete etapa concluída",
      );
      assert.equal(resumed.filter((event) => event.type === "reply").length, 3);
      assert.ok(
        requests.some((request) => request.model === "summary-fixture"),
      );
      assert.ok(requests.some((request) => request.model === "answer-fixture"));
      const beforeReplay = requests.length;
      await events(await agentStream(id));
      assert.equal(
        requests.length,
        beforeReplay,
        "Replay concluído não chama IA",
      );
      const documentFollowup = await events(
        await agentStream(
          randomUUID(),
          input("O que consta no documento anterior?"),
        ),
      );
      assert.equal(documentFollowup.at(-1)?.type, "complete");
      assert.ok(
        JSON.stringify(requests.at(-1)?.packet.documentNotes).includes(id),
        "Pergunta posterior recupera trechos do trabalho original",
      );
      const missingId = randomUUID();
      const missing = await events(
        await agentStream(
          missingId,
          input(creator.name + " vendeu 1200 reais"),
        ),
      );
      assert.equal(missing.at(-1)?.type, "complete");
      assert.match(missing.at(-1)?.text ?? "", /data, a origem/);
      assert.ok((await session()).pending?.message.includes("1200"));
      assert.equal(
        await db().sale.count({ where: { creatorId: creator.id } }),
        0,
      );
      extractComplete = true;
      const completed = await events(
        await agentStream(
          randomUUID(),
          input(
            "Data 2026-10-27, origem fixture, pedido order-fixture-1, moeda BRL.",
          ),
        ),
      );
      const batchId = completed.at(-1)?.batchId;
      assert.ok(batchId);
      const batch = await db().importBatch.findUniqueOrThrow({
        where: { id: batchId },
      });
      assert.equal(batch.creatorId, creator.id);
      assert.equal(
        await db().sale.count({ where: { creatorId: creator.id } }),
        0,
        "Prévia não altera fatos",
      );
      assert.ok(
        requests.some((request) => request.model === "extract-fixture"),
      );
      const state = await session();
      assert.equal(state.creatorId, creator.id);
      assert.equal(
        state.messages.filter((message) => message.id === `u-${id}`).length,
        1,
      );
      const report = (
        await readFile("tests/fixtures/inbazz-instagram.txt", "utf8")
      ).replace("ana.demo", creator.name);
      const callsBeforeReport = requests.length;
      const pendingReport = await events(
        await agentStream(randomUUID(), input(report)),
      );
      assert.match(pendingReport.at(-1)?.text ?? "", /Qual é a data da coleta/);
      const monthJob = randomUUID();
      const month = await events(
        await agentStream(monthJob, input("foi desse mes a coleta de dados")),
      );
      const savedMonth = (await session()).pending?.context?.collection?.month;
      assert.equal(
        savedMonth,
        localDate(
          (await readJob(monthJob))!.createdAt,
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        ).slice(0, 7),
      );
      assert.match(month.at(-1)?.text ?? "", /lembra o dia/);
      assert.equal(
        requests.length,
        callsBeforeReport,
        "Mês parcial não reextrai o relatório",
      );
      const detour = await events(
        await agentStream(randomUUID(), input("Por que você precisa do dia?")),
      );
      assert.equal(detour.at(-1)?.type, "complete");
      assert.equal(
        (await session()).pending?.context?.collection?.month,
        savedMonth,
        "Pergunta não descarta a tarefa pendente",
      );
      const lastRequest = requests.at(-1)!;
      assert.ok(
        lastRequest.messages.some(
          (message) =>
            message.role === "user" &&
            message.content === "foi desse mes a coleta de dados",
        ),
      );
      assert.ok(JSON.stringify(lastRequest.packet).includes(savedMonth!));
      const defer = await events(
        await agentStream(randomUUID(), input("não lembro o dia")),
      );
      assert.match(defer.at(-1)?.text ?? "", /Podemos seguir/);
      assert.equal(
        (await session()).pending?.context?.collection?.deferred,
        true,
      );
      const oldState = await session();
      delete oldState.pending!.context;
      oldState.pending!.message +=
        "\nComplemento explícito do usuário:\nfoi desse mes a coleta de dados";
      await saveSession(oldState);
      const callsAfterQuestion = requests.length;
      const datedReport = await events(
        await agentStream(randomUUID(), input("dia 15")),
      );
      assert.ok(datedReport.at(-1)?.batchId);
      assert.equal(
        requests.length,
        callsAfterQuestion,
        "Complemento do dia, inclusive sessão antiga, não chama LLM",
      );
      await events(await agentStream(randomUUID(), input(report)));
      const referent = await events(
        await agentStream(
          randomUUID(),
          input("isso, foi no relatório anterior"),
        ),
      );
      assert.match(
        referent.at(-1)?.text ?? "",
        /referência ao relatório anterior/,
      );
      assert.ok((await session()).pending?.message.includes(report));
      const unknown = await events(
        await agentStream(
          randomUUID(),
          input("@perfil_que_nao_existe vendeu 15 reais"),
        ),
      );
      assert.match(unknown.at(-1)?.text ?? "", /Não encontrei/);
      assert.ok(
        (await session()).pending?.message.includes(report),
        "Referência desconhecida não substitui o envio pendente",
      );
      const pendingBeforeWorkbook = (await session()).pending;
      const workbook = new ExcelJS.Workbook();
      workbook
        .addWorksheet("Resumo")
        .addRow(["Arquivo com vários creators, não confirmado"]);
      workbook.addWorksheet("Vendas").addRows([
        ["Perfil", "Valor"],
        ["@outro_creator", 42.5],
      ]);
      workbook
        .addWorksheet("Pendencias")
        .addRow(["Vínculo comercial divergente"]);
      const workbookId = randomUUID();
      failWorkbook = true;
      const failedWorkbookEvents = await events(
        await agentStream(workbookId, {
          ...input(""),
          filename: "relatorio.xlsx",
          fileBase64: Buffer.from(await workbook.xlsx.writeBuffer()).toString(
            "base64",
          ),
        }),
      );
      assert.equal(failedWorkbookEvents.at(-1)?.type, "error");
      const failedWorkbook = (await readJob(workbookId))!;
      assert.equal(failedWorkbook.status, "failed");
      assert.match(failedWorkbook.parts[0], /Li as 3 abas/);
      assert.ok(
        (await session()).documents?.some(
          (document) => document.jobId === workbookId,
        ),
      );
      assert.deepEqual((await session()).pending, pendingBeforeWorkbook);
      failWorkbook = false;
      const workbookEvents = await events(await agentStream(workbookId));
      assert.equal(workbookEvents.at(-1)?.type, "complete");
      const workbookJob = (await readJob(workbookId))!;
      assert.equal(workbookJob.plan?.intent, "answer");
      assert.equal(
        workbookJob.plan?.creatorId,
        undefined,
        "Relatório global não herda creator ativo",
      );
      assert.match(
        workbookJob.document!.nodes.map((node) => node.text).join("\n"),
        /Vínculo comercial divergente/,
      );
      assert.deepEqual(
        (await session()).pending,
        pendingBeforeWorkbook,
        "Arquivo não descarta nem bloqueia pendência anterior",
      );
      assert.equal(workbookJob.batchId, undefined);
      if (process.env.CI_TEST_WORKBOOK_FILE) {
        const original = await readFile(process.env.CI_TEST_WORKBOOK_FILE);
        const originalId = randomUUID();
        const callsBeforeStructuredWorkbook = requests.length;
        const originalEvents = await events(
          await agentStream(originalId, {
            ...input("Leia o relatório e preserve os vínculos pendentes."),
            filename: path.basename(process.env.CI_TEST_WORKBOOK_FILE),
            fileBase64: original.toString("base64"),
          }),
        );
        assert.equal(originalEvents.at(-1)?.type, "complete");
        const originalJob = (await readJob(originalId))!;
        const originalText = originalJob
          .document!.nodes.map((node) => node.text)
          .join("\n");
        for (const name of [
          "Resumo",
          "Criadores",
          "Vendas",
          "Pendencias",
          "Metodologia",
        ])
          assert.ok(
            originalText.includes(name),
            `Aba ${name} deve chegar ao agente`,
          );
        assert.match(originalText, /\d{4}-\d{2}-\d{2}T/);
        assert.equal(originalJob.batchId, undefined);
        assert.ok(originalJob.workbookReport!.profiles.length > 0);
        assert.ok(originalJob.workbookReport!.orders > 0);
        assert.ok(Number.isFinite(originalJob.workbookReport!.paid));
        assert.equal(
          requests.length,
          callsBeforeStructuredWorkbook,
          "Mapeamento tabular conhecido dispensa inferência para recontar linhas",
        );
        assert.equal(originalJob.plan?.creatorId, undefined);
        assert.deepEqual((await session()).pending, pendingBeforeWorkbook);
      }
      const cancelled = await events(
        await agentStream(randomUUID(), input("pode cancelar")),
      );
      assert.match(cancelled.at(-1)?.text ?? "", /Cancelei/);
      assert.equal((await session()).pending, undefined);
      assert.equal(runningJob(), undefined);
    } finally {
      const batches = await db().importBatch.findMany({
          where: { creatorId: creator.id },
        }),
        ids = batches.map((batch) => batch.id);
      await db().pendingChange.deleteMany({ where: { importId: { in: ids } } });
      await db().sale.deleteMany({ where: { creatorId: creator.id } });
      await db().importBatch.deleteMany({ where: { creatorId: creator.id } });
      await db().creator.delete({ where: { id: creator.id } });
      for (const batch of batches)
        if (batch.storagePath) await unlink(batch.storagePath);
      for (const key of variables) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await db().$disconnect();
    }
  },
);
