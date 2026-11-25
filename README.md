# Toddle Bridge

MVP local de preparação de planejamentos, atividades, avisos e mensagens. Esta versão não consulta nem publica na Toddle. Não é uma integração oficial.

## Pré-requisitos

- Node.js 22 ou superior
- Git
- Autorização institucional e do fornecedor antes de implementar automação da plataforma.

## Windows (PowerShell)

```powershell
git clone https://github.com/thiagoarce/toddle-bridge.git
cd toddle-bridge
npm install
npx playwright install chromium
npm test
npm run dev
```

Abra http://127.0.0.1:3210/health. A API é somente local e não deve ser exposta diretamente à internet.

Para testar uma prévia fictícia, em outro terminal:

```powershell
$body = @{ kind = "lesson_plan"; destination = "Demo"; title = "Review"; body = "Practice exercises" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3210/drafts/preview -ContentType "application/json" -Body $body
```

O resultado contém `published: false` e `status: preview_only`.

## Navegador dedicado (teste manual)

```powershell
npm run login
```

O navegador abre com um perfil local separado. Para testar a persistência, navegue manualmente até um site de teste, feche o processo com Enter e execute novamente. Somente utilize uma conta institucional se houver autorização para esse ambiente. O perfil pode conter cookies e tokens de sessão: proteja-o como uma credencial, nunca envie para GitHub ou para a IA e não o compartilhe.

## Próximas etapas

1. Confirmar interface autorizada e condições de uso.
2. Validar o login e a sessão em ambiente aprovado, com dados de teste.
3. Implementar adaptador de consulta com privilégio mínimo.
4. Implementar rascunho, confirmação explícita, execução e verificação de cada publicação.
5. Adicionar autenticação de acesso remoto, auditoria, fila e interface MCP.

Não armazenar dados de alunos, senhas ou sessões no repositório. Não expor a API sem autenticação. Não incluir informações pessoais em chamadas a modelos de IA sem autorização e controles adequados.

## Mapeamento guiado (somente leitura)

Após obter autorização da instituição e do fornecedor para inspeção automatizada em ambiente aprovado, feche o navegador de login e execute `npm.cmd run map -- --authorized`. O navegador abre automaticamente em https://web.toddleapp.com; autentique-se manualmente se necessário. Navegue manualmente e digite no terminal a categoria da tela para registrar sua estrutura. Use formulários vazios ou dados fictícios, não telas de alunos individuais ou conversas privadas. Digite `fim` para encerrar.

O relatório `.local/reports/toddle-map.json` contém categorias, formatos de rotas com segmentos desconhecidos mascarados, tipos de controles, estados e nomes reconhecidos de um vocabulário fixo. Não exporta HTML, valores de campos, imagens, cookies, cabeçalhos ou tráfego. Não clica nem publica. Cada execução bem-sucedida substitui o relatório anterior. Confira o JSON antes de compartilhar apenas esse arquivo. O mapeamento não cobre automaticamente telas não visitadas, iframes, controles ocultos ou todos os componentes personalizados; não representa uma especificação de API interna. As operações futuras devem usar interfaces autorizadas.

## Mapeamento automático experimental

Em ambiente de teste autorizado com dados fictícios, execute `npm.cmd run map:auto -- --authorized-test-demo`. A origem da Toddle é fixa e a opção de execução declara autorização e escopo de teste, sem perguntas repetidas. O programa segue até 30 URLs de navegação interna reconhecidas, sem clicar em botões, enviar formulários ou coletar tráfego. Rotas desconhecidas, consultas, registros individuais e mensagens ficam fora do crawler. O relatório `.local/reports/toddle-map-auto.json` registra estruturas, conexões e contadores de exclusão, sem URLs completas. Revise antes de compartilhar. Menus implementados apenas em JavaScript, rotas não reconhecidas e formulários de criação continuam dependendo do modo guiado. Não use em ambiente de produção com dados reais de estudantes.

## Observação passiva de telas React

`npm.cmd run map:watch -- --authorized` registra automaticamente as mudanças estruturais da aba aprovada enquanto o operador navega manualmente, sem comandos por categoria. Pressione Enter no terminal para terminar. Limite de 100 estruturas distintas; arquivo `.local/reports/toddle-map-watch.json`. Não navega ou clica sozinho. Use somente telas autorizadas de visão geral e editores vazios, sem dados individuais. O relatório mantém apenas nomes de componentes previamente permitidos, rótulos reconhecidos e rotas mascaradas. Revise antes de compartilhar.

