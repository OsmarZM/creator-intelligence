import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import updaterModule from "../desktop/updater.cjs";
import backupModule from "../desktop/update-backup.cjs";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  enterMutation,
  prepareUpdate,
  cancelUpdate,
} from "../src/server/maintenance";
const { createUpdater } = updaterModule;
const { backupUpdateData } = backupModule;
test("updater: ações duplicadas, bloqueio durante gravação e instalação explícita após download", async () => {
  const emitter = new EventEmitter();
  let checks = 0,
    downloads = 0,
    installs = 0,
    busy = true,
    prepared = false;
  const updater = Object.assign(emitter, {
    checkForUpdates: async () => {
      checks++;
      emitter.emit("checking-for-update");
      await new Promise((resolve) => setTimeout(resolve, 20));
      emitter.emit("update-available", { version: "2.0.0" });
    },
    downloadUpdate: async () => {
      downloads++;
      emitter.emit("download-progress", { percent: 20 });
      emitter.emit("update-downloaded", { version: "2.0.0" });
    },
    quitAndInstall: (silent: boolean, reopen: boolean) => {
      assert.equal(silent, true);
      assert.equal(reopen, true);
      assert.ok(prepared);
      installs++;
    },
  });
  const controller = createUpdater({
    updater,
    version: "1.0.0",
    prepareInstall: async () => {
      if (busy) throw new Error("Gravação em andamento");
      prepared = true;
    },
  });
  assert.equal(Reflect.get(updater, "autoDownload"), false);
  assert.equal(Reflect.get(updater, "autoInstallOnAppQuit"), false);
  await assert.rejects(controller.execute("install"), /download/);
  const checking = controller.execute("check");
  await assert.rejects(controller.execute("check"), /andamento/);
  await checking;
  assert.equal(checks, 1);
  assert.equal(controller.snapshot().phase, "available");
  await controller.execute("download");
  assert.equal(downloads, 1);
  assert.equal(installs, 0);
  await controller.execute("install");
  assert.equal(installs, 0);
  assert.equal(controller.snapshot().phase, "downloaded");
  busy = false;
  await controller.execute("install");
  assert.equal(installs, 1);
  assert.equal(controller.snapshot().phase, "installing");
});
test("updater: erro de rede é recuperável e modo web não instala", async () => {
  const emitter = new EventEmitter();
  const updater = Object.assign(emitter, {
    checkForUpdates: async () => {
      emitter.emit("error", new Error("network"));
      throw new Error("network");
    },
  });
  const controller = createUpdater({
    updater,
    version: "1.0.0",
    prepareInstall: async () => {},
  });
  assert.equal((await controller.execute("check")).phase, "error");
  const web = createUpdater({
    updater: null,
    version: "1.0.0",
    prepareInstall: async () => {},
  });
  await assert.rejects(web.execute("check"), /Windows instalado/);
});
test("atualização: bloqueia novas gravações sem interromper as atuais", () => {
  cancelUpdate();
  const release = enterMutation();
  assert.throws(() => prepareUpdate(false), /gravação/);
  release();
  assert.throws(() => prepareUpdate(true), /análise/);
  prepareUpdate(false);
  assert.throws(() => enterMutation(), /atualização/);
  cancelUpdate();
  enterMutation()();
});
test("atualização: backup mantém dados e credenciais sem copiar recursivamente backups anteriores", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ci-update-"));
  try {
    await mkdir(path.join(root, "agent"));
    await writeFile(
      path.join(root, "agent/session.json"),
      '{"messages":[{"id":"original"}]}',
    );
    await writeFile(
      path.join(root, "ai-settings.json"),
      "encrypted-key-placeholder",
    );
    const first = await backupUpdateData(root, "1.0.0");
    assert.equal(
      await readFile(path.join(first, "ai-settings.json"), "utf8"),
      "encrypted-key-placeholder",
    );
    assert.equal(
      JSON.parse(await readFile(path.join(first, "agent/session.json"), "utf8"))
        .messages[0].id,
      "original",
    );
    await assert.rejects(
      readFile(path.join(first, "update-backups", "anything")),
      /ENOENT/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
