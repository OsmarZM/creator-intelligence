# Creator Intelligence para Windows

## Objetivo

O aplicativo desktop é a experiência principal. Ele inclui a interface, o backend Next.js e um PostgreSQL nativo próprio. O usuário não precisa iniciar terminal, Node ou Docker para usar o executável instalado. A conexão com provedores de IA pode depender de serviços locais/remotos escolhidos nas configurações.

## Instalação e uso

Execute o instalador `release/Creator-Intelligence-Setup-0.7.0.exe`. A instalação é por usuário, com atalhos na área de trabalho e no menu Iniciar. Abra **Creator Intelligence**. A primeira abertura prepara o banco; aberturas seguintes reutilizam os mesmos dados. O pacote inclui o núcleo Hermes, Python e suas dependências. Não há instalação separada do Hermes nem download dele no primeiro chat; configure apenas sua conexão de IA no aplicativo.

O botão **Abrir no navegador** abre o mesmo workspace em um localhost acessível somente nesta máquina. O aplicativo deve continuar aberto para manter o backend disponível. Ao encerrar o app, ele encerra seu backend e seu PostgreSQL; o Docker e o banco de desenvolvimento não são afetados.

## Configurar a IA

1. Abra **Configurações** dentro do app.
2. Escolha FreeLLMAPI, OpenAI, OpenRouter, Claude ou Gemini.
3. Confira a URL-base sugerida e informe a chave da sua conta/gateway.
4. Clique em **Buscar modelos** e selecione/informe o identificador desejado.
5. Clique em **Testar conexão**. Esse teste usa os campos ainda não salvos e faz uma solicitação mínima ao provedor; poderá consumir o uso normal dessa API.
6. Clique em **Salvar configurações**. As próximas chamadas usam a nova conexão sem reiniciar.

Uma chave já salva não aparece preenchida: o campo vazio significa manter a chave daquele provedor/endpoint. Trocar de provedor ou URL não reaproveita automaticamente um segredo de outro destino. A opção **Remover a chave salva** é explícita. Principal e reserva têm credenciais independentes, inclusive quando usam o mesmo serviço.

Erros HTTP 401 e 403 indicam problemas de credencial/permissão; 404 indica endpoint/modelo não encontrado; 429 indica limite de uso. Falta de chave não é resolvida por fallback. Provedores que não listam modelos podem ser configurados pelo identificador manual.

O FreeLLMAPI padrão é um endereço sugerido (`http://127.0.0.1:31415/v1`), não uma credencial ou modelo garantido. O app não cria uma chave nem assume uma chave fictícia como válida. Um gateway local pode encaminhar dados a um provedor remoto.

## Criador e continuidade da conversa

O chat é único: nomes e handles cadastrados identificam o criador, mensagens seguintes podem herdar esse contexto e referências ambíguas exigem esclarecimento. O filtro do dashboard permanece disponível para consultar os indicadores. Dados novos são preparados para revisão; perguntas seguem para análise. Nenhuma proposta altera os fatos automaticamente.

Textos extensos são processados em blocos, com respostas por seções e etapas salvas para retomada. **Retomar análise** reaproveita as etapas concluídas. **Pausar após etapa** aguarda a chamada atual terminar. O histórico completo fica no diretório local; contexto resumido e recente limita o que é enviado à IA.

Em Configurações, a seção de processamento permite modelos separados para roteamento, extração, resumo e resposta, conexão auxiliar, tamanho de bloco e limite de saída. O padrão é sequencial e herda o modelo principal. Falhas transitórias têm tentativas limitadas; HTTP 429 respeita a espera informada pelo provedor. Erros de credencial não são repetidos automaticamente.

Detalhes, limites e referências de Hermes, OpenClaw e LiteLLM estão em [arquitetura do chat](AGENT-CHAT-ARCHITECTURE.md).

## Tema e dados