O mapeador abre a Toddle automaticamente, aguarda a área autenticada e não pede mais a origem ou confirmações digitadas. Use os parâmetros de autorização apenas quando aplicáveis; eles não substituem a autorização institucional. Se a sessão expirar, autentique-se manualmente no navegador.

## Explorador React supervisionado

Somente em conta de teste/demo autorizada e com dados fictícios, feche o navegador dedicado e execute `npm.cmd run map:explore -- --authorized-test-demo`. O explorador usa cartões de turma, funcionalidades, abas, botões e links de navegação reconhecidos. Pode abrir editores vazios, sem preencher nem enviar. Não intercepta requisições, não bloqueia WebSockets e não desativa service workers. Registra apenas contagens e categorias de requisições, sem conteúdo, cabeçalhos ou credenciais. A navegação pode produzir efeitos no servidor; não há garantia de ausência de alterações permanentes. Acompanhe a execução e feche a aba para interromper. A exploração usa busca em largura: visita os destinos de primeiro nível antes de aprofundar, evita repetir estados equivalentes e reutiliza URLs de visão geral já observadas quando aplicável. O calendário global é explorado uma vez. A descoberta visual usa texto renderizado, rótulos acessíveis e posições no DOM, inclusive em menus React e diálogos. O relatório inclui `visualControls` com rótulos genéricos e geometria; não é OCR de imagem. Menus podem ser explorados, mas formulários editáveis e ações de envio não são executados. Não exporta texto integral, imagens, dados de campos ou nomes arbitrários. A classificação é heurística e pode omitir componentes sem texto ou confundir um botão de criação com a abertura de um formulário; utilize apenas o ambiente de teste supervisionado. Limites: 80 estados, profundidade 5 e 120 tentativas. Saída local: `.local/reports/toddle-map-explore.json`. Revise antes de enviar; não compartilhe o perfil do navegador.

### Explorer v7

Registra todas as turmas da tela inicial, mas aprofunda apenas uma turma de cada estrutura equivalente por padrão. Use `npm.cmd run map:explore -- --authorized-test-demo --all-classes` para repetir a exploração em todas. Reconhece menus React renderizados fora do diálogo, rótulos ARIA referenciados e texto de componentes personalizados. Prioriza a expansão de menus, tenta hover em Planning/Classroom e utiliza o rótulo visível associado a seletores de visualização quando disponível. A interceptação de rede permanece desativada. Não é OCR e não garante cobertura integral. O relatório continua local e uma nova execução o substitui; preserve uma cópia do relatório anterior, se necessário. Em outro computador, clone/atualize o repositório, instale dependências e autentique-se manualmente no perfil dedicado; não transfira cookies nem o perfil.

### Explorer v8 — checkpoints

Uma execução nova arquiva o relatório e checkpoint anteriores. O checkpoint é atualizado a cada ação processada, com substituição atômica do JSON. O arquivo `.local/reports/toddle-explore-checkpoint.json` contém a fila, mapa estrutural, impressões digitais de estados e caminhos por ações genéricas, sem cookies, tokens ou URLs completas. Para continuar uma execução interrompida, use:

