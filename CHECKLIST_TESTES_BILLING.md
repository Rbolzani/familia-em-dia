# Checklist de Testes — Billing / Assinaturas

**Atualizado:** 2026-06-22
**Ambiente:** dev (Stripe test mode, Supabase `fawsbgxmrbpgcnlhjoao`)
**Contas de teste:** rogerbolzani (owner) · rbolzanic (parceiro)

> Legenda: ✅ ok · ⏳ pendente · 🔜 próximo

---

## A) Plano Gratuito — restrições
- ✅ Até 2 filhos
- ✅ IA limitada (5 usos/mês)
- ✅ Sem entrada por voz
- ✅ Sem resumo diário no WhatsApp
- ✅ Sem compartilhamento com parceiro

## B) Checkout e ativação
- ✅ Checkout com cartão de teste → plano Família ativa
- ✅ Libera IA ilimitada, voz, WhatsApp e compartilhamento
- ✅ Trial de 14 dias só para conta nova (server-enforced)
- ✅ **Sem trial após os primeiros 14 dias, em nenhuma hipótese** (decisão no servidor, não no cliente)
- ✅ Rótulo do botão correto: "Mudar para X" para quem já é pagante (não "Começar grátis…")

## C) Cancelamento e reativação
- ✅ Cancelar dentro do app cancela de verdade no Stripe (não só rótulo)
- ✅ Formulário de motivo do cancelamento → gravado no Stripe (`cancellation_details`)
- ✅ Reativação antes do fim do período
- ✅ Cancelamento desabilitado no portal Stripe (evita botão duplicado)
- ✅ Reconciliação on-page-load (robusto a webhook perdido)

## D) Upgrade / Downgrade
- ✅ Upgrade Família → Plus vai ao checkout/modificação com proration
- ✅ Downgrade Plus → Família com proration (créditos explicados)
- ✅ **Plano anual (−20%)**: troca mensal↔anual sem pedir cartão; toggle abre no intervalo atual; preço R$31,90/mês (R$382,80/ano)

## E) Compartilhamento e herança de plano
- ✅ Isolamento entre famílias (item 30)
- ✅ Parceiro herda o plano do owner (`getEffectiveSubscription` / `get_family_plan`)
- ✅ Parceiro não vê trial/plano próprios — reflete o do owner
- ✅ Banner do parceiro com texto correto ("você terá 5 dias…")
- ✅ Plano atualiza em tempo real para o parceiro (realtime em `subscriptions`)
- ✅ Parceiro não pode gerenciar/contratar plano (cards e notas de rodapé ocultos)

## F) Grace period (owner → grátis com parceiro conectado)
- ✅ Grace de 5 dias iniciado em qualquer transição pago/trial → grátis
  (corrigido em `stripe-sync.ts`; antes só existia para expiração de trial)
- ✅ Banner de grace para owner ("parceiro será desconectado em N dias")
- ✅ Banner de grace para parceiro ("você será desconectado em N dias")
- ✅ **Após o grace**: cron `expire-trials` Fase 2 remove o parceiro de `family_members`
- ✅ Fichas de logística do ex-parceiro **permanecem** para o owner
- ✅ **Slot órfão editável**: owner pode reatribuir/liberar chip deixado pelo
  ex-parceiro (corrigido em `LogChip.tsx` — antes travava para sempre)

## G) Notificações de grace via WhatsApp
- ✅ Mensagem do owner ("seu parceiro será desconectado em N dias")
- ✅ Mensagem do parceiro ("sua conexão será encerrada em N dias")
- ✅ Aviso de grace é enviado **mesmo sem atividades** no período
  (corrigido `buildDailySummary`: o early-return só ocorre quando não há
  atividades **nem** aviso de grace)
- ⏳ Entrega real ao vivo — depende de credenciais WhatsApp (ver produção)

## H) Produção (pré-lançamento)
- ⏳ Deploy: variáveis Stripe na Vercel + webhook de produção
- ⏳ WhatsApp: configurar credenciais (Twilio sandbox p/ teste OU Meta Cloud
  API com template aprovado) — sem isso o envio falha com
  "WHATSAPP_TOKEN/WHATSAPP_PHONE_ID não configurados"

---

## Modelo com cartão (nova oferta, contas `oferta = 'v2'`) — testado em 20–21/10/2026
Stripe sandbox + banco de produção (dados de teste apagados ao final). O modelo novo só vale para quem cria a conta pela tela nova (`oferta: 'v2'` nos metadados), então dá para testar sem afetar contas reais.

- ✅ Cadastro com CPF → Checkout mostra "14 dias grátis, R$ 0,00 hoje" → app em teste no plano escolhido
- ✅ Saiu antes do cartão → conta `incompleto`, layout manda para `/assinar` (T7)
- ✅ Mesmo cartão em segunda conta → assinatura cancelada na hora, tela T5 "Assinar sem teste", nada cobrado
- ✅ CPF repetido recusado (T6)
- ✅ Básico: cadeado + caixa de upgrade em logística, voz, WhatsApp, rede de apoio, 3º filho, 16º reconhecimento (limite de 15 desde 21/10/2026), cofre acima de 200 MB
- ✅ Troca de plano no teste mantém o fim do teste; nova primeira cobrança no valor do plano novo
- ✅ Downgrade bloqueado quando filhos/rede passam do limite do plano de destino (T14)
- ✅ Cancelar no teste: motivo obrigatório, T13, motivo gravado no Stripe, acesso até o fim do teste
- ✅ Cartão recusado → `past_due`, banner com prazo; aviso do 5º dia; pausa no 7º dia; cartão atualizado → volta a `active`
- ✅ Conta pausada: dono e convidados só visualizam (bloqueio no banco, `familia_pode_editar`); reativação devolve o nível anterior do convidado
- ✅ Exclusão: aviso de 30 dias; exclusão no dia 90 cancela o Stripe e grava o registro anônimo
- ✅ Conta do modelo antigo continua com banner antigo, gratuito ao fim do teste e consegue assinar
- ⏳ E-mails e WhatsApp do modelo novo (sem chaves no ambiente local) — conferir em produção depois da virada
- ⏳ Arrependimento só para quem contratou sem teste (reembolso em até 7 dias da cobrança) — conferir no sandbox
