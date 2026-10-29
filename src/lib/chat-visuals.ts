import { z } from "zod";
const label = z.string().trim().min(1).max(160);
export const chatVisualSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("stats"),
      title: label,
      items: z
        .array(
          z
            .object({
              label,
              value: z.string().max(100),
              detail: z.string().max(240).optional(),
            })
            .strict(),
        )
        .min(1)
        .max(6),
    })
    .strict(),
  z
    .object({
      type: z.literal("table"),
      title: label,
      columns: z.array(label).min(1).max(8),
      rows: z
        .array(
          z
            .array(
              z.union([z.string().max(500), z.number().finite(), z.null()]),
            )
            .max(8),
        )
        .max(100),
    })
    .strict()
    .refine(
      (value) => value.rows.every((row) => row.length === value.columns.length),
      "A tabela precisa ter o mesmo número de células e colunas.",
    ),
  z
    .object({
      type: z.literal("bars"),
      title: label,
      unit: z.enum(["BRL", "count", "percent"]),
      items: z
        .array(
          z
            .object({
              label,
              value: z.number().finite().min(0).max(1_000_000_000),
            })
            .strict(),
        )
        .min(1)
        .max(20),
    })
    .strict(),
  z
    .object({
      type: z.literal("flow"),
      title: label,
      steps: z
        .array(
          z
            .object({ title: label, detail: z.string().max(240).optional() })
            .strict(),
        )
        .min(2)
        .max(8),
    })
    .strict(),
]);
export type ChatVisual = z.infer<typeof chatVisualSchema>;
