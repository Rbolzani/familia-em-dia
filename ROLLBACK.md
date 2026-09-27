# Plano de rollback

Como desfazer cada tipo de mudança **antes** de precisar. Escrito em 27/09/2026
para o item U7 da bateria de prontidão.

Regra que vale para tudo: **primeiro parar o sangramento, depois investigar.**
Reverter um deploy leva um minuto; achar a causa com o app quebrado leva horas,
e o cliente está esperando no meio.

---

## 0. Decidir em 30 segundos

| Sintoma | Ação imediata | Seção |
|---|---|---|
| Tela branca, erro 500, build quebrado | reverter deploy | 1 |
| Funciona local e quebra em produção | conferir variável de ambiente | 2 |
| Mensagem do WhatsApp não chega / Meta recusa | voltar template | 3 |
| Dado errado ou apagado em massa no banco | **parar escritas** e ver seção 4 | 4 |
| Cobrança errada no cliente | nada de rollback: agir no Stripe | 5 |

Reverter **não é admitir derrota** — é separar "parar o dano" de "entender o
dano". Só o segundo pode esperar.

---

## 1. Deploy (Vercel)

**Rollback instantâneo, sem build:**

1. Painel da Vercel → projeto → aba **Deployments**
2. Escolha o último deploy que estava bom → menu `···` → **Promote to Production**
   (em algumas versões: **Instant Rollback**)

Pela linha de comando, a partir de `gestao-filhos-app/`:

```bash
npx vercel ls --prod          # lista os deploys, o mais recente primeiro
npx vercel redeploy <url-do-deploy-bom> --target production
```

**Leva ~1 min** e não depende de git.

**Depois** de estabilizar, desfaça também no git, senão o próximo push traz o
problema de volta:

```bash
git revert <hash-do-commit-ruim>
git push origin main
```

> Um `git revert` cria um commit novo que desfaz o anterior. Nunca use
> `push --force` em `main`: o deploy automático segue o que está no GitHub, e
> reescrever histórico com o time (ou com você mesmo em outra máquina)
> desalinhado é um segundo incidente em cima do primeiro.

**Pontos de retorno conhecidos:**
- `backup-v1-pre-logistica-compartilhada` — antes do compartilhamento
- `backup-pre-next-16.3.3` — antes do upgrade do Next

---

## 2. Variáveis de ambiente

O sintoma clássico é "funciona local, quebra em produção".

```bash
# repor o valor anterior (sobrescreve)
printf '%s' "VALOR_ANTIGO" | npx vercel env add NOME_DA_VAR production --force
```

⚠️ **Variável só vale no deploy seguinte.** Depois de repor, force um redeploy
(seção 1). Sem isso, o painel mostra o valor novo e a aplicação continua com o
velho — parece que o rollback não funcionou.

⚠️ **`NEXT_PUBLIC_*` congela no BUILD**, não no boot. Mudar exige build novo, não
basta redeploy de um build existente.

⚠️ Variáveis marcadas como *Sensitive* **não podem ser lidas de volta** — nem
pelo painel, nem por `vercel env pull`. Se você precisa poder conferir um valor
depois, guarde-o também no gerenciador de senhas na hora de criar.

Segredos e onde mais cada um vive: `ROTACAO_DE_SEGREDOS.md`.

---

## 3. Template do WhatsApp

A contagem de parâmetros é **contrato** com a Meta: mandar 8 params para um
template de 9 faz a Meta **rejeitar a mensagem inteira**.

Por isso o nome e as flags formam **um conjunto e mudam juntos**:

| Variável | Valor do v5 | Valor do v4 |
|---|---|---|
| `WHATSAPP_TEMPLATE_NAME` | `resumo_diario_v5` | `resumo_diario_v4` |
| `WHATSAPP_TEMPLATE_HAS_PAYMENTS` | `true` | `false` |
| `WHATSAPP_TEMPLATE_HAS_EXAMS` | `true` | `true` |
| `WHATSAPP_TEMPLATE_HAS_CLASSES` | `true` | `true` |
| `WHATSAPP_TEMPLATE_HAS_REMINDERS` | `true` | `true` |

**Rollback:** reponha as duas primeiras linhas (seção 2) e redeploy. O código
cai sozinho no formato anterior — inclusive a ordem das seções, que o
`templateHasPayments()` comanda junto.

