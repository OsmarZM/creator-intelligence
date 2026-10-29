import type ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@/generated/prisma/client";
import { saleSchema, dateSchema, moneyToCents } from "@/lib/domain";
import type { ReportProfile, WorkbookReportView } from "@/lib/workbook-report";
import { db } from "./db";
import { dataDirectory } from "./data-directory";

export type WorkbookReport = {
  view: WorkbookReportView;
  sales: {
    row: number;
    handle: string;
    csv: string;
    record: ReturnType<typeof saleSchema.parse>;
  }[];
};
export const profileIdentity = (value: string) =>
  value.trim().replace(/^@/, "").toLowerCase();
const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
const checksum = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
function columns(sheet: ExcelJS.Worksheet, required: string[]) {
  for (let n = 1; n <= Math.min(sheet.rowCount, 12); n++) {
    const map = new Map<string, number>();
    sheet.getRow(n).eachCell((cell, index) => {
      if (cell.text.trim()) map.set(normalize(cell.text), index);
    });
    if (required.every((name) => map.has(normalize(name))))
      return { row: n, map };
  }
  return null;
}
function numeric(cell: ExcelJS.Cell): number | null {
  const raw = cell.formula ? cell.result : cell.value;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && /^\d+(?:[.,]\d+)?$/.test(raw.trim()))
    return Number(raw.replace(",", "."));
  return null;
}
function cents(value: number | null) {
  if (
    value === null ||
    value < 0 ||
    value > 1_000_000_000 ||
    Math.abs(value * 100 - Math.round(value * 100)) > 0.0001
  )
    throw new Error("Valor pago inválido ou com precisão superior a centavos.");
  return Math.round(value * 100);
}
function saleDate(cell: ExcelJS.Cell) {
  const value = cell.value;
  // Excel serial dates have no timezone; retain the calendar day, without
  // converting it to the machine's timezone or borrowing dashboard filters.
  return dateSchema.parse(
    value instanceof Date ? value.toISOString().slice(0, 10) : cell.text.trim(),
  );
}
export function readWorkbookReport(
  workbook: ExcelJS.Workbook,
  buffer: Buffer,
  filename: string,
  jobId: string,
): WorkbookReport | null {
  const profileSheet = workbook.worksheets.find((sheet) =>
    columns(sheet, ["Perfil na conversa", "Username no CSV", "Status"]),
  );
  const salesSheet = workbook.worksheets.find((sheet) =>
    columns(sheet, [
      "Perfil no chat",
      "Username vendas",
      "Data da venda",
      "ID do pedido",
      "Valor pago (R$)",
      "Status do vinculo",
      "Arquivo origem",
    ]),
  );
  if (!profileSheet || !salesSheet) return null;
  const summary = workbook.worksheets.find(
    (sheet) => normalize(sheet.name) === "resumo",
  );
  const title = summary?.getCell("A1").text ?? "";
  const source = title.includes("•")
    ? title.split("•").slice(1).join("•").trim()
    : "";
  if (!source || source.length > 120)
    throw new Error(
      "A origem comercial não está explícita no título do relatório. Informe a origem antes de importar.",
    );
  const pc = columns(profileSheet, [
    "Perfil na conversa",
    "Username no CSV",
    "Status",
  ])!;
  const sc = columns(salesSheet, [
    "Perfil no chat",
    "Username vendas",
    "Data da venda",
    "ID do pedido",
    "Valor pago (R$)",
    "Status do vinculo",
    "Arquivo origem",
  ])!;
  const profiles: ReportProfile[] = [];
  const byProfile = new Map<string, ReportProfile>();
  profileSheet.eachRow((row, n) => {
    if (n <= pc.row) return;
    const cell = (name: string) =>
      row.getCell(pc.map.get(normalize(name)) ?? 0);
    const text = (name: string) =>
      pc.map.has(normalize(name)) ? cell(name).text.trim() : "";
    const value = (name: string) =>
      pc.map.has(normalize(name)) ? numeric(cell(name)) : null;
    const handle = text("Perfil na conversa");
    if (!handle) return;
    if (!/^@[\p{L}\p{N}_.-]{1,80}$/u.test(handle))
      throw new Error(`Perfil inválido em ${profileSheet.name}!A${n}.`);
    const key = profileIdentity(handle);
    if (byProfile.has(key))
      throw new Error(`Perfil repetido no relatório: ${handle}.`);
    const engagement = value("Engajamento IG");
    const profile: ReportProfile = {
      handle,
      username: text("Username no CSV"),
      validated: normalize(text("Status")) === "validado",
      orders: 0,
      paid: 0,
      pendingOrders: 0,
      followersIG: value("Seguidores IG"),
      followersTikTok: value("Seguidores TikTok"),
      engagementPercent:
        engagement === null
          ? null
          : engagement *
            (cell("Engajamento IG").numFmt?.includes("%") ? 100 : 1),
    };
    byProfile.set(key, profile);
    profiles.push(profile);
  });
  if (!profiles.length || profiles.length > 100)
    throw new Error("O relatório precisa identificar entre 1 e 100 creators.");
  const records: WorkbookReport["sales"] = [];
  const seen = new Set<string>();
  let pendingOrders = 0,
    pendingCents = 0,
    validCents = 0;
  salesSheet.eachRow((row, n) => {
    if (n <= sc.row) return;
    const cell = (name: string) => row.getCell(sc.map.get(normalize(name))!);
    const idCell = cell("ID do pedido"),
      externalId = idCell.text.trim();
    if (!externalId && !cell("Perfil no chat").text.trim()) return;
    if (
      !externalId ||
      (typeof idCell.value === "number" && !Number.isSafeInteger(idCell.value))
    )
      throw new Error(`ID de pedido inválido em ${salesSheet.name}!E${n}.`);
    if (seen.has(externalId))
      throw new Error(`Pedido repetido no relatório: ${externalId}.`);
    seen.add(externalId);
    const amountCents = cents(numeric(cell("Valor pago (R$)")));
    const handle = cell("Perfil no chat").text.trim();
    const profile = byProfile.get(profileIdentity(handle));
    const username = cell("Username vendas").text.trim();
    const linked =
      profile?.validated &&
      profileIdentity(profile.username) === profileIdentity(username) &&
      normalize(cell("Status do vinculo").text) === "validado";
    if (!linked) {
      pendingOrders++;
      pendingCents += amountCents;
      if (profile) profile.pendingOrders++;
      return;
    }
    const couponColumn = sc.map.get("cupom");
    const coupon = couponColumn ? row.getCell(couponColumn).text.trim() : "";
    const record = saleSchema.parse({
      type: "sale",
      source,
      externalId,
      date: saleDate(cell("Data da venda")),
      amount: amountCents / 100,
      currency: "BRL",
      status: "valid",
      ...(coupon ? { coupon } : {}),
    });
    const csv = cell("Arquivo origem").text.trim();
    if (!csv)
      throw new Error(`Origem CSV ausente em ${salesSheet.name}!L${n}.`);
    records.push({ row: n, handle: profile.handle, csv, record });
    profile.orders++;
    profile.paid = (Math.round(profile.paid * 100) + amountCents) / 100;
    validCents += amountCents;
  });
  if (!records.length)
    throw new Error(
      "Nenhum pedido com vínculo validado e campos completos foi identificado.",
    );
  // A discrepancy with the explicit control total requires review, never a
  // silent recalculation of a cached formula or an invented matching rule.
  summary?.eachRow((row) => {
    if (
      normalize(row.getCell(1).text) === "valor pago com vinculo validado (r$)"
    ) {
      const control = numeric(row.getCell(2));
      if (
        control === null ||
        Math.abs(Math.round(control * 100) - validCents) > 1
      )
        throw new Error(
          "O total dos pedidos validados não confere com o controle da aba Resumo. Revise o arquivo antes de aplicar.",
        );
    }
  });
  const dates = records.map(({ record }) => record.date).sort();
  return {
    sales: records,
    view: {
      jobId,
      hash: checksum(buffer),
      filename,
      source,
      status: "ready",
      profiles,
      orders: records.length,
      paid: validCents / 100,
      pendingOrders,
      pendingPaid: pendingCents / 100,
      period: { from: dates[0], to: dates.at(-1)! },
      currency: "BRL",
      warnings: [
        "Pedidos com vínculo divergente ficam fora dos indicadores até a associação ser confirmada.",
        "Seguidores e engajamento são informações do arquivo; sem data exata de coleta, não viram medições diárias.",
        "Os CSVs cobrem períodos diferentes. O ranking compara valores importados, não desempenho em períodos equivalentes.",
        "Valor pago é o campo da aba Vendas; resumos e detalhes não são somados entre si.",
      ],
    },
  };
}

