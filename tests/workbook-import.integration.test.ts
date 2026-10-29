import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { reportFixture } from "./fixtures/workbook-report";
import { db } from "../src/server/db";
import {
  readWorkbookReport,
  applyWorkbookReport,
} from "../src/server/workbook-report";
import { revertImport } from "../src/server/imports";
test(
  "relatório: aplicação atômica cria creators, deduplica pedidos, bloqueia conflito e mantém reversão",
  { skip: process.env.RUN_DB_TESTS !== "1", timeout: 120000 },
  async () => {
    const old = process.env.CI_DATA_DIR;
    process.env.CI_DATA_DIR = await mkdtemp(
      path.join(os.tmpdir(), "ci-workbook-import-"),
    );
    const suffix = randomUUID().slice(0, 8);
    const workbook = reportFixture(suffix);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const report = readWorkbookReport(
      workbook,
      buffer,
      "fixture.xlsx",
      randomUUID(),
    )!;
    const names = report.view.profiles.map((profile) => profile.handle);
    try {
      const applied = await applyWorkbookReport(report, buffer);
      assert.equal(applied.applied.createdCreators, 3);
      assert.equal(applied.applied.insertedSales, 2);
      const ids = (
        await db().creator.findMany({ where: { name: { in: names } } })
      ).map((creator) => creator.id);
      assert.equal(ids.length, 3);
      const sales = await db().sale.findMany({
        where: { creatorId: { in: ids } },
      });
      assert.equal(sales.length, 2);
      assert.equal(
        sales.reduce(
          (sum, sale) => sum + Math.round(Number(sale.amount) * 100),
          0,
        ),
        5250,
      );
      assert.equal(
        await db().metricRecord.count({ where: { creatorId: { in: ids } } }),
        0,
        "Sem data de coleta não há snapshot inventado",
      );
      const second = await applyWorkbookReport(report, buffer);
      assert.equal(second.applied.createdCreators, 0);
      assert.equal(second.applied.insertedSales, 0);
      assert.equal(second.applied.duplicateSales, 2);
      assert.equal(
        await db().sale.count({ where: { creatorId: { in: ids } } }),
        2,
      );
      workbook.getWorksheet("Vendas")!.getCell("H2").value = 43.5;
      workbook.getWorksheet("Resumo")!.getCell("B2").value = 53.5;
      const changedBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
      const changed = readWorkbookReport(
        workbook,
        changedBuffer,
        "updated.xlsx",
        randomUUID(),
      )!;
      await assert.rejects(
        applyWorkbookReport(changed, changedBuffer),
        /dados diferentes/,
      );
      assert.equal(
        await db().importBatch.count({ where: { creatorId: { in: ids } } }),
        3,
        "Conflito não deixa lotes parciais",
      );
      assert.equal(
        await db().sale.count({ where: { creatorId: { in: ids } } }),
        2,
      );
      await revertImport(applied.applied.importIds[0]);
      assert.equal(
        await db().sale.count({ where: { creatorId: { in: ids } } }),
        1,
      );
      assert.equal(
        await db().creator.count({ where: { id: { in: ids } } }),
        3,
        "Reversão de vendas mantém os cadastros de creators",
      );
    } finally {
      const creators = await db().creator.findMany({
        where: { name: { in: names } },
      });
      const ids = creators.map((creator) => creator.id);
      const batches = await db().importBatch.findMany({
        where: { creatorId: { in: ids } },
      });
      const batchIds = batches.map((batch) => batch.id);
      await db().auditLog.deleteMany({ where: { importId: { in: batchIds } } });
      await db().pendingChange.deleteMany({
        where: { importId: { in: batchIds } },
      });
      await db().sale.deleteMany({ where: { creatorId: { in: ids } } });
      await db().importBatch.deleteMany({ where: { id: { in: batchIds } } });
      await db().creator.deleteMany({ where: { id: { in: ids } } });
      if (old === undefined) delete process.env.CI_DATA_DIR;
      else process.env.CI_DATA_DIR = old;
      await db().$disconnect();
    }
  },
);
