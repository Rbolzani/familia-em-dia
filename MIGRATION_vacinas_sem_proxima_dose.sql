-- Remove o campo `proxima_dose` das entradas de vacina.
--
-- PROBLEMA: o prompt do OCR pedia "proxima_dose" sem explicar o que era.
-- Comprovantes de vacinação NÃO agendam doses futuras — registram apenas o
-- que foi aplicado. Diante de um cartão com 1ª e 2ª dose, o modelo copiava a
-- data da 2ª dose como "proxima_dose" da 1ª, transformando histórico em
-- agendamento. O app então anunciava "dose vencida há 1590 dias" sobre uma
-- dose que havia sido tomada — 100% dos alertas de vacina eram falsos.
--
-- Vacina passa a ter só HISTÓRICO (nome, dose, data_aplicacao). Dose faltante
-- vira lembrete sem data no mural, via metadata.doses_pendentes.
UPDATE documents d
SET metadata = jsonb_set(
      d.metadata,
      '{vacinas}',
      (SELECT coalesce(jsonb_agg(x - 'proxima_dose' ORDER BY ord), '[]'::jsonb)
       FROM jsonb_array_elements(d.metadata->'vacinas') WITH ORDINALITY t(x, ord))
    )
WHERE d.doc_type = 'vacinacao'
  AND d.metadata->'vacinas' IS NOT NULL
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(d.metadata->'vacinas') y
              WHERE y ? 'proxima_dose');