export async function applyWorkbookReport(
  report: WorkbookReport,
  buffer: Buffer,
) {
  if (checksum(buffer) !== report.view.hash)
    throw new Error("O arquivo mudou desde a leitura.");
  const root = path.join(dataDirectory(), "imports");
  await mkdir(root, { recursive: true });
  const storagePath = path.join(root, `${report.view.hash}.xlsx`);
  try {
    await writeFile(storagePath, buffer, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (checksum(await readFile(storagePath)) !== report.view.hash)
      throw new Error("O arquivo arquivado não confere com o original.");
  }
  const applied = await db().$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"workbook:" + report.view.source}))`;
      const all = await tx.creator.findMany();
      const result = {
        createdCreators: 0,
        reusedCreators: 0,
        insertedSales: 0,
        duplicateSales: 0,
        importIds: [] as string[],
      };
      for (const profile of report.view.profiles) {
        const identity = profileIdentity(profile.handle);
        const matches = all.filter(
          (creator) => profileIdentity(creator.name) === identity,
        );
        if (matches.length > 1)
          throw new Error(
            `Há mais de um cadastro correspondente a ${profile.handle}. Resolva a duplicidade antes de importar.`,
          );
        const created = !matches.length;
        const creator =
          matches[0] ??
          (await tx.creator.create({
            data: {
              name: profile.handle,
              slug: `creator-${checksum(identity).slice(0, 24)}`,
            },
          }));
        if (created) {
          result.createdCreators++;
          all.push(creator);
        } else result.reusedCreators++;
        const hash = `workbook-v1:${report.view.hash}`;
        const previous = await tx.importBatch.findUnique({
          where: { creatorId_hash: { creatorId: creator.id, hash } },
        });
        const sales = report.sales.filter(
          (sale) => profileIdentity(sale.handle) === identity,
        );
        if (previous) {
          if (previous.status !== "confirmed")
            throw new Error(
              "Este arquivo possui um lote revertido ou incompleto. Revise o histórico antes de reaplicar.",
            );
          result.duplicateSales += sales.length;
          result.importIds.push(previous.id);
          continue;
        }
        const batch = await tx.importBatch.create({
          data: {
            creatorId: creator.id,
            hash,
            filename: report.view.filename,
            storagePath,
            status: "confirmed",
            confirmedAt: new Date(),
          },
        });
        result.importIds.push(batch.id);
        if (created)
          await tx.auditLog.create({
            data: {
              importId: batch.id,
              entity: "creator",
              entityId: creator.id,
              operation: "insert",
              after: json({
                name: creator.name,
                slug: creator.slug,
                source: report.view.source,
              }),
            },
          });
        for (const sale of sales) {
          const r = sale.record;
          const other = await tx.sale.findFirst({
            where: {
              source: r.source,
              externalId: r.externalId,
              creatorId: { not: creator.id },
            },
          });
          if (other)
            throw new Error(
              `O pedido ${r.externalId} já está associado a outro creator nessa origem. Revise o vínculo antes de aplicar.`,
            );
          const current = await tx.sale.findUnique({
            where: {
              creatorId_source_externalId: {
                creatorId: creator.id,
                source: r.source,
                externalId: r.externalId,
              },
            },
          });
          if (
            current &&
            (moneyToCents(String(current.amount)) !==
              moneyToCents(String(r.amount)) ||
              current.date.toISOString().slice(0, 10) !== r.date ||
              current.currency !== r.currency ||
              current.status !== r.status ||
              (current.coupon ?? "") !== (r.coupon ?? ""))
          )
            throw new Error(
              `O pedido ${r.externalId} já existe com dados diferentes. Nenhum valor será sobrescrito automaticamente.`,
            );
          const { type: _type, ...fields } = r;
          void _type;
          const saved =
            current ??
            (await tx.sale.create({
              data: {
                ...fields,
                date: new Date(r.date),
                creatorId: creator.id,
                importId: batch.id,
              },
            }));
          await tx.pendingChange.create({
            data: {
              importId: batch.id,
              row: sale.row,
              type: "sale",
              classification: current ? "duplicate" : "new",
              status: current ? "skipped" : "approved",
              payload: json(r),
              targetId: saved.id,
              reason: `Aba Vendas, linha ${sale.row}; CSV original: ${sale.csv}`,
            },
          });
          if (current) result.duplicateSales++;
          else {
            result.insertedSales++;
            await tx.auditLog.create({
              data: {
                importId: batch.id,
                entity: "sale",
                entityId: saved.id,
                operation: "insert",
                after: json(r),
              },
            });
          }
        }
        await tx.pendingChange.create({
          data: {
            importId: batch.id,
            row: 1,
            type: "context",
            classification: "invalid",
            status: "pending",
            payload: json(profile),
            reason:
              "Informações sociais preservadas como contexto. Falta a data exata de coleta para criar medições; vínculos divergentes não foram importados.",
          },
        });
      }
      return result;
    },
    { isolationLevel: "Serializable", timeout: 60000 },
  );
  return { ...report.view, status: "applied" as const, applied };
}

export function reportSummary(view: WorkbookReportView) {
  const money = (value: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: view.currency,
    }).format(value);
  return `**${view.status === "applied" ? "Base atualizada" : "Dados estruturados para importação"}**\n\n${view.profiles.length} creators identificados; ${view.orders} pedidos com vínculo validado; ${money(view.paid)} de valor pago. ${view.pendingOrders} pedidos (${money(view.pendingPaid)}) permanecem fora dos indicadores. Origem: ${view.source}. Datas das vendas: ${view.period.from} a ${view.period.to}.\n\n| Creator | Pedidos validados | Valor pago | Vínculo |\n|---|---:|---:|---|\n${view.profiles
    .slice(0, 20)
    .map(
      (p) =>
        `| ${p.handle} | ${p.orders} | ${money(p.paid)} | ${p.validated ? "Validado" : "Pendente"} |`,
    )
    .join("\n")}\n\n${view.warnings.join("\n\n")}`;
}
