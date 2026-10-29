# Chat unificado e processamento por etapas

## Objetivo

Uma conversa local reconhece perguntas, propostas de dados e o criador mencionado. A interface não exige escolher um modo ou manter um seletor de contexto. Dados novos continuam dependendo de revisão e confirmação antes de alterar os indicadores.

## Fluxo implementado na versão 0.3.0

1. Reconhecer nomes completos e handles cadastrados; usar o contexto anterior quando não houver outra referência. Identidades desconhecidas ou múltiplas exigem esclarecimento.
2. Classificar mensagens simples localmente. Usar o modelo roteador para mensagens ambíguas ou extensas.
3. Processar CSV/XLSX deterministicamente. Para texto, extrair registros em blocos pequenos, preservando os campos ausentes para esclarecimento/revisão.
4. Resumir documentos extensos por bloco, reduzir os resumos em etapas e responder por seções. Os cálculos financeiros continuam no serviço de métricas e no banco, não no resumo da IA.
5. Persistir cada etapa concluída. Uma falha permite retomar o trabalho salvo; reproduzir um trabalho já concluído não chama o provedor novamente.

O mecanismo é um fluxo fechado de serviços do produto, sem execução livre de comandos, SQL ou navegação pelo modelo.

## Módulos e persistência

`src/server/agent/` separa orçamento, intenção, extração, configuração, armazenamento, orquestração e transporte HTTP. O frontend recebe eventos NDJSON de progresso, resposta parcial, conclusão ou erro.

O diretório de dados do usuário guarda `agent/session.json`, trabalhos em `agent/jobs`, resultados reutilizáveis de extração e resumos. Nova conversa arquiva o histórico anterior. O histórico bruto permanece local; a janela enviada ao modelo usa mensagens recentes e resumos por criador. A interface recupera as últimas 100 mensagens. Esses arquivos de conteúdo não são cifrados pelo aplicativo; as credenciais continuam protegidas pelo Windows DPAPI.

Desconectar a janela interrompe a leitura, sem apagar o trabalho. Encerrar o aplicativo exige retomar a análise salva na próxima abertura. A pausa acontece no próximo ponto entre etapas; não cancela imediatamente uma requisição já enviada.

## Orçamento e modelos

Configurações permite definir modelos para roteamento, extração, resumo e resposta, além de usar a conexão principal ou reserva nas etapas auxiliares. Campos de modelo vazios herdam o modelo da conexão. Os IDs precisam existir no provedor; quatro campos preenchidos não garantem quatro provedores independentes.

O padrão é sequencial, para reduzir pressão sobre limites gratuitos. Cada bloco tem 5.000 caracteres por padrão, configurável entre 2.000 e 8.000; mensagem e texto para extração limitados a 180.000 caracteres, anexos a 5 MB e até 48 blocos iniciais. Limites são estimativas por caracteres, não uma contagem exata do tokenizer de cada modelo. O orçamento de resposta por chamada é configurável entre 300 e 1.500 tokens, padrão 800. A extração pode subdividir blocos recusados por tamanho ou saída truncada, com profundidade e número de chamadas limitados.

HTTP 429 respeita `Retry-After` e impede novas chamadas ao mesmo endpoint durante o intervalo. Falhas transitórias têm tentativas limitadas; a reserva é usada quando configurada e apropriada. Erros de credencial não geram rotação de contas. Respostas truncadas são tratadas como erro, para não importar JSON incompleto. Roteamento, resumo e resposta registram uso informado pelo provedor; isso não constitui uma medição integral de todas as tentativas e caches.

## Referências e decisões

A correção 0.3.1 distingue tamanho de entrada de limite de geração: depois de saída truncada, extração pode usar 1.400/2.800/4.096 tokens, resumo 500/1.000/2.000 e triagem 500/1.000/1.500. Limites explícitos e o orçamento de resposta do usuário são mantidos. Tentativas de inferência e reserva continuam limitadas; podem consumir cota. Relatórios Inbazz no formato reconhecido são lidos localmente, preservando datas ausentes e indisponibilidade de métricas privadas. Os testes de parser e contexto cobrem esse comportamento com exemplos fictícios.

| Projeto | Padrão estudado | Aplicação aqui |
| --- | --- | --- |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) e [ciclo do agente](https://raw.githubusercontent.com/NousResearch/hermes-agent/main/website/docs/developer-guide/agent-loop.md) | Fases, limites de execução e compressão de contexto | Etapas explícitas, histórico persistido e modelos auxiliares |
| [OpenClaw: compaction](https://docs.openclaw.ai/concepts/compaction) | Resumo limitado sem perder o histórico bruto em disco | Memória compactada por criador e documentos resumidos em blocos |
| [OpenClaw: model failover](https://docs.openclaw.ai/concepts/model-failover) | Recuperação e intervalos de indisponibilidade | Reserva configurada, limites de tentativas e cooldown |
| [LiteLLM Router](https://docs.litellm.ai/docs/routing) | Gestão de limites, retries e fallback | Controle por endpoint; sem adicionar outro proxy ao desktop |
| [LlamaIndex: ingestion pipeline](https://docs.llamaindex.ai/en/v0.10.17/module_guides/loading/ingestion_pipeline/root.html) | Transformações por trecho e cache de processamento | Cache por conteúdo e configuração na extração |

Foram aproveitados padrões de arquitetura, sem instalar esses frameworks ou copiar seus agentes. O produto mantém Electron, Next.js e PostgreSQL locais. `react-markdown` e `remark-gfm` foram adicionados para respostas legíveis com listas, tabelas e código; HTML bruto e imagens de respostas não são renderizados.

APIs gratuitas continuam sujeitas a cotas e disponibilidade. Várias LLMs não somam suas janelas de contexto automaticamente. O ganho vem de enviar menos contexto repetido, limitar a saída por etapa, reutilizar resultados e escolher o modelo adequado para cada tarefa. Resumos podem perder detalhes: o arquivo original e os registros validados permanecem a evidência para revisão.

## Validação

`tests/agent.test.ts` verifica limites, Unicode, intenção e espera de rate limit. `tests/agent.integration.test.ts`, com `RUN_DB_TESTS=1`, usa provedores simulados e PostgreSQL real para verificar falha intermediária, retomada, escolha de modelos, contexto implícito e prévia sem inserir fatos. Isso não prova a disponibilidade de provedores gratuitos reais; essa conexão precisa de uma verificação separada.
