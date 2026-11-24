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

Após obter autorização da instituição e do fornecedor para inspeção automatizada em ambiente aprovado, feche o navegador de login e execute `npm.cmd run map`. Abra a página manualmente no navegador dedicado; informe a origem HTTPS exata, sem caminho. Navegue manualmente e digite no terminal a categoria da tela para registrar sua estrutura. Use formulários vazios ou dados fictícios, não telas de alunos individuais ou conversas privadas. Digite `fim` para encerrar.

O relatório `.local/reports/toddle-map.json` contém categorias, formatos de rotas com segmentos desconhecidos mascarados, tipos de controles, estados e nomes reconhecidos de um vocabulário fixo. Não exporta HTML, valores de campos, imagens, cookies, cabeçalhos ou tráfego. Não clica nem publica. Cada execução bem-sucedida substitui o relatório anterior. Confira o JSON antes de compartilhar apenas esse arquivo. O mapeamento não cobre automaticamente telas não visitadas, iframes, controles ocultos ou todos os componentes personalizados; não representa uma especificação de API interna. As operações futuras devem usar interfaces autorizadas.
