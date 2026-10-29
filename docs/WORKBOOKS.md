# Relatórios de creators e vendas

## Objetivo

Converter relatórios reconhecidos em creators e vendas, preservando a origem, a revisão humana e os dados incompletos.

## Fluxo

1. Anexe um XLSX no chat. Todas as abas são lidas como contexto, com datas, percentuais e resultados de fórmulas salvos no arquivo.
2. Quando os cabeçalhos correspondem ao contrato abaixo, o mapeamento local prepara um cartão com totais, ranking, tabela e ressalvas. Não há chamada ao modelo para recontar linhas.
3. Clique em **Criar creators e aplicar vendas validadas**. A transação cria ou reutiliza perfis e grava somente os pedidos com vínculos validados.
4. O painel recarrega os dados e usa o período efetivo dos pedidos importados.

## Contrato reconhecido

| Aba | Campos | Regra |
|---|---|---|
| Resumo | Título com `• Origem`; `Valor pago com vinculo validado (R$)` | Origem explícita e controle compatível com o detalhe |
| Criadores | Perfil na conversa, Username no CSV, Status | Perfil e username declarados; preserva pontos e underscores |
| Vendas | Perfil no chat, Username vendas, Data da venda, ID do pedido, Valor pago (R$), Status do vinculo, Arquivo origem | Vínculo VALIDADO nas duas abas e username correspondente |
| Criadores | Seguidores IG/TikTok e Engajamento IG | Contexto; sem data exata de coleta, não gera medição diária |

Pedidos divergentes ficam fora dos indicadores. Resumo e detalhe não são somados entre si. O arquivo original é arquivado por SHA-256; a auditoria guarda a linha e a origem CSV. Reenvios não duplicam pedidos. Conflitos de valor, data, moeda ou creator bloqueiam a gravação. A reversão dos lotes mantém os cadastros de creators.

## API local

`POST /api/agent/workbook/apply`: `{jobId, hash, confirm: true}`. O UUID identifica a leitura salva e o hash identifica seu arquivo. A resposta contém os totais, perfis e contagens da aplicação. O cartão não envia valores financeiros novos ao endpoint.

## Limites

Arquivos fora desse contrato continuam no fluxo genérico de leitura por trechos; não há mapeador universal. Fórmulas não são executadas nem recalculadas. Informações sem data e vínculos incertos não são completados automaticamente. Ranking de arquivos com períodos diferentes representa valores importados, sem equiparar desempenho.
