import { createHash, randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@/generated/prisma/client";
import { recordSchema, type DataRecord } from "@/lib/domain";
import { db } from "./db";
import { parseInput } from "./parser";
import { dataDirectory } from "./data-directory";
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
type Tx = Prisma.TransactionClient;
async function existing(tx: Tx, creatorId: string, r: DataRecord) {
  if (r.type === "sale")
    return tx.sale.findUnique({
      where: {
        creatorId_source_externalId: {
          creatorId,
          source: r.source,
          externalId: r.externalId,
        },
      },
    });
  return tx.metricRecord.findUnique({
    where: {
      creatorId_metric_kind_startDate_endDate_entity_source: {
        creatorId,
        metric: r.metric,
        kind: r.kind,
        startDate: new Date(r.startDate),
        endDate: new Date(r.endDate),
        entity: r.entity,
        source: r.source,
      },
    },
  });
}
function toRecord(row: Record<string, unknown>, type: string): DataRecord {
  const date = (v: unknown) => new Date(String(v)).toISOString().slice(0, 10);
  if (type === "sale")
    return recordSchema.parse({
      type,
      externalId: row.externalId,
      source: row.source,
      date: date(row.date),
      amount: Number(row.amount),
      currency: row.currency,
      ...(row.product ? { product: row.product } : {}),
      ...(row.campaign ? { campaign: row.campaign } : {}),
      ...(row.coupon ? { coupon: row.coupon } : {}),
      status: row.status,
    });
  return recordSchema.parse({
    type,
    metric: row.metric,
    kind: row.kind,
    value: Number(row.value),
    startDate: date(row.startDate),
    endDate: date(row.endDate),
    entity: row.entity,
    source: row.source,
  });
}
function equal(a: DataRecord, b: DataRecord) {
  return JSON.stringify(a) === JSON.stringify(b);
}
export async function previewImport(
  creatorId: string,
  filename: string,
  buffer: Buffer,
  progress?: (message: string) => Promise<void>,
) {
  const creator = await db().creator.findUnique({ where: { id: creatorId } });
  if (!creator) throw new Error("Criador não encontrado.");
  if (buffer.byteLength > 5 * 1024 * 1024)
    throw new Error("Arquivo limitado a 5 MB.");
  const hash = createHash("sha256").update(buffer).digest("hex");
  const previous = await db().importBatch.findUnique({
    where: { creatorId_hash: { creatorId, hash } },
    include: { changes: { orderBy: { row: "asc" } } },
  });
  if (previous)
    return {
      ...previous,
      interpretation: "Arquivo já recebido; lote original recuperado.",
    };
  const parsed = await parseInput(
    buffer,
    filename,
    {
      id: creator.id,
      name: creator.name,
    },
    progress,
  );
  const storagePath = path.join(
    dataDirectory(),
    "imports",
    `${randomUUID()}.bin`,
  );
  await mkdir(path.dirname(storagePath), { recursive: true });
  await writeFile(storagePath, buffer, { flag: "wx" });
  // Only pending proposals are stored here. Facts are written by confirmImport.
  return db()
    .$transaction(
      async (tx) => {
        const batch = await tx.importBatch.create({
          data: {
            creatorId,
            filename: path.basename(filename),
            hash,
            storagePath,
          },
        });
        const seen = new Set<string>();
        for (const row of parsed.rows) {
          const r = row.record;
          let classification = "invalid",
            reason = row.reason,
            targetId: string | undefined,
            before: unknown;
          if (r) {
            const identity =
              r.type === "sale"
                ? JSON.stringify([r.type, r.source, r.externalId])
                : JSON.stringify([
                    r.type,
                    r.metric,
                    r.kind,
                    r.startDate,
                    r.endDate,
                    r.entity,
                    r.source,
                  ]);
            const current = await existing(tx, creatorId, r);
            if (seen.has(identity)) {
              classification = "conflict";
              reason =
                "Identidade repetida dentro do lote; revise a origem e reenvie as linhas.";
            } else if (current) {
              before = toRecord(current, r.type);
              targetId = current.id;
              classification = equal(before as DataRecord, r)
                ? "duplicate"
                : "update";
              reason =
                classification === "update"
                  ? "Registro existente com valores diferentes. Revise antes de aprovar a correção."
                  : "Registro idêntico já está na base.";
            } else classification = "new";
            seen.add(identity);
          }
          await tx.pendingChange.create({
            data: {
              importId: batch.id,
              row: row.row,
              type: r?.type ?? "unknown",
              classification,
              payload: json(row.payload ?? {}),
              ...(before ? { previous: json(before) } : {}),
              targetId,
              reason,
            },
          });
        }
        return {
          ...batch,
          changes: await tx.pendingChange.findMany({
            where: { importId: batch.id },
            orderBy: { row: "asc" },
          }),
          interpretation: parsed.interpretation,
        };
      },
      { timeout: 30000 },
    )
    .catch(async (error: unknown) => {
      await unlink(storagePath);
      throw error;
    });
}
export async function confirmImport(id: string, selected: string[]) {
  if (!selected.length)
    throw new Error("Selecione pelo menos um registro válido.");
  return db().$transaction(
    async (tx) => {
      const lock = await tx.importBatch.updateMany({
        where: { id, status: "pending" },
        data: { status: "applying" },
      });
      if (lock.count !== 1)
        throw new Error("Lote já confirmado, revertido ou inexistente.");
      const batch = await tx.importBatch.findUniqueOrThrow({
        where: { id },
        include: { changes: true },
      });
      const changes = batch.changes.filter((c) => selected.includes(c.id));
      if (
        changes.length !== new Set(selected).size ||
        changes.some((c) => !["new", "update"].includes(c.classification))
      )
        throw new Error(
          "Seleção contém registros inválidos, duplicados ou conflitos.",
        );
      for (const change of changes) {
        const r = recordSchema.parse(change.payload);
        const current = await existing(tx, batch.creatorId, r);
        if (
          change.classification === "new"
            ? !!current
            : !current ||
              !equal(
                toRecord(current, r.type),
                recordSchema.parse(change.previous),
              )
        )
          throw new Error(
            "A base mudou desde a prévia. Reimporte o arquivo com os valores revisados.",
          );
        let entityId: string;
        if (r.type === "sale") {
          const { type: _type, ...fields } = r;
          void _type;
          const data = {
            ...fields,
            product: r.product ?? null,
            campaign: r.campaign ?? null,
            coupon: r.coupon ?? null,
            date: new Date(r.date),
            creatorId: batch.creatorId,
            importId: id,
          };
          entityId = (
            current
              ? await tx.sale.update({ where: { id: current.id }, data })
              : await tx.sale.create({ data })
          ).id;
        } else {
          const { type: _type, ...fields } = r;
          void _type;
          const data = {
            ...fields,
            startDate: new Date(r.startDate),
            endDate: new Date(r.endDate),
            creatorId: batch.creatorId,
            importId: id,
          };
          entityId = (
            current
              ? await tx.metricRecord.update({
                  where: { id: current.id },
                  data,
                })
              : await tx.metricRecord.create({ data })
          ).id;
        }
        await tx.auditLog.create({
          data: {
            importId: id,
            entity: r.type,
            entityId,
            operation: current ? "update" : "insert",
            ...(current ? { before: json(current) } : {}),
            after: json(r),
          },
        });
        await tx.pendingChange.update({
          where: { id: change.id },
          data: { status: "approved" },
        });
      }
      await tx.pendingChange.updateMany({
        where: { importId: id, status: "pending" },
        data: { status: "skipped" },
      });
      return tx.importBatch.update({
        where: { id },
        data: { status: "confirmed", confirmedAt: new Date() },
      });
    },
    { isolationLevel: "Serializable", timeout: 30000 },
  );
}
export async function revertImport(id: string) {
  return db().$transaction(
    async (tx) => {
      const lock = await tx.importBatch.updateMany({
        where: { id, status: "confirmed" },
        data: { status: "reverting" },
      });
      if (lock.count !== 1)
        throw new Error("Somente um lote confirmado pode ser revertido.");
      const logs = await tx.auditLog.findMany({
        where: { importId: id, entity: { in: ["sale", "metric"] }, operation: { in: ["insert", "update"] } },
        orderBy: { createdAt: "desc" },
      });
      for (const log of logs) {
        const current =
          log.entity === "sale"
            ? await tx.sale.findUnique({ where: { id: log.entityId } })
            : await tx.metricRecord.findUnique({ where: { id: log.entityId } });
        if (
          !current ||
          current.importId !== id ||
          !equal(toRecord(current, log.entity), recordSchema.parse(log.after))
        )
          throw new Error(
            "Registro alterado após este lote. Reversão bloqueada para preservar as alterações posteriores.",
          );
        if (log.operation === "insert") {
          if (log.entity === "sale")
            await tx.sale.delete({ where: { id: log.entityId } });
          else await tx.metricRecord.delete({ where: { id: log.entityId } });
        } else {
          const before = log.before as Record<string, unknown>;
          if (log.entity === "sale")
            await tx.sale.update({
              where: { id: log.entityId },
              data: {
                amount: String(before.amount),
                date: new Date(String(before.date)),
                currency: String(before.currency),
                product: before.product as string | null,
                coupon: before.coupon as string | null,
                campaign: before.campaign as string | null,
                status: String(before.status),
                importId: String(before.importId),
              },
            });
          else
            await tx.metricRecord.update({
              where: { id: log.entityId },
              data: {
                value: String(before.value),
                importId: String(before.importId),
              },
            });
        }
        await tx.auditLog.create({
          data: {
            importId: id,
            entity: log.entity,
            entityId: log.entityId,
            operation: "revert",
            before: json(current),
            after: json(log.before ?? { deleted: true }),
          },
        });
      }
      return tx.importBatch.update({
        where: { id },
        data: { status: "reverted" },
      });
    },
    { isolationLevel: "Serializable", timeout: 30000 },
  );
}
