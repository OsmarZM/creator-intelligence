# Creator Intelligence — plano de execução

## Objetivo

Seguir a proposta executável fornecida pelo usuário em 26/10/2026: aplicação única Next.js/TypeScript, PostgreSQL/Prisma, IA preferencial pelo FreeLLMAPI e gráficos ECharts. A proposta mais recente prevalece sobre a visão inicial: processamento síncrono limitado no MVP, sem worker separado ou infraestrutura adicional.

## Etapas

| Etapa              | Implementação inicial                                                                                                         | Ainda necessário para concluir a visão integral                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — Fundação       | Layout dividido e redimensionável, filtros, chat, criadores, anexos e estado vazio real                                       | Qualificação contínua de acessibilidade e usabilidade                                                                                             |
| 2 — Banco/métricas | Criadores, perfis, posts, vendas, métricas, lotes, propostas, auditoria, dashboards; receita, ticket, crescimento e snapshots | CRUD de perfis/posts, engajamento por base, agregados de receita e filtros de domínio                                                             |
| 3 — IA/importação  | Adaptadores HTTP, fallback técnico, CSV/XLSX/TXT/MD, validação, confirmação parcial, correções, duplicidade, reversão e configuração de provedores pela UI | Mapeamento assistido de colunas desconhecidas, edição de propostas inválidas e qualificação real por provedor |
| 4 — Dashboards     | Linha/barra/área/pizza, métricas, agregação validada, cor, legenda, largura, duplicação, ordem e persistência                 | Período independente por card, escalas/eixos configuráveis e segmentações completas                                                               |
| 5 — Chat analítico | Respostas com contexto calculado e propostas de gráficos validadas                                                            | Catálogo de ferramentas, consulta entre períodos, top posts, lacunas por entidade e histórico persistido de conversas                             |

## Critério de aceite prioritário

Cadastrar um criador → importar CSV → revisar/confirmar → consultar receita/pedidos/histórico → editar/salvar gráfico → recarregar e recuperar painel. Qualificar separadamente conexão e extração real por IA.

## Próximo incremento

Receber amostras reais dos arquivos para definir campos canônicos, unidades, datas, entidades, duplicidades e contexto enviado à IA. Os formatos atuais permanecem explícitos; não assumir o significado de colunas desconhecidas antes dessa análise.

Depois, concluir o chat analítico com ações `getMetrics`, `comparePeriods` e `getTopPosts`, preservando os cálculos determinísticos. Antes disso, definir cadastro/vínculo de posts e base de engajamento; não classificar um post como “melhor” sem critério explícito.

## Desktop 0.2.0

Aplicativo Windows como experiência principal, instalador por usuário, backend e PostgreSQL próprios, botão para abrir o localhost, configuração de IA editável com credenciais protegidas pelo Windows e temas claro/escuro em preto, roxo e branco. Consulte `DESKTOP.md` e `VALIDATION-DESKTOP-0.2.0.md` para uso e limites da qualificação.

## Fora do MVP

Integrações automáticas com redes sociais, previsão por ML, banco vetorial/RAG, agentes autônomos, drag-and-drop avançado, microsserviços e multiempresa.
