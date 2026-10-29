import { z } from "zod";

export const providerSchema = z.enum([
  "freellmapi",
  "openai",
  "openrouter",
  "anthropic",
  "gemini",
]);
export const providerPresets = {
  freellmapi: { label: "FreeLLMAPI", baseUrl: "http://127.0.0.1:31415/v1" },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  anthropic: { label: "Claude", baseUrl: "https://api.anthropic.com/v1" },
  gemini: {
    label: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  },
} as const;
export const providerInputSchema = z
  .object({
    provider: providerSchema,
    baseUrl: z
      .string()
      .trim()
      .url()
      .max(500)
      .superRefine((value, ctx) => {
        const url = new URL(value);
        if (
          !["http:", "https:"].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        )
          ctx.addIssue({
            code: "custom",
            message:
              "Use uma URL HTTP/HTTPS sem credenciais, query ou fragmento.",
          });
        if (
          url.protocol === "http:" &&
          !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        )
          ctx.addIssue({
            code: "custom",
            message: "Use HTTPS para provedores fora desta máquina.",
          });
      }),
    model: z.string().trim().min(1, "Escolha ou informe um modelo.").max(200),
    apiKey: z.string().max(4096).optional(),
    clearKey: z.boolean().optional(),
  })
  .strict();
export const settingsInputSchema = z
  .object({
    primary: providerInputSchema,
    fallback: providerInputSchema.nullable(),
  })
  .strict();
export type ProviderInput = z.infer<typeof providerInputSchema>;
export const draftRequestSchema = z
  .object({
    slot: z.enum(["primary", "fallback"]),
    connection: providerInputSchema,
  })
  .strict();
export type PublicProvider = Omit<ProviderInput, "apiKey" | "clearKey"> & {
  hasKey: boolean;
};
export type AISettings = {
  primary: PublicProvider;
  fallback: PublicProvider | null;
  configured: boolean;
  saved: boolean;
};
