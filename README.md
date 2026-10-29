# Creator Intelligence

Workspace local para acompanhar performance de criadores com chat à esquerda e dashboards editáveis à direita. A aplicação lê arquivos, propõe alterações, exige confirmação e calcula os indicadores usando PostgreSQL como fonte de verdade.

## Aplicativo Windows como experiência principal

A versão 0.7.0 tem aplicativo desktop com backend, PostgreSQL, núcleo Hermes e Python incluídos. Ele inicia os serviços locais, mantém os dados na pasta do usuário e oferece **Abrir no navegador** como opção. O usuário não instala Hermes, Python, Node ou Docker separadamente. A conexão com o provedor de IA é configurada no próprio app. Relatórios Excel reconhecidos podem criar creators e aplicar vendas validadas por um cartão de confirmação no chat; veja [importação e visuais](docs/WORKBOOKS.md). Outros documentos continuam disponíveis como contexto.

Veja [instalação, configuração e arquitetura desktop](docs/DESKTOP.md). As instruções abaixo de Node/Docker se referem ao ambiente de desenvolvimento web.

Baixe o aplicativo nas [Releases](https://github.com/OsmarZM/creator-intelligence/releases). No Windows instalado, use **Atualizações** para verificar, baixar e instalar uma nova versão com backup local. O filtro de creators aceita busca por nome ou `@`, com navegação por teclado.

## Modo web de desenvolvimento

Requisitos: Node.js 22.12+ (ou versão compatível com as dependências instaladas), npm e Docker Desktop com containers Linux.

```powershell
npm install
npm run setup
npm run dev
```

O setup requer PowerShell 7 (`pwsh`), cria `.env` com senha aleatória quando o arquivo ainda não existe, inicia o banco e aplica as migrações. Preserve o `.env` existente. Para configurar manualmente, copie `.env.example`, defina a mesma senha em `POSTGRES_PASSWORD` e `DATABASE_URL`, execute `docker compose up -d` e `npm run db:migrate`.

Abra [http://127.0.0.1:3000](http://127.0.0.1:3000). A aplicação escuta somente na interface local. O PostgreSQL usa a porta 5438, volume próprio e bind local. Não execute `docker compose down -v` se quiser preservar os dados.

## Primeiro uso

1. Abra **Criadores** no topo e cadastre um criador.
2. Mencione o nome ou @ cadastrado no chat. Mensagens seguintes podem herdar esse contexto; o agente pergunta quando houver ambiguidade. O filtro do painel continua disponível para consulta.
3. Baixe um CSV de exemplo na janela de criadores, substitua os dados ilustrativos pelos reais e envie pelo botão **Anexar** no chat.
4. Revise a prévia. Registros novos vêm selecionados; correções exigem seleção explícita. Duplicidades, conflitos e linhas incompletas não são aprováveis.
5. Confirme os registros selecionados. O banco e os indicadores são atualizados.
6. Edite os gráficos pelo menu de cada card e clique em **Salvar**. O botão `+` ao lado de Salvar inicia outro painel; o botão **Gráfico** adiciona um card.
7. Consulte o histórico para revisar os lotes e reverter uma importação confirmada. A reversão é bloqueada se houver alterações posteriores nos registros envolvidos.

Os CSVs em `public/examples/` contêm dados fictícios identificados como exemplo. Nenhum dado é inserido automaticamente na base.

Veja também [chat unificado, modelos e processamento por etapas](docs/AGENT-CHAT-ARCHITECTURE.md).

## Funcionamento

```text
Arquivo/texto → parser → validação Zod → propostas pendentes
                                             ↓ confirmação explícita
Dashboard ← motor de métricas ← PostgreSQL + auditoria
```

- CSV/XLSX com cabeçalhos conhecidos são processados deterministicamente; não são enviados ao modelo.
- TXT/MD e texto com dados novos usam extração por blocos. A saída passa pelas mesmas regras antes de virar proposta.
- O chat reconhece perguntas e recebe indicadores calculados, fontes e período. Textos extensos usam resumos e respostas por seções. O usuário revisa propostas antes de confirmar dados ou aplicar gráficos.
- O modelo não executa SQL, código ou escrita direta nos fatos.
- Confirmações e reversões usam transações serializáveis. Uma segunda confirmação não aplica o lote novamente. O estado anterior é conferido antes de uma correção.
- O arquivo original é mantido em `storage/imports/`, fora do diretório público. Faça backup dessa pasta e do volume PostgreSQL em conjunto.

## Estrutura

| Caminho                   | Responsabilidade                                |
| ------------------------- | ----------------------------------------------- |
| `src/app/`                | Interface Next.js e rotas HTTP                  |
| `src/components/`         | Chat, painel, revisão e editor visual           |
| `src/lib/domain.ts`       | Contratos Zod e regras de domínio               |
| `src/lib/chart-data.ts`   | Agregação compartilhada de séries               |
| `src/server/imports.ts`   | Propostas, deduplicação, confirmação e reversão |
| `src/server/parser.ts`    | CSV, XLSX e extração de texto                   |
| `src/server/analytics.ts` | Indicadores determinísticos e evidências        |
| `src/server/ai.ts`        | Adaptadores HTTP e fallback                     |
| `prisma/`                 | Modelo relacional e migrações versionadas       |
| `tests/`                  | Regras de domínio e testes de integração        |

Dependências: Next.js/React/TypeScript; Tailwind; componentes locais com Radix Slot, clsx e tailwind-merge no padrão de composição shadcn; Prisma/PostgreSQL; ECharts modular; ExcelJS/csv-parse; Zod. Não há Redis, filas ou serviços separados. Acesso a dados é feito pelo Prisma nos serviços; não há repository sem comportamento apenas para repassar chamadas.

## IA e credenciais

Configure pela interface: provedor, URL-base, chave, modelo, lista de modelos, teste e reserva opcional. As alterações salvas valem sem reiniciar. Chaves são protegidas pelo Windows DPAPI e não são retornadas ao navegador. Confira o [passo a passo](docs/DESKTOP.md#configurar-a-ia).

No modo web de desenvolvimento, o `.env` continua sendo uma origem inicial opcional enquanto não houver configuração salva na interface. No desktop, os dados e as configurações têm pasta própria. Fallback ocorre somente em falhas técnicas (rede, timeout, HTTP 429/5xx), nunca para contornar erro de autenticação.

## Formato dos arquivos

Até 5 MB e 2.000 registros por lote. XLSX usa somente a primeira aba, até 30 colunas, sem executar fórmulas. Cabeçalhos exatos, conforme exemplos. CSV aceita vírgula ou ponto e vírgula, UTF-8 e valores decimais com ponto. Datas ISO `AAAA-MM-DD`. Texto livre limitado a 24.000 caracteres.

**Venda individual**:

| Campo                           | Regra                                              |
| ------------------------------- | -------------------------------------------------- |
| `type`                          | `sale`                                             |
| `externalId`                    | Identificador do pedido na origem; obrigatório     |
| `source`                        | Origem estável, por exemplo `loja-principal`       |
| `date`                          | Data da venda                                      |
| `amount`                        | Valor não negativo, no máximo duas casas decimais  |
| `currency`                      | Código monetário de três letras, por exemplo BRL   |
| `product`, `campaign`, `coupon` | Opcionais, sem atribuição automática a posts       |
| `status`                        | `valid`, `cancelled` ou `refunded`; padrão `valid` |

Identidade: criador + origem + ID externo. Uma linha representa um pedido, não um item. Totais semanais não devem ser enviados como pedidos fictícios. Não existe cálculo de receita líquida contábil, taxas, devolução parcial ou itens de pedido nesta versão.

**Métrica histórica**:

| Campo                  | Regra                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `type`                 | `metric`                                                                               |
| `metric`               | `followers`, `follower_gain`, `views`, `likes`, `comments`, `shares`, `saves`, `reach` |
| `kind`                 | `snapshot` ou `interval`                                                               |
| `value`                | Inteiro; negativos somente para `follower_gain`                                        |
| `startDate`, `endDate` | Datas explícitas; snapshot exige datas iguais                                          |
| `entity`               | Perfil/conteúdo estável, por exemplo `instagram:gab` ou `youtube:video-123`            |
| `source`               | Origem da medição                                                                      |

Identidade: criador + métrica + tipo + datas + entidade + origem. `followers` exige snapshot; `follower_gain` exige intervalo. Totais por fonte/perfil distintos são independentes; a aplicação não resolve automaticamente duas fontes medindo a mesma audiência.

## Regras analíticas

- Receita: soma em centavos dos pedidos `valid`, dentro do período e da moeda selecionada. Cancelamentos/estornos não entram. Ausência de registros resulta em `null`, exibido como `—`.
- Pedidos: quantidade de vendas válidas, nunca quantidade de linhas de produtos. Ticket: receita dividida pelos pedidos válidos.
- Seguidores: última menos primeira medição disponível dentro do filtro, por criador/perfil/origem. Todas as séries precisam de duas datas. Não representa necessariamente a variação exata entre os limites do filtro. Base inicial zero não gera percentual.
- Views: última medição snapshot disponível por criador/entidade/origem dentro do filtro. Não é quantidade de visualizações ocorridas durante o intervalo.
- Intervalos: somente registros integralmente contidos no filtro; não rateamos sobreposições.
- Charts de seguidores/views exigem `latest`; uma medição por entidade/origem em cada grupo. Não somamos snapshots repetidos. Pizza exige agrupamento por categoria.

## Validação

```powershell
npm run test
npm run typecheck
npm run lint
npm run build
```

O teste de integração fica desabilitado por padrão. Para executá-lo com o PostgreSQL de desenvolvimento já migrado:

```powershell
$env:RUN_DB_TESTS = '1'
npm test
Remove-Item Env:RUN_DB_TESTS
```

Ele cria um criador isolado e remove somente os registros e arquivos que ele próprio criou. Use banco de desenvolvimento dedicado.

O `override` de `uuid` é restrito ao ExcelJS: a dependência utiliza `v4()` e a versão 11.1.1 mantém a entrada CommonJS, corrigindo o aviso de segurança da versão transitiva original. O parser XLSX foi revalidado após a alteração.

## Limites atuais e sequência de evolução

Esta entrega estabelece o circuito de importação/revisão/banco/dashboard e os contratos de IA. O plano completo recebido está em [docs/ROADMAP.md](docs/ROADMAP.md).

- Credenciais e provedores agora são configuráveis pela interface, com proteção do Windows e aplicação imediata.
- O chat mantém histórico local, contexto resumido e checkpoints por etapa. Não executa ferramentas livres, comparação automática com outro período ou ranking estruturado de posts.
- Perfis e posts têm modelos previstos no banco, mas faltam cadastro completo e vínculo de métricas por FK. `entity` é a chave explícita inicial.
- Engajamento com base configurável, receita agregada, filtros de plataforma/produto/campanha, períodos próprios por card e receitas líquidas exigem evolução dos contratos.
- Não há login/multiempresa. Host/origin são conferidos e os comandos padrão fazem bind local. Isso não substitui autenticação: antes de publicar, adicione controle de acesso, limites de requisição e operação de backups. Não publique esta versão diretamente na internet.
- XLSX é processado em memória; os limites atendem uso local e não qualificam uploads públicos hostis.

Fontes técnicas consultadas: [Next.js](https://nextjs.org/docs/app/getting-started/installation) e [Prisma 7](https://www.prisma.io/docs/orm/v7).

Consulte [arquitetura do chat](docs/AGENT-CHAT-ARCHITECTURE.md) para esclarecimentos, informações parciais e retomada.

Consulte [aplicativo desktop](docs/DESKTOP.md) para os runtimes incluídos e [releases e atualização](docs/RELEASES.md) para distribuição e atualização pelo GitHub.