**Teste depois:** `/alertas` → Enviar teste, e confira o status na tabela
`whatsapp_messages` (seção 6). Status `accepted` que nunca vira `delivered`
significa problema de entrega, não de template.

---

## 4. Banco de dados (Supabase)

**Antes de qualquer coisa: pare de escrever.** Se um cron ou um script está
corrompendo dados, desligue-o primeiro — restaurar por cima de escrita ativa
produz um estado pior que o original.

### 4.1 Mudança de schema (migração)

Toda migração aplicada está em `MIGRATION_*.sql` na raiz. Para desfazer,
escreva o inverso (drop da coluna, drop da policy, recriação da função
anterior) e aplique. **Não existe "desfazer" automático.**

O caminho seguro para algo estrutural é: aplicar em transação e conferir antes
do commit —

```sql
begin;
  -- alteração aqui
  -- conferência aqui (select ...)
rollback;   -- troque por commit quando a conferência passar
```

### 4.2 Dados perdidos ou corrompidos

O Supabase Pro faz **backup diário** (retenção de 7 dias).

**⚠️ NÃO restaure por cima da produção.** Isso volta o banco inteiro — inclusive
o que todos os outros usuários fizeram desde o ponto do backup — e derruba o app
durante a restauração.

O caminho correto, **validado em 19/09** (item U2):

1. Supabase → **Database → Backups** → aba **Restore to new project**
2. Restaure num projeto **novo** (leva de minutos a ~30 min)
3. Extraia dali **só o que se perdeu** e reinsira na produção
4. **Apague o projeto novo** — ele é cobrado por hora enquanto existir

Conferência de integridade do que foi restaurado: compare contagens por tabela
e, melhor, uma impressão digital do conteúdo, não só o número de linhas.

### 4.3 O que o backup NÃO cobre

**Arquivos do Storage não entram no backup** — documentos do cofre e fotos dos
filhos. O banco volta com as linhas apontando para arquivos que não existem
mais. Risco conhecido e aceito até aqui; se um dia virar inaceitável, a saída é
uma cópia periódica dos buckets.

---

## 5. Cobrança (Stripe)

Não existe "rollback" de dinheiro: existe **estorno**, que é um evento novo.

- **Cobrança indevida dentro de 7 dias:** o próprio app devolve integral e
  encerra na hora (direito de arrependimento, art. 49 do CDC).
- **Fora disso:** estorno pelo painel do Stripe, com registro do motivo.
- **Assinatura em estado errado no banco:** não edite o banco. Corrija no Stripe
  e abra `/planos` — a reconciliação (`reconcileUserFromStripe`) traz a verdade
  do Stripe para o banco. Editar o banco direto cria divergência silenciosa: o
  app diz uma coisa, o Stripe cobra outra.

⚠️ Ao trocar `STRIPE_WEBHOOK_SECRET`, o webhook **para de validar** até o
redeploy. Faça a troca e o redeploy na mesma janela.

---

## 6. Como saber se o rollback funcionou

Não confie na tela. Confirme por evidência:

```bash
# app de pé e gate de autenticação intacto
curl -s -o /dev/null -w "%{http_code}\n" https://www.familiaemdia.com.br/
curl -s -o /dev/null -w "%{http_code}\n" https://www.familiaemdia.com.br/dashboard   # 307
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://www.familiaemdia.com.br/api/children  # 401
```

```sql
-- entrega das mensagens (status real, vindo da Meta)
select kind, status, error_code, sent_at
from whatsapp_messages order by sent_at desc limit 10;
```

E olhe o **Sentry** depois de qualquer reversão: erro que some é bom sinal; erro
novo aparecendo logo após o rollback costuma ser incompatibilidade entre a
versão antiga do código e um dado já migrado.

---

## 7. O que nunca fazer sob pressão

- **Apagar** WABA, portfólio empresarial, projeto Supabase ou bucket. Apagar não
  é rollback: é perda definitiva, e quase sempre existe um caminho reversível.
- **Restaurar backup por cima da produção** sem ter certeza do que se perde.
- **`push --force` em `main`.**
- **Mexer em duas coisas ao mesmo tempo.** Se você reverte deploy e variável
  juntos e o problema some, não se sabe qual era — e a chance de repetir é alta.
- **Confiar em "deu certo" sem medir.** Vários defeitos desta bateria pareciam
  resolvidos e não estavam: o envio de WhatsApp respondia sucesso sem entregar, e
  o alerta do Sentry disparava para ninguém.
