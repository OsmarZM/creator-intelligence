import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/server/db";
import {
  previewImport,
  confirmImport,
  revertImport,
} from "../src/server/imports";
import { getAnalytics } from "../src/server/analytics";
test(
  "PostgreSQL: prévia, confirmação parcial, idempotência, correção, concorrência e reversão",
  { skip: process.env.RUN_DB_TESTS !== "1" },
  async () => {
    const creator = await db().creator.create({
      data: { name: "Teste isolado", slug: `integration-${randomUUID()}` },
    });
    const csv = (amount: string, extra = "") =>
      Buffer.from(
        `type;externalId;source;date;amount;currency\nsale;order-1;integration;2026-10-01;${amount};BRL\n${extra}`,
      );
    try {
      const preview = await previewImport(
        creator.id,
        "test.csv",
        csv("100.25", "sale;order-invalid;integration;2026-02-30;9.00;BRL\n"),
      );
      assert.equal(
        await db().sale.count({ where: { creatorId: creator.id } }),
        0,
        "Prévia não grava fatos",
      );
      assert.equal(
        preview.changes.filter((c) => c.classification === "invalid").length,
        1,
      );
      const first = preview.changes.find((c) => c.classification === "new")!;
      await assert.rejects(
        () =>
          confirmImport(
            preview.id,
            preview.changes.map((c) => c.id),
          ),
        /inválidos/,
      );
      assert.equal(
        (
          await db().importBatch.findUniqueOrThrow({
            where: { id: preview.id },
          })
        ).status,
        "pending",
        "Transação inválida reverte o estado do lote",
      );
      await confirmImport(preview.id, [first.id]);
      await assert.rejects(
        () => confirmImport(preview.id, [first.id]),
        /já confirmado/,
      );
      const repeat = await previewImport(
        creator.id,
        "renamed.csv",
        csv("100.25", "sale;order-invalid;integration;2026-02-30;9.00;BRL\n"),
      );
      assert.equal(repeat.id, preview.id);
      const duplicate = await previewImport(
        creator.id,
        "duplicate.csv",
        csv("100.25"),
      );
      assert.equal(duplicate.changes[0].classification, "duplicate");
      const correction = await previewImport(
        creator.id,
        "correction.csv",
        csv("125.30"),
      );
      assert.equal(correction.changes[0].classification, "update");
      await confirmImport(correction.id, [correction.changes[0].id]);
      const a = await getAnalytics({
        creatorId: creator.id,
        from: "2026-10-01",
        to: "2026-10-31",
        currency: "BRL",
      });
      assert.equal(a.summary.revenue, 125.3);
      assert.equal(a.summary.orders, 1);
      assert.equal(a.summary.followerDelta, null);
      await assert.rejects(() => revertImport(preview.id), /alterado após/);
      await revertImport(correction.id);
      assert.equal(
        String(
          (
            await db().sale.findFirstOrThrow({
              where: { creatorId: creator.id },
            })
          ).amount,
        ),
        "100.25",
      );
      await revertImport(preview.id);
      assert.equal(
        await db().sale.count({ where: { creatorId: creator.id } }),
        0,
      );
      const concurrent = await previewImport(
        creator.id,
        "concurrent.csv",
        csv("42.00"),
      );
      const attempts = await Promise.allSettled([
        confirmImport(concurrent.id, [concurrent.changes[0].id]),
        confirmImport(concurrent.id, [concurrent.changes[0].id]),
      ]);
      assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(
        await db().sale.count({ where: { creatorId: creator.id } }),
        1,
      );
    } finally {
      const batches = await db().importBatch.findMany({
        where: { creatorId: creator.id },
        select: { id: true, storagePath: true },
      });
      const ids = batches.map((b) => b.id);
      await db().auditLog.deleteMany({ where: { importId: { in: ids } } });
      await db().pendingChange.deleteMany({ where: { importId: { in: ids } } });
      await db().sale.deleteMany({ where: { creatorId: creator.id } });
      await db().metricRecord.deleteMany({ where: { creatorId: creator.id } });
      await db().importBatch.deleteMany({ where: { creatorId: creator.id } });
      await db().creator.delete({ where: { id: creator.id } });
      const { unlink } = await import("node:fs/promises");
      for (const b of batches) {
        if (b.storagePath) await unlink(b.storagePath);
      }
      await db().$disconnect();
    }
  },
);