```powershell
npm.cmd run map:explore -- --authorized-test-demo --resume
````

Mantenha o mesmo modo de turmas (inclua `--all-classes` novamente se usou essa opção). Na retomada, autentique-se na mesma plataforma de teste autorizada. Em outro PC, clone/atualize, instale as dependências e Chromium, autentique-se manualmente e copie apenas o checkpoint v8 para a pasta `.local/reports`, por transferência privada autorizada. O checkpoint é vinculado à plataforma e cada tela restaurada é comparada com a impressão digital anterior antes da ação; alterações da interface ou ordem de turmas podem invalidar caminhos. Não transfira o perfil de navegador. Os relatórios v6/v7 não contêm uma fila recuperável e não podem ser retomados diretamente. Cada sessão de retomada permite até 80 novos estados e 120 tentativas; o mapa é acumulado e os contadores de rede referem-se à sessão atual. Sem `--resume`, inicia uma exploração nova. Os arquivos permanecem ignorados pelo Git; não faça commit do checkpoint ou dos relatórios. Use `npm.cmd test` para executar os testes locais.

### Explorer v9 — memória cumulativa (comportamento padrão)

`npm.cmd run map:explore -- --authorized-test-demo` reutiliza automaticamente o checkpoint local da mesma plataforma e do mesmo modo de turmas, inclusive se a fila anterior estiver vazia. Aceita checkpoints v8 e v9. Não repete ações já registradas como concluídas para o mesmo estado; pode atravessar telas conhecidas para chegar ao próximo destino. Inspeciona a página inicial em cada execução para encontrar novos controles. Falhas transitórias registradas a partir da v9 são tentadas em sessões seguintes, no máximo três tentativas no total; as demais ficam no histórico. A memória não garante detectar todas as mudanças em telas internas já exploradas. O relatório é cumulativo e os contadores de rede são da sessão atual.

Use `--fresh` para arquivar o mapa e checkpoint existentes e começar outro. `--resume` continua disponível para exigir um checkpoint existente. Um checkpoint incompatível ou inválido não é sobrescrito automaticamente. Mantenha o arquivo `.local/reports/toddle-explore-checkpoint.json` local e privado; não transfira a sessão autenticada. A interceptação de rede continua desativada; apenas ambientes de teste autorizados com dados fictícios.

### Explorer v10 — recuperação de turmas incompletas

Mantém o mapa v8/v9, inclusive com fila vazia. Reabre os cartões de turma cujo destino anterior não continha controles reconhecidos de uma turma. Após clicar em um cartão, aguarda até 25 segundos por controles pedagógicos reconhecíveis em duas leituras consecutivas; se não aparecerem, registra `class-content-not-ready` em vez de tratar a tela inicial de carregamento como concluída. A detecção de estruturas equivalentes continua ativa. Não é necessário usar `--fresh`; a migração ocorre automaticamente. A prontidão é heurística e não comprova que todos os dados terminaram de carregar.

### Explorer v11 — descoberta de menus incompletos

Reutiliza checkpoints v8–v10. Na migração, reabre menus Create anteriormente capturados com itens sem rótulos reconhecidos e revisita uma vez Planning/Classroom quando a interação anterior não mudou o estado. A leitura de menu considera títulos individuais, linhas renderizadas e textos curtos de descendentes, sem exportar texto integral. Menus sem opções identificáveis são registrados como `menu-items-unrecognized`; cliques/hover em Planning/Classroom que não alteram o estado são registrados como `no-visible-change`, com tentativas limitadas em sessões futuras. Não há garantia de reconhecimento de todos os itens. A interceptação de rede permanece desativada. Use a mesma conta de teste autorizada e não utilize `--fresh` para preservar o mapa.

### Explorer v12 — limites configuráveis

O comando normal usa até 250 novos estados por sessão, 400 tentativas e profundidade 10. O mapa acumulado permanece no checkpoint, compatível com v8–v11. Em ambiente de teste autorizado, é possível ajustar os limites com `--max-new-states 500 --max-attempts 800 --max-depth 12`. Valores aceitos: 1–1000 novos estados, 1–1500 tentativas e profundidade 1–20. Ao retomar, não escolha uma profundidade inferior à dos caminhos pendentes já salvos. A fila vazia encerra a execução mesmo se o orçamento não foi utilizado; isso não significa cobertura integral da plataforma. As regras de reconhecimento de controles e de deduplicação não foram alteradas.

### Explorer v13 — navegação observada

Reconhece `Interdisciplinary unit`, `Subject specific unit`, `Import from MB Library` e `Weekly planners`. Para Weekly planners, abre o submenu Planning por hover (com alternativa por clique), procura o texto exato ou o rótulo com atalho W e segue apenas se a opção for encontrada de forma inequívoca. Reaproveita checkpoints v8–v12 e tenta recuperar menus Create anteriormente incompletos. Não presume que opções acinzentadas estejam habilitadas. Use apenas ambiente de teste autorizado. Sem interceptação de rede; o reconhecimento ainda não é OCR nem visão computacional geral.

### Explorer v14 — Planning flyout and local teaching

Retains checkpoints v8–v13. Retries one representative course's Weekly planners path on upgrade. The Planning trigger is reacquired after the sidebar expands, and the target is resolved by exact text or role, including the W shortcut label. The tool records successful navigation destinations locally in `.local/weekly-routes.json`, keyed by course scope; the file is not part of the shareable report. If automatic navigation fails, use `npm.cmd run map:explore -- --authorized-test-demo --teach-weekly`. When the terminal displays TEACH, manually open Planning > Weekly planners in the same authorized demo course, then press Enter. A new URL in the same course and approved scope is required. This is operator-guided teaching, not OCR. The learned route can be reused within that course on later runs; it is not a universal route template. Other previously excluded destinations remain excluded. No network interception was added. Do not share the local routes file or authenticated profile.
