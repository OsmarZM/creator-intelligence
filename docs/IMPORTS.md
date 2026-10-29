# Formatos de importação

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

