import ExcelJS from "exceljs";
export function reportFixture(suffix = "fixture") {
  const workbook = new ExcelJS.Workbook();
  const summary = workbook.addWorksheet("Resumo");
  summary.addRow([`Cruzamento de criadores • Origem ${suffix}`]);
  summary.addRow([
    "Valor pago com vinculo validado (R$)",
    { formula: "SUM(Vendas!H2:H3)", result: 52.5 },
  ]);
  const profiles = workbook.addWorksheet("Criadores");
  profiles.addRow([
    "Perfil na conversa",
    "Username no CSV",
    "Status",
    "Seguidores IG",
    "Engajamento IG",
  ]);
  profiles.addRow([`@ana_${suffix}`, `ana_${suffix}`, "VALIDADO", 1000, 0.016]);
  profiles.getCell("E2").numFmt = "0.0%";
  profiles.addRow([`@bia_${suffix}`, `bia_${suffix}_`, "VALIDADO", 2500, 0.02]);
  profiles.getCell("E3").numFmt = "0.0%";
  profiles.addRow([
    `@caio_${suffix}`,
    `outro_${suffix}`,
    "DIVERGENCIA",
    3000,
    0,
  ]);
  const sales = workbook.addWorksheet("Vendas");
  sales.addRow([
    "Perfil no chat",
    "Username vendas",
    "Cupom",
    "Data da venda",
    "ID do pedido",
    "Valor total (R$)",
    "Desconto (R$)",
    "Valor pago (R$)",
    "Comissao (R$)",
    "Frete (R$)",
    "Status do vinculo",
    "Arquivo origem",
  ]);
  sales.addRow([
    `@ana_${suffix}`,
    `ana_${suffix}`,
    "ANA",
    new Date("2026-09-01T12:00:00Z"),
    "pedido-1",
    50,
    7.5,
    42.5,
    1,
    0,
    "VALIDADO",
    "ana.csv",
  ]);
  sales.addRow([
    `@bia_${suffix}`,
    `bia_${suffix}_`,
    "BIA",
    new Date("2026-10-01T12:00:00Z"),
    "pedido-2",
    10,
    0,
    10,
    1,
    0,
    "VALIDADO",
    "bia.csv",
  ]);
  sales.addRow([
    `@caio_${suffix}`,
    `outro_${suffix}`,
    "CAIO",
    new Date("2026-10-02T12:00:00Z"),
    "pedido-3",
    7.5,
    0,
    7.5,
    1,
    0,
    "DIVERGENCIA",
    "outro.csv",
  ]);
  return workbook;
}
