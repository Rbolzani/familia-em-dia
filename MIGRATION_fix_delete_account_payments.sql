-- ============================================================
-- CORREÇÃO — exclusão de conta apagava as mensalidades da família
-- Projeto fawsbgxmrbpgcnlhjoao · 2026-08-30
-- ============================================================
--
-- ACHADO (perda de dados, não segurança)
-- Quando o dono exclui a conta e HÁ um parceiro, `delete_my_account()`
-- transfere a titularidade das linhas dele para o novo dono:
--     activities · documents · children · document_files
-- `payments` não estava na lista. E a constraint é:
--     payments_user_id_fkey  FOREIGN KEY (user_id)
--       REFERENCES auth.users(id) ON DELETE CASCADE
-- Ou seja: no passo final da rota, `admin.auth.admin.deleteUser()` apagava o
-- auth.users e o CASCADE levava junto TODAS as mensalidades da família —
-- com `payment_marks` cascateando atrás (payment_marks_payment_id_fkey também
-- é CASCADE). O parceiro que ficava perdia o módulo inteiro, sem aviso e sem
-- ter feito nada.
--
-- O mesmo buraco existia no bloco das famílias onde o usuário era PARCEIRO
-- (não dono), que devolve as linhas ao dono da família.
--
-- CORREÇÃO
-- `payments` acrescentado às duas transferências. No ramo da família solo os
-- DELETEs explícitos de payments/payment_marks foram adicionados por clareza —
-- o CASCADE de `families` já daria conta, mas depender de cascata implícita
-- foi justamente o que escondeu este bug.
--
-- VALIDADO em transação com rollback: família com 6 mensalidades e um
-- parceiro; após delete_my_account(), 6 de 6 transferidas ao parceiro e
-- ZERO restando com o usuário que sai — logo o CASCADE não tem mais o que
-- levar.
--
-- (A limpeza do bucket `avatars` na exclusão de conta foi feita na rota
--  src/app/api/account/delete/route.ts, não aqui — Storage não é tabela.)

create or replace function public.delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path to 'public','auth'
as $function$
DECLARE
  p_uid        uuid := auth.uid();
  v_fam        RECORD;
  v_new_owner  uuid;
  v_user_email text;
BEGIN
  IF p_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = p_uid;

  FOR v_fam IN SELECT id FROM families WHERE created_by = p_uid LOOP
    SELECT user_id INTO v_new_owner
    FROM family_members
    WHERE family_id = v_fam.id AND user_id != p_uid
    ORDER BY joined_at ASC LIMIT 1;

    IF v_new_owner IS NOT NULL THEN
      UPDATE families SET created_by = v_new_owner WHERE id = v_fam.id;
      UPDATE family_members SET role = 'owner', access_role = 'full_editor'
        WHERE family_id = v_fam.id AND user_id = v_new_owner;
      UPDATE activities    SET user_id = v_new_owner WHERE family_id = v_fam.id AND user_id = p_uid;
      UPDATE documents     SET user_id = v_new_owner WHERE family_id = v_fam.id AND user_id = p_uid;
      UPDATE children      SET user_id = v_new_owner WHERE family_id = v_fam.id AND user_id = p_uid;
      UPDATE document_files SET user_id = v_new_owner WHERE family_id = v_fam.id AND user_id = p_uid;
      UPDATE payments      SET user_id = v_new_owner WHERE family_id = v_fam.id AND user_id = p_uid;
      UPDATE activities SET takes_user_id = NULL WHERE family_id = v_fam.id AND takes_user_id = p_uid;
      UPDATE activities SET picks_user_id = NULL WHERE family_id = v_fam.id AND picks_user_id = p_uid;
      DELETE FROM family_members WHERE family_id = v_fam.id AND user_id = p_uid;
    ELSE
      DELETE FROM payment_marks  WHERE family_id = v_fam.id;
      DELETE FROM payments       WHERE family_id = v_fam.id;
      DELETE FROM document_files WHERE family_id = v_fam.id;
      DELETE FROM documents      WHERE family_id = v_fam.id;
      DELETE FROM activities     WHERE family_id = v_fam.id;
      DELETE FROM children       WHERE family_id = v_fam.id;
      DELETE FROM family_invites WHERE family_id = v_fam.id;
      DELETE FROM family_members WHERE family_id = v_fam.id;
      DELETE FROM families       WHERE id = v_fam.id;
    END IF;
  END LOOP;

  UPDATE activities SET takes_user_id = NULL WHERE takes_user_id = p_uid;
  UPDATE activities SET picks_user_id = NULL WHERE picks_user_id = p_uid;

  UPDATE activities a
    SET user_id = (SELECT created_by FROM families f WHERE f.id = a.family_id)
    WHERE a.user_id = p_uid;
  UPDATE documents d
    SET user_id = (SELECT created_by FROM families f WHERE f.id = d.family_id)
    WHERE d.user_id = p_uid;
  UPDATE children c
    SET user_id = (SELECT created_by FROM families f WHERE f.id = c.family_id)
    WHERE c.user_id = p_uid;
  UPDATE document_files df
    SET user_id = (SELECT created_by FROM families f WHERE f.id = df.family_id)
    WHERE df.user_id = p_uid;
  UPDATE payments p
    SET user_id = (SELECT created_by FROM families f WHERE f.id = p.family_id)
    WHERE p.user_id = p_uid;

  DELETE FROM family_members        WHERE user_id     = p_uid;
  DELETE FROM family_invites        WHERE invited_by  = p_uid;
  DELETE FROM logistics_suggestions WHERE proposed_by = p_uid OR proposed_to = p_uid;
  DELETE FROM ai_inputs             WHERE user_id     = p_uid;
  DELETE FROM app_notifications     WHERE user_id     = p_uid;
  DELETE FROM profiles              WHERE user_id     = p_uid;
  DELETE FROM notification_settings WHERE user_id     = p_uid;

  IF v_user_email IS NOT NULL THEN
    UPDATE family_invites SET invited_email = NULL WHERE invited_email = v_user_email;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$function$;
