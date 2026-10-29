# Releases e atualização do aplicativo

## Uso no Windows

As versões ficam em https://github.com/OsmarZM/creator-intelligence/releases. O instalador inclui os runtimes locais. Na primeira versão que oferece atualização interna, instale o pacote normalmente. Depois use **Atualizações** no topo do app:

1. **Verificar atualizações** consulta as releases estáveis públicas.
2. **Baixar atualização** baixa e confere o instalador conforme o SHA-512 do manifesto.
3. **Reiniciar e instalar** bloqueia novas gravações, aguarda o app estar livre, encerra backend e banco e faz um backup antes de iniciar o NSIS.

O backup fica em `%APPDATA%\Creator Intelligence\update-backups`. Inclui banco parado, conversa, importações e configurações protegidas; não copia recursivamente backups antigos nem caches do navegador. Fechar o app normalmente não instala uma atualização automaticamente. Falha de rede permite tentar novamente; análise ou gravação ativa mantém o download disponível para instalar depois.

## Componentes e segurança

`electron-updater` 6.8.11 é uma dependência explícita para atualização NSIS e validação de download. `scripts/prepare-updater.mjs` copia sua árvore de dependências para um runtime separado, resolvido dentro da instalação. O renderer envia somente ações constantes; não escolhe URL, executável ou pasta. IPC aceita apenas a própria janela e origem local. O manifesto do GitHub é configurado pelo build, sem token no cliente.

O repositório público recebe código, exemplos fictícios e instalador. Banco, uploads, backups, credenciais e relatórios internos de qualificação ficam locais e ignorados pelo Git. A publicação verifica o hash e os metadados antes de enviar os três artefatos necessários.

## Publicar uma versão

1. Atualize a versão do `package.json` e lock com `npm version ... --no-git-tag-version`. Mantenha a versão do preload correspondente.
2. Execute lint, typecheck, testes e qualificação visual. Prepare Hermes/Python conforme `DESKTOP.md` no ambiente de build.
3. Gere o backend e os runtimes: `npm run build`, `npm run desktop:prepare`.
4. Execute `npx electron-builder --config desktop/builder.cjs --win nsis --publish never`.
5. Confira `release/latest.yml`, o instalador `.exe` e seu `.exe.blockmap`, o SHA-512 e a versão do aplicativo. Crie um commit/tag e uma release em rascunho, envie os três artefatos e publique após a conferência.

Nunca publique somente o EXE: o atualizador precisa de `latest.yml`. Nunca sobrescreva uma versão publicada com outro binário; gere uma versão maior. O updater usa apenas releases estáveis e não permite downgrade. Os instaladores atuais não têm assinatura digital. Um manifesto de checksum protege a integridade do download, sem substituir uma assinatura de código.

Referência: https://www.electron.build/v26/docs/features/auto-update/
