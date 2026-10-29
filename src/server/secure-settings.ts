import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import {
  providerInputSchema,
  settingsInputSchema,
  type ProviderInput,
} from "@/lib/ai-config";
import { dataDirectory } from "./data-directory";

const storedProvider = providerInputSchema
  .omit({ apiKey: true, clearKey: true })
  .extend({ keyCipher: z.string().optional() });
const storedSchema = z.object({
  version: z.literal(1),
  primary: storedProvider,
  fallback: storedProvider.nullable(),
});
type StoredProvider = z.infer<typeof storedProvider>;
export type RuntimeProvider = Omit<ProviderInput, "apiKey" | "clearKey"> & {
  key: string;
};

// Secrets travel over stdin, never command arguments or logs. Windows DPAPI binds them to the current user.
export function protectSecret(value: string, decrypt = false): Promise<string> {
  if (process.platform !== "win32")
    throw new Error(
      "Armazenamento de credenciais requer a proteção de usuário do Windows nesta versão.",
    );
  const script = `Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); ${
    decrypt
      ? `[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($v),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))`
      : `[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($v),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))`
  }`;
  return new Promise((resolve, reject) => {
    const child = spawn(
      path.join(
        process.env.SystemRoot || "C:\\Windows",
        "System32/WindowsPowerShell/v1.0/powershell.exe",
      ),
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(
        new Error(
          "A proteção de credenciais do Windows excedeu o tempo limite.",
        ),
      );
    // Cold PowerShell startup can exceed 15 seconds on Windows while the
    // desktop is loading its local services. Keep credential protection bounded
    // without treating normal startup latency as a failed key operation.
    }, 45000);
    child.stdout.on("data", (data) => {
      output += data.toString();
    });
    child.stderr.resume();
    child.on("error", () => {
      clearTimeout(timeout);
      reject(
        new Error(
          "Não foi possível iniciar a proteção de credenciais do Windows.",
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(output.trim());
      else
        reject(
          new Error(
            "Falha ao proteger/ler a credencial. Use o mesmo usuário do Windows que a salvou.",
          ),
        );
    });
    child.stdin.end(value);
  });
}
async function savedSettings() {
  if (process.env.CI_IGNORE_SAVED_SETTINGS === "1") return null;
  try {
    return storedSchema.parse(
      JSON.parse(
        await readFile(path.join(dataDirectory(), "ai-settings.json"), "utf8"),
      ),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(
      "Não foi possível ler as configurações salvas de IA. Preserve o arquivo e verifique sua integridade.",
    );
  }
}
function fromEnvironment(fallback = false): StoredProvider | null {
  const prefix = fallback ? "AI_FALLBACK_" : "AI_";
  if (fallback && !process.env[`${prefix}PROVIDER`]) return null;
  return {
    provider: (process.env[`${prefix}PROVIDER`] ||
      "freellmapi") as StoredProvider["provider"],
    baseUrl: process.env[`${prefix}BASE_URL`] || "http://127.0.0.1:31415/v1",
    model: process.env[`${prefix}MODEL`] || "auto",
  };
}
async function resolveStored(
  input: StoredProvider,
  envKey?: string,
): Promise<RuntimeProvider> {
  return {
    ...input,
    baseUrl: input.baseUrl.replace(/\/+$/, ""),
    key: input.keyCipher
      ? await protectSecret(input.keyCipher, true)
      : envKey || "",
  };
}
export async function readRuntimeSettings() {
  const saved = await savedSettings();
  if (saved)
    return {
      primary: await resolveStored(saved.primary),
      fallback: saved.fallback ? await resolveStored(saved.fallback) : null,
    };
  const primary = fromEnvironment()!,
    fallback = fromEnvironment(true);
  return {
    primary: await resolveStored(primary, process.env.AI_API_KEY),
    fallback: fallback
      ? await resolveStored(fallback, process.env.AI_FALLBACK_API_KEY)
      : null,
  };
}
export async function publicSettings() {
  const saved = await savedSettings();
  const expose = (p: StoredProvider, hasEnvKey = false) => ({
    provider: p.provider,
    baseUrl: p.baseUrl,
    model: p.model,
    hasKey: !!p.keyCipher || hasEnvKey,
  });
  const primary = saved?.primary || fromEnvironment()!;
  const fallback = saved ? saved.fallback : fromEnvironment(true);
  return {
    primary: expose(primary, !saved && !!process.env.AI_API_KEY),
    fallback: fallback
      ? expose(fallback, !saved && !!process.env.AI_FALLBACK_API_KEY)
      : null,
    configured: !!primary.baseUrl && !!primary.model,
    saved: !!saved,
  };
}
async function mergeProvider(
  input: ProviderInput,
  previous: StoredProvider | null,
  envKey?: string,
): Promise<StoredProvider> {
  const { apiKey, clearKey, ...publicPart } = input;
  const same =
    previous?.provider === input.provider &&
    previous?.baseUrl.replace(/\/+$/, "") === input.baseUrl.replace(/\/+$/, "");
  const keyCipher = clearKey
    ? undefined
    : apiKey
      ? await protectSecret(apiKey.trim())
      : same && previous?.keyCipher
        ? previous.keyCipher
        : envKey
          ? await protectSecret(envKey)
          : undefined;
  return { ...publicPart, ...(keyCipher ? { keyCipher } : {}) };
}
export async function resolveDraft(
  input: unknown,
  slot: "primary" | "fallback" = "primary",
): Promise<RuntimeProvider> {
  const parsed = providerInputSchema.parse(input),
    saved = await savedSettings();
  const previous =
    [saved?.[slot]].find(
      (p) =>
        p?.provider === parsed.provider &&
        p.baseUrl.replace(/\/+$/, "") === parsed.baseUrl.replace(/\/+$/, ""),
    ) || null;
  const env = fromEnvironment(slot === "fallback");
  const envKey =
    !saved &&
    env?.provider === parsed.provider &&
    env.baseUrl.replace(/\/+$/, "") === parsed.baseUrl.replace(/\/+$/, "")
      ? process.env[slot === "fallback" ? "AI_FALLBACK_API_KEY" : "AI_API_KEY"]
      : undefined;
  const { apiKey, clearKey, ...publicPart } = parsed;
  return {
    ...publicPart,
    baseUrl: publicPart.baseUrl.replace(/\/+$/, ""),
    key: clearKey
      ? ""
      : apiKey?.trim() ||
        (previous?.keyCipher
          ? await protectSecret(previous.keyCipher, true)
          : envKey || ""),
  };
}
let writing: Promise<unknown> = Promise.resolve();
export async function saveSettings(input: unknown) {
  const parsed = settingsInputSchema.parse(input);
  const operation = writing
    .catch(() => {})
    .then(async () => {
      const saved = await savedSettings();
      const envPrimary = fromEnvironment();
      const primaryEnvKey =
        !saved &&
        envPrimary?.provider === parsed.primary.provider &&
        envPrimary.baseUrl === parsed.primary.baseUrl
          ? process.env.AI_API_KEY
          : undefined;
      const primary = await mergeProvider(
        parsed.primary,
        saved?.primary || null,
        primaryEnvKey,
      );
      const fallbackEnv = fromEnvironment(true);
      const fallbackEnvKey =
        !saved &&
        parsed.fallback &&
        fallbackEnv?.provider === parsed.fallback.provider &&
        fallbackEnv.baseUrl === parsed.fallback.baseUrl
          ? process.env.AI_FALLBACK_API_KEY
          : undefined;
      const fallback = parsed.fallback
        ? await mergeProvider(
            parsed.fallback,
            saved?.fallback || null,
            fallbackEnvKey,
          )
        : null;
      await mkdir(dataDirectory(), { recursive: true });
      const target = path.join(dataDirectory(), "ai-settings.json"),
        temp = `${target}.${randomUUID()}.tmp`;
      await writeFile(
        temp,
        JSON.stringify({ version: 1, primary, fallback }, null, 2),
        { encoding: "utf8", mode: 0o600 },
      );
      await rename(temp, target);
      return publicSettings();
    });
  writing = operation;
  return operation;
}
