# Rotação de segredos — procedimento

Item **Q5** do plano de testes. Existe porque já houve incidente: o
`CRON_SECRET` foi trocado na Vercel e o agendador externo continuou mandando o
antigo. Todas as chamadas passaram a voltar **401**, o resumo diário parou de
ser enviado — **e ninguém percebeu**, porque a falha era silenciosa.

A lição está na estrutura deste documento: **um segredo quase nunca mora num
lugar só.** Trocar sem atualizar a outra ponta é o que derruba o serviço.

---

## Regra geral

1. **Gere o novo antes de invalidar o antigo.** Onde o provedor permite duas
   chaves ativas (Stripe, Supabase, Resend), crie a nova, atualize todos os
   consumidores, confirme que funciona, e só então revogue a velha.
2. **Atualize TODOS os consumidores** da tabela abaixo antes de revogar.
3. **Verifique**, com o comando indicado. Não confie em "deve estar funcionando".
4. **Anote a data** na última coluna.

`NEXT_PUBLIC_*` congela no **build**: mudar exige **redeploy**, não basta salvar
a variável na Vercel.

---

## Onde cada segredo vive

| Segredo | Onde é usado | Onde mais precisa ser atualizado | Como verificar |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel (rotas de API) | `.env.local` de cada máquina de desenvolvimento | Abrir `/configuracoes` — a lista de parceiros usa o admin client |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Bundle do navegador | `.env.local` · **exige redeploy** | Fazer login em janela anônima |
| Senha do banco (Postgres) | `pg_dump`, ferramentas externas | qualquer conexão por *connection string* | `pg_dump --schema-only` |
| `ANTHROPIC_API_KEY` | Vercel | `.env.local` | Captura por IA em `/ia` |
| `GROQ_API_KEY` | Vercel | `.env.local` | Botão de voz em `/ia` |
| `STRIPE_SECRET_KEY` | Vercel | `.env.local` | Abrir `/planos` (reconcilia com o Stripe ao carregar) |
| `STRIPE_WEBHOOK_SECRET` | Vercel | **painel do Stripe** — é gerado por endpoint | Reenviar um evento pelo painel do Stripe |
| `CRON_SECRET` | Vercel | **cron-job.org**, aba *Advanced*, header `Authorization: Bearer …` | `curl` abaixo — tem que voltar **200** |
| `WHATSAPP_TOKEN` | Vercel | — (token permanente da Meta) | "Enviar teste" em `/alertas` |
| API key do **Resend** | **Supabase → Auth → SMTP** | **Gmail**, em "Enviar como" de `dpo@` e `suporte@` | Pedir redefinição de senha e ver se o e-mail chega |
| `NEXT_PUBLIC_SENTRY_DSN` | Bundle do navegador | **exige redeploy** | Console sem erro de CSP; evento aparece no Sentry |

> **Os dois que já mordem:** `CRON_SECRET` (a outra ponta é um site externo,
> fácil de esquecer) e a key do **Resend** (mora em dois lugares, nenhum deles
> na Vercel — Supabase e Gmail).

---

## Verificação do CRON_SECRET

Depois de trocar na Vercel **e** no cron-job.org:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://www.familiaemdia.com.br/api/whatsapp-daily -H "Authorization: Bearer NOVO_SEGREDO"
```

- **200** → as duas pontas batem.
- **401** → uma das pontas ficou para trás. Foi exatamente este o incidente.

Use o domínio **com `www`**: o apex responde 308 e o `curl` sem `-L` mostraria
o redirecionamento em vez do resultado real.

---

## Quando rotacionar

- **Imediatamente:** segredo em print, em mensagem, em commit, ou em log; saída
  de alguém com acesso; suspeita de comprometimento.
- **Programado:** a cada 12 meses, ou conforme o provedor exigir.

Se um segredo foi commitado, **trocar é obrigatório** — o histórico do git
guarda o valor mesmo depois do commit que o remove.

---

## Registro de rotações

| Data | Segredo | Motivo | Quem |
|---|---|---|---|
| 2026-08-?? | `CRON_SECRET` | rotação de rotina | Rogério |
