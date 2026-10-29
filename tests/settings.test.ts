import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  saveSettings,
  publicSettings,
  readRuntimeSettings,
  resolveDraft,
} from "../src/server/secure-settings";
import { providerInputSchema } from "../src/lib/ai-config";

test("configuração rejeita credenciais na URL e HTTP externo", () => {
  const base = {
    provider: "freellmapi",
    baseUrl: "http://127.0.0.1:31415/v1",
    model: "test",
  };
  assert.equal(providerInputSchema.safeParse(base).success, true);
  assert.equal(
    providerInputSchema.safeParse({
      ...base,
      baseUrl: "http://key:secret@localhost/v1",
    }).success,
    false,
  );
  assert.equal(
    providerInputSchema.safeParse({ ...base, baseUrl: "http://example.com/v1" })
      .success,
    false,
  );
  assert.equal(
    providerInputSchema.safeParse({
      ...base,
      baseUrl: "https://example.com/v1?key=secret",
    }).success,
    false,
  );
});
test(
  "Windows DPAPI: salvar, ler, manter e remover chave sem expor segredo",
  { skip: process.platform !== "win32" },
  async () => {
    const old = process.env.CI_DATA_DIR,
      folder = await mkdtemp(path.join(tmpdir(), "ci-settings-"));
    process.env.CI_DATA_DIR = folder;
    const primary = {
      provider: "freellmapi" as const,
      baseUrl: "http://127.0.0.1:31415/v1",
      model: "test",
      apiKey: "test-secret-not-a-real-provider-key",
    };
    try {
      const first = await saveSettings({
        primary,
        fallback: { ...primary, apiKey: "test-fallback-key" },
      });
      assert.equal(
        (await resolveDraft({ ...primary, apiKey: "" }, "fallback")).key,
        "test-fallback-key",
      );
      assert.equal(first.primary.hasKey, true);
      assert.equal(JSON.stringify(first).includes(primary.apiKey), false);
      assert.equal(
        (
          await readFile(path.join(folder, "ai-settings.json"), "utf8")
        ).includes(primary.apiKey),
        false,
      );
      assert.equal((await readRuntimeSettings()).primary.key, primary.apiKey);
      await saveSettings({
        primary: { ...primary, apiKey: "", model: "other" },
        fallback: null,
      });
      assert.equal((await readRuntimeSettings()).primary.key, primary.apiKey);
      assert.equal(
        (await resolveDraft({ ...primary, apiKey: "" })).key,
        primary.apiKey,
      );
      const changed = await resolveDraft({
        ...primary,
        provider: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: "",
      });
      assert.equal(changed.key, "");
      await saveSettings({
        primary: { ...primary, apiKey: "", clearKey: true },
        fallback: null,
      });
      assert.equal((await publicSettings()).primary.hasKey, false);
      assert.equal((await readRuntimeSettings()).primary.key, "");
    } finally {
      if (old === undefined) delete process.env.CI_DATA_DIR;
      else process.env.CI_DATA_DIR = old;
      await rm(folder, { recursive: true, force: true });
    }
  },
);