A identidade visual usa preto, roxo e branco, com tema claro e escuro pelo botão de sol/lua. A preferência fica salva na pasta de dados e é aplicada também em novas aberturas do aplicativo.

O diretório padrão de dados é `%APPDATA%\Creator Intelligence`:

| Caminho                       | Conteúdo                                                            |
| ----------------------------- | ------------------------------------------------------------------- |
| `database/`                   | Cluster PostgreSQL exclusivo do aplicativo                          |
| `database.json`               | Porta e senha do banco protegida pelo Windows                       |
| `ai-settings.json`            | Provedores/modelos e chaves cifradas com DPAPI para o usuário atual |
| `appearance.json`             | Preferência de tema                                                 |
| `imports/`                    | Originais dos arquivos recebidos                                    |
| `backend.log`, `postgres.log` | Diagnóstico local                                                   |

Não copie a pasta `database/` enquanto o banco estiver em execução para tratá-la como backup consistente. Para cópia física simples, feche o aplicativo antes e copie a pasta de dados completa. Credenciais cifradas são vinculadas ao usuário do Windows; outra conta pode precisar informar novamente suas chaves. A desinstalação não solicita apagar os dados do usuário.

Os dados do app são separados do ambiente web de desenvolvimento. Nenhuma migração automática dos dados do Docker foi feita. Quando houver dados reais para transferir, a transferência deve ser validada com backup, contagens e conferência de métricas.

## Desenvolvimento e empacotamento

Requisitos para **gerar** o instalador: Node compatível com as dependências, npm, Windows x64 e arquivos de distribuição Windows do PostgreSQL. O script usa `C:\Program Files\PostgreSQL\18` ou o diretório definido em `CI_POSTGRES_ROOT`. Isso é um requisito do ambiente de build; o runtime é incluído no instalador.

O build também prepara Hermes e Python uma vez com `npm run desktop:prepare:hermes`, usando `CI_HERMES_SOURCE` para um checkout upstream que contenha a revisão fixa, `CI_PYTHON_ROOT` para CPython portátil e, opcionalmente, `CI_UV` para o executável uv do ambiente de build. O script arquiva a revisão original, exclui o ambiente pessoal, instala dependências do lock com hashes e gera o manifesto em `.desktop-resources/hermes`. Esses requisitos são do desenvolvedor; o instalador entrega o runtime pronto ao usuário. O empacotamento falha se o runtime incluído estiver ausente.

```powershell
npm install
node scripts/create-icon.mjs
npm run desktop:build
```

Para executar a janela Electron diretamente após preparar os recursos:

```powershell
npm run build
npm run desktop:prepare
npm run desktop
```

O empacotamento inclui o servidor standalone, os assets, as migrações e o runtime PostgreSQL. Arquivos `.env`, credenciais e dados do workspace são excluídos do payload. Preserve as licenças do runtime incluído. O instalador desta entrega não possui assinatura digital. As versões públicas ficam nas Releases do repositório; consulte [publicação e atualizações](RELEASES.md).

## Decisões técnicas

- Electron preserva os serviços existentes de importação e métricas, evitando reimplementar a API para ter uma janela Windows.
- O renderer usa isolamento de contexto, sandbox e Node desabilitado. O preload expõe abertura do localhost, aparência e ações tipadas de atualização; todos os canais validam a origem do renderer.
- O processo principal gerencia o backend e o PostgreSQL. Ambos fazem bind em loopback, com portas livres; a senha do banco é aleatória e protegida pelo Windows.
- Migrações do app são transacionais e registradas com checksum. Migração já aplicada com conteúdo diferente é rejeitada.
- A API de configuração de IA não consulta o banco. No desktop, a inicialização do backend depende da preparação bem-sucedida do PostgreSQL; uma falha nessa etapa mantém a tela de diagnóstico de inicialização.

Referências: [isolamento e segurança do Electron](https://www.electronjs.org/docs/latest/tutorial/security), [servidor standalone do Next.js](https://nextjs.org/docs/app/api-reference/config/next-config-js/output).
