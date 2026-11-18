-- Base do banco: o ponto de partida do sistema. Deixe este arquivo como está;
-- toda mudança no banco entra como migração nova (ver AGENTS.md).
--
-- Extensões que o sistema usa e que um projeto novo do Supabase não traz ligadas.
--   pg_cron  : agendador (chama o app de tempos em tempos)
--   pg_net   : faz a chamada HTTP do agendador para o app
--   unaccent : busca sem acento (fornecedores, descrições)
-- O cofre (vault) já vem ligado em todo projeto novo.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;


--
-- PostgreSQL database dump
--



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: ajustar_mes_recorrencia(uuid, uuid, date, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ajustar_mes_recorrencia(_owner uuid, _recorrencia_id uuid, _competencia date, _novo_valor numeric) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  afetadas int := 0;
  mescomp date;
  v_owner uuid := public.team_owner();
BEGIN
  PERFORM 1 FROM public.payable_recurrences WHERE id = _recorrencia_id AND public.is_team_owner(owner_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Recorrência não encontrada'; END IF;

  mescomp := date_trunc('month', _competencia)::date;

  UPDATE public.payable_notes n
  SET valor_total = _novo_valor
  WHERE n.recorrencia_id = _recorrencia_id AND n.owner_id = v_owner
    AND n.competencia_mes = mescomp
    AND EXISTS (
      SELECT 1 FROM public.payable_installments pi
      WHERE pi.note_id = n.id AND pi.status='aberta' AND pi.planilha_lancado=false
    );

  UPDATE public.payable_installments pi
  SET valor = _novo_valor
  FROM public.payable_notes n
  WHERE pi.note_id = n.id AND n.recorrencia_id = _recorrencia_id AND n.owner_id = v_owner
    AND n.competencia_mes = mescomp AND pi.status='aberta' AND pi.planilha_lancado=false;

  GET DIAGNOSTICS afetadas = ROW_COUNT;
  RETURN afetadas;
END;
$$;


--
-- Name: anuncios_margem(uuid[], date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.anuncios_margem(_account_ids uuid[], _from date, _to date) RETURNS TABLE(account_id uuid, item_id text, titulo text, seller_sku text, thumbnail text, permalink text, preco_atual numeric, status text, unidades bigint, receita numeric, comissao numeric, frete numeric, devolucao numeric, ads numeric, imposto numeric, cmv numeric, custo_unit numeric, is_kit boolean, custo_faltando boolean, componentes_sem_custo integer, margem numeric, pedidos_ok bigint, pedidos_problema bigint, unidades_canceladas bigint, valor_perdido numeric, frete_rateado numeric, parcelamento numeric, valor_produto numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH owner AS (SELECT public.team_owner() AS oid),
  permitidas AS (SELECT unnest(public.contas_permitidas(_account_ids)) AS id),
  adsp AS (SELECT * FROM public.ml_ads_periodo(_account_ids, _from, _to)),
  r AS (SELECT * FROM public.mp_reconciliation(public.contas_permitidas(_account_ids), _from, _to)),
  itens AS (
    SELECT r.account_id, r.order_id, oi.item_id, oi.seller_sku, oi.quantity, oi.unit_price,
           r.receita, r.fee_comissao, r.fee_cobranca, r.fee_outros, r.fee_parcelamento, r.fee_frete,
           r.imposto, r.cmv, r.cmv_missing,
           COALESCE((oi.unit_price * oi.quantity) / NULLIF(sum(oi.unit_price * oi.quantity) OVER (PARTITION BY o.id), 0),
                    1.0 / count(*) OVER (PARTITION BY o.id)) AS share
    FROM r
    JOIN public.ml_orders o ON o.account_id = r.account_id AND o.order_id = r.order_id
    JOIN public.ml_order_items oi ON oi.order_ref = o.id
  ),
  vendas AS (
    SELECT i.account_id, i.item_id, max(i.seller_sku) AS seller_sku,
           sum(i.quantity)::bigint AS unidades,
           sum(i.unit_price * i.quantity)::numeric AS valor_produto,
           sum(i.receita * i.share)::numeric AS receita,
           sum((i.fee_comissao + i.fee_cobranca + i.fee_outros + i.fee_parcelamento) * i.share)::numeric AS comissao,
           sum(i.fee_frete * i.share)::numeric AS frete,
           sum(i.fee_parcelamento * i.share)::numeric AS parcelamento,
           sum(i.imposto * i.share)::numeric AS imposto,
           sum(i.cmv * i.share)::numeric AS cmv,
           bool_or(i.cmv_missing) AS cmv_missing,
           count(DISTINCT i.order_id)::bigint AS pedidos_ok
    FROM itens i GROUP BY 1, 2
  ),
  perdas AS (
    SELECT oi.account_id, oi.item_id,
           count(DISTINCT o.id)::bigint AS pedidos_problema,
           sum(CASE WHEN o.status='cancelled' THEN oi.quantity ELSE 0 END)::bigint AS unidades_canceladas,
           sum(CASE WHEN o.status='cancelled' THEN oi.unit_price*oi.quantity ELSE 0 END)::numeric AS valor_perdido
    FROM public.ml_order_items oi JOIN public.ml_orders o ON o.id = oi.order_ref
    WHERE oi.account_id IN (SELECT id FROM permitidas)
      AND (o.date_created AT TIME ZONE 'America/Sao_Paulo')::date >= _from
      AND (o.date_created AT TIME ZONE 'America/Sao_Paulo')::date <= _to
      AND o.status = 'cancelled'
    GROUP BY 1,2
  ),
  ads AS (
    SELECT a.account_id, a.item_id, (sum(a.cost) * COALESCE(ap.fator,1))::numeric AS ads
    FROM public.ml_ads_daily a
    LEFT JOIN adsp ap ON ap.account_id = a.account_id
    WHERE a.account_id IN (SELECT id FROM permitidas) AND a.date >= _from AND a.date <= _to
    GROUP BY a.account_id, a.item_id, ap.fator
  ),
  custo_periodo AS (
    SELECT b.account_id, sum(b.valor)::numeric AS valor
    FROM public.ml_billing_norm b
    WHERE b.account_id IN (SELECT id FROM permitidas)
      AND b.escopo='periodo' AND b.conta_no_custo AND b.category <> 'ads'
      AND (b.transaction_date AT TIME ZONE 'America/Sao_Paulo')::date >= _from
      AND (b.transaction_date AT TIME ZONE 'America/Sao_Paulo')::date <= _to
    GROUP BY 1
  ),
  receita_conta AS (SELECT v.account_id, sum(v.receita)::numeric AS receita_total FROM vendas v GROUP BY 1),
  custo_sku AS (
    SELECT ps.sku, ps.is_kit,
           CASE WHEN ps.is_kit THEN (
             SELECT COALESCE(SUM(cps.custo_base * kc.quantity),0) FROM public.kit_components kc
             LEFT JOIN public.product_skus cps ON cps.owner_id = ps.owner_id AND cps.sku = kc.component_sku
             WHERE kc.owner_id = ps.owner_id AND kc.kit_sku = ps.sku
           ) ELSE COALESCE(ps.custo_base,0) END AS custo_unit,
           CASE WHEN ps.is_kit THEN (
             SELECT count(*) FILTER (WHERE cps.custo_base IS NULL OR cps.custo_base = 0)
             FROM public.kit_components kc
             LEFT JOIN public.product_skus cps ON cps.owner_id = ps.owner_id AND cps.sku = kc.component_sku
             WHERE kc.owner_id = ps.owner_id AND kc.kit_sku = ps.sku
           ) ELSE (CASE WHEN COALESCE(ps.custo_base,0)=0 THEN 1 ELSE 0 END) END AS faltando_cnt
    FROM public.product_skus ps WHERE ps.owner_id = (SELECT oid FROM owner)
  ),
  calc AS (
    SELECT v.account_id, v.item_id, COALESCE(it.title, v.item_id) AS titulo,
      v.seller_sku, it.thumbnail, it.permalink, it.price AS preco_atual, it.status, v.unidades, v.valor_produto,
      v.receita, v.comissao, v.frete, 0::numeric AS devolucao, v.parcelamento,
      COALESCE(ad.ads,0) AS ads, v.imposto, v.cmv,
      cs.custo_unit, COALESCE(cs.is_kit,false) AS is_kit,
      v.cmv_missing AS custo_faltando,
      COALESCE(cs.faltando_cnt,0)::integer AS componentes_sem_custo, v.pedidos_ok,
      COALESCE(pe.pedidos_problema,0) AS pedidos_problema,
      COALESCE(pe.unidades_canceladas,0) AS unidades_canceladas,
      COALESCE(pe.valor_perdido,0) AS valor_perdido,
      (CASE WHEN COALESCE(rc.receita_total,0) > 0
            THEN COALESCE(cp.valor,0) * (v.receita / rc.receita_total) ELSE 0 END)::numeric AS frete_rateado
    FROM vendas v
    LEFT JOIN public.ml_items it ON it.account_id = v.account_id AND it.item_id = v.item_id
    LEFT JOIN ads ad ON ad.account_id = v.account_id AND ad.item_id = v.item_id
    LEFT JOIN perdas pe ON pe.account_id = v.account_id AND pe.item_id = v.item_id
    LEFT JOIN custo_sku cs ON cs.sku = btrim(v.seller_sku)
    LEFT JOIN receita_conta rc ON rc.account_id = v.account_id
    LEFT JOIN custo_periodo cp ON cp.account_id = v.account_id
  )
  SELECT c.account_id, c.item_id, c.titulo, c.seller_sku, c.thumbnail, c.permalink,
    c.preco_atual, c.status, c.unidades, c.receita, c.comissao, c.frete, c.devolucao,
    c.ads, c.imposto, c.cmv, c.custo_unit, c.is_kit, c.custo_faltando, c.componentes_sem_custo,
    (c.receita - c.comissao - c.frete - c.frete_rateado - c.ads - c.imposto - c.cmv) AS margem,
    c.pedidos_ok, c.pedidos_problema, c.unidades_canceladas, c.valor_perdido, c.frete_rateado, c.parcelamento, c.valor_produto
  FROM calc c ORDER BY c.receita DESC;
$$;


--
-- Name: FUNCTION anuncios_margem(_account_ids uuid[], _from date, _to date); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.anuncios_margem(_account_ids uuid[], _from date, _to date) IS 'Regime de competencia. parcelamento (CFONPN) e informativo e NAO entra na margem: e repasse do acrescimo pago pelo comprador, que tambem nao esta na receita.';


--
-- Name: aplicar_seguranca_rpc(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.aplicar_seguranca_rpc() RETURNS TABLE(acao text, quantidade integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare r record; n_fechadas int := 0; n_vault int := 0;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and p.prosecdef
      and p.prorettype <> 'trigger'::regtype
      and p.proname not in ('vault_get_secret','vault_set_secret')
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    execute format('revoke execute on function %s from public, anon', r.fn);
    execute format('grant execute on function %s to authenticated, service_role', r.fn);
    n_fechadas := n_fechadas + 1;
  end loop;

  for r in
    select p.oid::regprocedure as fn
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname='public' and p.proname in ('vault_get_secret','vault_set_secret')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.fn);
    execute format('grant execute on function %s to service_role', r.fn);
    n_vault := n_vault + 1;
  end loop;

  return query
  select 'Funcoes fechadas para acesso anonimo'::text, n_fechadas
  union all select 'Funcoes do cofre restritas ao servidor'::text, n_vault
  union all select 'Ainda abertas ao anonimo (deve ser zero)'::text,
    (select count(*)::int from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
     where ns.nspname='public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
       and has_function_privilege('anon', p.oid,'EXECUTE'));
end;
$$;


--
-- Name: atualizar_valor_recorrencia(uuid, uuid, numeric, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.atualizar_valor_recorrencia(_owner uuid, _recorrencia_id uuid, _novo_valor numeric, _a_partir_de date) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  afetadas int := 0;
  m0 date;
  v_owner uuid := public.team_owner();
BEGIN
  PERFORM 1 FROM public.payable_recurrences WHERE id = _recorrencia_id AND public.is_team_owner(owner_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Recorrência não encontrada'; END IF;

  m0 := date_trunc('month', _a_partir_de)::date;

  UPDATE public.payable_recurrences SET valor = _novo_valor, updated_at = now()
  WHERE id = _recorrencia_id;

  UPDATE public.payable_notes n
  SET valor_total = _novo_valor
  WHERE n.recorrencia_id = _recorrencia_id AND n.owner_id = v_owner
    AND n.competencia_mes >= m0
    AND EXISTS (
      SELECT 1 FROM public.payable_installments pi
      WHERE pi.note_id = n.id AND pi.status = 'aberta' AND pi.planilha_lancado = false
    );

  UPDATE public.payable_installments pi
  SET valor = _novo_valor
  FROM public.payable_notes n
  WHERE pi.note_id = n.id AND n.recorrencia_id = _recorrencia_id AND n.owner_id = v_owner
    AND n.competencia_mes >= m0 AND pi.status = 'aberta' AND pi.planilha_lancado = false;

  GET DIAGNOSTICS afetadas = ROW_COUNT;
  RETURN afetadas;
END;
$$;


--
-- Name: audit_null_sale_fee(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_null_sale_fee(_account_id uuid, _from date) RETURNS bigint
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT count(*)::bigint FROM public.ml_order_items i
  JOIN public.ml_orders o ON o.id = i.order_ref
  WHERE i.account_id = _account_id
    AND (auth.role() = 'service_role' OR public.owns_account(_account_id))
    AND i.sale_fee IS NULL
    AND o.status IN ('paid','delivered','partially_refunded')
    AND (o.date_created AT TIME ZONE 'America/Sao_Paulo')::date >= _from;
$$;


--
-- Name: audit_orders_without_items(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_orders_without_items(_account_id uuid, _from date) RETURNS bigint
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT count(*)::bigint FROM public.ml_orders o
  WHERE o.account_id = _account_id
    AND (auth.role() = 'service_role' OR public.owns_account(_account_id))
    AND o.status IN ('paid','delivered','partially_refunded')
    AND (o.date_created AT TIME ZONE 'America/Sao_Paulo')::date >= _from
    AND NOT EXISTS (SELECT 1 FROM public.ml_order_items i WHERE i.order_ref = o.id);
$$;


--
-- Name: audit_recheck_billing(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_recheck_billing() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  f RECORD;
  v_period text;
  v_actual bigint;
  v_resolved integer := 0;
BEGIN
  FOR f IN
    SELECT id, account_id, expected, context
    FROM public.audit_findings
    WHERE check_code = 'billing_completeness'
      AND status IN ('aberto', 'corrigindo')
      AND account_id IS NOT NULL
  LOOP
    v_period := f.context->>'period_key';
    IF v_period IS NULL THEN
      CONTINUE;
    END IF;

    -- Sem a cópia que o ML passou a listar num período mais novo (sync-07, como as telas).
    v_actual := public.billing_lancamentos_no_periodo(f.account_id, v_period);

    IF f.expected IS NOT NULL AND v_actual >= f.expected THEN
      UPDATE public.audit_findings
      SET actual = v_actual,
          diff = COALESCE(expected, 0) - v_actual,
          status = 'resolvido',
          resolved_at = now(),
          updated_at = now()
      WHERE id = f.id;
      v_resolved := v_resolved + 1;
    ELSE
      UPDATE public.audit_findings
      SET actual = v_actual,
          diff = COALESCE(expected, 0) - v_actual,
          updated_at = now()
      WHERE id = f.id;
    END IF;
  END LOOP;

  RETURN v_resolved;
END;
$$;


--
-- Name: audit_seguranca_rpc(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_seguranca_rpc() RETURNS TABLE(severidade text, funcao text, args text, problema text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  -- 1) SECURITY DEFINER executavel por anon: fura RLS sem nenhuma sessao
  select 'CRITICO'::text, p.proname::text, pg_get_function_identity_arguments(p.oid),
         'SECURITY DEFINER executavel por anon: qualquer um com a chave publica chama'::text
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
    and has_function_privilege('anon', p.oid, 'EXECUTE')
  union all
  -- 2) recebe conta/dono por parametro e nao confere quem chama
  select 'ISOLAMENTO'::text, p.proname::text, pg_get_function_identity_arguments(p.oid),
         'Recebe conta ou dono por parametro sem validar o chamador: so seguro enquanto houver um unico time'::text
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
    and pg_get_function_identity_arguments(p.oid) ~ '_owner|_account'
    and pg_get_functiondef(p.oid) !~ 'team_owner\(\)|owns_account\(|auth\.uid\(\)|is_admin\(\)|contas_permitidas\('
  order by 1, 2;
$$;


--
-- Name: FUNCTION audit_seguranca_rpc(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.audit_seguranca_rpc() IS 'Vigilancia de seguranca das RPCs. CRITICO deve ser sempre zero. ISOLAMENTO e aceitavel enquanto existir um unico time (account_members com um root_owner_id); no dia que entrar um segundo time, cada funcao listada precisa passar a validar o chamador com contas_permitidas() ou team_owner().';


--
-- Name: audit_unclassified_subtypes(uuid, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_unclassified_subtypes(_account_id uuid, _from date, _to date) RETURNS TABLE(sub_type text, detail_type text, concept text, sum_amount numeric, cnt bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    COALESCE(b.detail_sub_type, '[sem sub_type: ' || COALESCE(b.detail_type, '') || ']') AS sub_type,
    b.detail_type,
    max(b.concept) AS concept,
    sum(abs(b.amount))::numeric AS sum_amount,
    count(*)::bigint AS cnt
  FROM ml_billing_details b
  LEFT JOIN billing_subtype_map m ON m.sub_type = b.detail_sub_type
  WHERE b.account_id = _account_id
    AND b.transaction_date IS NOT NULL
    AND (b.transaction_date AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN _from AND _to
    AND m.sub_type IS NULL
    -- classificados por padrão (não geram alerta)
    AND NOT (b.detail_type = 'BONUS' OR (b.detail_sub_type IS NOT NULL AND b.detail_sub_type LIKE 'B%'))
    AND (b.detail_sub_type IS NULL OR b.detail_sub_type NOT LIKE 'CVV%')
    AND upper(coalesce(b.marketplace,'')) NOT IN ('SHIPPING','SHIPPING_FULL','MCLICS')
  GROUP BY 1, b.detail_type;
$$;


--
-- Name: backfill_item_skus(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.backfill_item_skus() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE affected integer;
BEGIN
  WITH sku_por_item AS (
    SELECT DISTINCT ON (account_id, item_id)
      account_id, item_id, seller_sku
    FROM ml_order_items
    WHERE seller_sku IS NOT NULL
    ORDER BY account_id, item_id, id DESC
  )
  UPDATE ml_items i
  SET seller_sku = s.seller_sku
  FROM sku_por_item s
  WHERE i.account_id = s.account_id
    AND i.item_id = s.item_id
    AND i.seller_sku IS NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;


--
-- Name: backfill_items_from_orders(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.backfill_items_from_orders() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE affected integer;
BEGIN
  WITH src AS (
    SELECT DISTINCT ON (oi.account_id, oi.item_id)
      oi.account_id, oi.item_id, oi.title, oi.seller_sku
    FROM ml_order_items oi
    ORDER BY oi.account_id, oi.item_id, oi.id DESC
  )
  INSERT INTO ml_items (account_id, item_id, title, seller_sku, status, synced_at)
  SELECT s.account_id, s.item_id, COALESCE(s.title, s.item_id), s.seller_sku, 'desconhecido', now()
  FROM src s
  WHERE NOT EXISTS (
    SELECT 1 FROM ml_items i
    WHERE i.account_id = s.account_id AND i.item_id = s.item_id
  )
  ON CONFLICT (account_id, item_id) DO NOTHING;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;


--
-- Name: billing_lancamentos_no_periodo(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.billing_lancamentos_no_periodo(_account_id uuid, _period_key text) RETURNS bigint
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select count(*) from ml_billing_details b
   where b.account_id = _account_id and b.period_key = _period_key
     and not exists (select 1 from ml_billing_details n
                      where n.account_id = b.account_id and n.billing_group = b.billing_group
                        and n.detail_id = b.detail_id and n.period_key > b.period_key);
$$;


--
-- Name: billing_max_detail_id(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.billing_max_detail_id(_account_id uuid, _period_key text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
  SELECT max(detail_id::bigint)::text
  FROM public.ml_billing_details
  WHERE account_id = _account_id
    AND period_key = _period_key
    AND detail_id ~ '^[0-9]+$';
$_$;


--
-- Name: card_invoice_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.card_invoice_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF OLD.status = 'concluida' AND current_setting('app.card_invoice_undo', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Fatura já lançada. Desfaça o lançamento antes de reimportar.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: card_invoice_items_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.card_invoice_items_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.card_invoices
             WHERE id=OLD.invoice_id AND status='concluida') THEN
    RAISE EXCEPTION 'Itens de fatura lançada não podem ser alterados. Desfaça antes.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: card_invoice_post(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.card_invoice_post(_invoice_id uuid, _decisions jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE
  v_inv public.card_invoices%ROWTYPE;
  v_item public.card_invoice_items%ROWTYPE;
  v_value public.expense_values%ROWTYPE;
  v_after public.expense_values%ROWTYPE;
  v_post public.card_invoice_postings%ROWTYPE;
  v_dec jsonb;
  v_seen uuid[] := ARRAY[]::uuid[];
  v_item_id uuid;
  v_expense_id uuid;
  v_value_amount numeric;
  v_cobrado numeric;
  v_rule_id uuid;
  v_month date;
  v_total numeric;
  v_items integer := 0;
  i integer;
BEGIN
  SELECT * INTO v_inv FROM public.card_invoices
  WHERE id=_invoice_id AND public.is_team_owner(owner_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fatura não encontrada'; END IF;
  IF v_inv.status <> 'revisao' THEN
    RAISE EXCEPTION 'Fatura já lançada. Desfaça o lançamento antes de lançar novamente.';
  END IF;
  IF v_inv.referencia !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'Mês de referência inválido';
  END IF;
  IF jsonb_typeof(_decisions) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Decisões inválidas';
  END IF;
  v_month := (v_inv.referencia || '-01')::date;

  FOR v_dec IN SELECT value FROM jsonb_array_elements(_decisions) LOOP
    v_item_id := (v_dec->>'itemId')::uuid;
    IF v_item_id = ANY(v_seen) THEN RAISE EXCEPTION 'Item repetido na confirmação'; END IF;
    v_seen := array_append(v_seen, v_item_id);
    SELECT * INTO v_item FROM public.card_invoice_items
    WHERE id=v_item_id AND invoice_id=_invoice_id AND owner_id=v_inv.owner_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item de outra fatura ou inexistente'; END IF;
    IF COALESCE((v_dec->>'ignorar')::boolean, false) OR v_dec->>'expenseId' IS NULL THEN
      CONTINUE;
    END IF;
    v_expense_id := (v_dec->>'expenseId')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.expenses
                   WHERE id=v_expense_id AND owner_id=v_inv.owner_id) THEN
      RAISE EXCEPTION 'Gasto de outro titular ou inexistente';
    END IF;

    v_cobrado := abs(v_item.valor);
    v_value_amount := CASE
      WHEN v_item.match_status='casado_valor_diferente'
           AND NOT COALESCE((v_dec->>'usarCobrado')::boolean,true)
           AND v_item.valor_previsto IS NOT NULL AND v_item.valor_previsto <> 0
      THEN abs(v_item.valor_previsto) ELSE v_cobrado END;
    INSERT INTO public.card_invoice_postings(invoice_id,expense_id,month,amount)
    VALUES (_invoice_id,v_expense_id,v_month,v_value_amount)
    ON CONFLICT (invoice_id,expense_id,month)
    DO UPDATE SET amount=public.card_invoice_postings.amount+EXCLUDED.amount;

    IF COALESCE(v_item.parcela_total,0)>COALESCE(v_item.parcela_atual,0)
       AND COALESCE(v_item.parcela_atual,0)>=1 THEN
      IF v_item.parcela_total>240 THEN RAISE EXCEPTION 'Número de parcelas inválido'; END IF;
      FOR i IN 1..v_item.parcela_total-v_item.parcela_atual LOOP
        INSERT INTO public.card_invoice_postings(invoice_id,expense_id,month,amount)
        VALUES (_invoice_id,v_expense_id,(v_month + (i || ' months')::interval)::date,v_cobrado)
        ON CONFLICT (invoice_id,expense_id,month)
        DO UPDATE SET amount=public.card_invoice_postings.amount+EXCLUDED.amount;
      END LOOP;
    END IF;

    UPDATE public.card_invoice_items
    SET match_status='confirmado', expense_id=v_expense_id WHERE id=v_item_id;
    v_items := v_items+1;
    IF COALESCE((v_dec->>'criarRegra')::boolean,false)
       AND NULLIF(v_item.descricao_normalizada,'') IS NOT NULL THEN
      INSERT INTO public.card_rules(owner_id,padrao,expense_id,match_tipo,ativo)
      VALUES (v_inv.owner_id,v_item.descricao_normalizada,v_expense_id,'contem',true)
      RETURNING id INTO v_rule_id;
      INSERT INTO public.card_invoice_posted_rules(invoice_id,rule_id)
      VALUES (_invoice_id,v_rule_id);
    END IF;
  END LOOP;

  FOR v_post IN SELECT * FROM public.card_invoice_postings
                WHERE invoice_id=_invoice_id ORDER BY expense_id,month LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_post.expense_id::text||v_post.month::text,0));
    SELECT * INTO v_value FROM public.expense_values
    WHERE expense_id=v_post.expense_id AND month=v_post.month FOR UPDATE;
    IF FOUND THEN
      UPDATE public.card_invoice_postings
      SET row_existed=true, before_amount=v_value.amount,
          before_previsto=v_value.previsto, before_tem_conta=v_value.tem_conta
      WHERE invoice_id=_invoice_id AND expense_id=v_post.expense_id AND month=v_post.month;
      UPDATE public.expense_values
      SET amount=(CASE WHEN v_value.tem_conta THEN COALESCE(v_value.previsto,0)
                       ELSE v_value.amount END)+v_post.amount, updated_at=now()
      WHERE id=v_value.id;
    ELSE
      UPDATE public.card_invoice_postings SET row_existed=false
      WHERE invoice_id=_invoice_id AND expense_id=v_post.expense_id AND month=v_post.month;
      INSERT INTO public.expense_values(owner_id,expense_id,month,amount)
      VALUES (v_inv.owner_id,v_post.expense_id,v_post.month,v_post.amount);
    END IF;
    SELECT * INTO v_after FROM public.expense_values
    WHERE expense_id=v_post.expense_id AND month=v_post.month;
    UPDATE public.card_invoice_postings
    SET after_amount=v_after.amount, after_previsto=v_after.previsto,
        after_tem_conta=v_after.tem_conta, after_updated_at=v_after.updated_at
    WHERE invoice_id=_invoice_id AND expense_id=v_post.expense_id AND month=v_post.month;
  END LOOP;

  UPDATE public.card_invoices SET status='concluida' WHERE id=_invoice_id;
  SELECT COALESCE(sum(amount),0) INTO v_total FROM public.card_invoice_postings
  WHERE invoice_id=_invoice_id;
  RETURN jsonb_build_object('totalLancado',v_total,'itens',v_items);
END;
$_$;


--
-- Name: card_invoice_undo(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.card_invoice_undo(_invoice_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_inv public.card_invoices%ROWTYPE;
  v_post public.card_invoice_postings%ROWTYPE;
  v_value public.expense_values%ROWTYPE;
BEGIN
  SELECT * INTO v_inv FROM public.card_invoices
  WHERE id=_invoice_id AND public.is_team_owner(owner_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fatura não encontrada'; END IF;
  IF v_inv.status <> 'concluida' THEN RAISE EXCEPTION 'Fatura não está lançada'; END IF;

  FOR v_post IN SELECT * FROM public.card_invoice_postings
                WHERE invoice_id=_invoice_id ORDER BY expense_id,month LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_post.expense_id::text||v_post.month::text,0));
    SELECT * INTO v_value FROM public.expense_values
    WHERE expense_id=v_post.expense_id AND month=v_post.month FOR UPDATE;
    IF NOT FOUND OR v_value.amount IS DISTINCT FROM v_post.after_amount
       OR v_value.previsto IS DISTINCT FROM v_post.after_previsto
       OR v_value.tem_conta IS DISTINCT FROM v_post.after_tem_conta
       OR v_value.updated_at IS DISTINCT FROM v_post.after_updated_at THEN
      RAISE EXCEPTION 'A planilha mudou após o lançamento. Revise o gasto e o mês antes de desfazer.';
    END IF;
    PERFORM set_config('app.planilha_sync','on',true);
    IF v_post.row_existed THEN
      UPDATE public.expense_values
      SET amount=v_post.before_amount, previsto=v_post.before_previsto,
          tem_conta=v_post.before_tem_conta, updated_at=now()
      WHERE id=v_value.id;
    ELSE
      DELETE FROM public.expense_values WHERE id=v_value.id;
    END IF;
    PERFORM set_config('app.planilha_sync','off',true);
  END LOOP;
  DELETE FROM public.card_rules WHERE id IN
    (SELECT rule_id FROM public.card_invoice_posted_rules WHERE invoice_id=_invoice_id);
  DELETE FROM public.card_invoice_posted_rules WHERE invoice_id=_invoice_id;
  DELETE FROM public.card_invoice_postings WHERE invoice_id=_invoice_id;
  PERFORM set_config('app.card_invoice_undo','on',true);
  UPDATE public.card_invoices SET status='revisao' WHERE id=_invoice_id;
  PERFORM set_config('app.card_invoice_undo','off',true);
  UPDATE public.card_invoice_items SET match_status='pendente'
  WHERE invoice_id=_invoice_id AND match_status='confirmado';
END;
$$;


--
-- Name: clear_expense_month(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clear_expense_month(_expense_id uuid, _month date) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_owner uuid;
BEGIN
  SELECT owner_id INTO v_owner FROM public.expenses WHERE id = _expense_id;
  IF v_owner IS NULL OR NOT public.is_team_owner(v_owner) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  DELETE FROM public.expense_values
   WHERE expense_id = _expense_id
     AND month = date_trunc('month', _month)::date;
END;
$$;


--
-- Name: close_previous_tax_rate(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.close_previous_tax_rate() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE v_conta uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.account_id ELSE NEW.account_id END;
BEGIN
  UPDATE public.account_tax_rates t
     SET valid_to = f.fim
    FROM (SELECT id, (lead(valid_from) OVER (ORDER BY valid_from, created_at) - 1) AS fim
            FROM public.account_tax_rates WHERE account_id = v_conta) f
   WHERE t.id = f.id AND t.valid_to IS DISTINCT FROM f.fim;
  RETURN NULL;
END;
$$;


--
-- Name: conc_caixa_futuro(uuid[], date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.conc_caixa_futuro(_account_ids uuid[], _from date, _to date) RETURNS TABLE(liberado numeric, a_liberar numeric, sem_data numeric, sem_data_qtd bigint, ate_7d numeric, de_8_a_15d numeric, mais_16d numeric, proxima_data date, proxima_valor numeric, sem_pedido numeric, sem_pedido_qtd bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE a uuid;
BEGIN
  IF _account_ids IS NULL OR array_length(_account_ids, 1) IS NULL THEN
    RETURN;
  END IF;
  FOREACH a IN ARRAY _account_ids LOOP
    IF NOT public.owns_account(a) THEN
      RAISE EXCEPTION 'Acesso negado a conta %', a;
    END IF;
  END LOOP;

  RETURN QUERY
  WITH pg AS (
    SELECT p.net_received_amount AS v, p.money_release_date AS d,
           o.id IS NULL AS orfao
    FROM public.mp_payments p
    LEFT JOIN public.ml_orders o
      ON o.account_id = p.account_id AND o.order_id = p.order_id AND o.status <> 'cancelled'
    WHERE p.account_id = ANY(_account_ids)
      AND p.status = 'approved'
      AND ((COALESCE(o.date_created, p.date_created) AT TIME ZONE 'America/Sao_Paulo')::date) BETWEEN _from AND _to
  ),
  p AS (SELECT * FROM pg WHERE NOT orfao),
  nxt AS (
    SELECT (p.d AT TIME ZONE 'America/Sao_Paulo')::date AS dia, SUM(p.v)::numeric AS v
    FROM p WHERE p.d IS NOT NULL AND p.d > now()
    GROUP BY 1 ORDER BY 1 LIMIT 1
  )
  SELECT COALESCE(SUM(p.v) FILTER (WHERE p.d IS NOT NULL AND p.d <= now()), 0)::numeric,
         COALESCE(SUM(p.v) FILTER (WHERE p.d IS NOT NULL AND p.d > now()), 0)::numeric,
         COALESCE(SUM(p.v) FILTER (WHERE p.d IS NULL), 0)::numeric,
         COUNT(*) FILTER (WHERE p.d IS NULL)::bigint,
         COALESCE(SUM(p.v) FILTER (WHERE p.d > now() AND p.d <= now() + interval '7 days'), 0)::numeric,
         COALESCE(SUM(p.v) FILTER (WHERE p.d > now() + interval '7 days' AND p.d <= now() + interval '15 days'), 0)::numeric,
         COALESCE(SUM(p.v) FILTER (WHERE p.d > now() + interval '15 days'), 0)::numeric,
         (SELECT n.dia FROM nxt n),
         (SELECT n.v FROM nxt n),
         (SELECT COALESCE(SUM(g.v),0)::numeric FROM pg g WHERE g.orfao),
         (SELECT COUNT(*)::bigint FROM pg g WHERE g.orfao)
  FROM p;
END;
$$;


--
-- Name: conc_divergencias(uuid[], date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.conc_divergencias(_account_ids uuid[], _from date, _to date) RETURNS TABLE(tarifas_canceladas numeric, pedidos_cancelados bigint, receita_cancelada numeric, tarifas_sem_venda numeric, order_ids_sem_venda bigint, vendas_sem_custo bigint, receita_sem_custo numeric, vendas_billing_pendente bigint, receita_billing_pendente numeric, sistema_tarifas numeric, ml_retido numeric, diff_tarifas numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE a uuid;
BEGIN
  IF _account_ids IS NULL OR array_length(_account_ids, 1) IS NULL THEN
    RETURN;
  END IF;
  FOREACH a IN ARRAY _account_ids LOOP
    IF NOT public.owns_account(a) THEN
      RAISE EXCEPTION 'Acesso negado a conta %', a;
    END IF;
  END LOOP;

  RETURN QUERY
  WITH canc AS (
    SELECT o.account_id, o.order_id, o.total_amount
    FROM public.ml_orders o
    WHERE o.account_id = ANY(_account_ids)
      AND ((o.date_created AT TIME ZONE 'America/Sao_Paulo')::date) BETWEEN _from AND _to
      AND o.status = 'cancelled'
  ),
  canc_fees AS (
    SELECT COALESCE(SUM(b.amount * CASE WHEN b.detail_type='BONUS' THEN -1 ELSE 1 END), 0)::numeric AS v
    FROM public.ml_billing_details b
    JOIN canc c ON c.account_id = b.account_id AND c.order_id = b.order_id
    WHERE COALESCE(b.concept_type,'') <> 'MCLICS'
  ),
  orfas AS (
    SELECT COALESCE(SUM(b.amount * CASE WHEN b.detail_type='BONUS' THEN -1 ELSE 1 END), 0)::numeric AS v,
           COUNT(DISTINCT b.order_id)::bigint AS n
    FROM public.ml_billing_details b
    WHERE b.account_id = ANY(_account_ids)
      AND b.order_id IS NOT NULL
      AND COALESCE(b.concept_type,'') <> 'MCLICS'
      AND ((b.transaction_date AT TIME ZONE 'America/Sao_Paulo')::date) BETWEEN _from AND _to
      AND NOT EXISTS (
        SELECT 1 FROM public.ml_orders o
        WHERE o.account_id = b.account_id AND o.order_id = b.order_id
      )
  ),
  r AS (SELECT * FROM public.mp_reconciliation(_account_ids, _from, _to)),
  agg AS (
    SELECT COUNT(*) FILTER (WHERE r.cmv_missing)::bigint AS sem_custo,
           COALESCE(SUM(r.receita) FILTER (WHERE r.cmv_missing), 0)::numeric AS sem_custo_rec,
           COUNT(*) FILTER (WHERE r.fees_billing_missing)::bigint AS bill_pend,
           COALESCE(SUM(r.receita) FILTER (WHERE r.fees_billing_missing), 0)::numeric AS bill_pend_rec,
           COALESCE(SUM(r.fees_billing_total), 0)::numeric AS sis,
           COALESCE(SUM(r.mp_fees) FILTER (WHERE r.match_status = 'ok'), 0)::numeric AS ml_ret
    FROM r
  )
  SELECT cf.v,
         (SELECT COUNT(*)::bigint FROM canc),
         (SELECT COALESCE(SUM(c.total_amount),0)::numeric FROM canc c),
         o.v, o.n,
         g.sem_custo, g.sem_custo_rec,
         g.bill_pend, g.bill_pend_rec,
         g.sis, g.ml_ret, (g.sis - g.ml_ret)::numeric
  FROM canc_fees cf, orfas o, agg g;
END;
$$;


--
-- Name: conc_recebimentos(uuid[], date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.conc_recebimentos(_account_ids uuid[], _from date, _to date) RETURNS TABLE(account_id uuid, payment_id bigint, order_id bigint, release_date timestamp with time zone, date_approved timestamp with time zone, status text, money_release_status text, sem_data boolean, bruto numeric, mp_fee numeric, ml_fee numeric, shipping_fee numeric, installment_fee numeric, fee_total numeric, liquido numeric, payment_method_id text, payment_type_id text, installments integer, order_date timestamp with time zone, order_status text, order_total numeric, sku text, title text, itens integer, pagamentos_do_pedido integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH acc AS (
    SELECT id FROM public.marketplace_accounts
    WHERE id = ANY(_account_ids) AND public.owns_account(id)
  ),
  pay AS (
    SELECT p.*
    FROM public.mp_payments p
    JOIN acc ON acc.id = p.account_id
    WHERE p.status IN ('approved','refunded')
      AND (
        (p.money_release_date IS NOT NULL
          AND (p.money_release_date AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN _from AND _to)
        OR (p.money_release_date IS NULL
          AND (p.date_approved AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN _from AND _to)
      )
  ),
  cnt AS (
    SELECT order_id, count(*)::int AS n
    FROM public.mp_payments
    WHERE order_id IS NOT NULL AND status IN ('approved','refunded')
    GROUP BY order_id
  ),
  itens AS (
    SELECT oi.order_ref,
           (array_agg(oi.title ORDER BY oi.quantity DESC))[1] AS title,
           (array_agg(oi.seller_sku ORDER BY oi.quantity DESC))[1] AS sku,
           count(*)::int AS itens
    FROM public.ml_order_items oi
    GROUP BY oi.order_ref
  )
  SELECT
    p.account_id,
    p.payment_id,
    p.order_id,
    p.money_release_date,
    p.date_approved,
    p.status,
    p.money_release_status,
    (p.money_release_date IS NULL) AS sem_data,
    CASE WHEN p.status = 'refunded' THEN -COALESCE(p.total_paid_amount,0) ELSE COALESCE(p.total_paid_amount,0) END,
    COALESCE(p.mp_fee,0),
    COALESCE(p.ml_fee,0),
    COALESCE(p.shipping_fee,0),
    COALESCE(p.installment_fee,0),
    COALESCE(p.fee_total,0),
    CASE WHEN p.status = 'refunded' THEN -COALESCE(p.net_received_amount,0) ELSE COALESCE(p.net_received_amount,0) END,
    p.payment_method_id,
    p.payment_type_id,
    p.installments,
    o.date_created,
    o.status,
    o.total_amount,
    i.sku,
    i.title,
    COALESCE(i.itens,0),
    COALESCE(c.n,1)
  FROM pay p
  LEFT JOIN public.ml_orders o ON o.order_id = p.order_id AND o.account_id = p.account_id
  LEFT JOIN itens i ON i.order_ref = o.id
  LEFT JOIN cnt c ON c.order_id = p.order_id
  ORDER BY p.money_release_date DESC NULLS LAST, p.date_approved DESC NULLS LAST;
$$;


--
-- Name: conc_recebimentos_resumo(uuid[], date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.conc_recebimentos_resumo(_account_ids uuid[], _from date, _to date) RETURNS TABLE(liberado numeric, liberado_qtd bigint, a_liberar numeric, a_liberar_qtd bigint, estornado numeric, estornado_qtd bigint, sem_data numeric, sem_data_qtd bigint, liquido numeric, bruto numeric, tarifas numeric, ultima_data date, proxima_data date)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH r AS (
    SELECT * FROM public.conc_recebimentos(_account_ids, _from, _to)
  )
  SELECT
    COALESCE(SUM(liquido) FILTER (WHERE status = 'approved' AND money_release_status = 'released'),0),
    COUNT(*) FILTER (WHERE status = 'approved' AND money_release_status = 'released'),
    COALESCE(SUM(liquido) FILTER (WHERE status = 'approved' AND money_release_status IS DISTINCT FROM 'released'),0),
    COUNT(*) FILTER (WHERE status = 'approved' AND money_release_status IS DISTINCT FROM 'released'),
    COALESCE(SUM(liquido) FILTER (WHERE status = 'refunded'),0),
    COUNT(*) FILTER (WHERE status = 'refunded'),
    COALESCE(SUM(liquido) FILTER (WHERE sem_data),0),
    COUNT(*) FILTER (WHERE sem_data),
    COALESCE(SUM(liquido),0),
    COALESCE(SUM(bruto),0),
    COALESCE(SUM(CASE WHEN status = 'refunded' THEN -fee_total ELSE fee_total END),0),
    MAX(release_date) FILTER (WHERE money_release_status = 'released')::date,
    MIN(release_date) FILTER (WHERE money_release_status IS DISTINCT FROM 'released')::date
  FROM r;
$$;


--
-- Name: conc_tarifas_canceladas(uuid[], date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.conc_tarifas_canceladas(_account_ids uuid[], _from date, _to date) RETURNS TABLE(account_id uuid, order_id bigint, order_date timestamp with time zone, order_total numeric, tarifas numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE a uuid;
BEGIN
  IF _account_ids IS NULL OR array_length(_account_ids, 1) IS NULL THEN
    RETURN;
  END IF;
  FOREACH a IN ARRAY _account_ids LOOP
    IF NOT public.owns_account(a) THEN
      RAISE EXCEPTION 'Acesso negado a conta %', a;
    END IF;
  END LOOP;

  RETURN QUERY
  SELECT o.account_id, o.order_id, o.date_created, o.total_amount,
         COALESCE(SUM(b.amount * CASE WHEN b.detail_type='BONUS' THEN -1 ELSE 1 END), 0)::numeric
  FROM public.ml_orders o
  JOIN public.ml_billing_details b
    ON b.account_id = o.account_id AND b.order_id = o.order_id
   AND COALESCE(b.concept_type,'') <> 'MCLICS'
  WHERE o.account_id = ANY(_account_ids)
    AND ((o.date_created AT TIME ZONE 'America/Sao_Paulo')::date) BETWEEN _from AND _to
    AND o.status = 'cancelled'
  GROUP BY o.account_id, o.order_id, o.date_created, o.total_amount
  HAVING COALESCE(SUM(b.amount * CASE WHEN b.detail_type='BONUS' THEN -1 ELSE 1 END), 0) <> 0
  ORDER BY 5 DESC;
END;
$$;


--
-- Name: contas_permitidas(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.contas_permitidas(_ids uuid[]) RETURNS uuid[]
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case
    -- sem usuario autenticado e conexao de servico (service_role / SQL direto), que ja tem acesso total
    when auth.uid() is null then coalesce(_ids, array[]::uuid[])
    else coalesce((select array_agg(x) from unnest(coalesce(_ids, array[]::uuid[])) x
                   where public.owns_account(x)), array[]::uuid[])
  end;
$$;


--
-- Name: FUNCTION contas_permitidas(_ids uuid[]); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.contas_permitidas(_ids uuid[]) IS 'Filtra um array de contas deixando apenas as do usuario autenticado. Sem auth.uid() a chamada vem de conexao de servico, que ja tem acesso total ao banco, e o array passa inteiro para permitir auditoria via SQL. Toda funcao SECURITY DEFINER que recebe _account_ids deve passar por aqui.';


--
-- Name: create_categoria(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_categoria(_owner uuid, _nome text, _kind text DEFAULT 'variavel'::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_id uuid;
BEGIN
  IF _nome IS NULL OR length(trim(_nome)) = 0 THEN RAISE EXCEPTION 'Nome da categoria vazio'; END IF;

  SELECT id INTO v_id FROM public.expense_categories
  WHERE parent_category_id IS NULL AND public.is_team_owner(owner_id) AND name ILIKE trim(_nome)
  LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO public.expense_categories (owner_id, name, kind, parent_category_id, allow_subcategories, ecommerce_mode, ecommerce_percent, ecommerce_amount)
  VALUES (public.team_owner(), trim(_nome), COALESCE(NULLIF(_kind,''),'variavel'), NULL, false, 'percent', 0, 0)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;


--
-- Name: create_empresa(text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_empresa(_nome text, _cnpj text, _razao text, _regime text DEFAULT 'simples'::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_owner uuid := public.team_owner(); v_id uuid;
BEGIN
  IF _nome IS NULL OR btrim(_nome)='' THEN RAISE EXCEPTION 'Nome obrigatório'; END IF;
  INSERT INTO public.empresas (owner_id, nome, cnpj, razao_social, regime_tributario)
  VALUES (v_owner, btrim(_nome), NULLIF(btrim(coalesce(_cnpj,'')),''), NULLIF(btrim(coalesce(_razao,'')),''), coalesce(_regime,'simples'))
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;


--
-- Name: create_fornecedor(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_fornecedor(_owner uuid, _nome text, _cnpj text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_parent uuid;
  v_id uuid;
  v_cnpj text;
BEGIN
  v_cnpj := NULLIF(regexp_replace(COALESCE(_cnpj,''), '\D', '', 'g'), '');

  SELECT id INTO v_parent FROM public.expense_categories
  WHERE owner_id = public.team_owner() AND parent_category_id IS NULL
    AND name ILIKE 'fornecedores' AND allow_subcategories = true
  LIMIT 1;
  IF v_parent IS NULL THEN RAISE EXCEPTION 'Categoria Fornecedores não encontrada'; END IF;

  -- já existe?
  SELECT id INTO v_id FROM public.expense_categories
  WHERE parent_category_id = v_parent AND public.is_team_owner(owner_id)
    AND name ILIKE trim(_nome)
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    -- atualiza cnpj se estava vazio
    UPDATE public.expense_categories
    SET cnpj = COALESCE(cnpj, v_cnpj)
    WHERE id = v_id;
    RETURN v_id;
  END IF;

  -- cria nova subcategoria (herda kind do pai; rateio padrão 0% e-commerce como os fornecedores)
  INSERT INTO public.expense_categories (owner_id, name, kind, parent_category_id, allow_subcategories, cnpj, ecommerce_mode, ecommerce_percent, ecommerce_amount)
  SELECT public.team_owner(), trim(_nome), COALESCE(kind,'variavel'), v_parent, false, v_cnpj, 'percent', 0, 0
  FROM public.expense_categories WHERE id = v_parent;

  SELECT id INTO v_id FROM public.expense_categories
  WHERE parent_category_id = v_parent AND name ILIKE trim(_nome) AND public.is_team_owner(owner_id)
  ORDER BY created_at DESC LIMIT 1;

  RETURN v_id;
END;
$$;


--
-- Name: create_gasto(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_gasto(_owner uuid, _categoria_id uuid, _nome text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_id uuid;
BEGIN
  IF _nome IS NULL OR length(trim(_nome)) = 0 THEN RAISE EXCEPTION 'Nome do gasto vazio'; END IF;

  SELECT id INTO v_id FROM public.expenses
  WHERE category_id = _categoria_id AND public.is_team_owner(owner_id) AND name ILIKE trim(_nome)
  LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO public.expenses (owner_id, category_id, name, ecommerce_override)
  VALUES (public.team_owner(), _categoria_id, trim(_nome), false)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;


--
-- Name: custo_sku_na_data(uuid, text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.custo_sku_na_data(_owner uuid, _sku text, _data date) RETURNS TABLE(custo numeric, origem text)
    LANGUAGE sql STABLE
    AS $$
  with ps as (
    select p.is_kit from public.product_skus p where p.owner_id = _owner and p.sku = _sku
  ),
  comp as (
    select kc.quantity as q, c.custo, c.origem
      from public.kit_components kc
      cross join lateral public.custo_unit_na_data(_owner, kc.component_sku, _data) c
     where kc.owner_id = _owner and kc.kit_sku = _sku
  ),
  simples as (
    select c.custo, c.origem from public.custo_unit_na_data(_owner, _sku, _data) c
     where not coalesce((select is_kit from ps), true)
  )
  select case when not exists (select 1 from ps) then null
              when (select is_kit from ps) then
                case when not exists (select 1 from comp) or exists (select 1 from comp where custo is null) then null
                     else (select sum(q * custo) from comp) end
              else (select custo from simples) end,
         case when not exists (select 1 from ps) then 'sem_custo'
              when (select is_kit from ps) then
                case when not exists (select 1 from comp) or exists (select 1 from comp where custo is null) then 'sem_custo'
                     else 'kit' end
              else (select origem from simples) end;
$$;


--
-- Name: custo_unit_na_data(uuid, text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.custo_unit_na_data(_owner uuid, _sku text, _data date) RETURNS TABLE(custo numeric, origem text)
    LANGUAGE sql STABLE
    AS $$
  with ps as (
    select p.custo_base, p.custo_travado from public.product_skus p where p.owner_id = _owner and p.sku = _sku
  ),
  h as (
    select hh.valor_unitario as v, hh.origem, hh.registrado_em,
           case when hh.origem = 'manual' then (hh.registrado_em at time zone 'America/Sao_Paulo')::date
                else hh.data_nota end as desde
      from public.product_cost_history hh
     where hh.owner_id = _owner and hh.sku = _sku
       and (hh.origem = 'manual' or hh.data_nota is not null)
  ),
  -- Antes do primeiro registro, vale o primeiro dia registrado.
  d as (select greatest(_data, (select min(desde) from h)) as dia),
  trava as (select coalesce((select custo_travado from ps), false) as ligada),
  escolhido as (
    select h.v, h.origem from h, d, trava
     where h.desde <= d.dia
     order by (case when trava.ligada then h.origem = 'manual' else h.origem <> 'manual' end) desc,
              h.desde desc, h.registrado_em desc
     limit 1
  )
  select nullif(coalesce((select v from escolhido), (select custo_base from ps)), 0),
         case when coalesce((select v from escolhido), (select custo_base from ps), 0) = 0 then 'sem_custo'
              when (select origem from escolhido) = 'manual' and (select ligada from trava) then 'travado'
              when (select origem from escolhido) = 'manual' then 'manual'
              when exists (select 1 from escolhido) then 'nota'
              else 'custo_atual' end;
$$;


--
-- Name: custos_por_operacao(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.custos_por_operacao(_owner uuid, _year integer) RETURNS TABLE(top_category_id uuid, top_category_name text, category_kind text, category_sort integer, month date, total numeric, ecommerce numeric, locacao numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH months AS (
    SELECT make_date(_year, m, 1)::date AS month FROM generate_series(1,12) m
  ),
  base AS (
    SELECT
      COALESCE(p.id, c.id)      AS top_id,
      COALESCE(p.name, c.name)  AS top_name,
      COALESCE(p.kind, c.kind)  AS top_kind,
      COALESCE(p.sort_order, c.sort_order) AS top_sort,
      e.id AS expense_id,
      CASE WHEN e.ecommerce_override THEN e.ecommerce_mode    ELSE c.ecommerce_mode    END AS eff_mode,
      CASE WHEN e.ecommerce_override THEN e.ecommerce_percent ELSE c.ecommerce_percent END AS eff_percent,
      CASE WHEN e.ecommerce_override THEN e.ecommerce_amount  ELSE c.ecommerce_amount  END AS eff_amount
    FROM public.expenses e
    JOIN public.expense_categories c ON c.id = e.category_id
    LEFT JOIN public.expense_categories p ON p.id = c.parent_category_id
    WHERE e.owner_id = public.team_owner()
  ),
  calc AS (
    SELECT
      b.top_id, b.top_name, b.top_kind, b.top_sort,
      mm.month,
      COALESCE(v.amount,0)::numeric AS total,
      COALESCE(v.ecommerce_valor_conta, (CASE WHEN b.eff_mode = 'percent'
            THEN COALESCE(v.amount,0) * b.eff_percent / 100
            ELSE LEAST(b.eff_amount, COALESCE(v.amount,0)) END))::numeric AS ecommerce
    FROM base b
    CROSS JOIN months mm
    LEFT JOIN public.expense_values v ON v.expense_id = b.expense_id AND v.month = mm.month
  )
  SELECT
    top_id, top_name, top_kind, top_sort, month,
    SUM(total)::numeric AS total,
    SUM(ecommerce)::numeric AS ecommerce,
    SUM(total - ecommerce)::numeric AS locacao
  FROM calc
  GROUP BY top_id, top_name, top_kind, top_sort, month
  ORDER BY top_sort, top_name, month;
$$;


--
-- Name: dashboard_cmv(date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.dashboard_cmv(_from date, _to date) RETURNS TABLE(cmv numeric, pedidos_sem_custo bigint, receita_sem_custo numeric, unidades_sem_custo numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with accs as (
    select coalesce(array_agg(m.id), array[]::uuid[]) as ids
    from public.marketplace_accounts m where m.owner_id = public.team_owner()
  ),
  r as (select * from public.mp_reconciliation((select ids from accs), _from, _to))
  select coalesce(sum(r.cmv) filter (where not r.cmv_missing), 0)::numeric,
         count(*) filter (where r.cmv_missing)::bigint,
         coalesce(sum(r.receita_produto) filter (where r.cmv_missing), 0)::numeric,
         coalesce(sum(r.units) filter (where r.cmv_missing), 0)::numeric
  from r;
$$;


--
-- Name: dashboard_dre_tree(date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.dashboard_dre_tree(_from date, _to date) RETURNS TABLE(secao text, secao_ord integer, grupo text, grupo_ord integer, item text, item_ord integer, valor numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH o AS (SELECT public.team_owner() AS owner),
  accs AS (SELECT m.id, m.nickname FROM public.marketplace_accounts m, o WHERE m.owner_id = o.owner),
  ids AS (SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) AS a FROM accs),
  custo AS (SELECT * FROM public.ml_custos_competencia((SELECT a FROM ids), _from, _to)),
  receita AS (SELECT r.account_id, SUM(r.receita) AS v
              FROM public.ml_receita_competencia_mes((SELECT a FROM ids), _from, _to) r GROUP BY 1)
  SELECT 'ENTRADAS'::text, 1, 'E-commerce'::text, 1, a.nickname, ROW_NUMBER() OVER (ORDER BY a.nickname)::int,
         COALESCE(r.v,0)::numeric
  FROM accs a LEFT JOIN receita r ON r.account_id = a.id

  UNION ALL
  SELECT 'ENTRADAS', 1, 'Locação', 2, 'Locação', 1,
         COALESCE((SELECT SUM(valor * public.fracao_do_mes(month, _from, _to)) FROM public.rental_invoices r, o
                   WHERE r.owner_id = o.owner
                     AND month >= date_trunc('month',_from)::date
                     AND month <= date_trunc('month',_to)::date),0)

  UNION ALL
  SELECT 'SAÍDAS', 2, 'Custos Mercado Livre', 1, x.item, x.ord, x.valor
  FROM custo c,
  LATERAL (VALUES
    ('Comissão'::text, 1, c.comissao),
    ('Frete', 2, c.frete + c.estorno),
    ('Ads', 3, c.ads),
    ('Full (armazenagem e coleta)', 4, c.full_periodo),
    ('Outros', 5, c.outros),
    ('Parcelamento', 6, c.parcelamento),
    ('Imposto (vendas ML)', 7, c.imposto)
  ) AS x(item, ord, valor)
  WHERE x.valor <> 0

  UNION ALL
  SELECT 'SAÍDAS', 2, 'Custo dos produtos', 2, 'CMV (produtos vendidos)', 1, SUM(c.cmv)
  FROM custo c HAVING SUM(c.cmv) <> 0

  UNION ALL
  SELECT 'SAÍDAS', 2, 'Custos gerais', 3,
         COALESCE(p.name, c.name), COALESCE(p.sort_order, c.sort_order)::int,
         COALESCE(SUM(vv.amount * public.fracao_do_mes(vv.month, _from, _to)),0)
  FROM public.expense_values vv
  JOIN public.expenses e ON e.id = vv.expense_id
  JOIN public.expense_categories c ON c.id = e.category_id
  LEFT JOIN public.expense_categories p ON p.id = c.parent_category_id, o
  WHERE e.owner_id = o.owner
    AND vv.month >= date_trunc('month',_from)::date
    AND vv.month <= date_trunc('month',_to)::date
  GROUP BY COALESCE(p.name, c.name), COALESCE(p.sort_order, c.sort_order);
$$;


--
-- Name: dashboard_dre_tree_op(date, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.dashboard_dre_tree_op(_from date, _to date, _op text) RETURNS TABLE(secao text, secao_ord integer, grupo text, grupo_ord integer, item text, item_ord integer, valor numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH o AS (SELECT public.team_owner() AS owner),
  accs AS (SELECT m.id, m.nickname FROM public.marketplace_accounts m, o WHERE m.owner_id=o.owner),
  ids AS (SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) AS a FROM accs),
  custo AS (SELECT * FROM public.ml_custos_competencia((SELECT a FROM ids), _from, _to)),
  receita AS (SELECT r.account_id, SUM(r.receita) AS v
              FROM public.ml_receita_competencia_mes((SELECT a FROM ids), _from, _to) r GROUP BY 1)
  SELECT 'ENTRADAS'::text,1,'E-commerce'::text,1,a.nickname,ROW_NUMBER() OVER(ORDER BY a.nickname)::int,
         COALESCE(r.v,0)::numeric
  FROM accs a LEFT JOIN receita r ON r.account_id=a.id
  WHERE _op='ecommerce'

  UNION ALL
  SELECT 'ENTRADAS',1,'Locação',2,'Locação',1,
         COALESCE((SELECT SUM(valor * public.fracao_do_mes(month, _from, _to)) FROM public.rental_invoices r,o WHERE r.owner_id=o.owner
                   AND month>=date_trunc('month',_from)::date AND month<=date_trunc('month',_to)::date),0)
  WHERE _op='locacao'

  UNION ALL
  SELECT 'SAÍDAS',2,'Custos Mercado Livre',1, x.item, x.ord, x.valor
  FROM custo c,
  LATERAL (VALUES
    ('Comissão'::text, 1, c.comissao),
    ('Frete', 2, c.frete + c.estorno),
    ('Ads', 3, c.ads),
    ('Full (armazenagem e coleta)', 4, c.full_periodo),
    ('Outros', 5, c.outros),
    ('Parcelamento', 6, c.parcelamento),
    ('Imposto (vendas ML)', 7, c.imposto)
  ) AS x(item, ord, valor)
  WHERE _op='ecommerce' AND x.valor <> 0

  UNION ALL
  SELECT 'SAÍDAS',2,'Custo dos produtos',2,'CMV (produtos vendidos)',1, SUM(c.cmv)
  FROM custo c WHERE _op='ecommerce' HAVING SUM(c.cmv) <> 0

  UNION ALL
  SELECT 'SAÍDAS',2,'Custos gerais',3, cat, ord::int, COALESCE(SUM(part),0)
  FROM (
    SELECT COALESCE(pc.name,c.name) cat, COALESCE(pc.sort_order,c.sort_order) ord,
      CASE WHEN _op='ecommerce' THEN
        (COALESCE(vv.ecommerce_valor_conta, (CASE WHEN (CASE WHEN e.ecommerce_override THEN e.ecommerce_mode ELSE c.ecommerce_mode END)='percent'
              THEN COALESCE(vv.amount,0)*COALESCE(CASE WHEN e.ecommerce_override THEN e.ecommerce_percent ELSE c.ecommerce_percent END,0)/100
              ELSE LEAST(COALESCE(CASE WHEN e.ecommerce_override THEN e.ecommerce_amount ELSE c.ecommerce_amount END,0),COALESCE(vv.amount,0)) END)))
      ELSE
        (COALESCE(vv.amount,0) - (COALESCE(vv.ecommerce_valor_conta, (CASE WHEN (CASE WHEN e.ecommerce_override THEN e.ecommerce_mode ELSE c.ecommerce_mode END)='percent'
              THEN COALESCE(vv.amount,0)*COALESCE(CASE WHEN e.ecommerce_override THEN e.ecommerce_percent ELSE c.ecommerce_percent END,0)/100
              ELSE LEAST(COALESCE(CASE WHEN e.ecommerce_override THEN e.ecommerce_amount ELSE c.ecommerce_amount END,0),COALESCE(vv.amount,0)) END))))
      END * public.fracao_do_mes(vv.month, _from, _to) part
    FROM public.expense_values vv
    JOIN public.expenses e ON e.id=vv.expense_id
    JOIN public.expense_categories c ON c.id=e.category_id
    LEFT JOIN public.expense_categories pc ON pc.id=c.parent_category_id, o
    WHERE e.owner_id=o.owner
      AND vv.month>=date_trunc('month',_from)::date AND vv.month<=date_trunc('month',_to)::date
  ) sub
  GROUP BY cat, ord
  HAVING COALESCE(SUM(part),0) <> 0;
$$;


--
-- Name: dashboard_ecom_metrics(date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.dashboard_ecom_metrics(_from date, _to date) RETURNS TABLE(pedidos bigint, faturamento numeric, ads numeric, ticket_medio numeric, tacos_pct numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH o AS (SELECT public.team_owner() AS owner),
  accs AS (SELECT COALESCE(array_agg(m.id), ARRAY[]::uuid[]) AS ids FROM public.marketplace_accounts m, o WHERE m.owner_id=o.owner),
  ped AS (
    SELECT COALESCE(SUM(r.pedidos),0)::bigint n, COALESCE(SUM(r.receita),0)::numeric fat
    FROM public.ml_receita_competencia_mes((SELECT ids FROM accs), _from, _to) r
  ),
  adsp AS (
    SELECT COALESCE(SUM(c.ads),0)::numeric v
    FROM public.ml_custos_competencia((SELECT ids FROM accs), _from, _to) c
  )
  SELECT ped.n, ped.fat, adsp.v,
    CASE WHEN ped.n>0 THEN ROUND(ped.fat/ped.n,2) ELSE 0 END,
    CASE WHEN ped.fat>0 THEN ROUND(adsp.v/ped.fat*100,2) ELSE 0 END
  FROM ped, adsp;
$$;


--
-- Name: dashboard_kpis(date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.dashboard_kpis(_from date, _to date) RETURNS TABLE(entradas_ml numeric, entradas_locacao numeric, entradas_total numeric, saidas_ml numeric, saidas_gerais numeric, saidas_total numeric, custos_variaveis numeric, custos_fixos numeric, mc numeric, mc_pct numeric, resultado numeric, a_receber_ml numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH o AS (SELECT public.team_owner() AS owner),
  accs AS (SELECT COALESCE(array_agg(m.id), ARRAY[]::uuid[]) AS ids FROM public.marketplace_accounts m, o WHERE m.owner_id = o.owner),
  ent_ml AS (
    SELECT COALESCE(SUM(r.receita),0) AS v
    FROM public.ml_receita_competencia_mes((SELECT ids FROM accs), _from, _to) r
  ),
  ent_loc AS (
    SELECT COALESCE(SUM(valor * public.fracao_do_mes(month, _from, _to)),0) AS v
    FROM public.rental_invoices r, o
    WHERE r.owner_id = o.owner
      AND month >= date_trunc('month',_from)::date
      AND month <= date_trunc('month',_to)::date
  ),
  sai_ml AS (
    SELECT COALESCE(SUM(c.custo_ml + c.cmv),0) AS v
    FROM public.ml_custos_competencia((SELECT ids FROM accs), _from, _to) c
  ),
  plan AS (
    SELECT COALESCE(p.kind,c.kind) AS kind, COALESCE(SUM(vv.amount * public.fracao_do_mes(vv.month, _from, _to)),0) AS v
    FROM public.expense_values vv
    JOIN public.expenses e ON e.id = vv.expense_id
    JOIN public.expense_categories c ON c.id = e.category_id
    LEFT JOIN public.expense_categories p ON p.id = c.parent_category_id, o
    WHERE e.owner_id = o.owner
      AND vv.month >= date_trunc('month',_from)::date
      AND vv.month <= date_trunc('month',_to)::date
    GROUP BY COALESCE(p.kind,c.kind)
  ),
  pf AS (SELECT COALESCE(SUM(v),0) AS v FROM plan WHERE kind='fixo'),
  pv AS (SELECT COALESCE(SUM(v),0) AS v FROM plan WHERE kind='variavel'),
  arec AS (
    SELECT COALESCE(SUM(p.net_received_amount),0) AS v
    FROM public.mp_payments p
    WHERE p.account_id = ANY(SELECT unnest(ids) FROM accs)
      AND p.status = 'approved'
      AND p.money_release_date > now()
  )
  SELECT
    ent_ml.v, ent_loc.v, ent_ml.v + ent_loc.v,
    sai_ml.v, pf.v + pv.v, sai_ml.v + pf.v + pv.v,
    sai_ml.v + pv.v, pf.v,
    (ent_ml.v + ent_loc.v) - (sai_ml.v + pv.v),
    ROUND(((ent_ml.v + ent_loc.v) - (sai_ml.v + pv.v)) / NULLIF(ent_ml.v + ent_loc.v,0) * 100, 2),
    (ent_ml.v + ent_loc.v) - (sai_ml.v + pf.v + pv.v),
    arec.v
  FROM ent_ml, ent_loc, sai_ml, pf, pv, arec;
$$;


--
-- Name: FUNCTION dashboard_kpis(_from date, _to date); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.dashboard_kpis(_from date, _to date) IS 'Regime de competencia: receita e custo ligado a pedido seguem a data do pedido. Custos sem pedido (ADS, Full, assinaturas) seguem a data da fatura.';


--
-- Name: dashboard_kpis_op(date, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.dashboard_kpis_op(_from date, _to date, _op text) RETURNS TABLE(entradas numeric, saidas numeric, custos_variaveis numeric, custos_fixos numeric, mc numeric, mc_pct numeric, resultado numeric, a_receber numeric, cmv numeric, pedidos_sem_custo bigint, receita_sem_custo numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH o AS (SELECT public.team_owner() AS owner),
  accs AS (SELECT COALESCE(array_agg(m.id), ARRAY[]::uuid[]) AS ids FROM public.marketplace_accounts m, o WHERE m.owner_id=o.owner),
  ent AS (
    SELECT CASE WHEN _op='ecommerce' THEN
      COALESCE((SELECT SUM(r.receita) FROM public.ml_receita_competencia_mes((SELECT ids FROM accs), _from, _to) r),0)
    ELSE
      COALESCE((SELECT SUM(valor * public.fracao_do_mes(month, _from, _to)) FROM public.rental_invoices r, o WHERE r.owner_id=o.owner
                AND month>=date_trunc('month',_from)::date AND month<=date_trunc('month',_to)::date),0)
    END AS v
  ),
  bml AS (
    SELECT CASE WHEN _op='ecommerce' THEN
      COALESCE((SELECT SUM(c.custo_ml) FROM public.ml_custos_competencia((SELECT ids FROM accs), _from, _to) c),0)
    ELSE 0 END AS v
  ),
  cmvc AS (
    SELECT CASE WHEN _op='ecommerce' THEN c.cmv ELSE 0 END AS v,
           CASE WHEN _op='ecommerce' THEN c.pedidos_sem_custo ELSE 0 END AS pedidos,
           CASE WHEN _op='ecommerce' THEN c.receita_sem_custo ELSE 0 END AS receita_sem
    FROM public.dashboard_cmv(_from, _to) c
  ),
  plan AS (
    SELECT COALESCE(p.kind,c.kind) AS kind,
      COALESCE(vv.ecommerce_valor_conta, (CASE WHEN (CASE WHEN e.ecommerce_override THEN e.ecommerce_mode ELSE c.ecommerce_mode END)='percent'
           THEN COALESCE(vv.amount,0)*COALESCE(CASE WHEN e.ecommerce_override THEN e.ecommerce_percent ELSE c.ecommerce_percent END,0)/100
           ELSE LEAST(COALESCE(CASE WHEN e.ecommerce_override THEN e.ecommerce_amount ELSE c.ecommerce_amount END,0), COALESCE(vv.amount,0)) END)) * public.fracao_do_mes(vv.month, _from, _to) AS ecom_part,
      COALESCE(vv.amount,0) * public.fracao_do_mes(vv.month, _from, _to) AS total
    FROM public.expense_values vv
    JOIN public.expenses e ON e.id=vv.expense_id
    JOIN public.expense_categories c ON c.id=e.category_id
    LEFT JOIN public.expense_categories p ON p.id=c.parent_category_id, o
    WHERE e.owner_id=o.owner
      AND vv.month>=date_trunc('month',_from)::date AND vv.month<=date_trunc('month',_to)::date
  ),
  pa AS (
    SELECT
      SUM(CASE WHEN kind='variavel' THEN (CASE WHEN _op='ecommerce' THEN ecom_part ELSE total-ecom_part END) ELSE 0 END) AS var_part,
      SUM(CASE WHEN kind='fixo'     THEN (CASE WHEN _op='ecommerce' THEN ecom_part ELSE total-ecom_part END) ELSE 0 END) AS fix_part
    FROM plan
  ),
  arec AS (
    SELECT CASE WHEN _op='ecommerce' THEN
      COALESCE((SELECT SUM(p.net_received_amount) FROM public.mp_payments p
                WHERE p.account_id = ANY(SELECT unnest(ids) FROM accs) AND p.status='approved' AND p.money_release_date>now()),0)
    ELSE 0 END AS v
  )
  SELECT
    ent.v,
    bml.v + cmvc.v + COALESCE(pa.var_part,0) + COALESCE(pa.fix_part,0),
    bml.v + cmvc.v + COALESCE(pa.var_part,0),
    COALESCE(pa.fix_part,0),
    ent.v - (bml.v + cmvc.v + COALESCE(pa.var_part,0)),
    ROUND((ent.v - (bml.v + cmvc.v + COALESCE(pa.var_part,0)))/NULLIF(ent.v,0)*100,2),
    ent.v - (bml.v + cmvc.v + COALESCE(pa.var_part,0) + COALESCE(pa.fix_part,0)),
    arec.v,
    cmvc.v,
    cmvc.pedidos,
    cmvc.receita_sem
  FROM ent, bml, cmvc, pa, arec;
$$;


--
-- Name: FUNCTION dashboard_kpis_op(_from date, _to date, _op text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.dashboard_kpis_op(_from date, _to date, _op text) IS 'Regime de competencia. Consome ml_receita_competencia_mes e ml_custos_competencia.';


--
-- Name: dashboard_margens(date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.dashboard_margens(_from date, _to date) RETURNS TABLE(operacao text, receita numeric, custos_variaveis numeric, margem_contribuicao_reais numeric, margem_contribuicao_pct numeric, custos_fixos numeric, margem_lucro_reais numeric, margem_lucro_pct numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH o AS (SELECT public.team_owner() AS owner),
  ops AS (SELECT unnest(ARRAY['ecommerce','locacao']) AS op),
  cmvc AS (SELECT c.cmv FROM public.dashboard_cmv(_from, _to) c),
  dre AS (
    SELECT ops.op, d.secao, d.grupo, d.valor
    FROM ops, LATERAL public.dashboard_dre_tree_op(_from, _to, ops.op) d
  ),
  plan AS (
    SELECT COALESCE(p.kind, c.kind) AS kind,
      COALESCE(vv.ecommerce_valor_conta, (CASE WHEN (CASE WHEN e.ecommerce_override THEN e.ecommerce_mode ELSE c.ecommerce_mode END)='percent'
           THEN COALESCE(vv.amount,0)*COALESCE(CASE WHEN e.ecommerce_override THEN e.ecommerce_percent ELSE c.ecommerce_percent END,0)/100
           ELSE LEAST(COALESCE(CASE WHEN e.ecommerce_override THEN e.ecommerce_amount ELSE c.ecommerce_amount END,0), COALESCE(vv.amount,0)) END)) * public.fracao_do_mes(vv.month, _from, _to) AS ecom_part,
      COALESCE(vv.amount,0) * public.fracao_do_mes(vv.month, _from, _to) AS total
    FROM public.expense_values vv
    JOIN public.expenses e ON e.id=vv.expense_id
    JOIN public.expense_categories c ON c.id=e.category_id
    LEFT JOIN public.expense_categories p ON p.id=c.parent_category_id, o
    WHERE e.owner_id=o.owner
      AND vv.month>=date_trunc('month',_from)::date AND vv.month<=date_trunc('month',_to)::date
  ),
  planagg AS (
    SELECT ops.op,
      COALESCE(SUM(CASE WHEN plan.kind='variavel' THEN (CASE WHEN ops.op='ecommerce' THEN plan.ecom_part ELSE plan.total-plan.ecom_part END) ELSE 0 END),0) AS var_part,
      COALESCE(SUM(CASE WHEN plan.kind='fixo'     THEN (CASE WHEN ops.op='ecommerce' THEN plan.ecom_part ELSE plan.total-plan.ecom_part END) ELSE 0 END),0) AS fix_part
    FROM ops LEFT JOIN plan ON true
    GROUP BY ops.op
  ),
  base AS (
    SELECT ops.op,
      COALESCE((SELECT SUM(d.valor) FROM dre d WHERE d.op=ops.op AND d.secao='ENTRADAS'),0) AS receita,
      COALESCE((SELECT SUM(d.valor) FROM dre d WHERE d.op=ops.op AND d.secao='SAÍDAS' AND d.grupo='Custos Mercado Livre'),0)
        + pa.var_part
        + CASE WHEN ops.op='ecommerce' THEN (SELECT cmv FROM cmvc) ELSE 0 END AS cv,
      pa.fix_part AS cf
    FROM ops JOIN planagg pa ON pa.op=ops.op
  ),
  full_rows AS (
    SELECT op, receita, cv, cf FROM base
    UNION ALL
    SELECT 'total', SUM(receita), SUM(cv), SUM(cf) FROM base
  )
  SELECT
    op,
    ROUND(receita,2),
    ROUND(cv,2),
    ROUND(receita-cv,2),
    ROUND((receita-cv)/NULLIF(receita,0)*100,2),
    ROUND(cf,2),
    ROUND(receita-cv-cf,2),
    ROUND((receita-cv-cf)/NULLIF(receita,0)*100,2)
  FROM full_rows
  ORDER BY CASE op WHEN 'ecommerce' THEN 1 WHEN 'locacao' THEN 2 ELSE 3 END;
$$;


--
-- Name: dashboard_monthly_series(date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.dashboard_monthly_series(_from date, _to date) RETURNS TABLE(mes date, entradas numeric, saidas numeric, resultado numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH o AS (SELECT public.team_owner() AS owner),
  accs AS (SELECT COALESCE(array_agg(m.id), ARRAY[]::uuid[]) AS ids FROM public.marketplace_accounts m, o WHERE m.owner_id = o.owner),
  months AS (SELECT generate_series(date_trunc('month',_from), date_trunc('month',_to), interval '1 month')::date AS m),
  e_ml AS (
    SELECT r.mes AS m, SUM(r.receita) AS v
    FROM public.ml_receita_competencia_mes((SELECT ids FROM accs), _from, _to) r GROUP BY 1
  ),
  e_loc AS (
    SELECT month::date AS m, SUM(valor * public.fracao_do_mes(month, _from, _to)) AS v
    FROM public.rental_invoices r, o
    WHERE r.owner_id = o.owner
      AND month >= date_trunc('month',_from)::date AND month <= date_trunc('month',_to)::date
    GROUP BY 1
  ),
  s_ml AS (
    SELECT c.mes AS m, SUM(c.custo_ml + c.cmv) AS v
    FROM public.ml_custos_competencia_mes((SELECT ids FROM accs), _from, _to) c GROUP BY 1
  ),
  s_ger AS (
    SELECT vv.month::date AS m, SUM(vv.amount * public.fracao_do_mes(vv.month, _from, _to)) AS v
    FROM public.expense_values vv
    JOIN public.expenses e ON e.id = vv.expense_id, o
    WHERE e.owner_id = o.owner
      AND vv.month >= date_trunc('month',_from)::date AND vv.month <= date_trunc('month',_to)::date
    GROUP BY 1
  )
  SELECT mo.m,
         (COALESCE(e_ml.v,0)+COALESCE(e_loc.v,0))::numeric,
         (COALESCE(s_ml.v,0)+COALESCE(s_ger.v,0))::numeric,
         (COALESCE(e_ml.v,0)+COALESCE(e_loc.v,0) - COALESCE(s_ml.v,0)-COALESCE(s_ger.v,0))::numeric
  FROM months mo
  LEFT JOIN e_ml ON e_ml.m = mo.m LEFT JOIN e_loc ON e_loc.m = mo.m
  LEFT JOIN s_ml ON s_ml.m = mo.m LEFT JOIN s_ger ON s_ger.m = mo.m
  ORDER BY mo.m;
$$;


--
-- Name: dashboard_monthly_series_op(date, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.dashboard_monthly_series_op(_from date, _to date, _op text) RETURNS TABLE(mes date, entradas numeric, saidas numeric, resultado numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH o AS (SELECT public.team_owner() AS owner),
  accs AS (SELECT COALESCE(array_agg(m.id), ARRAY[]::uuid[]) AS ids FROM public.marketplace_accounts m, o WHERE m.owner_id=o.owner),
  months AS (SELECT generate_series(date_trunc('month',_from), date_trunc('month',_to), interval '1 month')::date AS m),
  e_ml AS (
    SELECT r.mes AS m, SUM(r.receita) AS v
    FROM public.ml_receita_competencia_mes((SELECT ids FROM accs), _from, _to) r
    WHERE _op='ecommerce' GROUP BY 1
  ),
  e_loc AS (
    SELECT month::date m, SUM(valor * public.fracao_do_mes(month, _from, _to)) v FROM public.rental_invoices r,o
    WHERE _op='locacao' AND r.owner_id=o.owner
      AND month>=date_trunc('month',_from)::date AND month<=date_trunc('month',_to)::date GROUP BY 1),
  s_ml AS (
    SELECT c.mes AS m, SUM(c.custo_ml + c.cmv) AS v
    FROM public.ml_custos_competencia_mes((SELECT ids FROM accs), _from, _to) c
    WHERE _op='ecommerce' GROUP BY 1
  ),
  s_ger AS (
    SELECT vv.month::date m,
      SUM(CASE WHEN _op='ecommerce' THEN
            (COALESCE(vv.ecommerce_valor_conta, (CASE WHEN (CASE WHEN e.ecommerce_override THEN e.ecommerce_mode ELSE c.ecommerce_mode END)='percent'
                  THEN COALESCE(vv.amount,0)*COALESCE(CASE WHEN e.ecommerce_override THEN e.ecommerce_percent ELSE c.ecommerce_percent END,0)/100
                  ELSE LEAST(COALESCE(CASE WHEN e.ecommerce_override THEN e.ecommerce_amount ELSE c.ecommerce_amount END,0),COALESCE(vv.amount,0)) END)))
          ELSE
            (COALESCE(vv.amount,0) - (COALESCE(vv.ecommerce_valor_conta, (CASE WHEN (CASE WHEN e.ecommerce_override THEN e.ecommerce_mode ELSE c.ecommerce_mode END)='percent'
                  THEN COALESCE(vv.amount,0)*COALESCE(CASE WHEN e.ecommerce_override THEN e.ecommerce_percent ELSE c.ecommerce_percent END,0)/100
                  ELSE LEAST(COALESCE(CASE WHEN e.ecommerce_override THEN e.ecommerce_amount ELSE c.ecommerce_amount END,0),COALESCE(vv.amount,0)) END))))
          END * public.fracao_do_mes(vv.month, _from, _to)) v
    FROM public.expense_values vv
    JOIN public.expenses e ON e.id=vv.expense_id
    JOIN public.expense_categories c ON c.id=e.category_id
    LEFT JOIN public.expense_categories pc ON pc.id=c.parent_category_id, o
    WHERE e.owner_id=o.owner AND vv.month>=date_trunc('month',_from)::date AND vv.month<=date_trunc('month',_to)::date
    GROUP BY 1)
  SELECT mo.m,
    (COALESCE(e_ml.v,0)+COALESCE(e_loc.v,0))::numeric,
    (COALESCE(s_ml.v,0)+COALESCE(s_ger.v,0))::numeric,
    (COALESCE(e_ml.v,0)+COALESCE(e_loc.v,0)-COALESCE(s_ml.v,0)-COALESCE(s_ger.v,0))::numeric
  FROM months mo
  LEFT JOIN e_ml ON e_ml.m=mo.m LEFT JOIN e_loc ON e_loc.m=mo.m
  LEFT JOIN s_ml ON s_ml.m=mo.m LEFT JOIN s_ger ON s_ger.m=mo.m
  ORDER BY mo.m;
$$;


--
-- Name: dashboard_top_clientes_locacao(date, date, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.dashboard_top_clientes_locacao(_from date, _to date, _limite integer DEFAULT 10) RETURNS TABLE(cliente text, cnpj_raiz text, total numeric, faturas bigint, participacao_pct numeric, uf text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH base AS (
    SELECT i.cnpj_raiz,
           COALESCE(l.label, MAX(i.nome_fantasia), MAX(i.razao_social), i.cnpj_raiz) AS cliente,
           SUM(i.valor * public.fracao_do_mes(i.month, _from, _to)) AS total, COUNT(*)::bigint AS faturas, MAX(i.uf) AS uf
    FROM public.rental_invoices i
    LEFT JOIN public.rental_group_labels l
      ON l.owner_id = i.owner_id AND l.cnpj_raiz = i.cnpj_raiz
    WHERE i.owner_id = public.team_owner()
      AND i.month >= date_trunc('month',_from)::date
      AND i.month <= date_trunc('month',_to)::date
    GROUP BY i.cnpj_raiz, l.label
  ),
  tot AS (SELECT COALESCE(SUM(total),0) t FROM base)
  SELECT cliente, cnpj_raiz, total::numeric, faturas,
         CASE WHEN (SELECT t FROM tot) > 0 THEN ROUND(total/(SELECT t FROM tot)*100,2) ELSE 0 END,
         uf
  FROM base
  ORDER BY total DESC
  LIMIT GREATEST(_limite,1);
$$;


--
-- Name: dashboard_top_produtos(date, date, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.dashboard_top_produtos(_from date, _to date, _limite integer DEFAULT 5) RETURNS TABLE(titulo text, sku text, unidades numeric, receita numeric, participacao_pct numeric, thumbnail text, permalink text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH ids AS (
    SELECT COALESCE(array_agg(id),'{}'::uuid[]) arr
    FROM public.marketplace_accounts WHERE owner_id = public.team_owner()
  ),
  a AS (
    SELECT titulo, seller_sku,
           SUM(unidades) unidades, SUM(receita) receita,
           MAX(thumbnail) thumbnail, MAX(permalink) permalink
    FROM public.anuncios_margem((SELECT arr FROM ids), _from, _to)
    GROUP BY titulo, seller_sku
  ),
  tot AS (SELECT COALESCE(SUM(receita),0) t FROM a)
  SELECT a.titulo, a.seller_sku, a.unidades::numeric, a.receita::numeric,
         CASE WHEN (SELECT t FROM tot)>0 THEN ROUND(a.receita/(SELECT t FROM tot)*100,2) ELSE 0 END,
         a.thumbnail, a.permalink
  FROM a WHERE a.receita>0
  ORDER BY a.receita DESC
  LIMIT GREATEST(_limite,1);
$$;


--
-- Name: FUNCTION dashboard_top_produtos(_from date, _to date, _limite integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.dashboard_top_produtos(_from date, _to date, _limite integer) IS 'Usa todas as contas do time, inclusive as desativadas: desativar uma conta interrompe a sincronizacao mas nao apaga o historico de vendas. Mesmo conjunto de contas usado por dashboard_kpis_op.';


--
-- Name: delete_cost_history(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_cost_history(_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_owner uuid := public.team_owner();
  v_sku text;
BEGIN
  SELECT sku INTO v_sku FROM public.product_cost_history
  WHERE id = _id AND public.is_team_owner(owner_id);
  IF v_sku IS NULL THEN RAISE EXCEPTION 'Registro não encontrado'; END IF;

  DELETE FROM public.product_cost_history WHERE id = _id AND public.is_team_owner(owner_id);
  PERFORM public.recompute_sku_cost(v_owner, v_sku);
END;
$$;


--
-- Name: delete_faturamento_externo(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_faturamento_externo(_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  DELETE FROM public.faturamento_externo WHERE id=_id AND public.is_team_owner(owner_id);
END; $$;


--
-- Name: delete_sku(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_sku(_sku text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_owner uuid := public.team_owner();
BEGIN
  IF v_owner IS NULL OR NOT EXISTS (SELECT 1 FROM public.my_screens() s WHERE s.screen_key IN ('*', 'custos')) THEN
    RAISE EXCEPTION 'Sem permissão para excluir SKU';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.product_skus s WHERE s.owner_id = v_owner AND btrim(s.sku) = btrim(_sku)) THEN
    RAISE EXCEPTION 'SKU não encontrado';
  END IF;

  DELETE FROM public.product_skus s WHERE s.owner_id = v_owner AND btrim(s.sku) = btrim(_sku);
  DELETE FROM public.product_cost_history h WHERE h.owner_id = v_owner AND btrim(h.sku) = btrim(_sku);
  DELETE FROM public.sku_item_links l WHERE l.owner_id = v_owner AND btrim(l.seller_sku) = btrim(_sku);
  DELETE FROM public.kit_components k WHERE k.owner_id = v_owner AND (btrim(k.kit_sku) = btrim(_sku) OR btrim(k.component_sku) = btrim(_sku));
END;
$$;


--
-- Name: ensure_product_skus_from_ml(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_product_skus_from_ml(_account_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_owner uuid;
  v_inserted integer := 0;
BEGIN
  SELECT owner_id INTO v_owner FROM public.marketplace_accounts WHERE id = _account_id;
  IF v_owner IS NULL THEN RETURN 0; END IF;

  WITH src AS (
    SELECT btrim(i.seller_sku) AS sku, max(i.title) AS titulo
    FROM public.ml_items i
    WHERE i.account_id = _account_id AND btrim(coalesce(i.seller_sku,'')) <> ''
    GROUP BY btrim(i.seller_sku)
    UNION
    SELECT btrim(oi.seller_sku) AS sku, max(oi.title) AS titulo
    FROM public.ml_order_items oi
    WHERE oi.account_id = _account_id AND btrim(coalesce(oi.seller_sku,'')) <> ''
    GROUP BY btrim(oi.seller_sku)
  ), agg AS (
    SELECT sku, max(titulo) AS titulo FROM src GROUP BY sku
  ), ins AS (
    INSERT INTO public.product_skus (owner_id, sku, titulo, custo_base, ativo, is_kit)
    SELECT v_owner, a.sku, a.titulo, NULL, true, false FROM agg a
    ON CONFLICT (owner_id, sku) DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int INTO v_inserted FROM ins;

  -- preenche apenas títulos vazios de SKUs já existentes
  UPDATE public.product_skus ps
  SET titulo = a.titulo, updated_at = now()
  FROM (
    SELECT btrim(seller_sku) AS sku, max(title) AS titulo
    FROM public.ml_items WHERE account_id = _account_id AND btrim(coalesce(seller_sku,'')) <> ''
    GROUP BY btrim(seller_sku)
  ) a
  WHERE ps.owner_id = v_owner AND ps.sku = a.sku
    AND coalesce(btrim(ps.titulo), '') = '' AND coalesce(btrim(a.titulo),'') <> '';

  RETURN v_inserted;
END;
$$;


--
-- Name: estado_da_sincronizacao(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.estado_da_sincronizacao() RETURNS TABLE(account_id uuid, conta text, situacao text, ultima_sincronizacao timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select a.id,
         coalesce(nullif(btrim(a.trade_name), ''), a.nickname),
         case when a.status <> 'conectada' then 'desconectada'
              when t.status = 'erro' then 'token_falhou'
              when s.ultima is null or s.ultima < now() - interval '6 hours' then 'atrasada'
              else 'ok' end,
         s.ultima
    from marketplace_accounts a
    left join lateral (
      select l.status from sync_logs l
       where l.account_id = a.id and l.sync_type = 'token_refresh'
       order by l.started_at desc limit 1) t on true
    left join lateral (
      select max(l.started_at) as ultima from sync_logs l
       where l.account_id = a.id and l.status in ('sucesso', 'parcial')
         and l.sync_type not in ('audit', 'token_refresh', 'periods', 'enqueue', 'backfill', 'liberacoes')) s on true
   where a.owner_id = public.team_owner() and a.platform = 'mercado_livre';
$$;


--
-- Name: excluir_recorrencia(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.excluir_recorrencia(_owner uuid, _recorrencia_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_owner uuid := public.team_owner();
BEGIN
  PERFORM 1 FROM public.payable_recurrences WHERE id = _recorrencia_id AND public.is_team_owner(owner_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Recorrência não encontrada'; END IF;

  DELETE FROM public.payable_notes n
  WHERE n.recorrencia_id = _recorrencia_id AND n.owner_id = v_owner
    AND NOT EXISTS (
      SELECT 1 FROM public.payable_installments pi
      WHERE pi.note_id = n.id AND (pi.status='paga' OR pi.planilha_lancado=true)
    );

  UPDATE public.payable_notes SET recorrencia_id = NULL
  WHERE recorrencia_id = _recorrencia_id AND owner_id = v_owner;

  DELETE FROM public.payable_recurrences WHERE id = _recorrencia_id;
END;
$$;


--
-- Name: expense_sheet(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.expense_sheet(_owner uuid, _year integer) RETURNS TABLE(category_id uuid, category_name text, category_kind text, category_sort integer, expense_id uuid, expense_name text, expense_sort integer, month date, amount numeric, amount_ecommerce numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH months AS (
    SELECT (make_date(_year, m, 1))::date AS month
    FROM generate_series(1,12) m
  ),
  base AS (
    SELECT
      c.id AS category_id, c.name AS category_name, c.kind AS category_kind, c.sort_order AS category_sort,
      e.id AS expense_id, e.name AS expense_name, e.sort_order AS expense_sort,
      CASE WHEN e.ecommerce_override THEN e.ecommerce_mode ELSE c.ecommerce_mode END AS eff_mode,
      CASE WHEN e.ecommerce_override THEN e.ecommerce_percent ELSE c.ecommerce_percent END AS eff_percent,
      CASE WHEN e.ecommerce_override THEN e.ecommerce_amount ELSE c.ecommerce_amount END AS eff_amount
    FROM public.expenses e
    JOIN public.expense_categories c ON c.id = e.category_id
    WHERE e.owner_id = public.team_owner()
  )
  SELECT
    b.category_id, b.category_name, b.category_kind, b.category_sort,
    b.expense_id, b.expense_name, b.expense_sort,
    mm.month,
    COALESCE(v.amount, 0)::numeric AS amount,
    COALESCE(v.ecommerce_valor_conta, (CASE
      WHEN b.eff_mode = 'percent' THEN COALESCE(v.amount,0) * b.eff_percent / 100
      ELSE LEAST(b.eff_amount, COALESCE(v.amount,0))
    END))::numeric AS amount_ecommerce
  FROM base b
  CROSS JOIN months mm
  LEFT JOIN public.expense_values v
    ON v.expense_id = b.expense_id AND v.month = mm.month
  ORDER BY b.category_sort, b.category_name, b.expense_sort, b.expense_name, mm.month;
$$;


--
-- Name: expense_sheet_previsto(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.expense_sheet_previsto(_owner uuid, _year integer) RETURNS TABLE(categoria_efetiva_id uuid, gasto_id uuid, mes date, valor numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    CASE WHEN n.tipo_conta = 'fornecedor' THEN n.subcategoria_id ELSE n.categoria_id END AS categoria_efetiva_id,
    n.gasto_id,
    date_trunc('month', pi.vencimento)::date AS mes,
    SUM(pi.valor)::numeric AS valor
  FROM public.payable_installments pi
  JOIN public.payable_notes n ON n.id = pi.note_id
  WHERE public.is_team_owner(n.owner_id)
    AND pi.status = 'aberta'
    AND pi.planilha_lancado = false
    AND pi.vencimento IS NOT NULL
    AND EXTRACT(YEAR FROM pi.vencimento) = _year
    AND (CASE WHEN n.tipo_conta = 'fornecedor' THEN n.subcategoria_id ELSE n.categoria_id END) IS NOT NULL
  GROUP BY 1, 2, 3;
$$;


--
-- Name: expense_values_guarda_conta(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.expense_values_guarda_conta() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF current_setting('app.planilha_sync', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.tem_conta THEN
    NEW.previsto := NEW.amount;
    NEW.amount := OLD.amount;
    NEW.tem_conta := true;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' AND OLD.tem_conta THEN
    PERFORM set_config('app.planilha_sync', 'on', true);
    UPDATE public.expense_values SET previsto = NULL, updated_at = now() WHERE id = OLD.id;
    PERFORM set_config('app.planilha_sync', 'off', true);
    RETURN NULL;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: force_owner_to_team(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.force_owner_to_team() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.owner_id := public.team_owner();
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: fracao_do_mes(date, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fracao_do_mes(_mes date, _from date, _to date) RETURNS numeric
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select case
    when _mes is null or _from is null or _to is null then 0
    else greatest(
      0,
      (least(_to, (date_trunc('month', _mes::timestamp) + interval '1 month - 1 day')::date)
       - greatest(_from, date_trunc('month', _mes::timestamp)::date) + 1)::numeric
    ) / extract(day from (date_trunc('month', _mes::timestamp) + interval '1 month - 1 day'))::numeric
  end;
$$;


--
-- Name: gerar_contas_recorrencia(uuid, uuid, date, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gerar_contas_recorrencia(_owner uuid, _recorrencia_id uuid, _mes_inicial date, _meses integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  r public.payable_recurrences%ROWTYPE;
  m date;
  i int;
  v_note uuid;
  v_venc date;
  criadas int := 0;
  dia int;
  v_owner uuid := public.team_owner();
BEGIN
  SELECT * INTO r FROM public.payable_recurrences
  WHERE id = _recorrencia_id AND public.is_team_owner(owner_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Recorrência não encontrada'; END IF;

  dia := LEAST(GREATEST(r.dia_vencimento,1),31);
  m := date_trunc('month', _mes_inicial)::date;

  FOR i IN 0.._meses-1 LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.payable_notes
      WHERE recorrencia_id = _recorrencia_id AND competencia_mes = (m + (i || ' months')::interval)::date
        AND owner_id = v_owner
    ) THEN
      v_venc := LEAST(
        (m + (i || ' months')::interval)::date + (dia - 1),
        (date_trunc('month', (m + (i || ' months')::interval)::date) + interval '1 month - 1 day')::date
      );
      INSERT INTO public.payable_notes
        (owner_id, chave_nfe, numero_nota, fornecedor_nome, fornecedor_cnpj, data_emissao,
         valor_total, valor_produtos, valor_frete, valor_outros, destino,
         subcategoria_id, categoria_id, gasto_id, tipo_conta,
         ecommerce_mode, ecommerce_percent, ecommerce_amount, recorrencia_id, competencia_mes)
      VALUES
        (v_owner, NULL, NULL, r.nome, NULL, v_venc,
         r.valor, NULL, 0, 0, r.destino,
         r.subcategoria_id, r.categoria_id, r.gasto_id, r.tipo_conta,
         r.ecommerce_mode, r.ecommerce_percent, r.ecommerce_amount,
         _recorrencia_id, (m + (i || ' months')::interval)::date)
      RETURNING id INTO v_note;
      INSERT INTO public.payable_installments (owner_id, note_id, numero, vencimento, valor, status)
      VALUES (v_owner, v_note, '001', v_venc, r.valor, 'aberta');
      criadas := criadas + 1;
    END IF;
  END LOOP;
  RETURN criadas;
END;
$$;


--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.account_members
     where member_id = auth.uid() and (root_owner_id = auth.uid() or administrador)
  );
$$;


--
-- Name: is_team_owner(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_team_owner(_owner uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT _owner = public.team_owner();
$$;


--
-- Name: kit_cost(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.kit_cost(_owner uuid, _kit_sku text) RETURNS numeric
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(SUM(ps.custo_base * kc.quantity), 0)::numeric
  FROM public.kit_components kc
  JOIN public.product_skus ps ON ps.owner_id = kc.owner_id AND ps.sku = kc.component_sku
  WHERE kc.owner_id = public.team_owner() AND kc.kit_sku = _kit_sku;
$$;


--
-- Name: kit_recipe(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.kit_recipe(_owner uuid, _kit_sku text) RETURNS TABLE(component_sku text, titulo text, quantity integer, custo_unit numeric, custo_total numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT kc.component_sku, ps.titulo, kc.quantity, ps.custo_base AS custo_unit,
         (COALESCE(ps.custo_base,0) * kc.quantity)::numeric AS custo_total
  FROM public.kit_components kc
  LEFT JOIN public.product_skus ps ON ps.owner_id = kc.owner_id AND ps.sku = kc.component_sku
  WHERE kc.owner_id = public.team_owner() AND kc.kit_sku = _kit_sku
  ORDER BY kc.component_sku;
$$;


--
-- Name: list_categorias_arvore(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_categorias_arvore(_owner uuid) RETURNS TABLE(id uuid, name text, parent_id uuid, parent_name text, is_fornecedores boolean, allow_subcategories boolean, nivel integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    c.id, c.name, c.parent_category_id,
    p.name AS parent_name,
    (c.parent_category_id IS NULL AND lower(c.name) = 'fornecedores') AS is_fornecedores,
    c.allow_subcategories,
    CASE WHEN c.parent_category_id IS NULL THEN 0 ELSE 1 END AS nivel
  FROM public.expense_categories c
  LEFT JOIN public.expense_categories p ON p.id = c.parent_category_id
  WHERE public.is_team_owner(c.owner_id)
  ORDER BY
    COALESCE(p.name, c.name),
    (c.parent_category_id IS NULL) DESC,
    c.name;
$$;


--
-- Name: list_fornecedores(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_fornecedores(_owner uuid) RETURNS TABLE(id uuid, name text, cnpj text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT c.id, c.name, c.cnpj
  FROM public.expense_categories c
  WHERE public.is_team_owner(c.owner_id)
    AND c.parent_category_id = (
      SELECT id FROM public.expense_categories
      WHERE owner_id = public.team_owner() AND parent_category_id IS NULL
        AND name ILIKE 'fornecedores' AND allow_subcategories = true
      LIMIT 1
    )
  ORDER BY c.name;
$$;


--
-- Name: list_gastos_da_subcategoria(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_gastos_da_subcategoria(_owner uuid, _subcategoria_id uuid) RETURNS TABLE(id uuid, name text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT e.id, e.name
  FROM public.expenses e
  WHERE public.is_team_owner(e.owner_id) AND e.category_id = _subcategoria_id
  ORDER BY e.name;
$$;


--
-- Name: list_meses_recorrencia(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_meses_recorrencia(_owner uuid, _recorrencia_id uuid) RETURNS TABLE(note_id uuid, competencia_mes date, vencimento date, valor numeric, status text, pago_em date, planilha_lancado boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT n.id, n.competencia_mes, pi.vencimento, pi.valor, pi.status, pi.pago_em, pi.planilha_lancado
  FROM public.payable_notes n
  JOIN public.payable_installments pi ON pi.note_id = n.id
  WHERE n.recorrencia_id = _recorrencia_id AND public.is_team_owner(n.owner_id)
  ORDER BY n.competencia_mes;
$$;


--
-- Name: list_recorrencias(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_recorrencias(_owner uuid) RETURNS TABLE(id uuid, nome text, valor numeric, dia_vencimento integer, ativo boolean, categoria_id uuid, subcategoria_id uuid, gasto_id uuid, tipo_conta text, destino text, ecommerce_mode text, ecommerce_percent numeric, ecommerce_amount numeric, contas_geradas integer, contas_abertas integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT r.id, r.nome, r.valor, r.dia_vencimento, r.ativo,
         r.categoria_id, r.subcategoria_id, r.gasto_id, r.tipo_conta,
         r.destino, r.ecommerce_mode, r.ecommerce_percent, r.ecommerce_amount,
         (SELECT count(*)::int FROM public.payable_notes n WHERE n.recorrencia_id = r.id) AS contas_geradas,
         (SELECT count(*)::int FROM public.payable_notes n
            JOIN public.payable_installments pi ON pi.note_id = n.id
            WHERE n.recorrencia_id = r.id AND pi.status='aberta') AS contas_abertas
  FROM public.payable_recurrences r
  WHERE public.is_team_owner(r.owner_id)
  ORDER BY r.nome;
$$;


--
-- Name: marketplace_accounts_vault_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.marketplace_accounts_vault_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.client_secret IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.client_secret IS DISTINCT FROM OLD.client_secret) THEN
    NEW.client_secret_id := public.vault_set_secret(
      'ml_' || NEW.id::text || '_client_secret',
      NEW.client_secret,
      NEW.client_secret_id
    );
    NEW.client_secret := NULL;
  END IF;

  IF NEW.access_token IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.access_token IS DISTINCT FROM OLD.access_token) THEN
    NEW.access_token_id := public.vault_set_secret(
      'ml_' || NEW.id::text || '_access_token',
      NEW.access_token,
      NEW.access_token_id
    );
    NEW.access_token := NULL;
  END IF;

  IF NEW.refresh_token IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.refresh_token IS DISTINCT FROM OLD.refresh_token) THEN
    NEW.refresh_token_id := public.vault_set_secret(
      'ml_' || NEW.id::text || '_refresh_token',
      NEW.refresh_token,
      NEW.refresh_token_id
    );
    NEW.refresh_token := NULL;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: match_installments_by_approx(uuid, numeric, date, numeric, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_installments_by_approx(_owner uuid, _valor numeric, _data date, _tol_percent numeric DEFAULT 4, _tol_dias integer DEFAULT 4) RETURNS TABLE(installment_id uuid, note_id uuid, fornecedor_nome text, numero_nota text, vencimento date, valor numeric, categoria_id uuid, subcategoria_id uuid, gasto_id uuid, tipo_conta text, destino text, diff_valor numeric, diff_dias integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    pi.id AS installment_id,
    n.id AS note_id,
    n.fornecedor_nome,
    n.numero_nota,
    pi.vencimento,
    pi.valor,
    n.categoria_id,
    n.subcategoria_id,
    n.gasto_id,
    n.tipo_conta,
    n.destino,
    abs(pi.valor - _valor) AS diff_valor,
    abs(pi.vencimento - _data) AS diff_dias
  FROM public.payable_installments pi
  JOIN public.payable_notes n ON n.id = pi.note_id
  WHERE public.is_team_owner(pi.owner_id)
    AND pi.status = 'aberta'
    AND pi.planilha_lancado = false
    AND _valor > 0
    AND abs(pi.valor - _valor) <= (_valor * _tol_percent / 100.0)
    AND (pi.vencimento IS NULL OR abs(pi.vencimento - _data) <= _tol_dias)
  ORDER BY
    -- melhor match primeiro: prioriza proximidade de valor, depois de data
    (abs(pi.valor - _valor) / NULLIF(_valor,0)) + (abs(COALESCE(pi.vencimento,_data) - _data)::numeric / 100.0) ASC
  LIMIT 20;
$$;


--
-- Name: match_payable_item(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_payable_item(_owner uuid, _item_id uuid, _meu_sku text) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_item public.payable_items%ROWTYPE;
  v_note public.payable_notes%ROWTYPE;
  v_custo numeric;
  v_custo_unit numeric;
  v_fator numeric;
  v_exists boolean;
  v_owner uuid := public.team_owner();
BEGIN
  SELECT * INTO v_item FROM public.payable_items
  WHERE id = _item_id AND public.is_team_owner(owner_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Item não encontrado'; END IF;

  SELECT * INTO v_note FROM public.payable_notes WHERE id = v_item.note_id;

  UPDATE public.payable_items SET meu_sku = _meu_sku WHERE id = _item_id;

  IF v_item.fornecedor_sku IS NOT NULL AND length(trim(v_item.fornecedor_sku)) > 0 THEN
    INSERT INTO public.sku_translation_rules (owner_id, fornecedor_sku, meu_sku)
    VALUES (v_owner, v_item.fornecedor_sku, _meu_sku)
    ON CONFLICT (owner_id, fornecedor_sku)
    DO UPDATE SET meu_sku = EXCLUDED.meu_sku, updated_at = now();
  END IF;

  -- fator de embalagem: quantas unidades de venda vêm em cada unidade comprada na nota (caixa/fardo)
  v_fator := NULLIF(COALESCE(v_item.unidades_por_embalagem, 1), 0);
  IF v_fator IS NULL THEN v_fator := 1; END IF;

  -- custo unitário = (valor unitário da nota + frete rateado por unidade da nota) / unidades por embalagem
  v_custo_unit := (
    COALESCE(v_item.valor_unitario, 0)
    + CASE WHEN COALESCE(v_item.quantidade,0) > 0
           THEN COALESCE(v_item.frete_rateado,0) / v_item.quantidade
           ELSE 0 END
  ) / v_fator;

  SELECT EXISTS(
    SELECT 1 FROM public.product_cost_history
    WHERE owner_id = v_owner AND item_id = _item_id AND sku = _meu_sku
  ) INTO v_exists;

  IF NOT v_exists THEN
    DELETE FROM public.product_cost_history
    WHERE owner_id = v_owner AND item_id = _item_id AND sku <> _meu_sku;

    INSERT INTO public.product_cost_history
      (owner_id, sku, valor_unitario, origem, data_nota, numero_nota, note_id, item_id)
    VALUES
      (v_owner, _meu_sku, v_custo_unit, 'nota',
       v_note.data_emissao, v_note.numero_nota, v_item.note_id, _item_id);
  ELSE
    UPDATE public.product_cost_history
    SET valor_unitario = v_custo_unit,
        data_nota = v_note.data_emissao,
        numero_nota = v_note.numero_nota
    WHERE owner_id = v_owner AND item_id = _item_id AND sku = _meu_sku;
  END IF;

  v_custo := public.recompute_sku_cost(v_owner, _meu_sku);
  RETURN v_custo;
END;
$$;


--
-- Name: ml_ads_periodo(uuid[], date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ml_ads_periodo(_account_ids uuid[], _from date, _to date) RETURNS TABLE(account_id uuid, ads_faturado numeric, ads_diario numeric, ads_ancora numeric, fator numeric, ads_nao_atribuido numeric, dias_com_dado integer, dias_esperados integer, cobertura_ok boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with contas as (select unnest(public.contas_permitidas(_account_ids)) as account_id),
  esperado as (
    select greatest(least(_to, (now() at time zone 'America/Sao_Paulo')::date) - _from + 1, 0)::int as dias
  ),
  fat as (
    select n.account_id, sum(n.valor)::numeric v
    from public.ml_billing_norm n
    where n.account_id = any(public.contas_permitidas(_account_ids)) and n.category='ads'
      and (n.transaction_date at time zone 'America/Sao_Paulo')::date between _from and _to
    group by 1
  ),
  dia as (
    select a.account_id, sum(coalesce(a.cost,0))::numeric v, count(distinct a.date)::int d
    from public.ml_ads_daily a
    where a.account_id = any(public.contas_permitidas(_account_ids)) and a.date between _from and _to
    group by 1
  ),
  calc as (
    select c.account_id, coalesce(f.v,0) as faturado, coalesce(d.v,0) as diario,
      greatest(coalesce(f.v,0), coalesce(d.v,0)) as ancora,
      coalesce(d.d,0) as dias_com_dado, (select dias from esperado) as dias_esperados,
      (coalesce(d.d,0) > 0 and coalesce(d.d,0) >= (select dias from esperado)) as cobertura_ok
    from contas c
    left join fat f on f.account_id = c.account_id
    left join dia d on d.account_id = c.account_id
  )
  select k.account_id, k.faturado, k.diario, k.ancora,
    case when k.cobertura_ok and k.diario > 0 then k.ancora / k.diario else 1 end::numeric,
    case when k.cobertura_ok and k.diario > 0 then 0 else k.ancora - k.diario end::numeric,
    k.dias_com_dado, k.dias_esperados, k.cobertura_ok
  from calc k;
$$;


--
-- Name: ml_available_dates(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ml_available_dates(_account_ids uuid[]) RETURNS TABLE(dia date)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT DISTINCT (o.date_created AT TIME ZONE 'America/Sao_Paulo')::date
  FROM ml_orders o
  WHERE o.account_id = ANY(_account_ids)
    AND public.owns_account(o.account_id)
  ORDER BY 1;
$$;


--
-- Name: ml_cmv(uuid[], date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ml_cmv(_account_ids uuid[], _from date, _to date) RETURNS TABLE(account_id uuid, cmv numeric, receita_com_custo numeric, receita_total numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select r.account_id,
         coalesce(sum(r.cmv) filter (where not r.cmv_missing), 0)::numeric,
         coalesce(sum(r.receita_produto) filter (where not r.cmv_missing), 0)::numeric,
         coalesce(sum(r.receita_produto), 0)::numeric
  from public.mp_reconciliation(public.contas_permitidas(_account_ids), _from, _to) r
  group by r.account_id;
$$;


--
-- Name: ml_commission_breakdown(uuid[], date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ml_commission_breakdown(_account_ids uuid[], _from date, _to date) RETURNS TABLE(label text, amount numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '20s'
    AS $$
BEGIN
  IF _account_ids IS NULL OR array_length(_account_ids, 1) IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM unnest(_account_ids) AS x(id) WHERE NOT public.owns_account(x.id)) THEN RETURN; END IF;

  RETURN QUERY
  WITH ok AS (
    SELECT o.id, o.order_id FROM ml_orders o
    WHERE o.account_id = ANY(_account_ids)
      AND o.status IN ('paid','shipped','delivered','partially_refunded')
      AND (o.date_created AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN _from AND _to
  ),
  b AS (
    SELECT n.detail_sub_type, sum(n.valor) AS v
    FROM public.ml_billing_norm n JOIN ok ON ok.order_id = n.order_id
    WHERE n.category IN ('comissao','parcelamento')
    GROUP BY 1
  ),
  ponte AS (
    SELECT sum(ci.comissao) - COALESCE((SELECT sum(v) FROM b WHERE detail_sub_type NOT IN ('CFONPN','BFONPN')),0) AS v
    FROM public.ml_comissao_item ci JOIN ok ON ok.id = ci.order_ref
  )
  SELECT 'Custo por vender no Mercado Livre'::text,
         COALESCE((SELECT sum(v) FROM b WHERE detail_sub_type IN ('CVVML','BVVML','CV')),0)::numeric
  UNION ALL
  SELECT 'Custo por cobrar no Mercado Pago'::text,
         COALESCE((SELECT sum(v) FROM b WHERE detail_sub_type IN ('CVVPRC','BVVPRC')),0)::numeric
  UNION ALL
  SELECT 'Taxa de parcelamento (vendedor)'::text,
         COALESCE((SELECT sum(v) FROM b WHERE detail_sub_type IN ('CVVFN','BVVFN')),0)::numeric
  UNION ALL
  SELECT 'Taxa de recebimento'::text,
         COALESCE((SELECT sum(v) FROM b WHERE detail_sub_type IN ('CVVFNU','BVVFNU')),0)::numeric
  UNION ALL
  SELECT 'Pedidos ainda sem fatura (estimado pela tarifa do anúncio)'::text,
         GREATEST(COALESCE((SELECT v FROM ponte),0),0)::numeric
  UNION ALL
  SELECT 'Acréscimo de parcelamento pago pelo comprador (repasse, fora da margem)'::text,
         COALESCE((SELECT sum(v) FROM b WHERE detail_sub_type IN ('CFONPN','BFONPN')),0)::numeric;
END;
$$;


--
-- Name: FUNCTION ml_commission_breakdown(_account_ids uuid[], _from date, _to date); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.ml_commission_breakdown(_account_ids uuid[], _from date, _to date) IS 'Regime de competencia. As quatro primeiras linhas somam exatamente a comissao usada nas telas de margem; a quinta cobre pedidos ainda nao faturados. A ultima e repasse e nao entra na margem.';


--
-- Name: ml_cost_trends(uuid[], integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ml_cost_trends(_account_ids uuid[], _months integer DEFAULT 4) RETURNS TABLE(metric text, account_id uuid, months_rising integer, pct_change numeric, avg_pct_of_revenue_first numeric, avg_pct_of_revenue_last numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  m integer;
  months integer;
  today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  first_month date;
  aid uuid;
  valid_ids uuid[];
BEGIN
  months := GREATEST(2, LEAST(COALESCE(_months, 4), 24));

  SELECT COALESCE(array_agg(a), ARRAY[]::uuid[])
    INTO valid_ids
  FROM unnest(_account_ids) a
  WHERE public.owns_account(a);

  IF valid_ids IS NULL OR array_length(valid_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  first_month := date_trunc('month', today - interval '1 month')::date - ((months - 1) || ' months')::interval;

  FOREACH aid IN ARRAY valid_ids LOOP
    DECLARE
      pct_commissions numeric[] := ARRAY[]::numeric[];
      pct_shipping numeric[] := ARRAY[]::numeric[];
      pct_fulfillment numeric[] := ARRAY[]::numeric[];
      pct_ads numeric[] := ARRAY[]::numeric[];
      pct_other numeric[] := ARRAY[]::numeric[];
      mo_start date;
      mo_end date;
      rev numeric;
      r record;
    BEGIN
      FOR m IN 0..(months - 1) LOOP
        mo_start := (first_month + (m || ' months')::interval)::date;
        mo_end := (date_trunc('month', mo_start) + interval '1 month - 1 day')::date;

        SELECT * INTO r FROM public.ml_metrics(ARRAY[aid]::uuid[], mo_start, mo_end) LIMIT 1;
        rev := COALESCE(r.revenue, 0);
        IF rev <= 0 THEN
          pct_commissions := pct_commissions || NULL::numeric;
          pct_shipping := pct_shipping || NULL::numeric;
          pct_fulfillment := pct_fulfillment || NULL::numeric;
          pct_ads := pct_ads || NULL::numeric;
          pct_other := pct_other || NULL::numeric;
        ELSE
          pct_commissions := pct_commissions || (COALESCE(r.commissions, 0) / rev * 100);
          pct_shipping := pct_shipping || (COALESCE(r.shipping, 0) / rev * 100);
          pct_fulfillment := pct_fulfillment || (COALESCE(r.fulfillment, 0) / rev * 100);
          pct_ads := pct_ads || (COALESCE(r.ads, 0) / rev * 100);
          pct_other := pct_other || (COALESCE(r.other, 0) / rev * 100);
        END IF;
      END LOOP;

      RETURN QUERY
      SELECT x.metric, x.account_id, x.months_rising, x.pct_change, x.avg_first, x.avg_last
      FROM (
        VALUES
          ('comissoes'::text, pct_commissions),
          ('fretes',    pct_shipping),
          ('full',      pct_fulfillment),
          ('ads',       pct_ads),
          ('outros',    pct_other)
      ) AS v(metric_name, arr)
      CROSS JOIN LATERAL (
        SELECT
          v.metric_name AS metric,
          aid AS account_id,
          (
            WITH s AS (
              SELECT idx, val FROM (
                SELECT generate_subscripts(v.arr, 1) AS idx, unnest(v.arr) AS val
              ) t
              ORDER BY idx
            ),
            pairs AS (
              SELECT idx, val, LAG(val) OVER (ORDER BY idx) AS prev_val
              FROM s
            ),
            flags AS (
              SELECT idx,
                CASE
                  WHEN val IS NULL OR prev_val IS NULL THEN 0
                  WHEN val > prev_val THEN 1
                  ELSE 0
                END AS rising
              FROM pairs
              WHERE idx > 1
            ),
            tail AS (
              SELECT idx, rising,
                SUM(CASE WHEN rising = 0 THEN 1 ELSE 0 END) OVER (ORDER BY idx DESC) AS breaks
              FROM flags
            )
            SELECT COALESCE(COUNT(*), 0)::integer FROM tail WHERE breaks = 0 AND rising = 1
          ) AS months_rising,
          CASE
            WHEN v.arr[array_length(v.arr,1)] IS NULL OR v.arr[1] IS NULL OR v.arr[1] = 0 THEN NULL
            ELSE ((v.arr[array_length(v.arr,1)] - v.arr[1]) / v.arr[1]) * 100
          END AS pct_change,
          v.arr[1] AS avg_first,
          v.arr[array_length(v.arr,1)] AS avg_last
      ) x;
    END;
  END LOOP;
END;
$$;


--
-- Name: ml_custos_competencia(uuid[], date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ml_custos_competencia(_account_ids uuid[], _from date, _to date) RETURNS TABLE(account_id uuid, comissao numeric, frete numeric, estorno numeric, ads numeric, full_periodo numeric, outros numeric, custo_ml numeric, parcelamento numeric, imposto numeric, cmv numeric, vendas_sem_custo bigint, vendas_sem_aliquota bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with permitidas as (select public.contas_permitidas(_account_ids) as a),
  r as (select * from public.mp_reconciliation((select a from permitidas), _from, _to)),
  ped as (
    select r.account_id,
      sum(r.fee_comissao + r.fee_cobranca)::numeric as comissao,
      sum(r.fee_frete)::numeric as frete,
      sum(r.fee_outros)::numeric as outros,
      sum(r.fee_parcelamento)::numeric as parcelamento,
      sum(r.imposto)::numeric as imposto,
      coalesce(sum(r.cmv) filter (where not r.cmv_missing), 0)::numeric as cmv,
      count(*) filter (where r.cmv_missing)::bigint as sem_custo,
      count(*) filter (where r.imposto_missing)::bigint as sem_aliquota
    from r group by 1
  ),
  per as (
    select b.account_id,
      sum(case when b.category='full'   then b.valor else 0 end)::numeric full_periodo,
      sum(case when b.category='outros' then b.valor else 0 end)::numeric outros
    from public.ml_billing_norm b
    where b.account_id = any(public.contas_permitidas(_account_ids))
      and b.escopo='periodo' and b.conta_no_custo and b.category <> 'ads'
      and (b.transaction_date at time zone 'America/Sao_Paulo')::date >= _from
      and (b.transaction_date at time zone 'America/Sao_Paulo')::date <= _to
    group by 1
  ),
  adsp as (select ap.account_id, ap.ads_ancora from public.ml_ads_periodo(_account_ids, _from, _to) ap),
  contas as (select unnest((select a from permitidas)) as account_id)
  select i.account_id,
    coalesce(pd.comissao,0), coalesce(pd.frete,0), 0::numeric,
    coalesce(ap.ads_ancora,0), coalesce(pr.full_periodo,0),
    coalesce(pd.outros,0) + coalesce(pr.outros,0),
    coalesce(pd.comissao,0) + coalesce(pd.frete,0) + coalesce(pd.parcelamento,0) + coalesce(pd.imposto,0)
      + coalesce(ap.ads_ancora,0) + coalesce(pr.full_periodo,0)
      + coalesce(pd.outros,0) + coalesce(pr.outros,0),
    coalesce(pd.parcelamento,0), coalesce(pd.imposto,0), coalesce(pd.cmv,0),
    coalesce(pd.sem_custo,0), coalesce(pd.sem_aliquota,0)
  from contas i
  left join ped pd on pd.account_id = i.account_id
  left join per pr on pr.account_id = i.account_id
  left join adsp ap on ap.account_id = i.account_id;
$$;


--
-- Name: ml_custos_competencia_mes(uuid[], date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ml_custos_competencia_mes(_account_ids uuid[], _from date, _to date) RETURNS TABLE(mes date, account_id uuid, comissao numeric, frete numeric, estorno numeric, ads numeric, full_periodo numeric, outros numeric, custo_ml numeric, parcelamento numeric, imposto numeric, cmv numeric, vendas_sem_custo bigint, vendas_sem_aliquota bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with permitidas as (select public.contas_permitidas(_account_ids) as a),
  r as (select * from public.mp_reconciliation((select a from permitidas), _from, _to)),
  ped as (
    select date_trunc('month', r.order_date at time zone 'America/Sao_Paulo')::date as mes, r.account_id,
      sum(r.fee_comissao + r.fee_cobranca)::numeric as comissao,
      sum(r.fee_frete)::numeric as frete,
      sum(r.fee_outros)::numeric as outros,
      sum(r.fee_parcelamento)::numeric as parcelamento,
      sum(r.imposto)::numeric as imposto,
      coalesce(sum(r.cmv) filter (where not r.cmv_missing), 0)::numeric as cmv,
      count(*) filter (where r.cmv_missing)::bigint as sem_custo,
      count(*) filter (where r.imposto_missing)::bigint as sem_aliquota
    from r group by 1, 2
  ),
  per as (
    select date_trunc('month', (b.transaction_date at time zone 'America/Sao_Paulo'))::date mes,
      b.account_id,
      sum(case when b.category='full'   then b.valor else 0 end)::numeric full_periodo,
      sum(case when b.category='outros' then b.valor else 0 end)::numeric outros
    from public.ml_billing_norm b
    where b.account_id = any(public.contas_permitidas(_account_ids))
      and b.escopo='periodo' and b.conta_no_custo and b.category <> 'ads'
      and (b.transaction_date at time zone 'America/Sao_Paulo')::date >= _from
      and (b.transaction_date at time zone 'America/Sao_Paulo')::date <= _to
    group by 1,2
  ),
  meses as (select generate_series(date_trunc('month',_from), date_trunc('month',_to), interval '1 month')::date mes),
  contas as (select unnest((select a from permitidas)) as account_id),
  grade as (select m.mes, c.account_id from meses m cross join contas c),
  adsm as (
    select g.mes, g.account_id, ap.ads_ancora
    from grade g
    cross join lateral public.ml_ads_periodo(array[g.account_id],
        greatest(g.mes, _from), least((g.mes + interval '1 month - 1 day')::date, _to)) ap
  )
  select g.mes, g.account_id,
    coalesce(pd.comissao,0), coalesce(pd.frete,0), 0::numeric,
    coalesce(am.ads_ancora,0), coalesce(pr.full_periodo,0),
    coalesce(pd.outros,0) + coalesce(pr.outros,0),
    coalesce(pd.comissao,0) + coalesce(pd.frete,0) + coalesce(pd.parcelamento,0) + coalesce(pd.imposto,0)
      + coalesce(am.ads_ancora,0) + coalesce(pr.full_periodo,0)
      + coalesce(pd.outros,0) + coalesce(pr.outros,0),
    coalesce(pd.parcelamento,0), coalesce(pd.imposto,0), coalesce(pd.cmv,0),
    coalesce(pd.sem_custo,0), coalesce(pd.sem_aliquota,0)
  from grade g
  left join ped pd on pd.mes = g.mes and pd.account_id = g.account_id
  left join per pr on pr.mes = g.mes and pr.account_id = g.account_id
  left join adsm am on am.mes = g.mes and am.account_id = g.account_id
  order by g.mes, g.account_id;
$$;


--
-- Name: ml_daily_series(uuid[], date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ml_daily_series(_account_ids uuid[], _from date, _to date) RETURNS TABLE(day date, revenue numeric, commissions numeric, installment numeric, shipping numeric, fulfillment numeric, ads numeric, tax numeric, costs_total numeric, net numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '30s'
    AS $$
BEGIN
  IF _account_ids IS NULL OR array_length(_account_ids, 1) IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM unnest(_account_ids) AS x(id) WHERE NOT public.owns_account(x.id)) THEN RETURN; END IF;

  RETURN QUERY
  WITH days AS (SELECT generate_series(_from, _to, interval '1 day')::date AS d),
  fat AS (SELECT COALESCE(max(a.fator),1) AS f FROM public.ml_ads_periodo(_account_ids,_from,_to) a),
  conc AS (
    SELECT (r.order_date AT TIME ZONE 'America/Sao_Paulo')::date AS d,
      sum(r.receita) AS revenue,
      sum(r.fee_comissao + r.fee_cobranca) AS comissao,
      sum(r.fee_parcelamento) AS installment,
      sum(r.fee_frete) AS shipping,
      sum(r.fee_outros) AS other,
      sum(r.imposto) AS tax,
      coalesce(sum(r.cmv) FILTER (WHERE NOT r.cmv_missing), 0) AS cmv
    FROM public.mp_reconciliation(_account_ids, _from, _to) r GROUP BY 1
  ),
  ads_daily AS (
    SELECT a.date AS d, sum(coalesce(a.cost,0)) * (SELECT f FROM fat) AS ads
    FROM ml_ads_daily a
    WHERE a.account_id = ANY(_account_ids) AND a.date BETWEEN _from AND _to GROUP BY a.date
  ),
  bill_per AS (
    SELECT (n.transaction_date AT TIME ZONE 'America/Sao_Paulo')::date AS d,
      sum(CASE WHEN n.category = 'full'   THEN n.valor ELSE 0 END) AS fulfillment,
      sum(CASE WHEN n.category = 'outros' THEN n.valor ELSE 0 END) AS other
    FROM public.ml_billing_norm n
    WHERE n.account_id = ANY(_account_ids) AND n.escopo = 'periodo' AND n.conta_no_custo
      AND n.category <> 'ads'
      AND (n.transaction_date AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN _from AND _to
    GROUP BY 1
  ),
  tot AS (
    SELECT days.d,
      coalesce(c.revenue,0) AS revenue, coalesce(c.comissao,0) AS comissao,
      coalesce(c.installment,0) AS installment, coalesce(c.shipping,0) AS shipping,
      coalesce(bp.fulfillment,0) AS fulfillment, coalesce(ad.ads,0) AS ads, coalesce(c.tax,0) AS tax,
      coalesce(c.comissao,0) + coalesce(c.installment,0) + coalesce(c.shipping,0) + coalesce(c.other,0)
        + coalesce(bp.fulfillment,0) + coalesce(bp.other,0) + coalesce(ad.ads,0) + coalesce(c.tax,0) AS costs,
      coalesce(c.cmv,0) AS cmv
    FROM days
    LEFT JOIN conc c ON c.d = days.d
    LEFT JOIN ads_daily ad ON ad.d = days.d
    LEFT JOIN bill_per bp ON bp.d = days.d
  )
  SELECT t.d, t.revenue, t.comissao, t.installment, t.shipping, t.fulfillment, t.ads, t.tax,
         t.costs, t.revenue - t.costs - t.cmv
  FROM tot t
  ORDER BY t.d;
END;
$$;


--
-- Name: FUNCTION ml_daily_series(_account_ids uuid[], _from date, _to date); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.ml_daily_series(_account_ids uuid[], _from date, _to date) IS 'Regime de competencia. installment (CFONPN) e exibido mas NAO entra em costs_total: e repasse do acrescimo pago pelo comprador.';


--
-- Name: ml_data_health(uuid[], date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ml_data_health(_account_ids uuid[], _from date, _to date) RETURNS TABLE(orders_count bigint, billing_count bigint, ads_days_present bigint, visits_days_present bigint, period_days integer, missing_ads_days date[], missing_visits_days date[], last_sync_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '20s'
    AS $$
BEGIN
  IF _account_ids IS NULL OR array_length(_account_ids, 1) IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(_account_ids) AS x(id)
    WHERE NOT public.owns_account(x.id)
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH days AS (
    SELECT generate_series(_from, _to, interval '1 day')::date AS d
  ),
  ads_present AS (
    SELECT DISTINCT a.date AS d
    FROM ml_ads_daily a
    WHERE a.account_id = ANY(_account_ids)
      AND a.date BETWEEN _from AND _to
  ),
  visits_present AS (
    SELECT DISTINCT v.date AS d
    FROM ml_visits_daily v
    WHERE v.account_id = ANY(_account_ids)
      AND v.date BETWEEN _from AND _to
  )
  SELECT
    (SELECT count(*) FROM ml_orders o
      WHERE o.account_id = ANY(_account_ids)
        AND (o.date_created AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN _from AND _to),
    (SELECT count(*) FROM ml_billing_details b
      WHERE b.account_id = ANY(_account_ids)
        AND b.transaction_date IS NOT NULL
        AND (b.transaction_date AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN _from AND _to),
    (SELECT count(*) FROM ads_present),
    (SELECT count(*) FROM visits_present),
    ((_to - _from) + 1)::integer,
    COALESCE(ARRAY(
      SELECT d FROM days
      WHERE d NOT IN (SELECT d FROM ads_present)
      ORDER BY d
    ), ARRAY[]::date[]),
    COALESCE(ARRAY(
      SELECT d FROM days
      WHERE d NOT IN (SELECT d FROM visits_present)
      ORDER BY d
    ), ARRAY[]::date[]),
    (SELECT max(ma.last_sync_at) FROM marketplace_accounts ma WHERE ma.id = ANY(_account_ids));
END;
$$;


--
-- Name: ml_fulfillment_breakdown(uuid[], date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ml_fulfillment_breakdown(_account_ids uuid[], _from date, _to date) RETURNS TABLE(sub_type text, label text, amount numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '20s'
    AS $$
BEGIN
  IF _account_ids IS NULL OR array_length(_account_ids, 1) IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM unnest(_account_ids) AS x(id) WHERE NOT public.owns_account(x.id)) THEN RETURN; END IF;

  RETURN QUERY
  SELECT n.detail_sub_type::text, m.label::text, sum(n.valor)::numeric
  FROM public.ml_billing_norm n
  JOIN public.billing_subtype_map m ON m.sub_type = n.detail_sub_type
  WHERE n.account_id = ANY(_account_ids)
    AND n.category = 'full'
    AND (n.transaction_date AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN _from AND _to
  GROUP BY 1,2
  HAVING sum(n.valor) <> 0
  ORDER BY 3 DESC;
END;
$$;


--
-- Name: ml_metrics(uuid[], date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ml_metrics(_account_ids uuid[], _from date, _to date) RETURNS TABLE(account_id uuid, revenue numeric, revenue_gross numeric, revenue_lost numeric, cancelled_value numeric, partial_refunds numeric, commissions numeric, shipping numeric, fulfillment numeric, installment numeric, bonifications numeric, other numeric, ads numeric, refunds numeric, tax numeric, orders_count bigint, orders_cancelled bigint, orders_refunded bigint, units_sold bigint, visits bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '30s'
    AS $$
BEGIN
  IF _account_ids IS NULL OR array_length(_account_ids, 1) IS NULL THEN RETURN; END IF;
  IF auth.uid() IS NOT NULL
     AND EXISTS (SELECT 1 FROM unnest(_account_ids) AS x(id) WHERE NOT public.owns_account(x.id)) THEN RETURN; END IF;

  RETURN QUERY
  WITH acc AS (SELECT unnest(_account_ids) AS id),
  ord_base AS (
    SELECT o.account_id, o.status, o.total_amount, COALESCE(o.refunded_amount,0) AS refunded
    FROM ml_orders o
    WHERE o.account_id = ANY(_account_ids)
      AND (o.date_created AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN _from AND _to
  ),
  ord AS (
    SELECT b.account_id,
      sum(b.total_amount) AS revenue_gross,
      sum(CASE WHEN b.status = 'cancelled' THEN b.total_amount ELSE b.refunded END) AS revenue_lost,
      sum(CASE WHEN b.status = 'cancelled' THEN b.total_amount ELSE 0 END) AS cancelled_value,
      sum(CASE WHEN b.status <> 'cancelled' THEN b.refunded ELSE 0 END) AS partial_refunds,
      sum(CASE WHEN b.status = 'cancelled' THEN b.total_amount ELSE b.refunded END) AS refunds,
      count(*) FILTER (WHERE b.status <> 'cancelled') AS orders_count,
      count(*) FILTER (WHERE b.status = 'cancelled') AS orders_cancelled,
      count(*) FILTER (WHERE b.status = 'partially_refunded') AS orders_refunded
    FROM ord_base b GROUP BY b.account_id
  ),
  conc AS (
    SELECT r.account_id,
      sum(r.receita) AS revenue,
      sum(r.fee_comissao + r.fee_cobranca) AS commissions,
      sum(r.fee_frete) AS shipping,
      sum(r.fee_parcelamento) AS installment,
      sum(r.fee_outros) AS other,
      sum(r.imposto) AS tax,
      sum(r.units)::bigint AS units_sold
    FROM public.mp_reconciliation(_account_ids, _from, _to) r GROUP BY r.account_id
  ),
  ads AS (SELECT a.account_id, a.ads_ancora AS ads FROM public.ml_ads_periodo(_account_ids,_from,_to) a),
  vis AS (
    SELECT v.account_id, sum(coalesce(v.visits,0))::bigint AS visits
    FROM ml_visits_daily v
    WHERE v.account_id = ANY(_account_ids) AND v.date BETWEEN _from AND _to GROUP BY 1
  ),
  bill_per AS (
    SELECT n.account_id,
      sum(CASE WHEN n.category = 'full'   THEN n.valor ELSE 0 END) AS fulfillment,
      sum(CASE WHEN n.category = 'outros' THEN n.valor ELSE 0 END) AS other,
      sum(CASE WHEN n.detail_type = 'BONUS' AND n.category <> 'ads' THEN -n.valor ELSE 0 END) AS bonifications
    FROM public.ml_billing_norm n
    WHERE n.account_id = ANY(_account_ids) AND n.escopo = 'periodo'
      AND (n.transaction_date AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN _from AND _to
    GROUP BY 1
  )
  SELECT acc.id,
    coalesce(conc.revenue,0), coalesce(ord.revenue_gross,0), coalesce(ord.revenue_lost,0),
    coalesce(ord.cancelled_value,0), coalesce(ord.partial_refunds,0),
    coalesce(conc.commissions,0), coalesce(conc.shipping,0), coalesce(bill_per.fulfillment,0),
    coalesce(conc.installment,0),
    coalesce(bill_per.bonifications,0),
    coalesce(conc.other,0) + coalesce(bill_per.other,0),
    coalesce(ads.ads,0), coalesce(ord.refunds,0), coalesce(conc.tax,0),
    coalesce(ord.orders_count,0)::bigint, coalesce(ord.orders_cancelled,0)::bigint,
    coalesce(ord.orders_refunded,0)::bigint, coalesce(conc.units_sold,0)::bigint,
    coalesce(vis.visits,0)::bigint
  FROM acc
  LEFT JOIN ord ON ord.account_id = acc.id
  LEFT JOIN conc ON conc.account_id = acc.id
  LEFT JOIN ads ON ads.account_id = acc.id
  LEFT JOIN vis ON vis.account_id = acc.id
  LEFT JOIN bill_per ON bill_per.account_id = acc.id;
END;
$$;


--
-- Name: FUNCTION ml_metrics(_account_ids uuid[], _from date, _to date); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.ml_metrics(_account_ids uuid[], _from date, _to date) IS 'Regime de competencia. commissions vem de ml_comissao_item; shipping/installment/other de pedido seguem a data do pedido; fulfillment e outros de periodo seguem a data da fatura. bonifications e informativo: os cancelamentos JA estao abatidos nas demais linhas.';


--
-- Name: ml_receita_competencia_mes(uuid[], date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ml_receita_competencia_mes(_account_ids uuid[], _from date, _to date) RETURNS TABLE(mes date, account_id uuid, pedidos bigint, receita numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with permitidas as (select public.contas_permitidas(_account_ids) as a),
  contas as (select unnest((select a from permitidas)) as account_id),
  r as (select * from public.mp_reconciliation((select a from permitidas), _from, _to)),
  base as (
    select date_trunc('month', r.order_date at time zone 'America/Sao_Paulo')::date as mes,
           r.account_id, count(*)::bigint as pedidos, sum(r.receita)::numeric as receita
    from r group by 1, 2
  ),
  meses as (select generate_series(date_trunc('month',_from), date_trunc('month',_to), interval '1 month')::date as mes)
  select m.mes, c.account_id, coalesce(b.pedidos,0), coalesce(b.receita,0)
  from meses m cross join contas c
  left join base b on b.mes = m.mes and b.account_id = c.account_id
  order by m.mes, c.account_id;
$$;


--
-- Name: ml_trocar_itens_dos_pedidos(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ml_trocar_itens_dos_pedidos(_account_id uuid, _itens jsonb) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare v_refs uuid[];
begin
  -- Só pedidos desta conta, travados: outra rodada do mesmo período espera esta terminar.
  select array_agg(o.id order by o.id) into v_refs
    from (select o.id from ml_orders o
           where o.account_id = _account_id
             and o.id in (select (x->>'order_ref')::uuid from jsonb_array_elements(_itens) x)
           order by o.id for update) o;
  if v_refs is null then return 0; end if;
  delete from ml_order_items where account_id = _account_id and order_ref = any(v_refs);
  -- Na ordem da API: o primeiro item do pedido (SKU e título mostrados) não troca a cada rodada.
  insert into ml_order_items (account_id, order_ref, item_id, title, seller_sku, quantity, unit_price, full_unit_price,
                              sale_fee, created_at)
  select _account_id, r.order_ref, r.item_id, r.title, r.seller_sku, r.quantity, r.unit_price, r.full_unit_price,
         r.sale_fee, now() + (n.ordem * interval '1 microsecond')
    from jsonb_array_elements(_itens) with ordinality as n(item, ordem)
    cross join lateral jsonb_to_record(n.item) as r(order_ref uuid, item_id text, title text, seller_sku text,
                                                    quantity integer, unit_price numeric, full_unit_price numeric,
                                                    sale_fee numeric)
   where r.order_ref = any(v_refs);
  return (select count(*) from jsonb_array_elements(_itens) x where (x->>'order_ref')::uuid = any(v_refs));
end;
$$;


--
-- Name: mp_a_receber(uuid[], date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mp_a_receber(_account_ids uuid[], _from date, _to date) RETURNS TABLE(total_pending numeric, ate_7d numeric, de_8_a_15d numeric, mais_16d numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  a uuid;
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  FOREACH a IN ARRAY COALESCE(_account_ids, ARRAY[]::uuid[]) LOOP
    IF NOT public.owns_account(a) THEN
      RAISE EXCEPTION 'Acesso negado à conta %', a;
    END IF;
  END LOOP;

  RETURN QUERY
  WITH p AS (
    SELECT mp.net_received_amount AS net,
           (mp.money_release_date AT TIME ZONE 'America/Sao_Paulo')::date AS rel
    FROM public.mp_payments mp
    WHERE mp.account_id = ANY(_account_ids)
      AND mp.status = 'approved'
      AND COALESCE(mp.money_release_status, '') <> 'released'
      AND (COALESCE(mp.date_approved, mp.date_created) AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN _from AND _to
      AND mp.money_release_date IS NOT NULL
      AND (mp.money_release_date AT TIME ZONE 'America/Sao_Paulo')::date >= hoje
  )
  SELECT COALESCE(SUM(net), 0)::numeric,
         COALESCE(SUM(net) FILTER (WHERE rel <= hoje + 7), 0)::numeric,
         COALESCE(SUM(net) FILTER (WHERE rel > hoje + 7 AND rel <= hoje + 15), 0)::numeric,
         COALESCE(SUM(net) FILTER (WHERE rel > hoje + 15), 0)::numeric
  FROM p;
END;
$$;


--
-- Name: mp_divergencias(uuid[], date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mp_divergencias(_account_ids uuid[], _from date, _to date) RETURNS TABLE(account_id uuid, order_id bigint, order_date timestamp with time zone, tipo text, descricao text, valor_divergencia numeric, detalhe jsonb)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE a uuid;
BEGIN
  IF _account_ids IS NULL OR array_length(_account_ids, 1) IS NULL THEN
    RETURN;
  END IF;
  FOREACH a IN ARRAY _account_ids LOOP
    IF NOT public.owns_account(a) THEN
      RAISE EXCEPTION 'Acesso negado a conta %', a;
    END IF;
  END LOOP;

  RETURN QUERY
  WITH ord AS (
    SELECT o.id, o.account_id, o.order_id, o.date_created, o.status,
           o.total_amount, o.refunded_amount, o.shipping_id
    FROM public.ml_orders o
    WHERE o.account_id = ANY(_account_ids)
      AND ((o.date_created AT TIME ZONE 'America/Sao_Paulo')::date) BETWEEN _from AND _to
  ),
  it AS (
    SELECT i.order_ref,
           COALESCE(SUM(i.sale_fee * COALESCE(i.quantity, 1)), 0)::numeric AS ml_commission,
           COALESCE(SUM(i.quantity), 0)::integer AS unidades
    FROM public.ml_order_items i
    WHERE i.order_ref IN (SELECT o.id FROM ord o)
    GROUP BY i.order_ref
  ),
  pay AS (
    SELECT p.account_id, p.order_id,
           COALESCE(SUM(p.total_paid_amount), 0)::numeric AS paid,
           COALESCE(SUM(p.net_received_amount), 0)::numeric AS net,
           COALESCE(SUM(p.fee_total), 0)::numeric AS fee_total,
           COALESCE(SUM(p.mp_fee), 0)::numeric AS mp_fee,
           COALESCE(SUM(p.ml_fee), 0)::numeric AS ml_fee,
           COALESCE(SUM(p.shipping_fee), 0)::numeric AS shipping_fee,
           COALESCE(SUM(p.installment_fee), 0)::numeric AS installment_fee,
           COALESCE(SUM(p.split_fee), 0)::numeric AS split_fee,
           COALESCE(SUM(p.coupon_fee), 0)::numeric AS coupon_fee
    FROM public.mp_payments p
    WHERE p.account_id = ANY(_account_ids)
      AND p.order_id IS NOT NULL
      AND p.status = 'approved'
    GROUP BY p.account_id, p.order_id
  ),
  bill AS (
    SELECT d.account_id, d.order_id,
           COALESCE(SUM(d.amount) FILTER (WHERE d.detail_sub_type IN ('CVVML','CVVPRC')), 0)::numeric AS bill_comissao,
           COALESCE(SUM(d.amount) FILTER (WHERE m.category = 'frete'), 0)::numeric AS bill_frete,
           COALESCE(SUM(d.amount) FILTER (WHERE d.detail_sub_type LIKE 'B%'), 0)::numeric AS bill_estorno
    FROM public.ml_billing_details d
    LEFT JOIN public.billing_subtype_map m ON m.sub_type = d.detail_sub_type
    WHERE d.account_id = ANY(_account_ids)
      AND d.order_id IS NOT NULL
      AND d.order_id IN (SELECT o.order_id FROM ord o)
    GROUP BY d.account_id, d.order_id
  ),
  base AS (
    SELECT o.*, COALESCE(i.ml_commission, 0) AS ml_commission,
           COALESCE(i.unidades, 0) AS unidades,
           p.paid, p.net, p.fee_total, p.mp_fee, p.ml_fee, p.shipping_fee,
           p.installment_fee, p.split_fee, p.coupon_fee,
           COALESCE(b.bill_comissao, 0) AS bill_comissao,
           COALESCE(b.bill_frete, 0) AS bill_frete,
           COALESCE(b.bill_estorno, 0) AS bill_estorno
    FROM ord o
    LEFT JOIN it i ON i.order_ref = o.id
    LEFT JOIN pay p ON p.account_id = o.account_id AND p.order_id = o.order_id
    LEFT JOIN bill b ON b.account_id = o.account_id AND b.order_id = o.order_id
  )

  SELECT b.account_id, b.order_id, b.date_created,
         'comissao_duplicada'::text,
         'A comissao descontada no Mercado Pago (R$ ' || to_char(b.ml_fee, 'FM999999990.00') ||
         ') e maior que a comissao dos itens do pedido (R$ ' || to_char(b.ml_commission, 'FM999999990.00') ||
         ' em ' || b.unidades || ' unidade(s)). Possivel cobranca em duplicidade ou a maior.',
         round(b.ml_fee - b.ml_commission, 2),
         jsonb_build_object(
           'comissao_itens', round(b.ml_commission, 2),
           'unidades', b.unidades,
           'comissao_mp', round(b.ml_fee, 2),
           'comissao_faturamento', round(b.bill_comissao, 2),
           'total_pedido', round(b.total_amount, 2)
         )
  FROM base b
  WHERE b.ml_fee > 0 AND b.ml_commission > 0
    AND (b.ml_fee - b.ml_commission) > 1
    AND (b.ml_fee - b.ml_commission) > 0.10 * b.ml_commission

  UNION ALL

  SELECT b.account_id, b.order_id, b.date_created,
         'frete_acima_billing'::text,
         'O frete descontado no Mercado Pago (R$ ' || to_char(b.shipping_fee, 'FM999999990.00') ||
         ') e maior que o frete registrado no faturamento do ML (R$ ' || to_char(b.bill_frete, 'FM999999990.00') || ').',
         round(b.shipping_fee - b.bill_frete, 2),
         jsonb_build_object(
           'frete_mp', round(b.shipping_fee, 2),
           'frete_faturamento', round(b.bill_frete, 2),
           'shipping_id', b.shipping_id
         )
  FROM base b
  WHERE b.shipping_fee > 0 AND b.bill_frete > 0
    AND (b.shipping_fee - b.bill_frete) > 1

  UNION ALL

  SELECT b.account_id, b.order_id, b.date_created,
         'liquido_menor_que_esperado'::text,
         'O valor liquido recebido (R$ ' || to_char(b.net, 'FM999999990.00') ||
         ') e menor que o esperado apos as taxas conhecidas (R$ ' ||
         to_char(b.paid - b.ml_fee - b.shipping_fee - b.installment_fee - b.split_fee - b.mp_fee, 'FM999999990.00') ||
         '). Ha desconto sem explicacao.',
         round((b.paid - b.ml_fee - b.shipping_fee - b.installment_fee - b.split_fee - b.mp_fee) - b.net, 2),
         jsonb_build_object(
           'pago', round(b.paid, 2),
           'liquido', round(b.net, 2),
           'esperado', round(b.paid - b.ml_fee - b.shipping_fee - b.installment_fee - b.split_fee - b.mp_fee, 2),
           'taxa_mp', round(b.mp_fee, 2),
           'comissao_mp', round(b.ml_fee, 2),
           'frete_mp', round(b.shipping_fee, 2),
           'parcelamento_mp', round(b.installment_fee, 2),
           'split_mp', round(b.split_fee, 2),
           'cupom_mp', round(b.coupon_fee, 2)
         )
  FROM base b
  WHERE b.paid > 0
    AND ((b.paid - b.ml_fee - b.shipping_fee - b.installment_fee - b.split_fee - b.mp_fee) - b.net) > 1

  UNION ALL

  SELECT b.account_id, b.order_id, b.date_created,
         'estorno_nao_devolvido'::text,
         'Pedido cancelado ou devolvido, mas nao ha estorno da comissao (R$ ' ||
         to_char(b.ml_fee, 'FM999999990.00') || ') no faturamento do ML.',
         round(b.ml_fee, 2),
         jsonb_build_object(
           'status_pedido', b.status,
           'valor_devolvido', round(COALESCE(b.refunded_amount, 0), 2),
           'comissao_mp', round(b.ml_fee, 2),
           'estorno_faturamento', round(b.bill_estorno, 2)
         )
  FROM base b
  WHERE (b.status = 'cancelled' OR COALESCE(b.refunded_amount, 0) > 0)
    AND b.ml_fee > 1
    AND b.bill_estorno = 0

  UNION ALL

  SELECT p.account_id, p.order_id, COALESCE(p.date_approved, p.date_created),
         'cobranca_sem_venda'::text,
         'Existe cobranca de taxas (R$ ' || to_char(p.fee_total, 'FM999999990.00') ||
         ') num pagamento cujo pedido nao existe no historico de vendas.',
         round(p.fee_total, 2),
         jsonb_build_object(
           'payment_id', p.payment_id,
           'taxas', round(p.fee_total, 2),
           'valor_pago', round(p.total_paid_amount, 2),
           'status', p.status
         )
  FROM public.mp_payments p
  WHERE p.account_id = ANY(_account_ids)
    AND p.order_id IS NOT NULL
    AND p.status = 'approved'
    AND p.fee_total > 1
    AND ((COALESCE(p.date_approved, p.date_created) AT TIME ZONE 'America/Sao_Paulo')::date) BETWEEN _from AND _to
    AND NOT EXISTS (
      SELECT 1 FROM public.ml_orders o
      WHERE o.account_id = p.account_id AND o.order_id = p.order_id
    );
END;
$_$;


--
-- Name: mp_divergencias_resumo(uuid[], date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mp_divergencias_resumo(_account_ids uuid[], _from date, _to date) RETURNS TABLE(tipo text, quantidade bigint, valor_total numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT d.tipo, COUNT(*)::bigint, round(SUM(d.valor_divergencia), 2)
  FROM public.mp_divergencias(_account_ids, _from, _to) d
  GROUP BY d.tipo
  ORDER BY 3 DESC;
$$;


--
-- Name: mp_reconciliation(uuid[], date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mp_reconciliation(_account_ids uuid[], _from date, _to date) RETURNS TABLE(account_id uuid, order_id bigint, order_date timestamp with time zone, order_status text, order_total numeric, sku text, title text, units integer, ml_commission numeric, mp_gross numeric, mp_net numeric, mp_fees numeric, mp_fee numeric, ml_fee numeric, shipping_fee numeric, installment_fee numeric, split_fee numeric, coupon_fee numeric, release_date timestamp with time zone, release_status text, payment_count integer, has_rejected boolean, match_status text, cmv numeric, cmv_missing boolean, receita_produto numeric, fee_comissao numeric, fee_cobranca numeric, fee_parcelamento numeric, fee_frete numeric, fee_outros numeric, fees_billing_total numeric, fees_billing_missing boolean, tax_rate numeric, imposto numeric, imposto_missing boolean, ads_rateado numeric, ads_parcial boolean, resultado numeric, resultado_pct numeric, receita numeric, refunded_amount numeric, fee_comissao_origem text, fee_cobranca_origem text, fee_parcelamento_origem text, fee_frete_origem text, fees_fallback boolean, mp_paid_by_buyer numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE a uuid;
BEGIN
  IF _account_ids IS NULL OR array_length(_account_ids, 1) IS NULL THEN
    RETURN;
  END IF;
  FOREACH a IN ARRAY _account_ids LOOP
    IF auth.uid() IS NOT NULL AND NOT public.owns_account(a) THEN
      RAISE EXCEPTION 'Acesso negado a conta %', a;
    END IF;
  END LOOP;

  RETURN QUERY
  WITH ord AS (
    SELECT o.id, o.account_id, o.order_id, o.date_created, o.status, o.total_amount,
           COALESCE(o.refunded_amount, 0) AS refunded_amount,
           ((o.date_created AT TIME ZONE 'America/Sao_Paulo')::date) AS day_sp
    FROM public.ml_orders o
    WHERE o.account_id = ANY(_account_ids)
      AND ((o.date_created AT TIME ZONE 'America/Sao_Paulo')::date) BETWEEN _from AND _to
      AND o.status <> 'cancelled'
  ),
  -- Custo de cada item no dia da venda (din-04), com o SKU resolvido por item ANTES de agregar.
  -- Uma consulta por (dono, SKU, dia), não por item. O dono vem da conta, então a chamada do
  -- servidor (sem usuário) também enxerga o custo.
  item_dia AS (
    SELECT i.id, i.order_ref, i.quantity, a.owner_id, btrim(i.seller_sku) AS sku, o.day_sp
    FROM public.ml_order_items i
    JOIN ord o ON o.id = i.order_ref
    JOIN public.marketplace_accounts a ON a.id = o.account_id
  ),
  custo_dia AS (
    SELECT x.owner_id, x.sku, x.day_sp, c.custo
    FROM (SELECT DISTINCT d.owner_id, d.sku, d.day_sp FROM item_dia d WHERE d.sku IS NOT NULL) x
    CROSS JOIN LATERAL public.custo_sku_na_data(x.owner_id, x.sku, x.day_sp) c
  ),
  it AS (
    SELECT i.order_ref,
           SUM(i.quantity)::integer AS units,
           COALESCE(SUM(i.sale_fee * i.quantity), 0)::numeric AS ml_commission,
           COALESCE(SUM(i.unit_price * i.quantity), 0)::numeric AS receita_produto,
           (ARRAY_AGG(i.seller_sku ORDER BY i.created_at, i.id))[1] AS sku,
           (ARRAY_AGG(i.title ORDER BY i.created_at, i.id))[1] AS title,
           COALESCE(SUM(cd.custo * i.quantity), 0)::numeric AS cmv,
           bool_or(cd.custo IS NULL) AS cmv_missing
    FROM public.ml_order_items i
    JOIN item_dia x ON x.id = i.id
    LEFT JOIN custo_dia cd ON cd.owner_id = x.owner_id AND cd.sku = x.sku AND cd.day_sp = x.day_sp
    GROUP BY i.order_ref
  ),
  pay AS (
    SELECT p.account_id, p.order_id,
           COALESCE(SUM(COALESCE(p.net_received_amount + p.fee_total, p.transaction_amount, p.total_paid_amount)) FILTER (WHERE p.status = 'approved'), 0)::numeric AS mp_gross,
           COALESCE(SUM(p.total_paid_amount) FILTER (WHERE p.status = 'approved'), 0)::numeric AS mp_paid_by_buyer,
           COALESCE(SUM(p.net_received_amount) FILTER (WHERE p.status = 'approved'), 0)::numeric AS mp_net,
           COALESCE(SUM(p.fee_total) FILTER (WHERE p.status = 'approved'), 0)::numeric AS mp_fees,
           COALESCE(SUM(p.mp_fee) FILTER (WHERE p.status = 'approved'), 0)::numeric AS mp_fee,
           COALESCE(SUM(p.ml_fee) FILTER (WHERE p.status = 'approved'), 0)::numeric AS ml_fee,
           COALESCE(SUM(p.shipping_fee) FILTER (WHERE p.status = 'approved'), 0)::numeric AS shipping_fee,
           COALESCE(SUM(p.installment_fee) FILTER (WHERE p.status = 'approved'), 0)::numeric AS installment_fee,
           COALESCE(SUM(p.split_fee) FILTER (WHERE p.status = 'approved'), 0)::numeric AS split_fee,
           COALESCE(SUM(p.coupon_fee) FILTER (WHERE p.status = 'approved'), 0)::numeric AS coupon_fee,
           MAX(p.money_release_date) FILTER (WHERE p.status = 'approved') AS release_date,
           COUNT(*) FILTER (WHERE p.status = 'approved')::integer AS payment_count,
           COUNT(*) FILTER (WHERE p.status <> 'approved') > 0 AS has_rejected,
           COUNT(*) FILTER (WHERE p.status = 'approved' AND p.money_release_date IS NOT NULL AND p.money_release_date <= now())::integer AS released_cnt,
           COUNT(*) FILTER (WHERE p.status = 'approved' AND (p.money_release_date IS NULL OR p.money_release_date > now()))::integer AS pending_cnt
    FROM public.mp_payments p
    WHERE p.account_id = ANY(_account_ids)
      AND p.order_id IS NOT NULL
    GROUP BY p.account_id, p.order_id
  ),
  -- Tarifas por pedido classificadas pelo mesmo mapa das outras telas (billing_subtype_map,
  -- aba Regras e "Classificar" da Auditoria), não pelo texto (din-10). Dentro de "comissao" o texto
  -- só separa as colunas comissão / cobrança / parcelamento. Tarifa fora do mapa entra em "outros".
  -- Tarifa do período (e ADS, que aqui vem do ml_ads_daily) fica só nos custos do período, mesmo
  -- quando o ML manda o número do pedido; senão contaria duas vezes.
  -- A mesma tarifa pode vir em mais de um período (sync-07): conta uma vez, a do período mais novo.
  bill_balde AS (
    SELECT b.account_id, b.order_id, sig.s * b.amount AS valor,
           CASE
             WHEN m.escopo = 'periodo' OR m.category = 'ads' THEN NULL
             WHEN m.category = 'comissao' AND (b.concept ILIKE '%custo por cobrar%' OR b.concept ILIKE '%taxa de recebimento%') THEN 'cobranca'
             WHEN m.category = 'comissao' AND b.concept ILIKE '%parcelamento%' THEN 'parcelamento'
             WHEN m.category = 'comissao' THEN 'comissao'
             WHEN m.category = 'parcelamento' THEN 'parcelamento'
             WHEN m.category IN ('frete', 'estorno') THEN 'frete'
             WHEN m.category = 'comissao_excluida' THEN NULL
             ELSE 'outros'
           END AS balde
    FROM (
      SELECT DISTINCT ON (d.account_id, d.billing_group, d.detail_id) d.*
      FROM public.ml_billing_details d
      WHERE d.account_id = ANY(_account_ids)
        AND d.order_id IS NOT NULL
        AND COALESCE(d.concept_type, '') <> 'MCLICS'
        AND d.order_id IN (SELECT o.order_id FROM ord o)
      ORDER BY d.account_id, d.billing_group, d.detail_id, d.period_key DESC
    ) b
    LEFT JOIN public.billing_subtype_map m ON m.sub_type = b.detail_sub_type
    CROSS JOIN LATERAL (SELECT CASE WHEN b.detail_type = 'BONUS' THEN -1 ELSE 1 END AS s) sig
  ),
  bill AS (
    SELECT bb.account_id, bb.order_id,
           SUM(bb.valor) FILTER (WHERE bb.balde = 'comissao')::numeric AS fee_comissao,
           SUM(bb.valor) FILTER (WHERE bb.balde = 'cobranca')::numeric AS fee_cobranca,
           SUM(bb.valor) FILTER (WHERE bb.balde = 'parcelamento')::numeric AS fee_parcelamento,
           SUM(bb.valor) FILTER (WHERE bb.balde = 'frete')::numeric AS fee_frete,
           COALESCE(SUM(bb.valor) FILTER (WHERE bb.balde = 'outros'), 0)::numeric AS fee_outros,
           COUNT(*) FILTER (WHERE bb.balde = 'comissao') > 0 AS has_comissao,
           COUNT(*) FILTER (WHERE bb.balde = 'cobranca') > 0 AS has_cobranca,
           COUNT(*) FILTER (WHERE bb.balde = 'parcelamento') > 0 AS has_parcelamento,
           COUNT(*) FILTER (WHERE bb.balde = 'frete') > 0 AS has_frete
    FROM bill_balde bb
    GROUP BY bb.account_id, bb.order_id
  ),
  ads_day AS (
    SELECT ad.account_id, ad.date, ad.item_id, SUM(ad.cost)::numeric AS cost
    FROM public.ml_ads_daily ad
    WHERE ad.account_id = ANY(_account_ids)
      AND ad.date BETWEEN _from AND _to
      AND ad.item_id IS NOT NULL
    GROUP BY 1,2,3
  ),
  units_day AS (
    SELECT o.account_id, o.day_sp AS date, i.item_id, SUM(i.quantity)::numeric AS units
    FROM public.ml_order_items i
    JOIN ord o ON o.id = i.order_ref
    WHERE i.item_id IS NOT NULL
    GROUP BY 1,2,3
  ),
  ads_unit AS (
    SELECT ad.account_id, ad.date, ad.item_id, (ad.cost / u.units)::numeric AS cpu
    FROM ads_day ad
    JOIN units_day u ON u.account_id = ad.account_id AND u.date = ad.date AND u.item_id = ad.item_id
    WHERE u.units > 0
  ),
  ads_order AS (
    SELECT i.order_ref, COALESCE(SUM(au.cpu * i.quantity), 0)::numeric AS ads
    FROM public.ml_order_items i
    JOIN ord o ON o.id = i.order_ref
    JOIN ads_unit au ON au.account_id = o.account_id AND au.date = o.day_sp AND au.item_id = i.item_id
    GROUP BY i.order_ref
  ),
  base AS (
    SELECT o.account_id, o.order_id, o.date_created, o.status, o.total_amount, o.day_sp,
           o.refunded_amount,
           it.sku, it.title, COALESCE(it.units,0) AS units,
           COALESCE(it.ml_commission,0) AS ml_commission,
           GREATEST(COALESCE(it.receita_produto,0) - o.refunded_amount, 0) AS receita_produto,
           COALESCE(it.cmv,0) AS cmv, COALESCE(it.cmv_missing,true) AS cmv_missing,
           pp.mp_gross, pp.mp_paid_by_buyer, pp.mp_net, pp.mp_fees, pp.mp_fee, pp.ml_fee,
           pp.shipping_fee, pp.installment_fee, pp.split_fee, pp.coupon_fee,
           pp.release_date, pp.payment_count, pp.has_rejected,
           pp.released_cnt, pp.pending_cnt,
           CASE WHEN COALESCE(bb.has_comissao,false) THEN bb.fee_comissao ELSE COALESCE(pp.ml_fee,0) END AS fee_comissao,
           CASE WHEN COALESCE(bb.has_cobranca,false) THEN bb.fee_cobranca ELSE COALESCE(pp.mp_fee,0) END AS fee_cobranca,
           CASE WHEN COALESCE(bb.has_parcelamento,false) THEN bb.fee_parcelamento ELSE COALESCE(pp.installment_fee,0) END AS fee_parcelamento,
           CASE WHEN COALESCE(bb.has_frete,false) THEN bb.fee_frete ELSE COALESCE(pp.shipping_fee,0) END AS fee_frete,
           COALESCE(bb.fee_outros,0) AS fee_outros,
           CASE WHEN NOT COALESCE(bb.has_comissao,false) AND COALESCE(pp.ml_fee,0) > 0 THEN 'pagamento' ELSE 'billing' END::text AS fee_comissao_origem,
           CASE WHEN NOT COALESCE(bb.has_cobranca,false) AND COALESCE(pp.mp_fee,0) > 0 THEN 'pagamento' ELSE 'billing' END::text AS fee_cobranca_origem,
           CASE WHEN NOT COALESCE(bb.has_parcelamento,false) AND COALESCE(pp.installment_fee,0) > 0 THEN 'pagamento' ELSE 'billing' END::text AS fee_parcelamento_origem,
           CASE WHEN NOT COALESCE(bb.has_frete,false) AND COALESCE(pp.shipping_fee,0) > 0 THEN 'pagamento' ELSE 'billing' END::text AS fee_frete_origem,
           ((NOT COALESCE(bb.has_comissao,false) AND COALESCE(pp.ml_fee,0) > 0)
            OR (NOT COALESCE(bb.has_cobranca,false) AND COALESCE(pp.mp_fee,0) > 0)
            OR (NOT COALESCE(bb.has_parcelamento,false) AND COALESCE(pp.installment_fee,0) > 0)
            OR (NOT COALESCE(bb.has_frete,false) AND COALESCE(pp.shipping_fee,0) > 0)) AS fees_fallback,
           (bb.order_id IS NULL) AS fees_billing_missing,
           tx.rate AS tax_rate,
           COALESCE(ao.ads, 0) AS ads_rateado
    FROM ord o
    LEFT JOIN it ON it.order_ref = o.id
    LEFT JOIN pay pp ON pp.account_id = o.account_id AND pp.order_id = o.order_id
    LEFT JOIN bill bb ON bb.account_id = o.account_id AND bb.order_id = o.order_id
    LEFT JOIN ads_order ao ON ao.order_ref = o.id
    LEFT JOIN LATERAL (
      SELECT t.rate FROM public.account_tax_rates t
      WHERE t.account_id = o.account_id
        AND t.valid_from <= o.day_sp
        AND (t.valid_to IS NULL OR t.valid_to >= o.day_sp)
      ORDER BY t.valid_from DESC LIMIT 1
    ) tx ON true
  ),
  calc AS (
    SELECT b.*,
           GREATEST(COALESCE(NULLIF(b.mp_gross,0), b.total_amount) - b.refunded_amount, 0) AS receita_liq,
           (b.fee_comissao + b.fee_cobranca + b.fee_parcelamento + b.fee_frete + b.fee_outros) AS fees_tot,
           COALESCE(b.receita_produto * b.tax_rate / 100.0, 0) AS imposto_calc
    FROM base b
  )
  SELECT c.account_id,
         c.order_id,
         c.date_created,
         c.status,
         c.total_amount,
         c.sku,
         c.title,
         c.units,
         c.ml_commission,
         COALESCE(c.mp_gross, 0),
         COALESCE(c.mp_net, 0),
         COALESCE(c.mp_fees, 0),
         COALESCE(c.mp_fee, 0),
         COALESCE(c.ml_fee, 0),
         COALESCE(c.shipping_fee, 0),
         COALESCE(c.installment_fee, 0),
         COALESCE(c.split_fee, 0),
         COALESCE(c.coupon_fee, 0),
         c.release_date,
         CASE
           WHEN COALESCE(c.payment_count, 0) = 0 THEN NULL
           WHEN c.pending_cnt = 0 THEN 'released'
           WHEN c.released_cnt = 0 THEN 'pending'
           ELSE 'partial'
         END::text,
         COALESCE(c.payment_count, 0),
         COALESCE(c.has_rejected, false),
         CASE WHEN COALESCE(c.payment_count, 0) > 0 THEN 'ok' ELSE 'sem_pagamento' END::text,
         c.cmv,
         c.cmv_missing,
         c.receita_produto,
         c.fee_comissao,
         c.fee_cobranca,
         c.fee_parcelamento,
         c.fee_frete,
         c.fee_outros,
         c.fees_tot::numeric,
         c.fees_billing_missing,
         c.tax_rate,
         c.imposto_calc::numeric,
         (c.tax_rate IS NULL),
         c.ads_rateado,
         (c.day_sp = (now() AT TIME ZONE 'America/Sao_Paulo')::date),
         (c.receita_liq - c.fees_tot - c.imposto_calc - c.cmv - c.ads_rateado)::numeric,
         CASE WHEN c.receita_liq > 0
              THEN ((c.receita_liq - c.fees_tot - c.imposto_calc - c.cmv - c.ads_rateado) / c.receita_liq * 100)::numeric
              ELSE NULL END,
         c.receita_liq::numeric,
         c.refunded_amount,
         c.fee_comissao_origem,
         c.fee_cobranca_origem,
         c.fee_parcelamento_origem,
         c.fee_frete_origem,
         c.fees_fallback,
         COALESCE(c.mp_paid_by_buyer, 0)::numeric
  FROM calc c
  ORDER BY c.date_created DESC;
END;
$$;


--
-- Name: mp_reconciliation_summary(uuid[], date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mp_reconciliation_summary(_account_ids uuid[], _from date, _to date) RETURNS TABLE(orders_count bigint, orders_matched bigint, orders_unmatched bigint, total_order_value numeric, total_mp_gross numeric, total_mp_net numeric, total_mp_fees numeric, total_shipping numeric, total_installment numeric, total_split numeric, total_coupon numeric, total_released numeric, total_pending numeric, avg_fee_pct numeric, total_cmv numeric, orders_sem_custo bigint, receita_sem_custo numeric, total_fee_comissao numeric, total_fee_cobranca numeric, total_fee_parcelamento numeric, total_fee_frete numeric, total_fee_outros numeric, total_fees_billing numeric, orders_sem_billing bigint, total_imposto numeric, orders_sem_aliquota bigint, total_ads_atribuido numeric, total_ads_nao_atribuido numeric, total_ads_periodo numeric, total_ads_billing numeric, total_resultado numeric, total_receita numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_ads_total numeric := 0;
  v_mclics numeric := 0;
BEGIN
  IF _account_ids IS NULL OR array_length(_account_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(ad.cost), 0) INTO v_ads_total
  FROM public.ml_ads_daily ad
  WHERE ad.account_id = ANY(_account_ids) AND ad.date BETWEEN _from AND _to;

  SELECT COALESCE(SUM(b.amount * CASE WHEN b.detail_type = 'BONUS' THEN -1 ELSE 1 END), 0) INTO v_mclics
  FROM public.ml_billing_details b
  WHERE b.account_id = ANY(_account_ids)
    AND COALESCE(b.concept_type, '') = 'MCLICS'
    AND ((b.transaction_date AT TIME ZONE 'America/Sao_Paulo')::date) BETWEEN _from AND _to;

  RETURN QUERY
  WITH r AS (
    SELECT * FROM public.mp_reconciliation(_account_ids, _from, _to)
  )
  SELECT COUNT(*)::bigint,
         COUNT(*) FILTER (WHERE r.match_status = 'ok')::bigint,
         COUNT(*) FILTER (WHERE r.match_status = 'sem_pagamento')::bigint,
         COALESCE(SUM(r.order_total), 0)::numeric,
         COALESCE(SUM(r.mp_gross), 0)::numeric,
         COALESCE(SUM(r.mp_net), 0)::numeric,
         COALESCE(SUM(r.mp_fees), 0)::numeric,
         COALESCE(SUM(r.shipping_fee), 0)::numeric,
         COALESCE(SUM(r.installment_fee), 0)::numeric,
         COALESCE(SUM(r.split_fee), 0)::numeric,
         COALESCE(SUM(r.coupon_fee), 0)::numeric,
         COALESCE(SUM(r.mp_net) FILTER (WHERE r.release_status = 'released'), 0)::numeric,
         COALESCE(SUM(r.mp_net) FILTER (WHERE r.release_status IN ('pending', 'partial')), 0)::numeric,
         CASE WHEN COALESCE(SUM(r.mp_gross), 0) > 0
              THEN ROUND(SUM(r.mp_fees) * 100.0 / SUM(r.mp_gross), 2)
              ELSE 0 END::numeric,
         COALESCE(SUM(r.cmv) FILTER (WHERE r.cmv_missing = false), 0)::numeric,
         COUNT(*) FILTER (WHERE r.cmv_missing)::bigint,
         COALESCE(SUM(r.receita) FILTER (WHERE r.cmv_missing), 0)::numeric,
         COALESCE(SUM(r.fee_comissao), 0)::numeric,
         COALESCE(SUM(r.fee_cobranca), 0)::numeric,
         COALESCE(SUM(r.fee_parcelamento), 0)::numeric,
         COALESCE(SUM(r.fee_frete), 0)::numeric,
         COALESCE(SUM(r.fee_outros), 0)::numeric,
         COALESCE(SUM(r.fees_billing_total), 0)::numeric,
         COUNT(*) FILTER (WHERE r.fees_billing_missing)::bigint,
         COALESCE(SUM(r.imposto), 0)::numeric,
         COUNT(*) FILTER (WHERE r.imposto_missing)::bigint,
         COALESCE(SUM(r.ads_rateado), 0)::numeric,
         GREATEST(v_ads_total - COALESCE(SUM(r.ads_rateado), 0), 0)::numeric,
         v_ads_total::numeric,
         v_mclics::numeric,
         COALESCE(SUM(r.resultado) FILTER (WHERE r.cmv_missing = false AND r.imposto_missing = false), 0)::numeric,
         COALESCE(SUM(r.receita), 0)::numeric
  FROM r;
END;
$$;


--
-- Name: my_screens(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_screens() RETURNS TABLE(screen_key text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT '*'::text WHERE public.is_admin()
  UNION ALL
  SELECT s.screen_key FROM public.user_screen_access s
  WHERE s.member_id = auth.uid() AND NOT public.is_admin();
$$;


--
-- Name: normalize_desc(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_desc(_texto text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  SELECT btrim(regexp_replace(
    regexp_replace(
      lower(public.unaccent('public.unaccent'::regdictionary, regexp_replace(coalesce(_texto,''), '\(\s*\d+\s*/\s*\d+\s*\)', ' ', 'g'))),
      '[*#]+|\m\d{4,}\M', ' ', 'g'),
    '\s+', ' ', 'g'))
$$;


--
-- Name: on_payable_note_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.on_payable_note_delete() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  r record;
BEGIN
  -- SKUs afetados por registros de histórico desta nota
  FOR r IN
    SELECT DISTINCT sku FROM public.product_cost_history
    WHERE note_id = OLD.id AND owner_id = OLD.owner_id
  LOOP
    -- remove os registros desta nota para este sku
    DELETE FROM public.product_cost_history
    WHERE note_id = OLD.id AND owner_id = OLD.owner_id AND sku = r.sku;
    -- recalcula o custo do sku com o que sobrou
    PERFORM public.recompute_sku_cost(OLD.owner_id, r.sku);
  END LOOP;
  RETURN OLD;
END;
$$;


--
-- Name: operating_costs_matrix(uuid, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.operating_costs_matrix(_owner uuid, _from date, _to date) RETURNS TABLE(cost_id uuid, name text, category text, month date, amount_total numeric, amount_ecommerce numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH months AS (
    SELECT generate_series(date_trunc('month', _from)::date, date_trunc('month', _to)::date, interval '1 month')::date AS m
  ),
  costs AS (
    SELECT * FROM public.operating_costs
    WHERE owner_id = public.team_owner() AND is_active = true
  ),
  cross_data AS (
    SELECT c.id AS cost_id, c.name, c.category, c.recurrence, c.amount,
           c.ecommerce_mode, c.ecommerce_percent, c.ecommerce_amount,
           c.start_month, c.end_month, mm.m AS month
    FROM costs c CROSS JOIN months mm
    WHERE c.start_month <= mm.m AND (c.end_month IS NULL OR c.end_month >= mm.m)
  )
  SELECT
    cd.cost_id, cd.name, cd.category, cd.month,
    (CASE
      WHEN cd.recurrence = 'mensal_recorrente' THEN
        COALESCE((SELECT e.amount FROM public.operating_cost_entries e WHERE e.cost_id = cd.cost_id AND e.month = cd.month), cd.amount, 0)
      ELSE
        COALESCE((SELECT e.amount FROM public.operating_cost_entries e WHERE e.cost_id = cd.cost_id AND e.month = cd.month), 0)
    END)::numeric AS amount_total,
    (CASE
      WHEN cd.ecommerce_mode = 'percent' THEN
        (CASE
          WHEN cd.recurrence = 'mensal_recorrente' THEN
            COALESCE((SELECT e.amount FROM public.operating_cost_entries e WHERE e.cost_id = cd.cost_id AND e.month = cd.month), cd.amount, 0)
          ELSE
            COALESCE((SELECT e.amount FROM public.operating_cost_entries e WHERE e.cost_id = cd.cost_id AND e.month = cd.month), 0)
        END) * cd.ecommerce_percent / 100
      ELSE
        LEAST(cd.ecommerce_amount,
          (CASE
            WHEN cd.recurrence = 'mensal_recorrente' THEN
              COALESCE((SELECT e.amount FROM public.operating_cost_entries e WHERE e.cost_id = cd.cost_id AND e.month = cd.month), cd.amount, 0)
            ELSE
              COALESCE((SELECT e.amount FROM public.operating_cost_entries e WHERE e.cost_id = cd.cost_id AND e.month = cd.month), 0)
          END))
    END)::numeric AS amount_ecommerce
  FROM cross_data cd;
$$;


--
-- Name: operating_costs_month(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.operating_costs_month(_owner uuid, _month date) RETURNS TABLE(id uuid, name text, category text, cost_type text, recurrence text, amount_total numeric, ecommerce_mode text, ecommerce_percent numeric, ecommerce_amount numeric, amount_ecommerce numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH m AS (SELECT date_trunc('month', _month)::date AS month),
  base AS (
    SELECT
      c.id, c.name, c.category, c.cost_type, c.recurrence,
      (CASE
        WHEN c.recurrence = 'mensal_recorrente' THEN
          COALESCE((SELECT e.amount FROM public.operating_cost_entries e
               WHERE e.cost_id = c.id AND e.month = (SELECT month FROM m)), c.amount, 0)
        ELSE
          COALESCE((SELECT e.amount FROM public.operating_cost_entries e
               WHERE e.cost_id = c.id AND e.month = (SELECT month FROM m)), 0)
      END)::numeric AS amount_total,
      c.ecommerce_mode, c.ecommerce_percent, c.ecommerce_amount
    FROM public.operating_costs c
    WHERE c.owner_id = public.team_owner()
      AND c.is_active = true
      AND c.start_month <= (SELECT month FROM m)
      AND (c.end_month IS NULL OR c.end_month >= (SELECT month FROM m))
  )
  SELECT
    b.id, b.name, b.category, b.cost_type, b.recurrence, b.amount_total,
    b.ecommerce_mode, b.ecommerce_percent, b.ecommerce_amount,
    (CASE
      WHEN b.ecommerce_mode = 'percent' THEN b.amount_total * b.ecommerce_percent / 100
      ELSE LEAST(b.ecommerce_amount, b.amount_total)
    END)::numeric AS amount_ecommerce
  FROM base b
  WHERE b.amount_total <> 0;
$$;


--
-- Name: operating_costs_summary(uuid, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.operating_costs_summary(_owner uuid, _from date, _to date) RETURNS TABLE(month date, total_all numeric, total_ecommerce numeric, total_fixed numeric, total_variable numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    mm.m AS month,
    COALESCE(SUM(pm.amount_total), 0)::numeric AS total_all,
    COALESCE(SUM(pm.amount_ecommerce), 0)::numeric AS total_ecommerce,
    COALESCE(SUM(CASE WHEN pm.cost_type = 'fixo' THEN pm.amount_total ELSE 0 END), 0)::numeric AS total_fixed,
    COALESCE(SUM(CASE WHEN pm.cost_type = 'variavel' THEN pm.amount_total ELSE 0 END), 0)::numeric AS total_variable
  FROM (
    SELECT generate_series(
      date_trunc('month', _from)::date,
      date_trunc('month', _to)::date,
      interval '1 month'
    )::date AS m
  ) mm
  LEFT JOIN LATERAL public.operating_costs_month(_owner, mm.m) pm ON true
  GROUP BY mm.m
  ORDER BY mm.m;
$$;


--
-- Name: owns_account(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.owns_account(_account_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.marketplace_accounts
    WHERE id = _account_id AND owner_id = public.team_owner()
  );
$$;


--
-- Name: pagamentos_presos(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pagamentos_presos(_account_ids uuid[]) RETURNS TABLE(account_id uuid, payment_id bigint, order_id bigint, produto text, aprovado date, previsto date, dias_atraso integer, valor numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  -- ponytail: 7 dias corridos, sem calendário de feriados; trocar por dias úteis se der falso alarme.
  select p.account_id, p.payment_id, p.order_id,
         (select i.title from ml_orders o join ml_order_items i on i.order_ref = o.id
           where o.account_id = p.account_id and o.order_id = p.order_id
           order by i.created_at, i.id limit 1),
         (coalesce(p.date_approved, p.date_created) at time zone 'America/Sao_Paulo')::date,
         (p.money_release_date at time zone 'America/Sao_Paulo')::date,
         (now() at time zone 'America/Sao_Paulo')::date - (p.money_release_date at time zone 'America/Sao_Paulo')::date,
         p.net_received_amount
    from mp_payments p
   where p.account_id = any(public.contas_permitidas(coalesce(_account_ids,
           (select array_agg(m.id) from marketplace_accounts m where m.owner_id = public.team_owner()))))
     and p.status = 'approved' and p.net_received_amount > 0
     and coalesce(p.money_release_status, '') <> 'released'
     and p.money_release_date < now() - interval '7 days'
   order by p.money_release_date;
$$;


--
-- Name: pay_installment_to_planilha(uuid, uuid, uuid, date, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pay_installment_to_planilha(_owner uuid, _installment_id uuid, _expense_id uuid, _pago_em date, _valor_pago numeric DEFAULT NULL::numeric) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_inst public.payable_installments%ROWTYPE;
  v_note public.payable_notes%ROWTYPE;
  v_valor numeric;
  v_ecommerce numeric;
  v_rateio_fixo numeric;
  v_ja_rateado numeric;
  v_parcelas_restantes integer;
BEGIN
  SELECT * INTO v_inst FROM public.payable_installments
  WHERE id = _installment_id AND public.is_team_owner(owner_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Parcela não encontrada'; END IF;
  SELECT * INTO v_note FROM public.payable_notes WHERE id = v_inst.note_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_team_owner(v_note.owner_id) THEN
    RAISE EXCEPTION 'Conta não encontrada';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.expenses
                 WHERE id = _expense_id AND public.is_team_owner(owner_id)) THEN
    RAISE EXCEPTION 'Gasto não encontrado';
  END IF;
  IF _pago_em IS NULL THEN RAISE EXCEPTION 'Data de pagamento obrigatória'; END IF;

  v_valor := COALESCE(NULLIF(_valor_pago, 0), v_inst.valor, 0);
  IF v_valor < 0 THEN RAISE EXCEPTION 'Valor pago inválido'; END IF;
  IF v_note.destino = 'rateio' AND v_note.ecommerce_mode = 'fixed' THEN
    IF COALESCE(v_note.valor_total, 0) <= 0 THEN
      RAISE EXCEPTION 'Total da conta inválido para rateio fixo';
    END IF;
    v_rateio_fixo := LEAST(GREATEST(COALESCE(v_note.ecommerce_amount, 0), 0), v_note.valor_total);
    SELECT count(*) FILTER (WHERE NOT pi.planilha_lancado),
           COALESCE(sum(pi.planilha_ecommerce_valor) FILTER (WHERE pi.planilha_lancado), 0)
      INTO v_parcelas_restantes, v_ja_rateado
    FROM public.payable_installments pi
    WHERE pi.note_id = v_note.id AND pi.id <> v_inst.id;
  END IF;
  v_ecommerce := CASE v_note.destino
    WHEN 'ecommerce' THEN v_valor
    WHEN 'locacao' THEN 0
    WHEN 'rateio' THEN
      CASE WHEN v_note.ecommerce_mode = 'percent'
           THEN ROUND(v_valor * LEAST(GREATEST(v_note.ecommerce_percent, 0), 100) / 100, 2)
           ELSE LEAST(
             v_valor,
             GREATEST(v_rateio_fixo - v_ja_rateado, 0),
             CASE WHEN v_parcelas_restantes = 0 THEN v_rateio_fixo
                  ELSE ROUND(v_valor * v_rateio_fixo / v_note.valor_total, 2) END
           ) END
    ELSE 0 END;

  UPDATE public.payable_installments
  SET status = 'paga', pago_em = _pago_em,
      planilha_expense_id = _expense_id,
      planilha_month = date_trunc('month', _pago_em)::date,
      planilha_valor = v_valor,
      planilha_ecommerce_valor = v_ecommerce,
      planilha_lancado = true, updated_at = now()
  WHERE id = _installment_id;
END;
$$;


--
-- Name: payable_installments_sync_planilha(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.payable_installments_sync_planilha() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.planilha_expense_id IS NOT NULL THEN
    PERFORM public.planilha_recalcular(OLD.planilha_expense_id, OLD.planilha_month);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.planilha_expense_id IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR NEW.planilha_expense_id IS DISTINCT FROM OLD.planilha_expense_id
          OR NEW.planilha_month IS DISTINCT FROM OLD.planilha_month) THEN
    PERFORM public.planilha_recalcular(NEW.planilha_expense_id, NEW.planilha_month);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: payable_notes_split(uuid, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.payable_notes_split(_owner uuid, _fornecedor text DEFAULT NULL::text, _numero text DEFAULT NULL::text, _cnpj text DEFAULT NULL::text, _produto text DEFAULT NULL::text, _status_pag text DEFAULT 'todas'::text) RETURNS TABLE(id uuid, chave_nfe text, numero_nota text, fornecedor_nome text, fornecedor_cnpj text, data_emissao date, valor_total numeric, valor_produtos numeric, valor_frete numeric, valor_outros numeric, destino text, ecommerce_mode text, ecommerce_percent numeric, ecommerce_amount numeric, status text, created_at timestamp with time zone, parte_ecommerce numeric, parte_locacao numeric, parcelas_total integer, parcelas_pagas integer, recorrencia_id uuid, competencia_mes date)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH hoje AS (
    SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS d
  ),
  base AS (
    SELECT
      n.*,
      (SELECT count(*)::int FROM public.payable_installments pi WHERE pi.note_id = n.id) AS p_total,
      (SELECT count(*)::int FROM public.payable_installments pi WHERE pi.note_id = n.id AND pi.status = 'paga') AS p_pagas,
      (SELECT count(*)::int FROM public.payable_installments pi
        WHERE pi.note_id = n.id AND pi.status = 'aberta' AND pi.vencimento < (SELECT d FROM hoje)) AS p_atrasadas
    FROM public.payable_notes n
    WHERE public.is_team_owner(n.owner_id)
      AND (_fornecedor IS NULL OR _fornecedor = '' OR public.unaccent(n.fornecedor_nome) ILIKE '%' || public.unaccent(_fornecedor) || '%')
      AND (_numero IS NULL OR _numero = '' OR n.numero_nota ILIKE '%' || _numero || '%')
      AND (_cnpj IS NULL OR _cnpj = '' OR regexp_replace(coalesce(n.fornecedor_cnpj,''), '\D', '', 'g') ILIKE '%' || regexp_replace(_cnpj, '\D', '', 'g') || '%')
      AND (_produto IS NULL OR _produto = '' OR EXISTS (
        SELECT 1 FROM public.payable_items it
        WHERE it.note_id = n.id
          AND (public.unaccent(coalesce(it.descricao,'')) ILIKE '%' || public.unaccent(_produto) || '%'
               OR it.fornecedor_sku ILIKE '%' || _produto || '%')
      ))
  )
  SELECT
    b.id, b.chave_nfe, b.numero_nota, b.fornecedor_nome, b.fornecedor_cnpj,
    b.data_emissao, b.valor_total, b.valor_produtos, b.valor_frete, b.valor_outros,
    b.destino, b.ecommerce_mode, b.ecommerce_percent, b.ecommerce_amount, b.status, b.created_at,
    CASE
      WHEN b.destino = 'ecommerce' THEN b.valor_total
      WHEN b.destino = 'locacao' THEN 0
      WHEN b.destino = 'rateio' AND b.ecommerce_mode = 'percent'
        THEN round(b.valor_total * LEAST(GREATEST(b.ecommerce_percent,0),100) / 100.0, 2)
      WHEN b.destino = 'rateio' AND b.ecommerce_mode = 'fixed'
        THEN LEAST(GREATEST(b.ecommerce_amount,0), b.valor_total)
      ELSE 0
    END AS parte_ecommerce,
    b.valor_total - CASE
      WHEN b.destino = 'ecommerce' THEN b.valor_total
      WHEN b.destino = 'locacao' THEN 0
      WHEN b.destino = 'rateio' AND b.ecommerce_mode = 'percent'
        THEN round(b.valor_total * LEAST(GREATEST(b.ecommerce_percent,0),100) / 100.0, 2)
      WHEN b.destino = 'rateio' AND b.ecommerce_mode = 'fixed'
        THEN LEAST(GREATEST(b.ecommerce_amount,0), b.valor_total)
      ELSE 0
    END AS parte_locacao,
    b.p_total AS parcelas_total,
    b.p_pagas AS parcelas_pagas,
    b.recorrencia_id,
    b.competencia_mes
  FROM base b
  WHERE
    CASE
      WHEN _status_pag = 'pagas' THEN b.p_total > 0 AND b.p_pagas = b.p_total
      WHEN _status_pag = 'nao_pagas' THEN b.p_pagas < b.p_total
      WHEN _status_pag = 'atrasadas' THEN b.p_atrasadas > 0
      ELSE true
    END
  ORDER BY b.data_emissao DESC NULLS LAST, b.created_at DESC;
$$;


--
-- Name: payable_resumo(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.payable_resumo(_owner uuid, _op text DEFAULT 'todas'::text) RETURNS TABLE(vencido_valor numeric, vencido_qtd integer, hoje_valor numeric, hoje_qtd integer, semana_valor numeric, semana_qtd integer, mes_valor numeric, mes_qtd integer, pago_mes_valor numeric, pago_mes_qtd integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH base AS (
    SELECT
      i.status, i.vencimento, i.pago_em,
      i.valor,
      CASE
        WHEN _op = 'todas' THEN i.valor
        WHEN _op = 'ecommerce' THEN
          CASE n.destino
            WHEN 'ecommerce' THEN i.valor
            WHEN 'locacao' THEN 0
            WHEN 'rateio' THEN
              CASE WHEN n.ecommerce_mode = 'fixed'
                THEN i.valor * (COALESCE(NULLIF(n.valor_total,0),1) > 0)::int * LEAST(COALESCE(n.ecommerce_amount,0) / NULLIF(n.valor_total,0), 1)
                ELSE i.valor * COALESCE(n.ecommerce_percent,0) / 100 END
            ELSE 0 END
        WHEN _op = 'locacao' THEN
          CASE n.destino
            WHEN 'locacao' THEN i.valor
            WHEN 'ecommerce' THEN 0
            WHEN 'rateio' THEN
              CASE WHEN n.ecommerce_mode = 'fixed'
                THEN i.valor - i.valor * LEAST(COALESCE(n.ecommerce_amount,0) / NULLIF(n.valor_total,0), 1)
                ELSE i.valor * (100 - COALESCE(n.ecommerce_percent,0)) / 100 END
            ELSE i.valor END
        ELSE i.valor END AS valor_op
    FROM payable_installments i
    JOIN payable_notes n ON n.id = i.note_id
    WHERE i.owner_id = _owner
  )
  SELECT
    COALESCE(SUM(valor_op) FILTER (WHERE status='aberta' AND vencimento < CURRENT_DATE),0),
    COALESCE(COUNT(*) FILTER (WHERE status='aberta' AND vencimento < CURRENT_DATE),0)::int,
    COALESCE(SUM(valor_op) FILTER (WHERE status='aberta' AND vencimento = CURRENT_DATE),0),
    COALESCE(COUNT(*) FILTER (WHERE status='aberta' AND vencimento = CURRENT_DATE),0)::int,
    COALESCE(SUM(valor_op) FILTER (WHERE status='aberta' AND vencimento >= CURRENT_DATE AND vencimento < CURRENT_DATE + 7),0),
    COALESCE(COUNT(*) FILTER (WHERE status='aberta' AND vencimento >= CURRENT_DATE AND vencimento < CURRENT_DATE + 7),0)::int,
    COALESCE(SUM(valor_op) FILTER (WHERE status='aberta' AND date_trunc('month',vencimento)=date_trunc('month',CURRENT_DATE)),0),
    COALESCE(COUNT(*) FILTER (WHERE status='aberta' AND date_trunc('month',vencimento)=date_trunc('month',CURRENT_DATE)),0)::int,
    COALESCE(SUM(valor_op) FILTER (WHERE status='paga' AND date_trunc('month',pago_em)=date_trunc('month',CURRENT_DATE)),0),
    COALESCE(COUNT(*) FILTER (WHERE status='paga' AND date_trunc('month',pago_em)=date_trunc('month',CURRENT_DATE)),0)::int
  FROM base;
$$;


--
-- Name: planilha_recalcular(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.planilha_recalcular(_expense_id uuid, _month date) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_soma numeric;
  v_ecommerce numeric;
  v_n int;
  v_row public.expense_values%ROWTYPE;
  v_achou boolean;
BEGIN
  IF _expense_id IS NULL OR _month IS NULL THEN RETURN; END IF;
  PERFORM set_config('app.planilha_sync', 'on', true);

  SELECT COALESCE(sum(COALESCE(pi.planilha_valor, pi.valor, 0)), 0),
         COALESCE(sum(pi.planilha_ecommerce_valor), 0), count(*)
    INTO v_soma, v_ecommerce, v_n
  FROM public.payable_installments pi
  WHERE pi.planilha_lancado AND pi.planilha_expense_id = _expense_id AND pi.planilha_month = _month;

  SELECT * INTO v_row FROM public.expense_values
  WHERE expense_id = _expense_id AND month = _month FOR UPDATE;
  v_achou := FOUND;

  IF v_n > 0 THEN
    IF NOT v_achou THEN
      INSERT INTO public.expense_values
        (expense_id, owner_id, month, amount, tem_conta, previsto, ecommerce_valor_conta)
      SELECT _expense_id, e.owner_id, _month, v_soma, true, NULL, v_ecommerce
      FROM public.expenses e WHERE e.id = _expense_id;
    ELSIF NOT v_row.tem_conta THEN
      UPDATE public.expense_values
      SET previsto = v_row.amount, amount = v_soma, tem_conta = true,
          ecommerce_valor_conta = v_ecommerce, updated_at = now()
      WHERE id = v_row.id;
    ELSE
      UPDATE public.expense_values
      SET amount = v_soma, ecommerce_valor_conta = v_ecommerce, updated_at = now()
      WHERE id = v_row.id;
    END IF;
  ELSIF v_achou AND v_row.tem_conta THEN
    IF v_row.previsto IS NULL THEN
      DELETE FROM public.expense_values WHERE id = v_row.id;
    ELSE
      UPDATE public.expense_values
      SET amount = v_row.previsto, previsto = NULL, tem_conta = false,
          ecommerce_valor_conta = NULL, updated_at = now()
      WHERE id = v_row.id;
    END IF;
  END IF;

  PERFORM set_config('app.planilha_sync', 'off', true);
END;
$$;


--
-- Name: product_catalog(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.product_catalog(_owner uuid, _tipo text DEFAULT 'todos'::text, _busca text DEFAULT NULL::text) RETURNS TABLE(id uuid, sku text, titulo text, is_kit boolean, ativo boolean, categoria text, custo_efetivo numeric, componentes integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT ps.id, ps.sku, ps.titulo, ps.is_kit, ps.ativo, ps.categoria,
    CASE WHEN ps.is_kit THEN public.kit_cost(public.team_owner(), ps.sku) ELSE ps.custo_base END AS custo_efetivo,
    CASE WHEN ps.is_kit THEN (SELECT count(*)::int FROM public.kit_components kc WHERE kc.owner_id=public.team_owner() AND kc.kit_sku=ps.sku) ELSE 0 END AS componentes
  FROM public.product_skus ps
  WHERE ps.owner_id = public.team_owner()
    AND (_tipo='todos' OR (_tipo='simples' AND ps.is_kit=false) OR (_tipo='kit' AND ps.is_kit=true))
    AND (_busca IS NULL OR _busca='' OR unaccent(lower(ps.sku)) LIKE '%'||unaccent(lower(_busca))||'%' OR unaccent(lower(coalesce(ps.titulo,''))) LIKE '%'||unaccent(lower(_busca))||'%')
  ORDER BY ps.is_kit, ps.sku;
$$;


--
-- Name: product_skus_com_venda(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.product_skus_com_venda() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_kits text;
begin
  if exists (select 1 from ml_order_items i join marketplace_accounts a on a.id = i.account_id
              where a.owner_id = old.owner_id and btrim(i.seller_sku) = btrim(old.sku)) then
    raise exception 'O SKU % já teve vendas e não pode ser excluído: o custo dessas vendas sairia das contas e a margem dos meses passados mudaria.', btrim(old.sku);
  end if;
  -- Componente: o custo do kit é a soma das peças.
  select string_agg(distinct btrim(k.kit_sku), ', ') into v_kits
    from kit_components k
   where k.owner_id = old.owner_id and btrim(k.component_sku) = btrim(old.sku)
     and exists (select 1 from ml_order_items i join marketplace_accounts a on a.id = i.account_id
                  where a.owner_id = old.owner_id and btrim(i.seller_sku) = btrim(k.kit_sku));
  if v_kits is not null then
    raise exception 'O SKU % faz parte do(s) kit(s) %, que já tiveram vendas, e não pode ser excluído: o custo dessas vendas sairia das contas.', btrim(old.sku), v_kits;
  end if;
  return old;
end;
$$;


--
-- Name: purge_old_order_payloads(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purge_old_order_payloads() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE affected integer;
BEGIN
  UPDATE ml_orders SET raw = NULL
  WHERE raw IS NOT NULL
    AND date_created < now() - interval '90 days';
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;


--
-- Name: purge_old_sync_records(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purge_old_sync_records() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE logs_del integer; jobs_del integer; states_del integer;
BEGIN
  DELETE FROM sync_logs WHERE started_at < now() - interval '60 days';
  GET DIAGNOSTICS logs_del = ROW_COUNT;

  DELETE FROM sync_jobs
  WHERE status = 'concluido' AND finished_at < now() - interval '30 days';
  GET DIAGNOSTICS jobs_del = ROW_COUNT;

  DELETE FROM oauth_states WHERE expires_at < now() - interval '1 day';
  GET DIAGNOSTICS states_del = ROW_COUNT;

  RETURN jsonb_build_object('logs', logs_del, 'jobs', jobs_del, 'states', states_del);
END;
$$;


--
-- Name: rebuild_tax_rate_periods(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rebuild_tax_rate_periods(_account_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  r RECORD;
  next_from date;
BEGIN
  IF NOT public.owns_account(_account_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  next_from := NULL;
  FOR r IN
    SELECT id, valid_from
    FROM public.account_tax_rates
    WHERE account_id = _account_id
    ORDER BY valid_from DESC
  LOOP
    IF next_from IS NULL THEN
      UPDATE public.account_tax_rates SET valid_to = NULL WHERE id = r.id;
    ELSE
      UPDATE public.account_tax_rates SET valid_to = (next_from - INTERVAL '1 day')::date WHERE id = r.id;
    END IF;
    next_from := r.valid_from;
  END LOOP;
END;
$$;


--
-- Name: recompute_sku_cost(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recompute_sku_cost(_owner uuid, _sku text) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  novo numeric;
  v_owner uuid := public.team_owner();
  v_travado boolean;
BEGIN
  SELECT custo_travado INTO v_travado
  FROM public.product_skus
  WHERE owner_id = v_owner AND sku = _sku;

  IF COALESCE(v_travado, false) THEN
    SELECT valor_unitario INTO novo
    FROM public.product_cost_history
    WHERE owner_id = v_owner AND sku = _sku AND origem = 'manual'
    ORDER BY registrado_em DESC
    LIMIT 1;
  ELSE
    SELECT valor_unitario INTO novo
    FROM public.product_cost_history
    WHERE owner_id = v_owner AND sku = _sku AND origem = 'nota' AND data_nota IS NOT NULL
    ORDER BY data_nota DESC, registrado_em DESC
    LIMIT 1;

    IF novo IS NULL THEN
      SELECT valor_unitario INTO novo
      FROM public.product_cost_history
      WHERE owner_id = v_owner AND sku = _sku AND origem = 'manual'
      ORDER BY registrado_em DESC
      LIMIT 1;
    END IF;
  END IF;

  -- upsert do custo: se novo IS NULL (histórico vazio), zera o custo_base
  INSERT INTO public.product_skus (owner_id, sku, custo_base, is_kit)
  VALUES (v_owner, _sku, novo, false)
  ON CONFLICT (owner_id, sku)
  DO UPDATE SET custo_base = EXCLUDED.custo_base, updated_at = now();

  RETURN novo;
END;
$$;


--
-- Name: rental_by_city(uuid, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rental_by_city(_owner uuid, _year integer, _month integer DEFAULT NULL::integer) RETURNS TABLE(municipio text, uf text, total numeric, faturas bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(NULLIF(TRIM(i.municipio),''),'—') AS municipio,
         COALESCE(NULLIF(TRIM(i.uf),''),'') AS uf,
         SUM(i.valor)::numeric AS total,
         COUNT(*)::bigint AS faturas
  FROM public.rental_invoices i
  WHERE i.owner_id = public.team_owner()
    AND EXTRACT(YEAR FROM i.month) = _year
    AND (_month IS NULL OR EXTRACT(MONTH FROM i.month) = _month)
  GROUP BY 1,2 ORDER BY SUM(i.valor) DESC;
$$;


--
-- Name: rental_invoices_grouped(uuid, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rental_invoices_grouped(_owner uuid, _year integer, _month integer DEFAULT NULL::integer) RETURNS TABLE(cnpj_raiz text, grupo_label text, faturas bigint, total numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH filt AS (
    SELECT * FROM public.rental_invoices i
    WHERE i.owner_id = public.team_owner()
      AND EXTRACT(YEAR FROM i.month) = _year
      AND (_month IS NULL OR EXTRACT(MONTH FROM i.month) = _month)
  ),
  razao_moda AS (
    SELECT cnpj_raiz, razao_social,
           row_number() OVER (PARTITION BY cnpj_raiz ORDER BY count(*) DESC) rn
    FROM filt
    WHERE razao_social IS NOT NULL
    GROUP BY cnpj_raiz, razao_social
  )
  SELECT
    f.cnpj_raiz,
    COALESCE(gl.label, rm.razao_social, f.cnpj_raiz) AS grupo_label,
    count(*)::bigint AS faturas,
    SUM(f.valor)::numeric AS total
  FROM filt f
  LEFT JOIN public.rental_group_labels gl ON gl.owner_id = public.team_owner() AND gl.cnpj_raiz = f.cnpj_raiz
  LEFT JOIN razao_moda rm ON rm.cnpj_raiz = f.cnpj_raiz AND rm.rn = 1
  GROUP BY f.cnpj_raiz, COALESCE(gl.label, rm.razao_social, f.cnpj_raiz)
  ORDER BY SUM(f.valor) DESC;
$$;


--
-- Name: rental_monthly_total(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rental_monthly_total(_owner uuid, _year integer) RETURNS TABLE(month date, total numeric, faturas bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH months AS (SELECT make_date(_year, m, 1)::date AS month FROM generate_series(1,12) m)
  SELECT mm.month,
         COALESCE(SUM(i.valor),0)::numeric AS total,
         COUNT(i.id)::bigint AS faturas
  FROM months mm
  LEFT JOIN public.rental_invoices i
    ON i.month = mm.month AND i.owner_id = public.team_owner()
  GROUP BY mm.month ORDER BY mm.month;
$$;


--
-- Name: reopen_installment(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reopen_installment(_owner uuid, _installment_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_inst public.payable_installments%ROWTYPE;
BEGIN
  SELECT * INTO v_inst FROM public.payable_installments
  WHERE id = _installment_id AND public.is_team_owner(owner_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Parcela não encontrada'; END IF;
  UPDATE public.payable_installments
  SET status = 'aberta', pago_em = NULL, planilha_expense_id = NULL,
      planilha_month = NULL, planilha_valor = NULL, planilha_ecommerce_valor = NULL,
      planilha_lancado = false, updated_at = now()
  WHERE id = _installment_id;
END;
$$;


--
-- Name: resolve_name_rule(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_name_rule(_owner uuid, _text text) RETURNS TABLE(expense_id uuid, category_id uuid, matched_text text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT r.expense_id, r.category_id, r.match_text
  FROM public.expense_name_rules r
  WHERE r.owner_id = _owner
    AND unaccent(lower(_text)) LIKE '%' || unaccent(lower(r.match_text)) || '%'
  ORDER BY length(r.match_text) DESC
  LIMIT 1;
$$;


--
-- Name: set_expense_range(uuid, date, date, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_expense_range(_expense_id uuid, _from_month date, _to_month date, _amount numeric) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_owner uuid;
  v_count integer;
  v_from date := date_trunc('month', _from_month)::date;
  v_to date := date_trunc('month', _to_month)::date;
BEGIN
  SELECT owner_id INTO v_owner FROM public.expenses WHERE id = _expense_id;
  IF v_owner IS NULL OR NOT public.is_team_owner(v_owner) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF v_from > v_to THEN
    RAISE EXCEPTION 'from_month must be <= to_month';
  END IF;

  INSERT INTO public.expense_values (expense_id, owner_id, month, amount)
  SELECT _expense_id, v_owner, m::date, _amount
  FROM generate_series(v_from, v_to, interval '1 month') m
  ON CONFLICT (expense_id, month)
  DO UPDATE SET amount = EXCLUDED.amount, updated_at = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;


--
-- Name: set_faturamento_externo(uuid, text, date, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_faturamento_externo(_empresa_id uuid, _canal text, _month date, _valor numeric) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_owner uuid := public.team_owner();
BEGIN
  IF NOT public.is_team_owner((SELECT owner_id FROM public.empresas WHERE id=_empresa_id)) THEN
    RAISE EXCEPTION 'Empresa não encontrada'; END IF;
  IF _valor IS NULL OR _valor < 0 THEN RAISE EXCEPTION 'Valor inválido'; END IF;
  INSERT INTO public.faturamento_externo (owner_id, empresa_id, canal, month, valor)
  VALUES (v_owner, _empresa_id, _canal, date_trunc('month',_month)::date, _valor)
  ON CONFLICT (empresa_id, canal, month) DO UPDATE SET valor=EXCLUDED.valor, updated_at=now();
END; $$;


--
-- Name: set_manual_sku_cost(uuid, text, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_manual_sku_cost(_owner uuid, _sku text, _valor numeric) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_custo numeric;
  v_owner uuid := public.team_owner();
BEGIN
  -- Custo zero ou negativo não é custo (cus-07): recusa com mensagem em vez de gravar.
  IF _valor IS NULL OR _valor <= 0 THEN
    RAISE EXCEPTION 'O custo precisa ser maior que zero.';
  END IF;
  INSERT INTO public.product_cost_history (owner_id, sku, valor_unitario, origem, data_nota, numero_nota, note_id, item_id)
  VALUES (v_owner, _sku, _valor, 'manual', NULL, NULL, NULL, NULL);

  v_custo := public.recompute_sku_cost(v_owner, _sku);
  RETURN v_custo;
END;
$$;


--
-- Name: set_sku_cost_travado(uuid, text, numeric, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_sku_cost_travado(_owner uuid, _sku text, _valor numeric, _travar boolean) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_custo numeric;
  v_owner uuid := public.team_owner();
BEGIN
  -- Custo zero ou negativo não é custo (cus-07): recusa com mensagem em vez de gravar.
  IF _valor IS NULL OR _valor <= 0 THEN
    RAISE EXCEPTION 'O custo precisa ser maior que zero.';
  END IF;
  -- registra o custo manual
  INSERT INTO public.product_cost_history (owner_id, sku, valor_unitario, origem, data_nota, numero_nota, note_id, item_id)
  VALUES (v_owner, _sku, _valor, 'manual', NULL, NULL, NULL, NULL);

  -- ajusta a trava
  UPDATE public.product_skus
  SET custo_travado = _travar
  WHERE owner_id = v_owner AND sku = _sku;

  -- recalcula (respeitando a trava)
  v_custo := public.recompute_sku_cost(v_owner, _sku);
  RETURN v_custo;
END;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;


--
-- Name: sku_cost_history(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sku_cost_history(_owner uuid, _sku text) RETURNS TABLE(id uuid, valor_unitario numeric, origem text, data_nota date, numero_nota text, registrado_em timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT id, valor_unitario, origem, data_nota, numero_nota, registrado_em
  FROM public.product_cost_history
  WHERE owner_id = public.team_owner() AND sku = _sku
  ORDER BY COALESCE(data_nota, registrado_em::date) DESC, registrado_em DESC;
$$;


--
-- Name: sku_custo_unit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sku_custo_unit() RETURNS TABLE(sku text, custo_unit numeric, faltando_cnt bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT ps.sku,
         CASE WHEN ps.is_kit THEN (
           SELECT COALESCE(SUM(cps.custo_base * kc.quantity),0)
           FROM public.kit_components kc
           LEFT JOIN public.product_skus cps ON cps.owner_id = ps.owner_id AND cps.sku = kc.component_sku
           WHERE kc.owner_id = ps.owner_id AND kc.kit_sku = ps.sku
         ) ELSE COALESCE(ps.custo_base,0) END AS custo_unit,
         CASE WHEN ps.is_kit THEN (
           SELECT count(*) FILTER (WHERE cps.custo_base IS NULL OR cps.custo_base = 0)
           FROM public.kit_components kc
           LEFT JOIN public.product_skus cps ON cps.owner_id = ps.owner_id AND cps.sku = kc.component_sku
           WHERE kc.owner_id = ps.owner_id AND kc.kit_sku = ps.sku
         ) ELSE (CASE WHEN COALESCE(ps.custo_base,0)=0 THEN 1 ELSE 0 END)::bigint END AS faltando_cnt
  FROM public.product_skus ps
  WHERE ps.owner_id = public.team_owner();
$$;


--
-- Name: sku_delete_impact(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sku_delete_impact(_sku text) RETURNS TABLE(vendas bigint, unidades numeric, receita numeric, kits text[], historico bigint, vinculos bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_owner uuid := public.team_owner();
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  RETURN QUERY
  SELECT
    (SELECT COUNT(DISTINCT i.order_ref) FROM public.ml_order_items i
       JOIN public.marketplace_accounts a ON a.id = i.account_id
      WHERE a.owner_id = v_owner AND btrim(i.seller_sku) = btrim(_sku))::bigint,
    (SELECT COALESCE(SUM(i.quantity),0) FROM public.ml_order_items i
       JOIN public.marketplace_accounts a ON a.id = i.account_id
      WHERE a.owner_id = v_owner AND btrim(i.seller_sku) = btrim(_sku))::numeric,
    (SELECT COALESCE(SUM(i.unit_price * i.quantity),0) FROM public.ml_order_items i
       JOIN public.marketplace_accounts a ON a.id = i.account_id
      WHERE a.owner_id = v_owner AND btrim(i.seller_sku) = btrim(_sku))::numeric,
    (SELECT COALESCE(ARRAY_AGG(DISTINCT k.kit_sku), '{}') FROM public.kit_components k
      WHERE k.owner_id = v_owner AND btrim(k.component_sku) = btrim(_sku)),
    (SELECT COUNT(*) FROM public.product_cost_history h
      WHERE h.owner_id = v_owner AND btrim(h.sku) = btrim(_sku))::bigint,
    (SELECT COUNT(*) FROM public.sku_item_links l
      WHERE l.owner_id = v_owner AND btrim(l.seller_sku) = btrim(_sku))::bigint;
END;
$$;


--
-- Name: team_app_settings(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.team_app_settings() RETURNS TABLE(logo_url text, logo_icon_url text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT s.logo_url, s.logo_icon_url
  FROM public.app_settings s
  WHERE s.owner_id = public.team_owner()
  LIMIT 1;
$$;


--
-- Name: team_owner(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.team_owner() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(
    (SELECT root_owner_id FROM public.account_members WHERE member_id = auth.uid() LIMIT 1),
    auth.uid()
  );
$$;


--
-- Name: team_users(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.team_users() RETURNS TABLE(member_id uuid, email text, display_name text, is_admin boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
  select am.member_id,
         u.email::text,
         am.display_name,
         (am.member_id = am.root_owner_id or am.administrador) as is_admin
    from public.account_members am
    join auth.users u on u.id = am.member_id
   where public.is_admin()
     and am.root_owner_id = public.team_owner()
   order by (am.member_id = am.root_owner_id) desc, am.administrador desc, am.display_name nulls last;
$$;


--
-- Name: telegram_ad_candidates(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.telegram_ad_candidates(_owner_id uuid, _dias integer DEFAULT 30) RETURNS TABLE(account_id uuid, account_nickname text, item_id text, titulo text, seller_sku text, receita numeric, cmv numeric, ads numeric, margem numeric, margem_pct numeric, custo_faltando boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH accs AS (
    SELECT a.id, a.nickname FROM public.marketplace_accounts a
    WHERE a.owner_id = _owner_id AND a.status = 'conectada'
  ),
  vendas AS (
    SELECT oi.account_id, oi.item_id,
           max(oi.seller_sku) AS seller_sku,
           max(oi.title) AS titulo,
           sum(oi.unit_price * oi.quantity)::numeric AS receita,
           sum(COALESCE(oi.sale_fee,0) * oi.quantity)::numeric AS comissao,
           sum(oi.quantity)::numeric AS unidades
    FROM public.ml_order_items oi
    JOIN public.ml_orders o ON o.id = oi.order_ref
    WHERE oi.account_id IN (SELECT id FROM accs)
      AND o.date_created >= now() - (_dias || ' days')::interval
      AND o.status IN ('paid','shipped','delivered','partially_refunded')
    GROUP BY oi.account_id, oi.item_id
  ),
  ads AS (
    SELECT a.account_id, a.item_id, sum(a.cost)::numeric AS ads
    FROM public.ml_ads_daily a
    WHERE a.account_id IN (SELECT id FROM accs)
      AND a.date >= (now() - (_dias || ' days')::interval)::date
      AND a.item_id IS NOT NULL
    GROUP BY a.account_id, a.item_id
  ),
  custo_sku AS (
    SELECT ps.sku,
           CASE WHEN ps.is_kit THEN (
             SELECT COALESCE(SUM(cps.custo_base * kc.quantity),0)
             FROM public.kit_components kc
             LEFT JOIN public.product_skus cps ON cps.owner_id = ps.owner_id AND cps.sku = kc.component_sku
             WHERE kc.owner_id = ps.owner_id AND kc.kit_sku = ps.sku
           ) ELSE COALESCE(ps.custo_base,0) END AS custo_unit,
           CASE WHEN ps.is_kit THEN (
             SELECT count(*) FILTER (WHERE cps.custo_base IS NULL OR cps.custo_base = 0)
             FROM public.kit_components kc
             LEFT JOIN public.product_skus cps ON cps.owner_id = ps.owner_id AND cps.sku = kc.component_sku
             WHERE kc.owner_id = ps.owner_id AND kc.kit_sku = ps.sku
           ) ELSE (CASE WHEN COALESCE(ps.custo_base,0)=0 THEN 1 ELSE 0 END) END AS faltando_cnt
    FROM public.product_skus ps
    WHERE ps.owner_id = _owner_id
  )
  SELECT v.account_id, ac.nickname, v.item_id, v.titulo, v.seller_sku,
         v.receita,
         (COALESCE(cs.custo_unit,0) * v.unidades)::numeric AS cmv,
         COALESCE(ad.ads,0)::numeric AS ads,
         (v.receita - v.comissao - COALESCE(ad.ads,0) - COALESCE(cs.custo_unit,0) * v.unidades)::numeric AS margem,
         CASE WHEN v.receita > 0 THEN
           ((v.receita - v.comissao - COALESCE(ad.ads,0) - COALESCE(cs.custo_unit,0) * v.unidades) / v.receita * 100)::numeric
         ELSE NULL END AS margem_pct,
         (cs.sku IS NULL OR COALESCE(cs.faltando_cnt,0) > 0) AS custo_faltando
  FROM vendas v
  JOIN accs ac ON ac.id = v.account_id
  LEFT JOIN ads ad ON ad.account_id = v.account_id AND ad.item_id = v.item_id
  LEFT JOIN custo_sku cs ON cs.sku = btrim(v.seller_sku);
$$;


--
-- Name: telegram_sale_candidates(uuid, timestamp with time zone, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.telegram_sale_candidates(_owner_id uuid, _since timestamp with time zone, _limit integer) RETURNS TABLE(account_id uuid, account_nickname text, order_id bigint, order_date timestamp with time zone, sku text, title text, units integer, receita numeric, liquido numeric, cmv numeric, imposto numeric, margem numeric, margem_pct numeric, cmv_missing boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  WITH ord AS (
    SELECT o.id, o.account_id, o.order_id, o.date_created, o.total_amount,
           ((o.date_created AT TIME ZONE 'America/Sao_Paulo')::date) AS day_sp,
           a.nickname
    FROM public.ml_orders o
    JOIN public.marketplace_accounts a ON a.id = o.account_id
    WHERE a.owner_id = _owner_id
      AND o.date_created >= _since
      AND o.status IN ('paid','shipped','delivered','partially_refunded')
    ORDER BY o.date_created DESC
    LIMIT _limit
  ),
  custo_sku AS (
    SELECT ps.sku,
           CASE WHEN ps.is_kit THEN (
             SELECT COALESCE(SUM(cps.custo_base * kc.quantity),0)
             FROM public.kit_components kc
             LEFT JOIN public.product_skus cps ON cps.owner_id = ps.owner_id AND cps.sku = kc.component_sku
             WHERE kc.owner_id = ps.owner_id AND kc.kit_sku = ps.sku
           ) ELSE COALESCE(ps.custo_base,0) END AS custo_unit,
           CASE WHEN ps.is_kit THEN (
             SELECT count(*) FILTER (WHERE cps.custo_base IS NULL OR cps.custo_base = 0)
             FROM public.kit_components kc
             LEFT JOIN public.product_skus cps ON cps.owner_id = ps.owner_id AND cps.sku = kc.component_sku
             WHERE kc.owner_id = ps.owner_id AND kc.kit_sku = ps.sku
           ) ELSE (CASE WHEN COALESCE(ps.custo_base,0)=0 THEN 1 ELSE 0 END) END AS faltando_cnt
    FROM public.product_skus ps
    WHERE ps.owner_id = _owner_id
  ),
  it AS (
    SELECT i.order_ref,
           SUM(i.quantity)::integer AS units,
           COALESCE(SUM(i.sale_fee * i.quantity),0)::numeric AS ml_commission,
           COALESCE(SUM(i.unit_price * i.quantity),0)::numeric AS receita_produto,
           (ARRAY_AGG(i.seller_sku ORDER BY i.created_at, i.id))[1] AS sku,
           (ARRAY_AGG(i.title ORDER BY i.created_at, i.id))[1] AS title,
           COALESCE(SUM(COALESCE(cs.custo_unit,0) * i.quantity),0)::numeric AS cmv,
           bool_or(cs.sku IS NULL OR COALESCE(cs.faltando_cnt,0) > 0) AS cmv_missing
    FROM public.ml_order_items i
    LEFT JOIN custo_sku cs ON cs.sku = btrim(i.seller_sku)
    WHERE i.order_ref IN (SELECT o.id FROM ord o)
    GROUP BY i.order_ref
  ),
  pay AS (
    SELECT p.account_id, p.order_id,
           COALESCE(SUM(p.net_received_amount) FILTER (WHERE p.status='approved'),0)::numeric AS mp_net
    FROM public.mp_payments p
    WHERE p.order_id IS NOT NULL
    GROUP BY p.account_id, p.order_id
  ),
  bill AS (
    SELECT b.account_id, b.order_id,
           SUM(b.amount * CASE WHEN b.detail_type = 'BONUS' THEN -1 ELSE 1 END)::numeric AS fees
    FROM public.ml_billing_details b
    WHERE b.order_id IS NOT NULL
      AND COALESCE(b.concept_type, '') <> 'MCLICS'
      AND b.order_id IN (SELECT o.order_id FROM ord o)
    GROUP BY b.account_id, b.order_id
  ),
  base AS (
    SELECT o.account_id, o.nickname, o.order_id, o.date_created,
           it.sku, it.title, COALESCE(it.units,0) AS units,
           o.total_amount AS receita,
           CASE WHEN COALESCE(pp.mp_net,0) > 0 THEN pp.mp_net
                WHEN bb.fees IS NOT NULL THEN o.total_amount - bb.fees
                ELSE o.total_amount - COALESCE(it.ml_commission,0) END AS liquido,
           COALESCE(it.cmv,0) AS cmv,
           COALESCE(it.cmv_missing, true) AS cmv_missing,
           COALESCE(COALESCE(it.receita_produto,0) * tx.rate / 100.0, 0) AS imposto
    FROM ord o
    LEFT JOIN it ON it.order_ref = o.id
    LEFT JOIN pay pp ON pp.account_id = o.account_id AND pp.order_id = o.order_id
    LEFT JOIN bill bb ON bb.account_id = o.account_id AND bb.order_id = o.order_id
    LEFT JOIN LATERAL (
      SELECT t.rate FROM public.account_tax_rates t
      WHERE t.account_id = o.account_id
        AND t.valid_from <= o.day_sp
        AND (t.valid_to IS NULL OR t.valid_to >= o.day_sp)
      ORDER BY t.valid_from DESC LIMIT 1
    ) tx ON true
  )
  SELECT b.account_id, b.nickname, b.order_id, b.date_created, b.sku, b.title,
         b.units, b.receita, b.liquido, b.cmv, b.imposto,
         (b.liquido - b.cmv - b.imposto)::numeric AS margem,
         CASE WHEN b.receita > 0 THEN ((b.liquido - b.cmv - b.imposto) / b.receita * 100)::numeric ELSE NULL END,
         b.cmv_missing
  FROM base b;
END;
$$;


--
-- Name: tornar_conta_recorrente(uuid, uuid, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tornar_conta_recorrente(_owner uuid, _note_id uuid, _meses integer, _dia_vencimento integer) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  n public.payable_notes%ROWTYPE;
  v_rec uuid;
  v_mes_base date;
  dia int;
  v_owner uuid := public.team_owner();
BEGIN
  SELECT * INTO n FROM public.payable_notes WHERE id = _note_id AND public.is_team_owner(owner_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta não encontrada'; END IF;
  IF n.recorrencia_id IS NOT NULL THEN RAISE EXCEPTION 'Esta conta já pertence a uma recorrência'; END IF;

  dia := LEAST(GREATEST(_dia_vencimento,1),31);

  INSERT INTO public.payable_recurrences
    (owner_id, nome, categoria_id, subcategoria_id, gasto_id, tipo_conta, destino,
     ecommerce_mode, ecommerce_percent, ecommerce_amount, valor, dia_vencimento, ativo)
  VALUES
    (v_owner, n.fornecedor_nome, n.categoria_id, n.subcategoria_id, n.gasto_id, n.tipo_conta, n.destino,
     COALESCE(n.ecommerce_mode,'percent'), COALESCE(n.ecommerce_percent,0), COALESCE(n.ecommerce_amount,0),
     n.valor_total, dia, true)
  RETURNING id INTO v_rec;

  v_mes_base := date_trunc('month', COALESCE(n.data_emissao, now()::date))::date;
  UPDATE public.payable_notes SET recorrencia_id = v_rec, competencia_mes = v_mes_base WHERE id = _note_id;

  PERFORM public.gerar_contas_recorrencia(v_owner, v_rec, (v_mes_base + interval '1 month')::date, _meses);

  RETURN v_rec;
END;
$$;


--
-- Name: update_cost_history(uuid, numeric, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_cost_history(_id uuid, _valor numeric, _data date) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_owner uuid := public.team_owner();
  v_sku text;
  v_origem text;
BEGIN
  SELECT sku, origem INTO v_sku, v_origem FROM public.product_cost_history
  WHERE id = _id AND public.is_team_owner(owner_id);
  IF v_sku IS NULL THEN RAISE EXCEPTION 'Registro não encontrado'; END IF;
  IF v_origem <> 'manual' THEN RAISE EXCEPTION 'Só registros manuais podem ser editados'; END IF;
  IF _valor IS NULL OR _valor <= 0 THEN RAISE EXCEPTION 'Valor inválido'; END IF;

  UPDATE public.product_cost_history
  SET valor_unitario = _valor,
      data_nota = COALESCE(_data, data_nota),
      registrado_em = now()
  WHERE id = _id AND public.is_team_owner(owner_id);

  PERFORM public.recompute_sku_cost(v_owner, v_sku);
END;
$$;


--
-- Name: vault_get_secret(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.vault_get_secret(_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = _id LIMIT 1;
$$;


--
-- Name: vault_set_secret(text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.vault_set_secret(_name text, _secret text, _existing_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
DECLARE
  v_id uuid;
  v_saved text;
BEGIN
  IF _secret IS NULL OR length(_secret) = 0 THEN
    RAISE EXCEPTION 'Secret value is required';
  END IF;

  IF _existing_id IS NOT NULL THEN
    SELECT id INTO v_id
    FROM vault.secrets
    WHERE id = _existing_id
    LIMIT 1;

    IF v_id IS NOT NULL THEN
      PERFORM vault.update_secret(
        secret_id := _existing_id,
        new_secret := _secret,
        new_name := _name
      );

      SELECT decrypted_secret INTO v_saved
      FROM vault.decrypted_secrets
      WHERE id = _existing_id
      LIMIT 1;

      IF v_saved IS DISTINCT FROM _secret THEN
        RAISE EXCEPTION 'Vault update verification failed for %', _name;
      END IF;

      RETURN _existing_id;
    END IF;
  END IF;

  v_id := vault.create_secret(
    new_secret := _secret,
    new_name := _name
  );

  SELECT decrypted_secret INTO v_saved
  FROM vault.decrypted_secrets
  WHERE id = v_id
  LIMIT 1;

  IF v_saved IS DISTINCT FROM _secret THEN
    RAISE EXCEPTION 'Vault create verification failed for %', _name;
  END IF;

  RETURN v_id;
END;
$$;


--
-- Name: vencimentos_do_dia(uuid, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.vencimentos_do_dia(_owner uuid, _dia date, _op text DEFAULT 'todas'::text) RETURNS TABLE(installment_id uuid, note_id uuid, numero_parcela text, fornecedor_nome text, numero_nota text, vencimento date, valor numeric, status text, pago_em date, planilha_lancado boolean, categoria_id uuid, subcategoria_id uuid, gasto_id uuid, tipo_conta text, destino text, recorrencia_id uuid, categoria_efetiva_id uuid, atrasada boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    pi.id, n.id, pi.numero, n.fornecedor_nome, n.numero_nota, pi.vencimento, pi.valor, pi.status, pi.pago_em, pi.planilha_lancado,
    n.categoria_id, n.subcategoria_id, n.gasto_id, n.tipo_conta, n.destino, n.recorrencia_id,
    CASE WHEN n.tipo_conta = 'fornecedor' THEN n.subcategoria_id ELSE n.categoria_id END,
    (pi.status = 'aberta' AND pi.vencimento < _dia)
  FROM public.payable_installments pi
  JOIN public.payable_notes n ON n.id = pi.note_id
  WHERE public.is_team_owner(pi.owner_id)
    AND (
      (pi.status = 'aberta' AND pi.vencimento <= _dia)
      OR (pi.status = 'paga' AND pi.pago_em = _dia)
    )
    AND (
      _op = 'todas'
      OR (_op = 'ecommerce' AND n.destino IN ('ecommerce','rateio'))
      OR (_op = 'locacao'   AND n.destino IN ('locacao','rateio'))
    )
  ORDER BY pi.vencimento, n.fornecedor_nome, pi.numero;
$$;


--
-- Name: vendas_sem_aliquota(uuid[], date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.vendas_sem_aliquota(_account_ids uuid[], _from date, _to date) RETURNS TABLE(sem_aliquota bigint, vendas bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select count(*) filter (where not exists (
           select 1 from account_tax_rates t
            where t.account_id = o.account_id
              and t.valid_from <= (o.date_created at time zone 'America/Sao_Paulo')::date
              and (t.valid_to is null or t.valid_to >= (o.date_created at time zone 'America/Sao_Paulo')::date))),
         count(*)
    from ml_orders o
   where o.account_id = any(public.contas_permitidas(coalesce(_account_ids,
           (select array_agg(m.id) from marketplace_accounts m where m.owner_id = public.team_owner()))))
     and (o.date_created at time zone 'America/Sao_Paulo')::date between _from and _to
     and o.status <> 'cancelled';
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: account_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    root_owner_id uuid NOT NULL,
    member_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    display_name text,
    administrador boolean DEFAULT false NOT NULL
);


--
-- Name: account_tax_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_tax_rates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    rate numeric NOT NULL,
    valid_from date NOT NULL,
    valid_to date,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    logo_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    logo_icon_url text
);


--
-- Name: audit_findings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_findings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid,
    owner_id uuid NOT NULL,
    check_code text NOT NULL,
    severity text NOT NULL,
    title text NOT NULL,
    detail text,
    expected numeric,
    actual numeric,
    diff numeric,
    context jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'aberto'::text NOT NULL,
    auto_fixable boolean DEFAULT false NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT audit_findings_severity_check CHECK ((severity = ANY (ARRAY['critico'::text, 'alerta'::text, 'info'::text]))),
    CONSTRAINT audit_findings_status_check CHECK ((status = ANY (ARRAY['aberto'::text, 'corrigindo'::text, 'resolvido'::text, 'ignorado'::text])))
);


--
-- Name: billing_subtype_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_subtype_map (
    sub_type text NOT NULL,
    category text NOT NULL,
    label text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    escopo text,
    em_sale_fee boolean DEFAULT false NOT NULL,
    conta_no_custo boolean DEFAULT true NOT NULL,
    observacao text,
    CONSTRAINT billing_subtype_map_category_check CHECK ((category = ANY (ARRAY['comissao'::text, 'parcelamento'::text, 'frete'::text, 'full'::text, 'ads'::text, 'estorno'::text, 'financiamento'::text, 'comissao_excluida'::text, 'outros'::text])))
);


--
-- Name: card_invoice_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.card_invoice_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    data_compra date,
    descricao text NOT NULL,
    descricao_normalizada text,
    valor numeric NOT NULL,
    tipo_compra text,
    parcela_atual integer,
    parcela_total integer,
    codigo_autorizacao text,
    final_cartao text,
    match_status text DEFAULT 'pendente'::text NOT NULL,
    expense_id uuid,
    expense_category_id uuid,
    valor_previsto numeric,
    observacao text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT card_invoice_items_match_status_check CHECK ((match_status = ANY (ARRAY['pendente'::text, 'casado_previsto'::text, 'casado_valor_diferente'::text, 'sem_destino'::text, 'ignorado'::text, 'confirmado'::text]))),
    CONSTRAINT card_invoice_items_tipo_compra_check CHECK ((tipo_compra = ANY (ARRAY['a_vista'::text, 'parcelada'::text, 'internacional'::text])))
);


--
-- Name: card_invoice_posted_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.card_invoice_posted_rules (
    invoice_id uuid NOT NULL,
    rule_id uuid NOT NULL
);


--
-- Name: card_invoice_postings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.card_invoice_postings (
    invoice_id uuid NOT NULL,
    expense_id uuid NOT NULL,
    month date NOT NULL,
    amount numeric NOT NULL,
    row_existed boolean,
    before_amount numeric,
    before_previsto numeric,
    before_tem_conta boolean,
    after_amount numeric,
    after_previsto numeric,
    after_tem_conta boolean,
    after_updated_at timestamp with time zone,
    CONSTRAINT card_invoice_postings_amount_check CHECK ((amount >= (0)::numeric))
);


--
-- Name: card_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.card_invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    banco text DEFAULT 'BTG'::text NOT NULL,
    referencia text,
    vencimento date,
    total_fatura numeric,
    periodo_inicio date,
    periodo_fim date,
    status text DEFAULT 'processando'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT card_invoices_status_check CHECK ((status = ANY (ARRAY['processando'::text, 'revisao'::text, 'concluida'::text])))
);


--
-- Name: card_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.card_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    padrao text NOT NULL,
    expense_id uuid,
    expense_category_id uuid,
    match_tipo text DEFAULT 'contem'::text NOT NULL,
    valor_min numeric,
    valor_max numeric,
    ativo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT card_rules_match_tipo_check CHECK ((match_tipo = ANY (ARRAY['contem'::text, 'exato'::text, 'comeca'::text])))
);


--
-- Name: empresas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.empresas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    nome text NOT NULL,
    cnpj text,
    razao_social text,
    regime_tributario text DEFAULT 'simples'::text NOT NULL,
    ativo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: expense_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expense_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    ecommerce_mode text DEFAULT 'percent'::text NOT NULL,
    ecommerce_percent numeric DEFAULT 100 NOT NULL,
    ecommerce_amount numeric DEFAULT 0 NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    allow_subcategories boolean DEFAULT false NOT NULL,
    parent_category_id uuid,
    cnpj text,
    CONSTRAINT expense_categories_ecommerce_mode_check CHECK ((ecommerce_mode = ANY (ARRAY['percent'::text, 'fixed'::text]))),
    CONSTRAINT expense_categories_kind_check CHECK ((kind = ANY (ARRAY['fixo'::text, 'variavel'::text])))
);


--
-- Name: expense_name_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expense_name_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    match_text text NOT NULL,
    expense_id uuid,
    category_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT expense_name_rules_one_target CHECK (((((expense_id IS NOT NULL))::integer + ((category_id IS NOT NULL))::integer) = 1))
);


--
-- Name: expense_values; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expense_values (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    expense_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    month date NOT NULL,
    amount numeric DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tem_conta boolean DEFAULT false NOT NULL,
    previsto numeric,
    ecommerce_valor_conta numeric
);


--
-- Name: COLUMN expense_values.tem_conta; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expense_values.tem_conta IS 'true = o valor do mês vem das contas pagas no Contas a Pagar (célula travada).';


--
-- Name: COLUMN expense_values.previsto; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expense_values.previsto IS 'Valor digitado na planilha quando o mês tem conta paga (para comparar previsto x pago).';


--
-- Name: COLUMN expense_values.ecommerce_valor_conta; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expense_values.ecommerce_valor_conta IS 'Soma do rateio de e-commerce das parcelas pagas para este gasto e mês; NULL sem conta.';


--
-- Name: expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    name text NOT NULL,
    notes text,
    ecommerce_override boolean DEFAULT false NOT NULL,
    ecommerce_mode text DEFAULT 'percent'::text NOT NULL,
    ecommerce_percent numeric DEFAULT 100 NOT NULL,
    ecommerce_amount numeric DEFAULT 0 NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT expenses_ecommerce_mode_check CHECK ((ecommerce_mode = ANY (ARRAY['percent'::text, 'fixed'::text])))
);


--
-- Name: faturamento_externo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.faturamento_externo (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    empresa_id uuid NOT NULL,
    canal text NOT NULL,
    month date NOT NULL,
    valor numeric DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: kit_components; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kit_components (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    kit_sku text NOT NULL,
    component_sku text NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: marketplace_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketplace_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    platform text DEFAULT 'mercado_livre'::text NOT NULL,
    nickname text NOT NULL,
    external_user_id bigint,
    external_nickname text,
    site_id text DEFAULT 'MLB'::text NOT NULL,
    client_id text,
    client_secret text,
    advertiser_id bigint,
    access_token text,
    refresh_token text,
    token_expires_at timestamp with time zone,
    status text DEFAULT 'nao_conectada'::text NOT NULL,
    last_sync_at timestamp with time zone,
    last_sync_status text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    trade_name text,
    cnpj text,
    legal_name text,
    tax_regime text DEFAULT 'simples_nacional'::text,
    client_secret_id uuid,
    access_token_id uuid,
    refresh_token_id uuid,
    empresa_id uuid,
    ads_start_date date,
    CONSTRAINT marketplace_accounts_platform_check CHECK ((platform = ANY (ARRAY['mercado_livre'::text, 'shopee'::text]))),
    CONSTRAINT marketplace_accounts_status_check CHECK ((status = ANY (ARRAY['nao_conectada'::text, 'conectada'::text, 'erro'::text, 'token_expirado'::text]))),
    CONSTRAINT marketplace_accounts_tax_regime_check CHECK (((tax_regime IS NULL) OR (tax_regime = ANY (ARRAY['simples_nacional'::text, 'lucro_presumido'::text, 'lucro_real'::text, 'mei'::text]))))
);


--
-- Name: ml_ads_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ml_ads_daily (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    date date NOT NULL,
    campaign_id bigint,
    campaign_name text,
    item_id text,
    clicks integer DEFAULT 0 NOT NULL,
    prints integer DEFAULT 0 NOT NULL,
    cost numeric DEFAULT 0 NOT NULL,
    cpc numeric,
    ctr numeric,
    acos numeric,
    direct_units integer DEFAULT 0 NOT NULL,
    indirect_units integer DEFAULT 0 NOT NULL,
    direct_amount numeric DEFAULT 0 NOT NULL,
    indirect_amount numeric DEFAULT 0 NOT NULL,
    organic_units integer DEFAULT 0 NOT NULL,
    raw jsonb,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    ad_group_id bigint,
    title text
);


--
-- Name: ml_billing_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ml_billing_details (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    period_key text NOT NULL,
    billing_group text DEFAULT 'ML'::text NOT NULL,
    document_type text NOT NULL,
    detail_id text NOT NULL,
    detail_type text NOT NULL,
    detail_sub_type text,
    concept text,
    amount numeric NOT NULL,
    order_id bigint,
    item_id text,
    shipping_id bigint,
    transaction_date timestamp with time zone,
    raw jsonb,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    concept_type text,
    legal_document_number text,
    marketplace text,
    CONSTRAINT ml_billing_details_billing_group_check CHECK ((billing_group = ANY (ARRAY['ML'::text, 'MP'::text]))),
    CONSTRAINT ml_billing_details_document_type_check CHECK ((document_type = ANY (ARRAY['BILL'::text, 'CREDIT_NOTE'::text])))
);


--
-- Name: ml_billing_norm; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.ml_billing_norm WITH (security_invoker='true') AS
 SELECT b.id,
    b.account_id,
    b.order_id,
    b.item_id,
    b.transaction_date,
    b.detail_sub_type,
    b.detail_type,
    COALESCE(m.category, 'outros'::text) AS category,
    COALESCE(m.escopo,
        CASE
            WHEN (b.order_id IS NULL) THEN 'periodo'::text
            ELSE 'pedido'::text
        END) AS escopo,
    COALESCE(m.em_sale_fee, false) AS em_sale_fee,
    COALESCE(m.conta_no_custo, true) AS conta_no_custo,
        CASE
            WHEN (b.detail_type = 'BONUS'::text) THEN (- b.amount)
            ELSE b.amount
        END AS valor
   FROM (public.ml_billing_details b
     LEFT JOIN public.billing_subtype_map m ON ((m.sub_type = b.detail_sub_type)))
  WHERE (NOT (EXISTS ( SELECT 1
           FROM public.ml_billing_details n
          WHERE ((n.account_id = b.account_id) AND (n.billing_group = b.billing_group) AND (n.detail_id = b.detail_id) AND (n.period_key > b.period_key)))));


--
-- Name: ml_billing_periods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ml_billing_periods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    period_key text NOT NULL,
    date_from date,
    date_to date,
    amount numeric DEFAULT 0 NOT NULL,
    unpaid_amount numeric DEFAULT 0 NOT NULL,
    period_status text,
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ml_order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ml_order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_ref uuid NOT NULL,
    account_id uuid NOT NULL,
    item_id text NOT NULL,
    seller_sku text,
    title text NOT NULL,
    quantity integer NOT NULL,
    unit_price numeric NOT NULL,
    full_unit_price numeric,
    sale_fee numeric,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ml_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ml_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    order_id bigint NOT NULL,
    date_created timestamp with time zone NOT NULL,
    date_closed timestamp with time zone,
    status text NOT NULL,
    total_amount numeric NOT NULL,
    paid_amount numeric,
    currency_id text DEFAULT 'BRL'::text NOT NULL,
    buyer_nickname text,
    shipping_id bigint,
    logistic_type text,
    raw jsonb,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    refunded_amount numeric DEFAULT 0 NOT NULL
);


--
-- Name: ml_comissao_item; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.ml_comissao_item WITH (security_invoker='true') AS
 WITH itens AS (
         SELECT oi.order_ref,
            oi.account_id,
            oi.item_id,
            sum((oi.sale_fee * (oi.quantity)::numeric)) AS sale_fee_total,
            sum(oi.quantity) AS unidades
           FROM public.ml_order_items oi
          GROUP BY oi.order_ref, oi.account_id, oi.item_id
        ), bil AS (
         SELECT n.order_id,
            n.item_id,
            sum(n.valor) AS v
           FROM public.ml_billing_norm n
          WHERE (n.category = 'comissao'::text)
          GROUP BY n.order_id, n.item_id
        ), faturados AS (
         SELECT DISTINCT bil.order_id
           FROM bil
        )
 SELECT i.order_ref,
    o.order_id,
    i.account_id,
    i.item_id,
    i.unidades,
    i.sale_fee_total,
        CASE
            WHEN (f.order_id IS NOT NULL) THEN COALESCE(b.v, (0)::numeric)
            ELSE i.sale_fee_total
        END AS comissao,
    (f.order_id IS NOT NULL) AS fonte_faturamento
   FROM (((itens i
     JOIN public.ml_orders o ON ((o.id = i.order_ref)))
     LEFT JOIN faturados f ON ((f.order_id = o.order_id)))
     LEFT JOIN bil b ON (((b.order_id = o.order_id) AND (b.item_id = i.item_id))));


--
-- Name: ml_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ml_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    item_id text NOT NULL,
    title text NOT NULL,
    seller_sku text,
    status text,
    category_id text,
    price numeric,
    permalink text,
    thumbnail text,
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ml_visits_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ml_visits_daily (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    date date NOT NULL,
    visits integer DEFAULT 0 NOT NULL,
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mp_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mp_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    payment_id bigint NOT NULL,
    order_id bigint,
    date_created timestamp with time zone,
    date_approved timestamp with time zone,
    money_release_date timestamp with time zone,
    money_release_status text,
    status text,
    status_detail text,
    operation_type text,
    payment_method_id text,
    payment_type_id text,
    installments integer,
    transaction_amount numeric DEFAULT 0 NOT NULL,
    total_paid_amount numeric DEFAULT 0 NOT NULL,
    net_received_amount numeric DEFAULT 0 NOT NULL,
    fee_total numeric DEFAULT 0 NOT NULL,
    raw jsonb,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    mp_fee numeric DEFAULT 0 NOT NULL,
    ml_fee numeric DEFAULT 0 NOT NULL,
    shipping_fee numeric DEFAULT 0 NOT NULL,
    installment_fee numeric DEFAULT 0 NOT NULL,
    coupon_fee numeric DEFAULT 0 NOT NULL,
    split_fee numeric DEFAULT 0 NOT NULL
);


--
-- Name: mp_payments_compras_reserva_20261013; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mp_payments_compras_reserva_20261013 (
    id uuid,
    account_id uuid,
    payment_id bigint,
    order_id bigint,
    date_created timestamp with time zone,
    date_approved timestamp with time zone,
    money_release_date timestamp with time zone,
    money_release_status text,
    status text,
    status_detail text,
    operation_type text,
    payment_method_id text,
    payment_type_id text,
    installments integer,
    transaction_amount numeric,
    total_paid_amount numeric,
    net_received_amount numeric,
    fee_total numeric,
    raw jsonb,
    synced_at timestamp with time zone,
    mp_fee numeric,
    ml_fee numeric,
    shipping_fee numeric,
    installment_fee numeric,
    coupon_fee numeric,
    split_fee numeric
);


--
-- Name: oauth_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oauth_states (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    state text NOT NULL,
    account_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone
);


--
-- Name: operating_cost_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operating_cost_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cost_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    month date NOT NULL,
    amount numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT operating_cost_entries_month_check CHECK ((EXTRACT(day FROM month) = (1)::numeric))
);


--
-- Name: operating_cost_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operating_cost_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cost_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    month date NOT NULL,
    label text NOT NULL,
    amount numeric DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: operating_costs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operating_costs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    name text NOT NULL,
    category text NOT NULL,
    cost_type text NOT NULL,
    recurrence text NOT NULL,
    amount numeric,
    start_month date NOT NULL,
    end_month date,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ecommerce_mode text DEFAULT 'percent'::text NOT NULL,
    ecommerce_percent numeric DEFAULT 100 NOT NULL,
    ecommerce_amount numeric DEFAULT 0 NOT NULL,
    imported_at timestamp with time zone,
    CONSTRAINT operating_costs_cost_type_check CHECK ((cost_type = ANY (ARRAY['fixo'::text, 'variavel'::text]))),
    CONSTRAINT operating_costs_ecommerce_amount_chk CHECK ((ecommerce_amount >= (0)::numeric)),
    CONSTRAINT operating_costs_ecommerce_mode_chk CHECK ((ecommerce_mode = ANY (ARRAY['percent'::text, 'fixed'::text]))),
    CONSTRAINT operating_costs_ecommerce_percent_chk CHECK (((ecommerce_percent >= (0)::numeric) AND (ecommerce_percent <= (100)::numeric))),
    CONSTRAINT operating_costs_end_month_check CHECK (((end_month IS NULL) OR (EXTRACT(day FROM end_month) = (1)::numeric))),
    CONSTRAINT operating_costs_recurrence_check CHECK ((recurrence = ANY (ARRAY['mensal_recorrente'::text, 'mensal_variavel'::text, 'avulso'::text]))),
    CONSTRAINT operating_costs_start_month_check CHECK ((EXTRACT(day FROM start_month) = (1)::numeric))
);


--
-- Name: payable_installments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payable_installments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    note_id uuid NOT NULL,
    numero text,
    vencimento date,
    valor numeric DEFAULT 0 NOT NULL,
    status text DEFAULT 'aberta'::text NOT NULL,
    pago_em date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    planilha_expense_id uuid,
    planilha_month date,
    planilha_lancado boolean DEFAULT false NOT NULL,
    planilha_valor numeric,
    planilha_ecommerce_valor numeric
);


--
-- Name: COLUMN payable_installments.planilha_ecommerce_valor; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payable_installments.planilha_ecommerce_valor IS 'Valor de e-commerce fixado no momento do pagamento, para esta parcela.';


--
-- Name: payable_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payable_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    note_id uuid NOT NULL,
    fornecedor_sku text,
    descricao text,
    quantidade numeric,
    valor_unitario numeric,
    valor_total numeric,
    meu_sku text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    frete_rateado numeric DEFAULT 0 NOT NULL,
    unidades_por_embalagem numeric DEFAULT 1 NOT NULL
);


--
-- Name: payable_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payable_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    chave_nfe text,
    numero_nota text,
    fornecedor_nome text NOT NULL,
    fornecedor_cnpj text,
    data_emissao date,
    valor_total numeric DEFAULT 0 NOT NULL,
    valor_produtos numeric,
    valor_frete numeric,
    valor_outros numeric,
    destino text DEFAULT 'nao_definido'::text NOT NULL,
    subcategoria_id uuid,
    status text DEFAULT 'aberta'::text NOT NULL,
    observacao text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ecommerce_mode text DEFAULT 'percent'::text NOT NULL,
    ecommerce_percent numeric DEFAULT 0 NOT NULL,
    ecommerce_amount numeric DEFAULT 0 NOT NULL,
    categoria_id uuid,
    gasto_id uuid,
    tipo_conta text DEFAULT 'fornecedor'::text NOT NULL,
    recorrencia_id uuid,
    competencia_mes date
);


--
-- Name: payable_recurrences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payable_recurrences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    nome text NOT NULL,
    categoria_id uuid,
    subcategoria_id uuid,
    gasto_id uuid,
    tipo_conta text DEFAULT 'geral'::text NOT NULL,
    destino text DEFAULT 'nao_definido'::text NOT NULL,
    ecommerce_mode text DEFAULT 'percent'::text NOT NULL,
    ecommerce_percent numeric DEFAULT 0 NOT NULL,
    ecommerce_amount numeric DEFAULT 0 NOT NULL,
    valor numeric DEFAULT 0 NOT NULL,
    dia_vencimento integer DEFAULT 10 NOT NULL,
    ativo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: product_cost_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_cost_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    sku text NOT NULL,
    valor_unitario numeric NOT NULL,
    origem text DEFAULT 'nota'::text NOT NULL,
    data_nota date,
    numero_nota text,
    note_id uuid,
    item_id uuid,
    registrado_em timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: product_skus; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_skus (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    sku text NOT NULL,
    titulo text,
    custo_base numeric,
    categoria text,
    preco_varejo numeric,
    codigo_barras text,
    ativo boolean DEFAULT true NOT NULL,
    is_kit boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    custo_travado boolean DEFAULT false NOT NULL
);


--
-- Name: rental_group_labels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rental_group_labels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    cnpj_raiz text NOT NULL,
    label text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rental_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rental_invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    talao text,
    cnpj text,
    cnpj_raiz text,
    nome_fantasia text,
    razao_social text,
    municipio text,
    uf text,
    valor numeric NOT NULL,
    vencimento date,
    month date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    fatura_num text
);


--
-- Name: sku_item_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sku_item_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    seller_sku text NOT NULL,
    account_id uuid NOT NULL,
    item_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sku_translation_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sku_translation_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    fornecedor_sku text NOT NULL,
    meu_sku text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sync_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    job_type text NOT NULL,
    status text DEFAULT 'pendente'::text NOT NULL,
    target_date date,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    target_key text,
    progress_offset integer DEFAULT 0 NOT NULL,
    transient_retries integer DEFAULT 0 NOT NULL,
    progress_cursor text,
    verify_passes integer DEFAULT 0 NOT NULL,
    priority smallint DEFAULT 100 NOT NULL
);


--
-- Name: sync_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid,
    sync_type text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    status text DEFAULT 'executando'::text NOT NULL,
    records_processed integer DEFAULT 0 NOT NULL,
    error_message text,
    details jsonb,
    CONSTRAINT sync_logs_status_check CHECK ((status = ANY (ARRAY['executando'::text, 'sucesso'::text, 'erro'::text, 'parcial'::text]))),
    CONSTRAINT sync_logs_sync_type_check CHECK ((sync_type = ANY (ARRAY['orders'::text, 'items'::text, 'billing'::text, 'flex'::text, 'ads'::text, 'full'::text, 'audit'::text, 'token_refresh'::text, 'periods'::text, 'enqueue'::text, 'backfill'::text, 'worker'::text, 'liberacoes'::text])))
);


--
-- Name: telegram_ad_alert_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telegram_ad_alert_state (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    account_id uuid NOT NULL,
    item_id text NOT NULL,
    is_negative boolean DEFAULT false NOT NULL,
    last_alert_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: telegram_alert_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telegram_alert_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    account_id uuid,
    alert_type text NOT NULL,
    ref_key text NOT NULL,
    status text DEFAULT 'pendente'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: telegram_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telegram_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    allowed_chat_id text,
    is_active boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    inbound_enabled boolean DEFAULT false NOT NULL,
    alert_chat_id text,
    alert_margem_baixa boolean DEFAULT false NOT NULL,
    alert_prejuizo boolean DEFAULT false NOT NULL,
    alert_anuncio_negativo boolean DEFAULT false NOT NULL,
    alert_sem_custo_resumo boolean DEFAULT false NOT NULL,
    margem_minima_pct numeric DEFAULT 10 NOT NULL,
    max_alertas_hora integer DEFAULT 20 NOT NULL,
    alerts_started_at timestamp with time zone
);


--
-- Name: user_screen_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_screen_access (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    root_owner_id uuid NOT NULL,
    member_id uuid NOT NULL,
    screen_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: account_members account_members_member_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_members
    ADD CONSTRAINT account_members_member_id_key UNIQUE (member_id);


--
-- Name: account_members account_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_members
    ADD CONSTRAINT account_members_pkey PRIMARY KEY (id);


--
-- Name: account_tax_rates account_tax_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_tax_rates
    ADD CONSTRAINT account_tax_rates_pkey PRIMARY KEY (id);


--
-- Name: app_settings app_settings_owner_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_owner_id_key UNIQUE (owner_id);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (id);


--
-- Name: audit_findings audit_findings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_findings
    ADD CONSTRAINT audit_findings_pkey PRIMARY KEY (id);


--
-- Name: billing_subtype_map billing_subtype_map_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_subtype_map
    ADD CONSTRAINT billing_subtype_map_pkey PRIMARY KEY (sub_type);


--
-- Name: card_invoice_items card_invoice_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_invoice_items
    ADD CONSTRAINT card_invoice_items_pkey PRIMARY KEY (id);


--
-- Name: card_invoice_posted_rules card_invoice_posted_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_invoice_posted_rules
    ADD CONSTRAINT card_invoice_posted_rules_pkey PRIMARY KEY (invoice_id, rule_id);


--
-- Name: card_invoice_postings card_invoice_postings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_invoice_postings
    ADD CONSTRAINT card_invoice_postings_pkey PRIMARY KEY (invoice_id, expense_id, month);


--
-- Name: card_invoices card_invoices_owner_id_banco_referencia_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_invoices
    ADD CONSTRAINT card_invoices_owner_id_banco_referencia_key UNIQUE (owner_id, banco, referencia);


--
-- Name: card_invoices card_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_invoices
    ADD CONSTRAINT card_invoices_pkey PRIMARY KEY (id);


--
-- Name: card_rules card_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_rules
    ADD CONSTRAINT card_rules_pkey PRIMARY KEY (id);


--
-- Name: empresas empresas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empresas
    ADD CONSTRAINT empresas_pkey PRIMARY KEY (id);


--
-- Name: expense_categories expense_categories_owner_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_categories
    ADD CONSTRAINT expense_categories_owner_id_name_key UNIQUE (owner_id, name);


--
-- Name: expense_categories expense_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_categories
    ADD CONSTRAINT expense_categories_pkey PRIMARY KEY (id);


--
-- Name: expense_name_rules expense_name_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_name_rules
    ADD CONSTRAINT expense_name_rules_pkey PRIMARY KEY (id);


--
-- Name: expense_values expense_values_expense_id_month_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_values
    ADD CONSTRAINT expense_values_expense_id_month_key UNIQUE (expense_id, month);


--
-- Name: expense_values expense_values_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_values
    ADD CONSTRAINT expense_values_pkey PRIMARY KEY (id);


--
-- Name: expenses expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);


--
-- Name: faturamento_externo faturamento_externo_empresa_id_canal_month_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faturamento_externo
    ADD CONSTRAINT faturamento_externo_empresa_id_canal_month_key UNIQUE (empresa_id, canal, month);


--
-- Name: faturamento_externo faturamento_externo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faturamento_externo
    ADD CONSTRAINT faturamento_externo_pkey PRIMARY KEY (id);


--
-- Name: kit_components kit_components_owner_id_kit_sku_component_sku_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kit_components
    ADD CONSTRAINT kit_components_owner_id_kit_sku_component_sku_key UNIQUE (owner_id, kit_sku, component_sku);


--
-- Name: kit_components kit_components_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kit_components
    ADD CONSTRAINT kit_components_pkey PRIMARY KEY (id);


--
-- Name: marketplace_accounts marketplace_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_accounts
    ADD CONSTRAINT marketplace_accounts_pkey PRIMARY KEY (id);


--
-- Name: ml_ads_daily ml_ads_daily_account_id_date_campaign_id_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_ads_daily
    ADD CONSTRAINT ml_ads_daily_account_id_date_campaign_id_item_id_key UNIQUE (account_id, date, campaign_id, item_id);


--
-- Name: ml_ads_daily ml_ads_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_ads_daily
    ADD CONSTRAINT ml_ads_daily_pkey PRIMARY KEY (id);


--
-- Name: ml_billing_details ml_billing_details_account_id_period_key_billing_group_deta_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_billing_details
    ADD CONSTRAINT ml_billing_details_account_id_period_key_billing_group_deta_key UNIQUE (account_id, period_key, billing_group, detail_id);


--
-- Name: ml_billing_details ml_billing_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_billing_details
    ADD CONSTRAINT ml_billing_details_pkey PRIMARY KEY (id);


--
-- Name: ml_billing_periods ml_billing_periods_account_id_period_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_billing_periods
    ADD CONSTRAINT ml_billing_periods_account_id_period_key_key UNIQUE (account_id, period_key);


--
-- Name: ml_billing_periods ml_billing_periods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_billing_periods
    ADD CONSTRAINT ml_billing_periods_pkey PRIMARY KEY (id);


--
-- Name: ml_items ml_items_account_id_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_items
    ADD CONSTRAINT ml_items_account_id_item_id_key UNIQUE (account_id, item_id);


--
-- Name: ml_items ml_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_items
    ADD CONSTRAINT ml_items_pkey PRIMARY KEY (id);


--
-- Name: ml_order_items ml_order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_order_items
    ADD CONSTRAINT ml_order_items_pkey PRIMARY KEY (id);


--
-- Name: ml_orders ml_orders_account_id_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_orders
    ADD CONSTRAINT ml_orders_account_id_order_id_key UNIQUE (account_id, order_id);


--
-- Name: ml_orders ml_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_orders
    ADD CONSTRAINT ml_orders_pkey PRIMARY KEY (id);


--
-- Name: ml_visits_daily ml_visits_daily_account_id_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_visits_daily
    ADD CONSTRAINT ml_visits_daily_account_id_date_key UNIQUE (account_id, date);


--
-- Name: ml_visits_daily ml_visits_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_visits_daily
    ADD CONSTRAINT ml_visits_daily_pkey PRIMARY KEY (id);


--
-- Name: mp_payments mp_payments_account_id_payment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mp_payments
    ADD CONSTRAINT mp_payments_account_id_payment_id_key UNIQUE (account_id, payment_id);


--
-- Name: mp_payments mp_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mp_payments
    ADD CONSTRAINT mp_payments_pkey PRIMARY KEY (id);


--
-- Name: oauth_states oauth_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_states
    ADD CONSTRAINT oauth_states_pkey PRIMARY KEY (id);


--
-- Name: oauth_states oauth_states_state_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_states
    ADD CONSTRAINT oauth_states_state_key UNIQUE (state);


--
-- Name: operating_cost_entries operating_cost_entries_cost_id_month_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operating_cost_entries
    ADD CONSTRAINT operating_cost_entries_cost_id_month_key UNIQUE (cost_id, month);


--
-- Name: operating_cost_entries operating_cost_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operating_cost_entries
    ADD CONSTRAINT operating_cost_entries_pkey PRIMARY KEY (id);


--
-- Name: operating_cost_items operating_cost_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operating_cost_items
    ADD CONSTRAINT operating_cost_items_pkey PRIMARY KEY (id);


--
-- Name: operating_costs operating_costs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operating_costs
    ADD CONSTRAINT operating_costs_pkey PRIMARY KEY (id);


--
-- Name: payable_installments payable_installments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payable_installments
    ADD CONSTRAINT payable_installments_pkey PRIMARY KEY (id);


--
-- Name: payable_items payable_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payable_items
    ADD CONSTRAINT payable_items_pkey PRIMARY KEY (id);


--
-- Name: payable_notes payable_notes_owner_id_chave_nfe_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payable_notes
    ADD CONSTRAINT payable_notes_owner_id_chave_nfe_key UNIQUE (owner_id, chave_nfe);


--
-- Name: payable_notes payable_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payable_notes
    ADD CONSTRAINT payable_notes_pkey PRIMARY KEY (id);


--
-- Name: payable_recurrences payable_recurrences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payable_recurrences
    ADD CONSTRAINT payable_recurrences_pkey PRIMARY KEY (id);


--
-- Name: product_cost_history product_cost_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_cost_history
    ADD CONSTRAINT product_cost_history_pkey PRIMARY KEY (id);


--
-- Name: product_skus product_skus_owner_id_sku_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_skus
    ADD CONSTRAINT product_skus_owner_id_sku_key UNIQUE (owner_id, sku);


--
-- Name: product_skus product_skus_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_skus
    ADD CONSTRAINT product_skus_pkey PRIMARY KEY (id);


--
-- Name: rental_group_labels rental_group_labels_owner_id_cnpj_raiz_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rental_group_labels
    ADD CONSTRAINT rental_group_labels_owner_id_cnpj_raiz_key UNIQUE (owner_id, cnpj_raiz);


--
-- Name: rental_group_labels rental_group_labels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rental_group_labels
    ADD CONSTRAINT rental_group_labels_pkey PRIMARY KEY (id);


--
-- Name: rental_invoices rental_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rental_invoices
    ADD CONSTRAINT rental_invoices_pkey PRIMARY KEY (id);


--
-- Name: sku_item_links sku_item_links_account_id_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sku_item_links
    ADD CONSTRAINT sku_item_links_account_id_item_id_key UNIQUE (account_id, item_id);


--
-- Name: sku_item_links sku_item_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sku_item_links
    ADD CONSTRAINT sku_item_links_pkey PRIMARY KEY (id);


--
-- Name: sku_translation_rules sku_translation_rules_owner_id_fornecedor_sku_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sku_translation_rules
    ADD CONSTRAINT sku_translation_rules_owner_id_fornecedor_sku_key UNIQUE (owner_id, fornecedor_sku);


--
-- Name: sku_translation_rules sku_translation_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sku_translation_rules
    ADD CONSTRAINT sku_translation_rules_pkey PRIMARY KEY (id);


--
-- Name: sync_jobs sync_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_jobs
    ADD CONSTRAINT sync_jobs_pkey PRIMARY KEY (id);


--
-- Name: sync_logs sync_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_logs
    ADD CONSTRAINT sync_logs_pkey PRIMARY KEY (id);


--
-- Name: telegram_ad_alert_state telegram_ad_alert_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_ad_alert_state
    ADD CONSTRAINT telegram_ad_alert_state_pkey PRIMARY KEY (id);


--
-- Name: telegram_ad_alert_state telegram_ad_alert_state_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_ad_alert_state
    ADD CONSTRAINT telegram_ad_alert_state_unique UNIQUE (owner_id, account_id, item_id);


--
-- Name: telegram_alert_log telegram_alert_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_alert_log
    ADD CONSTRAINT telegram_alert_log_pkey PRIMARY KEY (id);


--
-- Name: telegram_alert_log telegram_alert_log_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_alert_log
    ADD CONSTRAINT telegram_alert_log_unique UNIQUE (owner_id, alert_type, ref_key);


--
-- Name: telegram_config telegram_config_owner_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_config
    ADD CONSTRAINT telegram_config_owner_id_key UNIQUE (owner_id);


--
-- Name: telegram_config telegram_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_config
    ADD CONSTRAINT telegram_config_pkey PRIMARY KEY (id);


--
-- Name: user_screen_access user_screen_access_member_id_screen_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_screen_access
    ADD CONSTRAINT user_screen_access_member_id_screen_key_key UNIQUE (member_id, screen_key);


--
-- Name: user_screen_access user_screen_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_screen_access
    ADD CONSTRAINT user_screen_access_pkey PRIMARY KEY (id);


--
-- Name: account_tax_rates_account_valid_from_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_tax_rates_account_valid_from_idx ON public.account_tax_rates USING btree (account_id, valid_from DESC);


--
-- Name: audit_findings_account_check; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_findings_account_check ON public.audit_findings USING btree (account_id, check_code);


--
-- Name: audit_findings_owner_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_findings_owner_status ON public.audit_findings USING btree (owner_id, status);


--
-- Name: audit_findings_status_sev; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_findings_status_sev ON public.audit_findings USING btree (status, severity);


--
-- Name: audit_findings_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX audit_findings_unique ON public.audit_findings USING btree (account_id, check_code, context);


--
-- Name: card_invoice_items_invoice_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX card_invoice_items_invoice_idx ON public.card_invoice_items USING btree (invoice_id);


--
-- Name: card_invoice_items_owner_desc_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX card_invoice_items_owner_desc_idx ON public.card_invoice_items USING btree (owner_id, descricao_normalizada);


--
-- Name: card_rules_owner_ativo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX card_rules_owner_ativo_idx ON public.card_rules USING btree (owner_id, ativo);


--
-- Name: expense_name_rules_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX expense_name_rules_owner_idx ON public.expense_name_rules USING btree (owner_id);


--
-- Name: idx_cost_hist_note; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cost_hist_note ON public.product_cost_history USING btree (note_id);


--
-- Name: idx_cost_hist_owner_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cost_hist_owner_sku ON public.product_cost_history USING btree (owner_id, sku);


--
-- Name: idx_expense_categories_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expense_categories_parent ON public.expense_categories USING btree (parent_category_id);


--
-- Name: idx_expense_values_owner_month; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expense_values_owner_month ON public.expense_values USING btree (owner_id, month);


--
-- Name: idx_expenses_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_category ON public.expenses USING btree (category_id);


--
-- Name: idx_kit_components_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kit_components_owner ON public.kit_components USING btree (owner_id);


--
-- Name: idx_kit_components_owner_kit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kit_components_owner_kit ON public.kit_components USING btree (owner_id, kit_sku);


--
-- Name: idx_ml_visits_daily_account_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ml_visits_daily_account_date ON public.ml_visits_daily USING btree (account_id, date);


--
-- Name: idx_payable_inst_note; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payable_inst_note ON public.payable_installments USING btree (note_id);


--
-- Name: idx_payable_inst_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payable_inst_owner ON public.payable_installments USING btree (owner_id);


--
-- Name: idx_payable_inst_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payable_inst_status ON public.payable_installments USING btree (owner_id, status);


--
-- Name: idx_payable_items_note; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payable_items_note ON public.payable_items USING btree (note_id);


--
-- Name: idx_payable_items_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payable_items_owner ON public.payable_items USING btree (owner_id);


--
-- Name: idx_payable_notes_cnpj; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payable_notes_cnpj ON public.payable_notes USING btree (owner_id, fornecedor_cnpj);


--
-- Name: idx_payable_notes_destino; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payable_notes_destino ON public.payable_notes USING btree (owner_id, destino);


--
-- Name: idx_payable_notes_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payable_notes_owner ON public.payable_notes USING btree (owner_id);


--
-- Name: idx_product_skus_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_skus_owner ON public.product_skus USING btree (owner_id);


--
-- Name: idx_product_skus_owner_kit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_skus_owner_kit ON public.product_skus USING btree (owner_id, is_kit);


--
-- Name: idx_recur_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recur_owner ON public.payable_recurrences USING btree (owner_id);


--
-- Name: idx_screen_access_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_screen_access_member ON public.user_screen_access USING btree (member_id);


--
-- Name: idx_screen_access_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_screen_access_owner ON public.user_screen_access USING btree (root_owner_id);


--
-- Name: idx_sku_rules_meu; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sku_rules_meu ON public.sku_translation_rules USING btree (owner_id, meu_sku);


--
-- Name: idx_sku_rules_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sku_rules_owner ON public.sku_translation_rules USING btree (owner_id);


--
-- Name: ml_ads_daily_account_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ml_ads_daily_account_date_idx ON public.ml_ads_daily USING btree (account_id, date);


--
-- Name: ml_ads_daily_account_id_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ml_ads_daily_account_id_date_idx ON public.ml_ads_daily USING btree (account_id, date);


--
-- Name: ml_ads_daily_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ml_ads_daily_uidx ON public.ml_ads_daily USING btree (account_id, date, COALESCE(campaign_id, (0)::bigint), COALESCE(item_id, ''::text));


--
-- Name: ml_billing_acc_datebr_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ml_billing_acc_datebr_idx ON public.ml_billing_details USING btree (account_id, (((transaction_date AT TIME ZONE 'America/Sao_Paulo'::text))::date));


--
-- Name: ml_billing_audit_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ml_billing_audit_idx ON public.ml_billing_details USING btree (detail_sub_type, transaction_date) INCLUDE (amount, item_id, account_id);


--
-- Name: ml_billing_details_account_id_period_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ml_billing_details_account_id_period_key_idx ON public.ml_billing_details USING btree (account_id, period_key);


--
-- Name: ml_billing_details_account_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ml_billing_details_account_period_idx ON public.ml_billing_details USING btree (account_id, period_key);


--
-- Name: ml_billing_details_lancamento_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ml_billing_details_lancamento_idx ON public.ml_billing_details USING btree (account_id, billing_group, detail_id, period_key);


--
-- Name: ml_billing_details_marketplace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ml_billing_details_marketplace_idx ON public.ml_billing_details USING btree (marketplace);


--
-- Name: ml_billing_details_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ml_billing_details_uidx ON public.ml_billing_details USING btree (account_id, period_key, billing_group, detail_id);


--
-- Name: ml_billing_periods_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ml_billing_periods_account_idx ON public.ml_billing_periods USING btree (account_id, period_key);


--
-- Name: ml_billing_subtype_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ml_billing_subtype_idx ON public.ml_billing_details USING btree (account_id, detail_sub_type);


--
-- Name: ml_items_account_item_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ml_items_account_item_uidx ON public.ml_items USING btree (account_id, item_id);


--
-- Name: ml_order_items_account_id_item_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ml_order_items_account_id_item_id_idx ON public.ml_order_items USING btree (account_id, item_id);


--
-- Name: ml_order_items_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ml_order_items_account_idx ON public.ml_order_items USING btree (account_id, order_ref);


--
-- Name: ml_order_items_order_ref_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ml_order_items_order_ref_idx ON public.ml_order_items USING btree (order_ref);


--
-- Name: ml_order_items_orderref_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ml_order_items_orderref_idx ON public.ml_order_items USING btree (order_ref);


--
-- Name: ml_orders_acc_datebr_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ml_orders_acc_datebr_idx ON public.ml_orders USING btree (account_id, (((date_created AT TIME ZONE 'America/Sao_Paulo'::text))::date));


--
-- Name: ml_orders_account_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ml_orders_account_date_idx ON public.ml_orders USING btree (account_id, date_created);


--
-- Name: ml_orders_account_id_date_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ml_orders_account_id_date_created_idx ON public.ml_orders USING btree (account_id, date_created DESC);


--
-- Name: ml_orders_account_order_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ml_orders_account_order_uidx ON public.ml_orders USING btree (account_id, order_id);


--
-- Name: mp_payments_account_approved_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mp_payments_account_approved_idx ON public.mp_payments USING btree (account_id, date_approved DESC);


--
-- Name: mp_payments_account_release_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mp_payments_account_release_idx ON public.mp_payments USING btree (account_id, money_release_date);


--
-- Name: mp_payments_audit_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mp_payments_audit_idx ON public.mp_payments USING btree (account_id, date_approved) WHERE (status = 'approved'::text);


--
-- Name: mp_payments_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mp_payments_order_idx ON public.mp_payments USING btree (account_id, order_id) WHERE (order_id IS NOT NULL);


--
-- Name: oauth_states_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX oauth_states_account_idx ON public.oauth_states USING btree (account_id);


--
-- Name: oauth_states_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX oauth_states_state_idx ON public.oauth_states USING btree (state);


--
-- Name: operating_cost_entries_cost_month_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX operating_cost_entries_cost_month_idx ON public.operating_cost_entries USING btree (cost_id, month);


--
-- Name: operating_cost_items_cost_month_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX operating_cost_items_cost_month_idx ON public.operating_cost_items USING btree (cost_id, month);


--
-- Name: operating_cost_items_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX operating_cost_items_owner_idx ON public.operating_cost_items USING btree (owner_id);


--
-- Name: operating_costs_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX operating_costs_owner_idx ON public.operating_costs USING btree (owner_id, is_active);


--
-- Name: rental_group_labels_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rental_group_labels_owner_idx ON public.rental_group_labels USING btree (owner_id);


--
-- Name: rental_invoices_cnpj_raiz_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rental_invoices_cnpj_raiz_idx ON public.rental_invoices USING btree (cnpj_raiz);


--
-- Name: rental_invoices_month_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rental_invoices_month_idx ON public.rental_invoices USING btree (month);


--
-- Name: rental_invoices_owner_fatura_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX rental_invoices_owner_fatura_key ON public.rental_invoices USING btree (owner_id, fatura_num);


--
-- Name: rental_invoices_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rental_invoices_owner_idx ON public.rental_invoices USING btree (owner_id);


--
-- Name: sync_jobs_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sync_jobs_owner_idx ON public.sync_jobs USING btree (owner_id);


--
-- Name: sync_jobs_pick_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sync_jobs_pick_idx ON public.sync_jobs USING btree (status, priority, target_date DESC);


--
-- Name: sync_jobs_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sync_jobs_status_created_idx ON public.sync_jobs USING btree (status, created_at);


--
-- Name: sync_jobs_unique_date; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sync_jobs_unique_date ON public.sync_jobs USING btree (account_id, job_type, target_date) WHERE (target_date IS NOT NULL);


--
-- Name: sync_jobs_unique_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sync_jobs_unique_key ON public.sync_jobs USING btree (account_id, job_type, target_key) WHERE (target_key IS NOT NULL);


--
-- Name: telegram_alert_log_sent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telegram_alert_log_sent_idx ON public.telegram_alert_log USING btree (owner_id, sent_at);


--
-- Name: telegram_alert_log_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telegram_alert_log_status_idx ON public.telegram_alert_log USING btree (owner_id, status, created_at);


--
-- Name: account_tax_rates account_tax_rates_close_previous; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER account_tax_rates_close_previous AFTER INSERT OR DELETE OR UPDATE OF valid_from ON public.account_tax_rates FOR EACH ROW EXECUTE FUNCTION public.close_previous_tax_rate();


--
-- Name: app_settings app_settings_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER app_settings_set_updated_at BEFORE UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: audit_findings audit_findings_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_findings_updated BEFORE UPDATE ON public.audit_findings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: operating_cost_entries operating_cost_entries_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER operating_cost_entries_set_updated_at BEFORE UPDATE ON public.operating_cost_entries FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: operating_costs operating_costs_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER operating_costs_set_updated_at BEFORE UPDATE ON public.operating_costs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: telegram_ad_alert_state telegram_ad_alert_state_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER telegram_ad_alert_state_updated_at BEFORE UPDATE ON public.telegram_ad_alert_state FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: telegram_alert_log telegram_alert_log_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER telegram_alert_log_updated_at BEFORE UPDATE ON public.telegram_alert_log FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: billing_subtype_map trg_billing_subtype_map_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_billing_subtype_map_updated BEFORE UPDATE ON public.billing_subtype_map FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: card_invoices trg_card_invoice_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_card_invoice_guard BEFORE DELETE OR UPDATE ON public.card_invoices FOR EACH ROW EXECUTE FUNCTION public.card_invoice_guard();


--
-- Name: card_invoice_items trg_card_invoice_items_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_card_invoice_items_guard BEFORE DELETE OR UPDATE ON public.card_invoice_items FOR EACH ROW EXECUTE FUNCTION public.card_invoice_items_guard();


--
-- Name: expense_categories trg_expense_categories_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_expense_categories_updated BEFORE UPDATE ON public.expense_categories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: expense_values trg_expense_values_guarda_conta; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_expense_values_guarda_conta BEFORE DELETE OR UPDATE ON public.expense_values FOR EACH ROW EXECUTE FUNCTION public.expense_values_guarda_conta();


--
-- Name: expense_values trg_expense_values_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_expense_values_updated BEFORE UPDATE ON public.expense_values FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: expenses trg_expenses_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_expenses_updated BEFORE UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: product_cost_history trg_force_owner_cost_hist; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_force_owner_cost_hist BEFORE INSERT ON public.product_cost_history FOR EACH ROW EXECUTE FUNCTION public.force_owner_to_team();


--
-- Name: empresas trg_force_owner_empresas; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_force_owner_empresas BEFORE INSERT ON public.empresas FOR EACH ROW EXECUTE FUNCTION public.force_owner_to_team();


--
-- Name: faturamento_externo trg_force_owner_faturamento_externo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_force_owner_faturamento_externo BEFORE INSERT ON public.faturamento_externo FOR EACH ROW EXECUTE FUNCTION public.force_owner_to_team();


--
-- Name: payable_installments trg_force_owner_payable_inst; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_force_owner_payable_inst BEFORE INSERT ON public.payable_installments FOR EACH ROW EXECUTE FUNCTION public.force_owner_to_team();


--
-- Name: payable_items trg_force_owner_payable_items; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_force_owner_payable_items BEFORE INSERT ON public.payable_items FOR EACH ROW EXECUTE FUNCTION public.force_owner_to_team();


--
-- Name: payable_notes trg_force_owner_payable_notes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_force_owner_payable_notes BEFORE INSERT ON public.payable_notes FOR EACH ROW EXECUTE FUNCTION public.force_owner_to_team();


--
-- Name: payable_recurrences trg_force_owner_recur; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_force_owner_recur BEFORE INSERT ON public.payable_recurrences FOR EACH ROW EXECUTE FUNCTION public.force_owner_to_team();


--
-- Name: rental_group_labels trg_force_owner_rental_group_labels; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_force_owner_rental_group_labels BEFORE INSERT ON public.rental_group_labels FOR EACH ROW EXECUTE FUNCTION public.force_owner_to_team();


--
-- Name: rental_invoices trg_force_owner_rental_invoices; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_force_owner_rental_invoices BEFORE INSERT ON public.rental_invoices FOR EACH ROW EXECUTE FUNCTION public.force_owner_to_team();


--
-- Name: sku_translation_rules trg_force_owner_sku_rules; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_force_owner_sku_rules BEFORE INSERT ON public.sku_translation_rules FOR EACH ROW EXECUTE FUNCTION public.force_owner_to_team();


--
-- Name: app_settings trg_force_owner_team; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_force_owner_team BEFORE INSERT ON public.app_settings FOR EACH ROW EXECUTE FUNCTION public.force_owner_to_team();


--
-- Name: audit_findings trg_force_owner_team; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_force_owner_team BEFORE INSERT ON public.audit_findings FOR EACH ROW EXECUTE FUNCTION public.force_owner_to_team();


--
-- Name: expense_categories trg_force_owner_team; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_force_owner_team BEFORE INSERT ON public.expense_categories FOR EACH ROW EXECUTE FUNCTION public.force_owner_to_team();


--
-- Name: expense_name_rules trg_force_owner_team; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_force_owner_team BEFORE INSERT ON public.expense_name_rules FOR EACH ROW EXECUTE FUNCTION public.force_owner_to_team();


--
-- Name: expense_values trg_force_owner_team; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_force_owner_team BEFORE INSERT ON public.expense_values FOR EACH ROW EXECUTE FUNCTION public.force_owner_to_team();


--
-- Name: expenses trg_force_owner_team; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_force_owner_team BEFORE INSERT ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.force_owner_to_team();


--
-- Name: marketplace_accounts trg_force_owner_team; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_force_owner_team BEFORE INSERT ON public.marketplace_accounts FOR EACH ROW EXECUTE FUNCTION public.force_owner_to_team();


--
-- Name: oauth_states trg_force_owner_team; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_force_owner_team BEFORE INSERT ON public.oauth_states FOR EACH ROW EXECUTE FUNCTION public.force_owner_to_team();


--
-- Name: operating_cost_entries trg_force_owner_team; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_force_owner_team BEFORE INSERT ON public.operating_cost_entries FOR EACH ROW EXECUTE FUNCTION public.force_owner_to_team();


--
-- Name: operating_cost_items trg_force_owner_team; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_force_owner_team BEFORE INSERT ON public.operating_cost_items FOR EACH ROW EXECUTE FUNCTION public.force_owner_to_team();


--
-- Name: operating_costs trg_force_owner_team; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_force_owner_team BEFORE INSERT ON public.operating_costs FOR EACH ROW EXECUTE FUNCTION public.force_owner_to_team();


--
-- Name: sku_item_links trg_force_owner_team; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_force_owner_team BEFORE INSERT ON public.sku_item_links FOR EACH ROW EXECUTE FUNCTION public.force_owner_to_team();


--
-- Name: telegram_config trg_force_owner_team; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_force_owner_team BEFORE INSERT ON public.telegram_config FOR EACH ROW EXECUTE FUNCTION public.force_owner_to_team();


--
-- Name: kit_components trg_force_owner_team_kit_components; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_force_owner_team_kit_components BEFORE INSERT ON public.kit_components FOR EACH ROW EXECUTE FUNCTION public.force_owner_to_team();


--
-- Name: product_skus trg_force_owner_team_product_skus; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_force_owner_team_product_skus BEFORE INSERT ON public.product_skus FOR EACH ROW EXECUTE FUNCTION public.force_owner_to_team();


--
-- Name: marketplace_accounts trg_ma_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ma_updated_at BEFORE UPDATE ON public.marketplace_accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: marketplace_accounts trg_marketplace_accounts_vault_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_marketplace_accounts_vault_guard BEFORE INSERT OR UPDATE ON public.marketplace_accounts FOR EACH ROW EXECUTE FUNCTION public.marketplace_accounts_vault_guard();


--
-- Name: payable_installments trg_payable_inst_planilha; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_payable_inst_planilha AFTER INSERT OR DELETE OR UPDATE OF planilha_lancado, planilha_expense_id, planilha_month, planilha_valor, planilha_ecommerce_valor ON public.payable_installments FOR EACH ROW EXECUTE FUNCTION public.payable_installments_sync_planilha();


--
-- Name: payable_notes trg_payable_note_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_payable_note_delete BEFORE DELETE ON public.payable_notes FOR EACH ROW EXECUTE FUNCTION public.on_payable_note_delete();


--
-- Name: product_skus trg_product_skus_com_venda; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_product_skus_com_venda BEFORE DELETE ON public.product_skus FOR EACH ROW EXECUTE FUNCTION public.product_skus_com_venda();


--
-- Name: product_skus trg_set_updated_at_product_skus; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_updated_at_product_skus BEFORE UPDATE ON public.product_skus FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: sku_translation_rules trg_set_updated_at_sku_rules; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_updated_at_sku_rules BEFORE UPDATE ON public.sku_translation_rules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: telegram_config trg_telegram_config_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_telegram_config_updated BEFORE UPDATE ON public.telegram_config FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: empresas trg_updated_at_empresas; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_empresas BEFORE UPDATE ON public.empresas FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: faturamento_externo trg_updated_at_faturamento_externo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_faturamento_externo BEFORE UPDATE ON public.faturamento_externo FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: rental_group_labels trg_updated_at_rental_group_labels; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_rental_group_labels BEFORE UPDATE ON public.rental_group_labels FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: rental_invoices trg_updated_at_rental_invoices; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_rental_invoices BEFORE UPDATE ON public.rental_invoices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: payable_installments trg_updated_payable_inst; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_payable_inst BEFORE UPDATE ON public.payable_installments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: payable_notes trg_updated_payable_notes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_payable_notes BEFORE UPDATE ON public.payable_notes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: payable_recurrences trg_updated_recur; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_recur BEFORE UPDATE ON public.payable_recurrences FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: account_tax_rates account_tax_rates_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_tax_rates
    ADD CONSTRAINT account_tax_rates_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.marketplace_accounts(id) ON DELETE CASCADE;


--
-- Name: app_settings app_settings_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: audit_findings audit_findings_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_findings
    ADD CONSTRAINT audit_findings_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.marketplace_accounts(id) ON DELETE CASCADE;


--
-- Name: card_invoice_items card_invoice_items_expense_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_invoice_items
    ADD CONSTRAINT card_invoice_items_expense_category_id_fkey FOREIGN KEY (expense_category_id) REFERENCES public.expense_categories(id) ON DELETE SET NULL;


--
-- Name: card_invoice_items card_invoice_items_expense_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_invoice_items
    ADD CONSTRAINT card_invoice_items_expense_id_fkey FOREIGN KEY (expense_id) REFERENCES public.expenses(id) ON DELETE SET NULL;


--
-- Name: card_invoice_items card_invoice_items_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_invoice_items
    ADD CONSTRAINT card_invoice_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.card_invoices(id) ON DELETE CASCADE;


--
-- Name: card_invoice_posted_rules card_invoice_posted_rules_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_invoice_posted_rules
    ADD CONSTRAINT card_invoice_posted_rules_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.card_invoices(id) ON DELETE CASCADE;


--
-- Name: card_invoice_posted_rules card_invoice_posted_rules_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_invoice_posted_rules
    ADD CONSTRAINT card_invoice_posted_rules_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.card_rules(id) ON DELETE CASCADE;


--
-- Name: card_invoice_postings card_invoice_postings_expense_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_invoice_postings
    ADD CONSTRAINT card_invoice_postings_expense_id_fkey FOREIGN KEY (expense_id) REFERENCES public.expenses(id);


--
-- Name: card_invoice_postings card_invoice_postings_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_invoice_postings
    ADD CONSTRAINT card_invoice_postings_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.card_invoices(id) ON DELETE CASCADE;


--
-- Name: card_rules card_rules_expense_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_rules
    ADD CONSTRAINT card_rules_expense_category_id_fkey FOREIGN KEY (expense_category_id) REFERENCES public.expense_categories(id) ON DELETE SET NULL;


--
-- Name: card_rules card_rules_expense_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_rules
    ADD CONSTRAINT card_rules_expense_id_fkey FOREIGN KEY (expense_id) REFERENCES public.expenses(id) ON DELETE CASCADE;


--
-- Name: expense_categories expense_categories_parent_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_categories
    ADD CONSTRAINT expense_categories_parent_category_id_fkey FOREIGN KEY (parent_category_id) REFERENCES public.expense_categories(id) ON DELETE CASCADE;


--
-- Name: expense_name_rules expense_name_rules_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_name_rules
    ADD CONSTRAINT expense_name_rules_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.expense_categories(id) ON DELETE CASCADE;


--
-- Name: expense_name_rules expense_name_rules_expense_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_name_rules
    ADD CONSTRAINT expense_name_rules_expense_id_fkey FOREIGN KEY (expense_id) REFERENCES public.expenses(id) ON DELETE CASCADE;


--
-- Name: expense_values expense_values_expense_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_values
    ADD CONSTRAINT expense_values_expense_id_fkey FOREIGN KEY (expense_id) REFERENCES public.expenses(id) ON DELETE CASCADE;


--
-- Name: expenses expenses_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.expense_categories(id) ON DELETE CASCADE;


--
-- Name: faturamento_externo faturamento_externo_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faturamento_externo
    ADD CONSTRAINT faturamento_externo_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;


--
-- Name: marketplace_accounts marketplace_accounts_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_accounts
    ADD CONSTRAINT marketplace_accounts_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE SET NULL;


--
-- Name: marketplace_accounts marketplace_accounts_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_accounts
    ADD CONSTRAINT marketplace_accounts_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: ml_ads_daily ml_ads_daily_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_ads_daily
    ADD CONSTRAINT ml_ads_daily_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.marketplace_accounts(id) ON DELETE RESTRICT;


--
-- Name: ml_billing_details ml_billing_details_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_billing_details
    ADD CONSTRAINT ml_billing_details_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.marketplace_accounts(id) ON DELETE RESTRICT;


--
-- Name: ml_billing_periods ml_billing_periods_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_billing_periods
    ADD CONSTRAINT ml_billing_periods_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.marketplace_accounts(id) ON DELETE RESTRICT;


--
-- Name: ml_items ml_items_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_items
    ADD CONSTRAINT ml_items_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.marketplace_accounts(id) ON DELETE RESTRICT;


--
-- Name: ml_order_items ml_order_items_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_order_items
    ADD CONSTRAINT ml_order_items_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.marketplace_accounts(id) ON DELETE RESTRICT;


--
-- Name: ml_order_items ml_order_items_order_ref_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_order_items
    ADD CONSTRAINT ml_order_items_order_ref_fkey FOREIGN KEY (order_ref) REFERENCES public.ml_orders(id) ON DELETE CASCADE;


--
-- Name: ml_orders ml_orders_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_orders
    ADD CONSTRAINT ml_orders_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.marketplace_accounts(id) ON DELETE RESTRICT;


--
-- Name: ml_visits_daily ml_visits_daily_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_visits_daily
    ADD CONSTRAINT ml_visits_daily_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.marketplace_accounts(id) ON DELETE RESTRICT;


--
-- Name: mp_payments mp_payments_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mp_payments
    ADD CONSTRAINT mp_payments_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.marketplace_accounts(id) ON DELETE RESTRICT;


--
-- Name: oauth_states oauth_states_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_states
    ADD CONSTRAINT oauth_states_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.marketplace_accounts(id) ON DELETE CASCADE;


--
-- Name: operating_cost_entries operating_cost_entries_cost_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operating_cost_entries
    ADD CONSTRAINT operating_cost_entries_cost_id_fkey FOREIGN KEY (cost_id) REFERENCES public.operating_costs(id) ON DELETE CASCADE;


--
-- Name: operating_cost_entries operating_cost_entries_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operating_cost_entries
    ADD CONSTRAINT operating_cost_entries_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: operating_cost_items operating_cost_items_cost_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operating_cost_items
    ADD CONSTRAINT operating_cost_items_cost_id_fkey FOREIGN KEY (cost_id) REFERENCES public.operating_costs(id) ON DELETE CASCADE;


--
-- Name: operating_costs operating_costs_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operating_costs
    ADD CONSTRAINT operating_costs_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: payable_installments payable_installments_note_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payable_installments
    ADD CONSTRAINT payable_installments_note_id_fkey FOREIGN KEY (note_id) REFERENCES public.payable_notes(id) ON DELETE CASCADE;


--
-- Name: payable_items payable_items_note_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payable_items
    ADD CONSTRAINT payable_items_note_id_fkey FOREIGN KEY (note_id) REFERENCES public.payable_notes(id) ON DELETE CASCADE;


--
-- Name: sku_item_links sku_item_links_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sku_item_links
    ADD CONSTRAINT sku_item_links_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.marketplace_accounts(id) ON DELETE RESTRICT;


--
-- Name: sku_item_links sku_item_links_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sku_item_links
    ADD CONSTRAINT sku_item_links_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: sync_jobs sync_jobs_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_jobs
    ADD CONSTRAINT sync_jobs_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.marketplace_accounts(id) ON DELETE CASCADE;


--
-- Name: sync_logs sync_logs_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_logs
    ADD CONSTRAINT sync_logs_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.marketplace_accounts(id) ON DELETE CASCADE;


--
-- Name: billing_subtype_map Authenticated can read subtype map; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated can read subtype map" ON public.billing_subtype_map FOR SELECT TO authenticated USING (true);


--
-- Name: ml_billing_periods Owner can manage billing periods; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owner can manage billing periods" ON public.ml_billing_periods TO authenticated USING (public.owns_account(account_id)) WITH CHECK (public.owns_account(account_id));


--
-- Name: operating_cost_items Owner manages own cost items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owner manages own cost items" ON public.operating_cost_items TO authenticated USING (public.is_team_owner(owner_id)) WITH CHECK ((public.is_team_owner(owner_id) OR (owner_id = auth.uid())));


--
-- Name: operating_cost_entries Owner manages own operating cost entries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owner manages own operating cost entries" ON public.operating_cost_entries TO authenticated USING (public.is_team_owner(owner_id)) WITH CHECK ((public.is_team_owner(owner_id) OR (owner_id = auth.uid())));


--
-- Name: operating_costs Owner manages own operating costs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owner manages own operating costs" ON public.operating_costs TO authenticated USING (public.is_team_owner(owner_id)) WITH CHECK ((public.is_team_owner(owner_id) OR (owner_id = auth.uid())));


--
-- Name: oauth_states Owner manages their oauth states; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owner manages their oauth states" ON public.oauth_states TO authenticated USING ((public.is_team_owner(owner_id) AND public.owns_account(account_id))) WITH CHECK (((public.is_team_owner(owner_id) OR (owner_id = auth.uid())) AND public.owns_account(account_id)));


--
-- Name: account_tax_rates Owners manage tax rates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners manage tax rates" ON public.account_tax_rates TO authenticated USING (public.owns_account(account_id)) WITH CHECK (public.owns_account(account_id));


--
-- Name: ml_visits_daily Owners manage their ml_visits_daily; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners manage their ml_visits_daily" ON public.ml_visits_daily USING (public.owns_account(account_id)) WITH CHECK (public.owns_account(account_id));


--
-- Name: expense_name_rules Owners manage their name rules; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners manage their name rules" ON public.expense_name_rules TO authenticated USING (public.is_team_owner(owner_id)) WITH CHECK ((public.is_team_owner(owner_id) OR (owner_id = auth.uid())));


--
-- Name: sync_jobs Users manage jobs of their accounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage jobs of their accounts" ON public.sync_jobs TO authenticated USING (public.owns_account(account_id)) WITH CHECK (public.owns_account(account_id));


--
-- Name: app_settings Users manage own settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own settings" ON public.app_settings TO authenticated USING (public.is_team_owner(owner_id)) WITH CHECK ((public.is_team_owner(owner_id) OR (owner_id = auth.uid())));


--
-- Name: account_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.account_members ENABLE ROW LEVEL SECURITY;

--
-- Name: account_tax_rates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.account_tax_rates ENABLE ROW LEVEL SECURITY;

--
-- Name: marketplace_accounts admin cria conta; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin cria conta" ON public.marketplace_accounts FOR INSERT TO authenticated WITH CHECK ((public.is_team_owner(owner_id) AND public.is_admin()));


--
-- Name: marketplace_accounts admin exclui conta; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin exclui conta" ON public.marketplace_accounts FOR DELETE TO authenticated USING ((public.is_team_owner(owner_id) AND public.is_admin()));


--
-- Name: app_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_findings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_findings ENABLE ROW LEVEL SECURITY;

--
-- Name: billing_subtype_map; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.billing_subtype_map ENABLE ROW LEVEL SECURITY;

--
-- Name: billing_subtype_map billing_subtype_map_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY billing_subtype_map_read ON public.billing_subtype_map FOR SELECT TO authenticated USING (true);


--
-- Name: card_invoice_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.card_invoice_items ENABLE ROW LEVEL SECURITY;

--
-- Name: card_invoice_posted_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.card_invoice_posted_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: card_invoice_postings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.card_invoice_postings ENABLE ROW LEVEL SECURITY;

--
-- Name: card_invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.card_invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: card_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.card_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: product_cost_history cost_hist_team; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cost_hist_team ON public.product_cost_history USING (public.is_team_owner(owner_id)) WITH CHECK ((public.is_team_owner(owner_id) OR (owner_id = auth.uid())));


--
-- Name: empresas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY;

--
-- Name: marketplace_accounts equipe edita dados da conta; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "equipe edita dados da conta" ON public.marketplace_accounts FOR UPDATE TO authenticated USING (public.is_team_owner(owner_id)) WITH CHECK (public.is_team_owner(owner_id));


--
-- Name: marketplace_accounts equipe le contas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "equipe le contas" ON public.marketplace_accounts FOR SELECT TO authenticated USING (public.is_team_owner(owner_id));


--
-- Name: sync_logs equipe le sync_logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "equipe le sync_logs" ON public.sync_logs FOR SELECT TO authenticated USING (((account_id IS NULL) OR public.owns_account(account_id)));


--
-- Name: expense_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: expense_name_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.expense_name_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: expense_values; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.expense_values ENABLE ROW LEVEL SECURITY;

--
-- Name: expenses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

--
-- Name: faturamento_externo; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.faturamento_externo ENABLE ROW LEVEL SECURITY;

--
-- Name: kit_components; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kit_components ENABLE ROW LEVEL SECURITY;

--
-- Name: marketplace_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.marketplace_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: account_members members read own team; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members read own team" ON public.account_members FOR SELECT TO authenticated USING (((root_owner_id = public.team_owner()) OR (member_id = auth.uid())));


--
-- Name: account_members members_admin_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY members_admin_delete ON public.account_members FOR DELETE USING ((public.is_admin() AND (root_owner_id = public.team_owner()) AND (member_id <> auth.uid()) AND (member_id <> root_owner_id)));


--
-- Name: account_members members_admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY members_admin_insert ON public.account_members FOR INSERT WITH CHECK ((public.is_admin() AND (root_owner_id = public.team_owner())));


--
-- Name: account_members members_admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY members_admin_update ON public.account_members FOR UPDATE USING ((public.is_admin() AND (root_owner_id = public.team_owner()))) WITH CHECK ((public.is_admin() AND (root_owner_id = public.team_owner())));


--
-- Name: ml_ads_daily; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ml_ads_daily ENABLE ROW LEVEL SECURITY;

--
-- Name: ml_billing_details; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ml_billing_details ENABLE ROW LEVEL SECURITY;

--
-- Name: ml_billing_periods; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ml_billing_periods ENABLE ROW LEVEL SECURITY;

--
-- Name: ml_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ml_items ENABLE ROW LEVEL SECURITY;

--
-- Name: ml_order_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ml_order_items ENABLE ROW LEVEL SECURITY;

--
-- Name: ml_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ml_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: ml_visits_daily; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ml_visits_daily ENABLE ROW LEVEL SECURITY;

--
-- Name: mp_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mp_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: mp_payments mp_payments owner access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "mp_payments owner access" ON public.mp_payments TO authenticated USING (public.owns_account(account_id)) WITH CHECK (public.owns_account(account_id));


--
-- Name: mp_payments_compras_reserva_20261013; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mp_payments_compras_reserva_20261013 ENABLE ROW LEVEL SECURITY;

--
-- Name: oauth_states; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.oauth_states ENABLE ROW LEVEL SECURITY;

--
-- Name: operating_cost_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.operating_cost_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: operating_cost_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.operating_cost_items ENABLE ROW LEVEL SECURITY;

--
-- Name: operating_costs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.operating_costs ENABLE ROW LEVEL SECURITY;

--
-- Name: card_invoice_items own card_invoice_items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own card_invoice_items" ON public.card_invoice_items TO authenticated USING (public.is_team_owner(owner_id)) WITH CHECK (public.is_team_owner(owner_id));


--
-- Name: card_invoices own card_invoices; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own card_invoices" ON public.card_invoices TO authenticated USING (public.is_team_owner(owner_id)) WITH CHECK (public.is_team_owner(owner_id));


--
-- Name: card_rules own card_rules; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own card_rules" ON public.card_rules TO authenticated USING (public.is_team_owner(owner_id)) WITH CHECK (public.is_team_owner(owner_id));


--
-- Name: expense_categories own expense_categories; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own expense_categories" ON public.expense_categories TO authenticated USING (public.is_team_owner(owner_id)) WITH CHECK ((public.is_team_owner(owner_id) OR (owner_id = auth.uid())));


--
-- Name: expense_values own expense_values; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own expense_values" ON public.expense_values TO authenticated USING (public.is_team_owner(owner_id)) WITH CHECK ((public.is_team_owner(owner_id) OR (owner_id = auth.uid())));


--
-- Name: expenses own expenses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own expenses" ON public.expenses TO authenticated USING (public.is_team_owner(owner_id)) WITH CHECK ((public.is_team_owner(owner_id) OR (owner_id = auth.uid())));


--
-- Name: ml_ads_daily own ml_ads_daily; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own ml_ads_daily" ON public.ml_ads_daily USING (public.owns_account(account_id)) WITH CHECK (public.owns_account(account_id));


--
-- Name: ml_billing_details own ml_billing_details; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own ml_billing_details" ON public.ml_billing_details USING (public.owns_account(account_id)) WITH CHECK (public.owns_account(account_id));


--
-- Name: ml_items own ml_items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own ml_items" ON public.ml_items USING (public.owns_account(account_id)) WITH CHECK (public.owns_account(account_id));


--
-- Name: ml_order_items own ml_order_items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own ml_order_items" ON public.ml_order_items USING (public.owns_account(account_id)) WITH CHECK (public.owns_account(account_id));


--
-- Name: ml_orders own ml_orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own ml_orders" ON public.ml_orders USING (public.owns_account(account_id)) WITH CHECK (public.owns_account(account_id));


--
-- Name: sku_item_links own sku_item_links; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own sku_item_links" ON public.sku_item_links TO authenticated USING ((public.is_team_owner(owner_id) AND public.owns_account(account_id))) WITH CHECK (((public.is_team_owner(owner_id) OR (owner_id = auth.uid())) AND public.owns_account(account_id)));


--
-- Name: telegram_ad_alert_state own telegram_ad_alert_state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own telegram_ad_alert_state" ON public.telegram_ad_alert_state FOR SELECT TO authenticated USING (public.is_team_owner(owner_id));


--
-- Name: telegram_alert_log own telegram_alert_log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own telegram_alert_log" ON public.telegram_alert_log FOR SELECT TO authenticated USING (public.is_team_owner(owner_id));


--
-- Name: telegram_config own telegram_config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own telegram_config" ON public.telegram_config TO authenticated USING (public.is_team_owner(owner_id)) WITH CHECK ((public.is_team_owner(owner_id) OR (owner_id = auth.uid())));


--
-- Name: audit_findings owner can read own findings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owner can read own findings" ON public.audit_findings FOR SELECT TO authenticated USING (public.is_team_owner(owner_id));


--
-- Name: audit_findings owner can update own findings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owner can update own findings" ON public.audit_findings FOR UPDATE TO authenticated USING (public.is_team_owner(owner_id)) WITH CHECK ((public.is_team_owner(owner_id) OR (owner_id = auth.uid())));


--
-- Name: payable_installments payable_inst_team; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payable_inst_team ON public.payable_installments USING (public.is_team_owner(owner_id)) WITH CHECK ((public.is_team_owner(owner_id) OR (owner_id = auth.uid())));


--
-- Name: payable_installments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payable_installments ENABLE ROW LEVEL SECURITY;

--
-- Name: payable_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payable_items ENABLE ROW LEVEL SECURITY;

--
-- Name: payable_items payable_items_team; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payable_items_team ON public.payable_items USING (public.is_team_owner(owner_id)) WITH CHECK ((public.is_team_owner(owner_id) OR (owner_id = auth.uid())));


--
-- Name: payable_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payable_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: payable_notes payable_notes_team; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payable_notes_team ON public.payable_notes USING (public.is_team_owner(owner_id)) WITH CHECK ((public.is_team_owner(owner_id) OR (owner_id = auth.uid())));


--
-- Name: payable_recurrences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payable_recurrences ENABLE ROW LEVEL SECURITY;

--
-- Name: product_cost_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_cost_history ENABLE ROW LEVEL SECURITY;

--
-- Name: product_skus; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_skus ENABLE ROW LEVEL SECURITY;

--
-- Name: payable_recurrences recur_team; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recur_team ON public.payable_recurrences USING (public.is_team_owner(owner_id)) WITH CHECK ((public.is_team_owner(owner_id) OR (owner_id = auth.uid())));


--
-- Name: rental_group_labels; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rental_group_labels ENABLE ROW LEVEL SECURITY;

--
-- Name: rental_invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rental_invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: user_screen_access screen_access_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY screen_access_admin_all ON public.user_screen_access USING ((public.is_admin() AND (root_owner_id = public.team_owner()))) WITH CHECK ((public.is_admin() AND (root_owner_id = public.team_owner())));


--
-- Name: user_screen_access screen_access_read_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY screen_access_read_own ON public.user_screen_access FOR SELECT USING ((member_id = auth.uid()));


--
-- Name: sku_item_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sku_item_links ENABLE ROW LEVEL SECURITY;

--
-- Name: sku_translation_rules sku_rules_team_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sku_rules_team_all ON public.sku_translation_rules USING (public.is_team_owner(owner_id)) WITH CHECK ((public.is_team_owner(owner_id) OR (owner_id = auth.uid())));


--
-- Name: sku_translation_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sku_translation_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: sync_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sync_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: sync_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: empresas team can manage empresas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "team can manage empresas" ON public.empresas USING (public.is_team_owner(owner_id)) WITH CHECK ((public.is_team_owner(owner_id) OR (owner_id = auth.uid())));


--
-- Name: faturamento_externo team can manage faturamento_externo; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "team can manage faturamento_externo" ON public.faturamento_externo USING (public.is_team_owner(owner_id)) WITH CHECK ((public.is_team_owner(owner_id) OR (owner_id = auth.uid())));


--
-- Name: rental_group_labels team can manage rental_group_labels; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "team can manage rental_group_labels" ON public.rental_group_labels USING (public.is_team_owner(owner_id)) WITH CHECK ((public.is_team_owner(owner_id) OR (owner_id = auth.uid())));


--
-- Name: rental_invoices team can manage rental_invoices; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "team can manage rental_invoices" ON public.rental_invoices USING (public.is_team_owner(owner_id)) WITH CHECK ((public.is_team_owner(owner_id) OR (owner_id = auth.uid())));


--
-- Name: kit_components team manages kit_components; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "team manages kit_components" ON public.kit_components TO authenticated USING (public.is_team_owner(owner_id)) WITH CHECK ((public.is_team_owner(owner_id) OR (owner_id = auth.uid())));


--
-- Name: product_skus team manages product_skus; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "team manages product_skus" ON public.product_skus TO authenticated USING (public.is_team_owner(owner_id)) WITH CHECK ((public.is_team_owner(owner_id) OR (owner_id = auth.uid())));


--
-- Name: telegram_ad_alert_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.telegram_ad_alert_state ENABLE ROW LEVEL SECURITY;

--
-- Name: telegram_alert_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.telegram_alert_log ENABLE ROW LEVEL SECURITY;

--
-- Name: telegram_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.telegram_config ENABLE ROW LEVEL SECURITY;

--
-- Name: user_screen_access; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_screen_access ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION ajustar_mes_recorrencia(_owner uuid, _recorrencia_id uuid, _competencia date, _novo_valor numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ajustar_mes_recorrencia(_owner uuid, _recorrencia_id uuid, _competencia date, _novo_valor numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ajustar_mes_recorrencia(_owner uuid, _recorrencia_id uuid, _competencia date, _novo_valor numeric) TO authenticated;
GRANT ALL ON FUNCTION public.ajustar_mes_recorrencia(_owner uuid, _recorrencia_id uuid, _competencia date, _novo_valor numeric) TO service_role;


--
-- Name: FUNCTION anuncios_margem(_account_ids uuid[], _from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.anuncios_margem(_account_ids uuid[], _from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.anuncios_margem(_account_ids uuid[], _from date, _to date) TO authenticated;
GRANT ALL ON FUNCTION public.anuncios_margem(_account_ids uuid[], _from date, _to date) TO service_role;


--
-- Name: FUNCTION aplicar_seguranca_rpc(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.aplicar_seguranca_rpc() FROM PUBLIC;
GRANT ALL ON FUNCTION public.aplicar_seguranca_rpc() TO service_role;


--
-- Name: FUNCTION atualizar_valor_recorrencia(_owner uuid, _recorrencia_id uuid, _novo_valor numeric, _a_partir_de date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.atualizar_valor_recorrencia(_owner uuid, _recorrencia_id uuid, _novo_valor numeric, _a_partir_de date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.atualizar_valor_recorrencia(_owner uuid, _recorrencia_id uuid, _novo_valor numeric, _a_partir_de date) TO authenticated;
GRANT ALL ON FUNCTION public.atualizar_valor_recorrencia(_owner uuid, _recorrencia_id uuid, _novo_valor numeric, _a_partir_de date) TO service_role;


--
-- Name: FUNCTION audit_null_sale_fee(_account_id uuid, _from date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.audit_null_sale_fee(_account_id uuid, _from date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.audit_null_sale_fee(_account_id uuid, _from date) TO service_role;
GRANT ALL ON FUNCTION public.audit_null_sale_fee(_account_id uuid, _from date) TO authenticated;


--
-- Name: FUNCTION audit_orders_without_items(_account_id uuid, _from date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.audit_orders_without_items(_account_id uuid, _from date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.audit_orders_without_items(_account_id uuid, _from date) TO service_role;
GRANT ALL ON FUNCTION public.audit_orders_without_items(_account_id uuid, _from date) TO authenticated;


--
-- Name: FUNCTION audit_recheck_billing(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.audit_recheck_billing() FROM PUBLIC;
GRANT ALL ON FUNCTION public.audit_recheck_billing() TO service_role;


--
-- Name: FUNCTION audit_seguranca_rpc(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.audit_seguranca_rpc() FROM PUBLIC;
GRANT ALL ON FUNCTION public.audit_seguranca_rpc() TO service_role;


--
-- Name: FUNCTION audit_unclassified_subtypes(_account_id uuid, _from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.audit_unclassified_subtypes(_account_id uuid, _from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.audit_unclassified_subtypes(_account_id uuid, _from date, _to date) TO authenticated;
GRANT ALL ON FUNCTION public.audit_unclassified_subtypes(_account_id uuid, _from date, _to date) TO service_role;


--
-- Name: FUNCTION backfill_item_skus(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.backfill_item_skus() FROM PUBLIC;
GRANT ALL ON FUNCTION public.backfill_item_skus() TO authenticated;
GRANT ALL ON FUNCTION public.backfill_item_skus() TO service_role;


--
-- Name: FUNCTION backfill_items_from_orders(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.backfill_items_from_orders() FROM PUBLIC;
GRANT ALL ON FUNCTION public.backfill_items_from_orders() TO authenticated;
GRANT ALL ON FUNCTION public.backfill_items_from_orders() TO service_role;


--
-- Name: FUNCTION billing_lancamentos_no_periodo(_account_id uuid, _period_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.billing_lancamentos_no_periodo(_account_id uuid, _period_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.billing_lancamentos_no_periodo(_account_id uuid, _period_key text) TO service_role;


--
-- Name: FUNCTION billing_max_detail_id(_account_id uuid, _period_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.billing_max_detail_id(_account_id uuid, _period_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.billing_max_detail_id(_account_id uuid, _period_key text) TO authenticated;
GRANT ALL ON FUNCTION public.billing_max_detail_id(_account_id uuid, _period_key text) TO service_role;


--
-- Name: FUNCTION card_invoice_guard(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.card_invoice_guard() FROM PUBLIC;
GRANT ALL ON FUNCTION public.card_invoice_guard() TO service_role;


--
-- Name: FUNCTION card_invoice_items_guard(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.card_invoice_items_guard() FROM PUBLIC;
GRANT ALL ON FUNCTION public.card_invoice_items_guard() TO service_role;


--
-- Name: FUNCTION card_invoice_post(_invoice_id uuid, _decisions jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.card_invoice_post(_invoice_id uuid, _decisions jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.card_invoice_post(_invoice_id uuid, _decisions jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.card_invoice_post(_invoice_id uuid, _decisions jsonb) TO service_role;


--
-- Name: FUNCTION card_invoice_undo(_invoice_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.card_invoice_undo(_invoice_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.card_invoice_undo(_invoice_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.card_invoice_undo(_invoice_id uuid) TO service_role;


--
-- Name: FUNCTION clear_expense_month(_expense_id uuid, _month date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.clear_expense_month(_expense_id uuid, _month date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.clear_expense_month(_expense_id uuid, _month date) TO authenticated;
GRANT ALL ON FUNCTION public.clear_expense_month(_expense_id uuid, _month date) TO service_role;


--
-- Name: FUNCTION close_previous_tax_rate(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.close_previous_tax_rate() TO anon;
GRANT ALL ON FUNCTION public.close_previous_tax_rate() TO authenticated;
GRANT ALL ON FUNCTION public.close_previous_tax_rate() TO service_role;


--
-- Name: FUNCTION conc_caixa_futuro(_account_ids uuid[], _from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.conc_caixa_futuro(_account_ids uuid[], _from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.conc_caixa_futuro(_account_ids uuid[], _from date, _to date) TO authenticated;
GRANT ALL ON FUNCTION public.conc_caixa_futuro(_account_ids uuid[], _from date, _to date) TO service_role;


--
-- Name: FUNCTION conc_divergencias(_account_ids uuid[], _from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.conc_divergencias(_account_ids uuid[], _from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.conc_divergencias(_account_ids uuid[], _from date, _to date) TO authenticated;
GRANT ALL ON FUNCTION public.conc_divergencias(_account_ids uuid[], _from date, _to date) TO service_role;


--
-- Name: FUNCTION conc_recebimentos(_account_ids uuid[], _from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.conc_recebimentos(_account_ids uuid[], _from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.conc_recebimentos(_account_ids uuid[], _from date, _to date) TO authenticated;
GRANT ALL ON FUNCTION public.conc_recebimentos(_account_ids uuid[], _from date, _to date) TO service_role;


--
-- Name: FUNCTION conc_recebimentos_resumo(_account_ids uuid[], _from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.conc_recebimentos_resumo(_account_ids uuid[], _from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.conc_recebimentos_resumo(_account_ids uuid[], _from date, _to date) TO authenticated;
GRANT ALL ON FUNCTION public.conc_recebimentos_resumo(_account_ids uuid[], _from date, _to date) TO service_role;


--
-- Name: FUNCTION conc_tarifas_canceladas(_account_ids uuid[], _from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.conc_tarifas_canceladas(_account_ids uuid[], _from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.conc_tarifas_canceladas(_account_ids uuid[], _from date, _to date) TO authenticated;
GRANT ALL ON FUNCTION public.conc_tarifas_canceladas(_account_ids uuid[], _from date, _to date) TO service_role;


--
-- Name: FUNCTION contas_permitidas(_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.contas_permitidas(_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.contas_permitidas(_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.contas_permitidas(_ids uuid[]) TO service_role;


--
-- Name: FUNCTION create_categoria(_owner uuid, _nome text, _kind text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_categoria(_owner uuid, _nome text, _kind text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_categoria(_owner uuid, _nome text, _kind text) TO authenticated;
GRANT ALL ON FUNCTION public.create_categoria(_owner uuid, _nome text, _kind text) TO service_role;


--
-- Name: FUNCTION create_empresa(_nome text, _cnpj text, _razao text, _regime text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_empresa(_nome text, _cnpj text, _razao text, _regime text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_empresa(_nome text, _cnpj text, _razao text, _regime text) TO authenticated;
GRANT ALL ON FUNCTION public.create_empresa(_nome text, _cnpj text, _razao text, _regime text) TO service_role;


--
-- Name: FUNCTION create_fornecedor(_owner uuid, _nome text, _cnpj text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_fornecedor(_owner uuid, _nome text, _cnpj text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_fornecedor(_owner uuid, _nome text, _cnpj text) TO authenticated;
GRANT ALL ON FUNCTION public.create_fornecedor(_owner uuid, _nome text, _cnpj text) TO service_role;


--
-- Name: FUNCTION create_gasto(_owner uuid, _categoria_id uuid, _nome text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_gasto(_owner uuid, _categoria_id uuid, _nome text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_gasto(_owner uuid, _categoria_id uuid, _nome text) TO authenticated;
GRANT ALL ON FUNCTION public.create_gasto(_owner uuid, _categoria_id uuid, _nome text) TO service_role;


--
-- Name: FUNCTION custo_sku_na_data(_owner uuid, _sku text, _data date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.custo_sku_na_data(_owner uuid, _sku text, _data date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.custo_sku_na_data(_owner uuid, _sku text, _data date) TO service_role;


--
-- Name: FUNCTION custo_unit_na_data(_owner uuid, _sku text, _data date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.custo_unit_na_data(_owner uuid, _sku text, _data date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.custo_unit_na_data(_owner uuid, _sku text, _data date) TO service_role;


--
-- Name: FUNCTION custos_por_operacao(_owner uuid, _year integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.custos_por_operacao(_owner uuid, _year integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.custos_por_operacao(_owner uuid, _year integer) TO authenticated;
GRANT ALL ON FUNCTION public.custos_por_operacao(_owner uuid, _year integer) TO service_role;


--
-- Name: FUNCTION dashboard_cmv(_from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.dashboard_cmv(_from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.dashboard_cmv(_from date, _to date) TO authenticated;
GRANT ALL ON FUNCTION public.dashboard_cmv(_from date, _to date) TO service_role;


--
-- Name: FUNCTION dashboard_dre_tree(_from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.dashboard_dre_tree(_from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.dashboard_dre_tree(_from date, _to date) TO authenticated;
GRANT ALL ON FUNCTION public.dashboard_dre_tree(_from date, _to date) TO service_role;


--
-- Name: FUNCTION dashboard_dre_tree_op(_from date, _to date, _op text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.dashboard_dre_tree_op(_from date, _to date, _op text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.dashboard_dre_tree_op(_from date, _to date, _op text) TO authenticated;
GRANT ALL ON FUNCTION public.dashboard_dre_tree_op(_from date, _to date, _op text) TO service_role;


--
-- Name: FUNCTION dashboard_ecom_metrics(_from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.dashboard_ecom_metrics(_from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.dashboard_ecom_metrics(_from date, _to date) TO authenticated;
GRANT ALL ON FUNCTION public.dashboard_ecom_metrics(_from date, _to date) TO service_role;


--
-- Name: FUNCTION dashboard_kpis(_from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.dashboard_kpis(_from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.dashboard_kpis(_from date, _to date) TO authenticated;
GRANT ALL ON FUNCTION public.dashboard_kpis(_from date, _to date) TO service_role;


--
-- Name: FUNCTION dashboard_kpis_op(_from date, _to date, _op text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.dashboard_kpis_op(_from date, _to date, _op text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.dashboard_kpis_op(_from date, _to date, _op text) TO authenticated;
GRANT ALL ON FUNCTION public.dashboard_kpis_op(_from date, _to date, _op text) TO service_role;


--
-- Name: FUNCTION dashboard_margens(_from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.dashboard_margens(_from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.dashboard_margens(_from date, _to date) TO authenticated;
GRANT ALL ON FUNCTION public.dashboard_margens(_from date, _to date) TO service_role;


--
-- Name: FUNCTION dashboard_monthly_series(_from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.dashboard_monthly_series(_from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.dashboard_monthly_series(_from date, _to date) TO authenticated;
GRANT ALL ON FUNCTION public.dashboard_monthly_series(_from date, _to date) TO service_role;


--
-- Name: FUNCTION dashboard_monthly_series_op(_from date, _to date, _op text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.dashboard_monthly_series_op(_from date, _to date, _op text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.dashboard_monthly_series_op(_from date, _to date, _op text) TO authenticated;
GRANT ALL ON FUNCTION public.dashboard_monthly_series_op(_from date, _to date, _op text) TO service_role;


--
-- Name: FUNCTION dashboard_top_clientes_locacao(_from date, _to date, _limite integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.dashboard_top_clientes_locacao(_from date, _to date, _limite integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.dashboard_top_clientes_locacao(_from date, _to date, _limite integer) TO authenticated;
GRANT ALL ON FUNCTION public.dashboard_top_clientes_locacao(_from date, _to date, _limite integer) TO service_role;


--
-- Name: FUNCTION dashboard_top_produtos(_from date, _to date, _limite integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.dashboard_top_produtos(_from date, _to date, _limite integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.dashboard_top_produtos(_from date, _to date, _limite integer) TO authenticated;
GRANT ALL ON FUNCTION public.dashboard_top_produtos(_from date, _to date, _limite integer) TO service_role;


--
-- Name: FUNCTION delete_cost_history(_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_cost_history(_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_cost_history(_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.delete_cost_history(_id uuid) TO service_role;


--
-- Name: FUNCTION delete_faturamento_externo(_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_faturamento_externo(_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_faturamento_externo(_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.delete_faturamento_externo(_id uuid) TO service_role;


--
-- Name: FUNCTION delete_sku(_sku text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_sku(_sku text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_sku(_sku text) TO authenticated;
GRANT ALL ON FUNCTION public.delete_sku(_sku text) TO service_role;


--
-- Name: FUNCTION ensure_product_skus_from_ml(_account_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ensure_product_skus_from_ml(_account_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ensure_product_skus_from_ml(_account_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.ensure_product_skus_from_ml(_account_id uuid) TO service_role;


--
-- Name: FUNCTION estado_da_sincronizacao(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.estado_da_sincronizacao() FROM PUBLIC;
GRANT ALL ON FUNCTION public.estado_da_sincronizacao() TO authenticated;
GRANT ALL ON FUNCTION public.estado_da_sincronizacao() TO service_role;


--
-- Name: FUNCTION excluir_recorrencia(_owner uuid, _recorrencia_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.excluir_recorrencia(_owner uuid, _recorrencia_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.excluir_recorrencia(_owner uuid, _recorrencia_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.excluir_recorrencia(_owner uuid, _recorrencia_id uuid) TO service_role;


--
-- Name: FUNCTION expense_sheet(_owner uuid, _year integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.expense_sheet(_owner uuid, _year integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.expense_sheet(_owner uuid, _year integer) TO authenticated;
GRANT ALL ON FUNCTION public.expense_sheet(_owner uuid, _year integer) TO service_role;


--
-- Name: FUNCTION expense_sheet_previsto(_owner uuid, _year integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.expense_sheet_previsto(_owner uuid, _year integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.expense_sheet_previsto(_owner uuid, _year integer) TO authenticated;
GRANT ALL ON FUNCTION public.expense_sheet_previsto(_owner uuid, _year integer) TO service_role;


--
-- Name: FUNCTION expense_values_guarda_conta(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.expense_values_guarda_conta() FROM PUBLIC;
GRANT ALL ON FUNCTION public.expense_values_guarda_conta() TO service_role;


--
-- Name: FUNCTION force_owner_to_team(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.force_owner_to_team() TO anon;
GRANT ALL ON FUNCTION public.force_owner_to_team() TO authenticated;
GRANT ALL ON FUNCTION public.force_owner_to_team() TO service_role;


--
-- Name: FUNCTION fracao_do_mes(_mes date, _from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fracao_do_mes(_mes date, _from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fracao_do_mes(_mes date, _from date, _to date) TO authenticated;
GRANT ALL ON FUNCTION public.fracao_do_mes(_mes date, _from date, _to date) TO service_role;


--
-- Name: FUNCTION gerar_contas_recorrencia(_owner uuid, _recorrencia_id uuid, _mes_inicial date, _meses integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.gerar_contas_recorrencia(_owner uuid, _recorrencia_id uuid, _mes_inicial date, _meses integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.gerar_contas_recorrencia(_owner uuid, _recorrencia_id uuid, _mes_inicial date, _meses integer) TO authenticated;
GRANT ALL ON FUNCTION public.gerar_contas_recorrencia(_owner uuid, _recorrencia_id uuid, _mes_inicial date, _meses integer) TO service_role;


--
-- Name: FUNCTION is_admin(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_admin() TO service_role;


--
-- Name: FUNCTION is_team_owner(_owner uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_team_owner(_owner uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_team_owner(_owner uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_team_owner(_owner uuid) TO service_role;


--
-- Name: FUNCTION kit_cost(_owner uuid, _kit_sku text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.kit_cost(_owner uuid, _kit_sku text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.kit_cost(_owner uuid, _kit_sku text) TO authenticated;
GRANT ALL ON FUNCTION public.kit_cost(_owner uuid, _kit_sku text) TO service_role;


--
-- Name: FUNCTION kit_recipe(_owner uuid, _kit_sku text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.kit_recipe(_owner uuid, _kit_sku text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.kit_recipe(_owner uuid, _kit_sku text) TO authenticated;
GRANT ALL ON FUNCTION public.kit_recipe(_owner uuid, _kit_sku text) TO service_role;


--
-- Name: FUNCTION list_categorias_arvore(_owner uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.list_categorias_arvore(_owner uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_categorias_arvore(_owner uuid) TO authenticated;
GRANT ALL ON FUNCTION public.list_categorias_arvore(_owner uuid) TO service_role;


--
-- Name: FUNCTION list_fornecedores(_owner uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.list_fornecedores(_owner uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_fornecedores(_owner uuid) TO authenticated;
GRANT ALL ON FUNCTION public.list_fornecedores(_owner uuid) TO service_role;


--
-- Name: FUNCTION list_gastos_da_subcategoria(_owner uuid, _subcategoria_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.list_gastos_da_subcategoria(_owner uuid, _subcategoria_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_gastos_da_subcategoria(_owner uuid, _subcategoria_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.list_gastos_da_subcategoria(_owner uuid, _subcategoria_id uuid) TO service_role;


--
-- Name: FUNCTION list_meses_recorrencia(_owner uuid, _recorrencia_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.list_meses_recorrencia(_owner uuid, _recorrencia_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_meses_recorrencia(_owner uuid, _recorrencia_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.list_meses_recorrencia(_owner uuid, _recorrencia_id uuid) TO service_role;


--
-- Name: FUNCTION list_recorrencias(_owner uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.list_recorrencias(_owner uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_recorrencias(_owner uuid) TO authenticated;
GRANT ALL ON FUNCTION public.list_recorrencias(_owner uuid) TO service_role;


--
-- Name: FUNCTION marketplace_accounts_vault_guard(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.marketplace_accounts_vault_guard() TO anon;
GRANT ALL ON FUNCTION public.marketplace_accounts_vault_guard() TO authenticated;
GRANT ALL ON FUNCTION public.marketplace_accounts_vault_guard() TO service_role;


--
-- Name: FUNCTION match_installments_by_approx(_owner uuid, _valor numeric, _data date, _tol_percent numeric, _tol_dias integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.match_installments_by_approx(_owner uuid, _valor numeric, _data date, _tol_percent numeric, _tol_dias integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.match_installments_by_approx(_owner uuid, _valor numeric, _data date, _tol_percent numeric, _tol_dias integer) TO authenticated;
GRANT ALL ON FUNCTION public.match_installments_by_approx(_owner uuid, _valor numeric, _data date, _tol_percent numeric, _tol_dias integer) TO service_role;


--
-- Name: FUNCTION match_payable_item(_owner uuid, _item_id uuid, _meu_sku text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.match_payable_item(_owner uuid, _item_id uuid, _meu_sku text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.match_payable_item(_owner uuid, _item_id uuid, _meu_sku text) TO authenticated;
GRANT ALL ON FUNCTION public.match_payable_item(_owner uuid, _item_id uuid, _meu_sku text) TO service_role;


--
-- Name: FUNCTION ml_ads_periodo(_account_ids uuid[], _from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ml_ads_periodo(_account_ids uuid[], _from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ml_ads_periodo(_account_ids uuid[], _from date, _to date) TO authenticated;
GRANT ALL ON FUNCTION public.ml_ads_periodo(_account_ids uuid[], _from date, _to date) TO service_role;


--
-- Name: FUNCTION ml_available_dates(_account_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ml_available_dates(_account_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ml_available_dates(_account_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.ml_available_dates(_account_ids uuid[]) TO service_role;


--
-- Name: FUNCTION ml_cmv(_account_ids uuid[], _from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ml_cmv(_account_ids uuid[], _from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ml_cmv(_account_ids uuid[], _from date, _to date) TO authenticated;
GRANT ALL ON FUNCTION public.ml_cmv(_account_ids uuid[], _from date, _to date) TO service_role;


--
-- Name: FUNCTION ml_commission_breakdown(_account_ids uuid[], _from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ml_commission_breakdown(_account_ids uuid[], _from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ml_commission_breakdown(_account_ids uuid[], _from date, _to date) TO authenticated;
GRANT ALL ON FUNCTION public.ml_commission_breakdown(_account_ids uuid[], _from date, _to date) TO service_role;


--
-- Name: FUNCTION ml_cost_trends(_account_ids uuid[], _months integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ml_cost_trends(_account_ids uuid[], _months integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ml_cost_trends(_account_ids uuid[], _months integer) TO authenticated;
GRANT ALL ON FUNCTION public.ml_cost_trends(_account_ids uuid[], _months integer) TO service_role;


--
-- Name: FUNCTION ml_custos_competencia(_account_ids uuid[], _from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ml_custos_competencia(_account_ids uuid[], _from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ml_custos_competencia(_account_ids uuid[], _from date, _to date) TO authenticated;
GRANT ALL ON FUNCTION public.ml_custos_competencia(_account_ids uuid[], _from date, _to date) TO service_role;


--
-- Name: FUNCTION ml_custos_competencia_mes(_account_ids uuid[], _from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ml_custos_competencia_mes(_account_ids uuid[], _from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ml_custos_competencia_mes(_account_ids uuid[], _from date, _to date) TO authenticated;
GRANT ALL ON FUNCTION public.ml_custos_competencia_mes(_account_ids uuid[], _from date, _to date) TO service_role;


--
-- Name: FUNCTION ml_daily_series(_account_ids uuid[], _from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ml_daily_series(_account_ids uuid[], _from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ml_daily_series(_account_ids uuid[], _from date, _to date) TO authenticated;
GRANT ALL ON FUNCTION public.ml_daily_series(_account_ids uuid[], _from date, _to date) TO service_role;


--
-- Name: FUNCTION ml_data_health(_account_ids uuid[], _from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ml_data_health(_account_ids uuid[], _from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ml_data_health(_account_ids uuid[], _from date, _to date) TO authenticated;
GRANT ALL ON FUNCTION public.ml_data_health(_account_ids uuid[], _from date, _to date) TO service_role;


--
-- Name: FUNCTION ml_fulfillment_breakdown(_account_ids uuid[], _from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ml_fulfillment_breakdown(_account_ids uuid[], _from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ml_fulfillment_breakdown(_account_ids uuid[], _from date, _to date) TO authenticated;
GRANT ALL ON FUNCTION public.ml_fulfillment_breakdown(_account_ids uuid[], _from date, _to date) TO service_role;


--
-- Name: FUNCTION ml_metrics(_account_ids uuid[], _from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ml_metrics(_account_ids uuid[], _from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ml_metrics(_account_ids uuid[], _from date, _to date) TO authenticated;
GRANT ALL ON FUNCTION public.ml_metrics(_account_ids uuid[], _from date, _to date) TO service_role;


--
-- Name: FUNCTION ml_receita_competencia_mes(_account_ids uuid[], _from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ml_receita_competencia_mes(_account_ids uuid[], _from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ml_receita_competencia_mes(_account_ids uuid[], _from date, _to date) TO authenticated;
GRANT ALL ON FUNCTION public.ml_receita_competencia_mes(_account_ids uuid[], _from date, _to date) TO service_role;


--
-- Name: FUNCTION ml_trocar_itens_dos_pedidos(_account_id uuid, _itens jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ml_trocar_itens_dos_pedidos(_account_id uuid, _itens jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ml_trocar_itens_dos_pedidos(_account_id uuid, _itens jsonb) TO service_role;


--
-- Name: FUNCTION mp_a_receber(_account_ids uuid[], _from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mp_a_receber(_account_ids uuid[], _from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mp_a_receber(_account_ids uuid[], _from date, _to date) TO authenticated;
GRANT ALL ON FUNCTION public.mp_a_receber(_account_ids uuid[], _from date, _to date) TO service_role;


--
-- Name: FUNCTION mp_divergencias(_account_ids uuid[], _from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mp_divergencias(_account_ids uuid[], _from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mp_divergencias(_account_ids uuid[], _from date, _to date) TO authenticated;
GRANT ALL ON FUNCTION public.mp_divergencias(_account_ids uuid[], _from date, _to date) TO service_role;


--
-- Name: FUNCTION mp_divergencias_resumo(_account_ids uuid[], _from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mp_divergencias_resumo(_account_ids uuid[], _from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mp_divergencias_resumo(_account_ids uuid[], _from date, _to date) TO authenticated;
GRANT ALL ON FUNCTION public.mp_divergencias_resumo(_account_ids uuid[], _from date, _to date) TO service_role;


--
-- Name: FUNCTION mp_reconciliation(_account_ids uuid[], _from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mp_reconciliation(_account_ids uuid[], _from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mp_reconciliation(_account_ids uuid[], _from date, _to date) TO authenticated;
GRANT ALL ON FUNCTION public.mp_reconciliation(_account_ids uuid[], _from date, _to date) TO service_role;


--
-- Name: FUNCTION mp_reconciliation_summary(_account_ids uuid[], _from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mp_reconciliation_summary(_account_ids uuid[], _from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mp_reconciliation_summary(_account_ids uuid[], _from date, _to date) TO authenticated;
GRANT ALL ON FUNCTION public.mp_reconciliation_summary(_account_ids uuid[], _from date, _to date) TO service_role;


--
-- Name: FUNCTION my_screens(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_screens() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_screens() TO authenticated;
GRANT ALL ON FUNCTION public.my_screens() TO service_role;


--
-- Name: FUNCTION normalize_desc(_texto text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.normalize_desc(_texto text) TO anon;
GRANT ALL ON FUNCTION public.normalize_desc(_texto text) TO authenticated;
GRANT ALL ON FUNCTION public.normalize_desc(_texto text) TO service_role;


--
-- Name: FUNCTION on_payable_note_delete(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.on_payable_note_delete() TO anon;
GRANT ALL ON FUNCTION public.on_payable_note_delete() TO authenticated;
GRANT ALL ON FUNCTION public.on_payable_note_delete() TO service_role;


--
-- Name: FUNCTION operating_costs_matrix(_owner uuid, _from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.operating_costs_matrix(_owner uuid, _from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.operating_costs_matrix(_owner uuid, _from date, _to date) TO authenticated;
GRANT ALL ON FUNCTION public.operating_costs_matrix(_owner uuid, _from date, _to date) TO service_role;


--
-- Name: FUNCTION operating_costs_month(_owner uuid, _month date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.operating_costs_month(_owner uuid, _month date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.operating_costs_month(_owner uuid, _month date) TO authenticated;
GRANT ALL ON FUNCTION public.operating_costs_month(_owner uuid, _month date) TO service_role;


--
-- Name: FUNCTION operating_costs_summary(_owner uuid, _from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.operating_costs_summary(_owner uuid, _from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.operating_costs_summary(_owner uuid, _from date, _to date) TO authenticated;
GRANT ALL ON FUNCTION public.operating_costs_summary(_owner uuid, _from date, _to date) TO service_role;


--
-- Name: FUNCTION owns_account(_account_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.owns_account(_account_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.owns_account(_account_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.owns_account(_account_id uuid) TO service_role;


--
-- Name: FUNCTION pagamentos_presos(_account_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.pagamentos_presos(_account_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pagamentos_presos(_account_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.pagamentos_presos(_account_ids uuid[]) TO service_role;


--
-- Name: FUNCTION pay_installment_to_planilha(_owner uuid, _installment_id uuid, _expense_id uuid, _pago_em date, _valor_pago numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.pay_installment_to_planilha(_owner uuid, _installment_id uuid, _expense_id uuid, _pago_em date, _valor_pago numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pay_installment_to_planilha(_owner uuid, _installment_id uuid, _expense_id uuid, _pago_em date, _valor_pago numeric) TO authenticated;
GRANT ALL ON FUNCTION public.pay_installment_to_planilha(_owner uuid, _installment_id uuid, _expense_id uuid, _pago_em date, _valor_pago numeric) TO service_role;


--
-- Name: FUNCTION payable_installments_sync_planilha(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.payable_installments_sync_planilha() FROM PUBLIC;
GRANT ALL ON FUNCTION public.payable_installments_sync_planilha() TO service_role;


--
-- Name: FUNCTION payable_notes_split(_owner uuid, _fornecedor text, _numero text, _cnpj text, _produto text, _status_pag text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.payable_notes_split(_owner uuid, _fornecedor text, _numero text, _cnpj text, _produto text, _status_pag text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.payable_notes_split(_owner uuid, _fornecedor text, _numero text, _cnpj text, _produto text, _status_pag text) TO authenticated;
GRANT ALL ON FUNCTION public.payable_notes_split(_owner uuid, _fornecedor text, _numero text, _cnpj text, _produto text, _status_pag text) TO service_role;


--
-- Name: FUNCTION payable_resumo(_owner uuid, _op text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.payable_resumo(_owner uuid, _op text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.payable_resumo(_owner uuid, _op text) TO authenticated;
GRANT ALL ON FUNCTION public.payable_resumo(_owner uuid, _op text) TO service_role;


--
-- Name: FUNCTION planilha_recalcular(_expense_id uuid, _month date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.planilha_recalcular(_expense_id uuid, _month date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.planilha_recalcular(_expense_id uuid, _month date) TO service_role;


--
-- Name: FUNCTION product_catalog(_owner uuid, _tipo text, _busca text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.product_catalog(_owner uuid, _tipo text, _busca text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.product_catalog(_owner uuid, _tipo text, _busca text) TO authenticated;
GRANT ALL ON FUNCTION public.product_catalog(_owner uuid, _tipo text, _busca text) TO service_role;


--
-- Name: FUNCTION product_skus_com_venda(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.product_skus_com_venda() FROM PUBLIC;
GRANT ALL ON FUNCTION public.product_skus_com_venda() TO service_role;


--
-- Name: FUNCTION purge_old_order_payloads(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.purge_old_order_payloads() FROM PUBLIC;
GRANT ALL ON FUNCTION public.purge_old_order_payloads() TO service_role;


--
-- Name: FUNCTION purge_old_sync_records(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.purge_old_sync_records() FROM PUBLIC;
GRANT ALL ON FUNCTION public.purge_old_sync_records() TO service_role;


--
-- Name: FUNCTION rebuild_tax_rate_periods(_account_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rebuild_tax_rate_periods(_account_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rebuild_tax_rate_periods(_account_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.rebuild_tax_rate_periods(_account_id uuid) TO service_role;


--
-- Name: FUNCTION recompute_sku_cost(_owner uuid, _sku text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.recompute_sku_cost(_owner uuid, _sku text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.recompute_sku_cost(_owner uuid, _sku text) TO authenticated;
GRANT ALL ON FUNCTION public.recompute_sku_cost(_owner uuid, _sku text) TO service_role;


--
-- Name: FUNCTION rental_by_city(_owner uuid, _year integer, _month integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rental_by_city(_owner uuid, _year integer, _month integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rental_by_city(_owner uuid, _year integer, _month integer) TO authenticated;
GRANT ALL ON FUNCTION public.rental_by_city(_owner uuid, _year integer, _month integer) TO service_role;


--
-- Name: FUNCTION rental_invoices_grouped(_owner uuid, _year integer, _month integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rental_invoices_grouped(_owner uuid, _year integer, _month integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rental_invoices_grouped(_owner uuid, _year integer, _month integer) TO authenticated;
GRANT ALL ON FUNCTION public.rental_invoices_grouped(_owner uuid, _year integer, _month integer) TO service_role;


--
-- Name: FUNCTION rental_monthly_total(_owner uuid, _year integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rental_monthly_total(_owner uuid, _year integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rental_monthly_total(_owner uuid, _year integer) TO authenticated;
GRANT ALL ON FUNCTION public.rental_monthly_total(_owner uuid, _year integer) TO service_role;


--
-- Name: FUNCTION reopen_installment(_owner uuid, _installment_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reopen_installment(_owner uuid, _installment_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reopen_installment(_owner uuid, _installment_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.reopen_installment(_owner uuid, _installment_id uuid) TO service_role;


--
-- Name: FUNCTION resolve_name_rule(_owner uuid, _text text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.resolve_name_rule(_owner uuid, _text text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resolve_name_rule(_owner uuid, _text text) TO authenticated;
GRANT ALL ON FUNCTION public.resolve_name_rule(_owner uuid, _text text) TO service_role;


--
-- Name: FUNCTION set_expense_range(_expense_id uuid, _from_month date, _to_month date, _amount numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_expense_range(_expense_id uuid, _from_month date, _to_month date, _amount numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_expense_range(_expense_id uuid, _from_month date, _to_month date, _amount numeric) TO authenticated;
GRANT ALL ON FUNCTION public.set_expense_range(_expense_id uuid, _from_month date, _to_month date, _amount numeric) TO service_role;


--
-- Name: FUNCTION set_faturamento_externo(_empresa_id uuid, _canal text, _month date, _valor numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_faturamento_externo(_empresa_id uuid, _canal text, _month date, _valor numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_faturamento_externo(_empresa_id uuid, _canal text, _month date, _valor numeric) TO authenticated;
GRANT ALL ON FUNCTION public.set_faturamento_externo(_empresa_id uuid, _canal text, _month date, _valor numeric) TO service_role;


--
-- Name: FUNCTION set_manual_sku_cost(_owner uuid, _sku text, _valor numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_manual_sku_cost(_owner uuid, _sku text, _valor numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_manual_sku_cost(_owner uuid, _sku text, _valor numeric) TO authenticated;
GRANT ALL ON FUNCTION public.set_manual_sku_cost(_owner uuid, _sku text, _valor numeric) TO service_role;


--
-- Name: FUNCTION set_sku_cost_travado(_owner uuid, _sku text, _valor numeric, _travar boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_sku_cost_travado(_owner uuid, _sku text, _valor numeric, _travar boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_sku_cost_travado(_owner uuid, _sku text, _valor numeric, _travar boolean) TO authenticated;
GRANT ALL ON FUNCTION public.set_sku_cost_travado(_owner uuid, _sku text, _valor numeric, _travar boolean) TO service_role;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_updated_at() TO service_role;


--
-- Name: FUNCTION sku_cost_history(_owner uuid, _sku text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sku_cost_history(_owner uuid, _sku text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sku_cost_history(_owner uuid, _sku text) TO authenticated;
GRANT ALL ON FUNCTION public.sku_cost_history(_owner uuid, _sku text) TO service_role;


--
-- Name: FUNCTION sku_custo_unit(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sku_custo_unit() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sku_custo_unit() TO authenticated;
GRANT ALL ON FUNCTION public.sku_custo_unit() TO service_role;


--
-- Name: FUNCTION sku_delete_impact(_sku text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sku_delete_impact(_sku text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sku_delete_impact(_sku text) TO authenticated;
GRANT ALL ON FUNCTION public.sku_delete_impact(_sku text) TO service_role;


--
-- Name: FUNCTION team_app_settings(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.team_app_settings() FROM PUBLIC;
GRANT ALL ON FUNCTION public.team_app_settings() TO authenticated;
GRANT ALL ON FUNCTION public.team_app_settings() TO service_role;


--
-- Name: FUNCTION team_owner(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.team_owner() FROM PUBLIC;
GRANT ALL ON FUNCTION public.team_owner() TO authenticated;
GRANT ALL ON FUNCTION public.team_owner() TO service_role;


--
-- Name: FUNCTION team_users(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.team_users() FROM PUBLIC;
GRANT ALL ON FUNCTION public.team_users() TO authenticated;
GRANT ALL ON FUNCTION public.team_users() TO service_role;


--
-- Name: FUNCTION telegram_ad_candidates(_owner_id uuid, _dias integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.telegram_ad_candidates(_owner_id uuid, _dias integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.telegram_ad_candidates(_owner_id uuid, _dias integer) TO authenticated;
GRANT ALL ON FUNCTION public.telegram_ad_candidates(_owner_id uuid, _dias integer) TO service_role;


--
-- Name: FUNCTION telegram_sale_candidates(_owner_id uuid, _since timestamp with time zone, _limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.telegram_sale_candidates(_owner_id uuid, _since timestamp with time zone, _limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.telegram_sale_candidates(_owner_id uuid, _since timestamp with time zone, _limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.telegram_sale_candidates(_owner_id uuid, _since timestamp with time zone, _limit integer) TO service_role;


--
-- Name: FUNCTION tornar_conta_recorrente(_owner uuid, _note_id uuid, _meses integer, _dia_vencimento integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.tornar_conta_recorrente(_owner uuid, _note_id uuid, _meses integer, _dia_vencimento integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.tornar_conta_recorrente(_owner uuid, _note_id uuid, _meses integer, _dia_vencimento integer) TO authenticated;
GRANT ALL ON FUNCTION public.tornar_conta_recorrente(_owner uuid, _note_id uuid, _meses integer, _dia_vencimento integer) TO service_role;


--
-- Name: FUNCTION update_cost_history(_id uuid, _valor numeric, _data date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_cost_history(_id uuid, _valor numeric, _data date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_cost_history(_id uuid, _valor numeric, _data date) TO authenticated;
GRANT ALL ON FUNCTION public.update_cost_history(_id uuid, _valor numeric, _data date) TO service_role;


--
-- Name: FUNCTION vault_get_secret(_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.vault_get_secret(_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.vault_get_secret(_id uuid) TO service_role;


--
-- Name: FUNCTION vault_set_secret(_name text, _secret text, _existing_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.vault_set_secret(_name text, _secret text, _existing_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.vault_set_secret(_name text, _secret text, _existing_id uuid) TO service_role;


--
-- Name: FUNCTION vencimentos_do_dia(_owner uuid, _dia date, _op text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.vencimentos_do_dia(_owner uuid, _dia date, _op text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.vencimentos_do_dia(_owner uuid, _dia date, _op text) TO authenticated;
GRANT ALL ON FUNCTION public.vencimentos_do_dia(_owner uuid, _dia date, _op text) TO service_role;


--
-- Name: FUNCTION vendas_sem_aliquota(_account_ids uuid[], _from date, _to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.vendas_sem_aliquota(_account_ids uuid[], _from date, _to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.vendas_sem_aliquota(_account_ids uuid[], _from date, _to date) TO authenticated;
GRANT ALL ON FUNCTION public.vendas_sem_aliquota(_account_ids uuid[], _from date, _to date) TO service_role;


--
-- Name: TABLE account_members; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.account_members TO authenticated;
GRANT ALL ON TABLE public.account_members TO service_role;


--
-- Name: COLUMN account_members.display_name; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(display_name) ON TABLE public.account_members TO authenticated;


--
-- Name: TABLE account_tax_rates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.account_tax_rates TO authenticated;
GRANT ALL ON TABLE public.account_tax_rates TO service_role;


--
-- Name: TABLE app_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.app_settings TO authenticated;
GRANT ALL ON TABLE public.app_settings TO service_role;


--
-- Name: TABLE audit_findings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.audit_findings TO authenticated;
GRANT ALL ON TABLE public.audit_findings TO service_role;


--
-- Name: TABLE billing_subtype_map; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.billing_subtype_map TO authenticated;
GRANT ALL ON TABLE public.billing_subtype_map TO service_role;


--
-- Name: TABLE card_invoice_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.card_invoice_items TO authenticated;
GRANT ALL ON TABLE public.card_invoice_items TO service_role;


--
-- Name: TABLE card_invoice_posted_rules; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.card_invoice_posted_rules TO service_role;


--
-- Name: TABLE card_invoice_postings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.card_invoice_postings TO service_role;


--
-- Name: TABLE card_invoices; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.card_invoices TO authenticated;
GRANT ALL ON TABLE public.card_invoices TO service_role;


--
-- Name: TABLE card_rules; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.card_rules TO authenticated;
GRANT ALL ON TABLE public.card_rules TO service_role;


--
-- Name: TABLE empresas; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.empresas TO authenticated;
GRANT ALL ON TABLE public.empresas TO service_role;


--
-- Name: TABLE expense_categories; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.expense_categories TO authenticated;
GRANT ALL ON TABLE public.expense_categories TO service_role;


--
-- Name: TABLE expense_name_rules; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.expense_name_rules TO authenticated;
GRANT ALL ON TABLE public.expense_name_rules TO service_role;


--
-- Name: TABLE expense_values; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.expense_values TO authenticated;
GRANT ALL ON TABLE public.expense_values TO service_role;


--
-- Name: TABLE expenses; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.expenses TO authenticated;
GRANT ALL ON TABLE public.expenses TO service_role;


--
-- Name: TABLE faturamento_externo; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.faturamento_externo TO authenticated;
GRANT ALL ON TABLE public.faturamento_externo TO service_role;


--
-- Name: TABLE kit_components; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.kit_components TO authenticated;
GRANT ALL ON TABLE public.kit_components TO service_role;


--
-- Name: TABLE marketplace_accounts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.marketplace_accounts TO authenticated;
GRANT ALL ON TABLE public.marketplace_accounts TO service_role;


--
-- Name: COLUMN marketplace_accounts.trade_name; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(trade_name) ON TABLE public.marketplace_accounts TO authenticated;


--
-- Name: COLUMN marketplace_accounts.cnpj; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(cnpj) ON TABLE public.marketplace_accounts TO authenticated;


--
-- Name: COLUMN marketplace_accounts.legal_name; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(legal_name) ON TABLE public.marketplace_accounts TO authenticated;


--
-- Name: COLUMN marketplace_accounts.tax_regime; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(tax_regime) ON TABLE public.marketplace_accounts TO authenticated;


--
-- Name: TABLE ml_ads_daily; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.ml_ads_daily TO authenticated;
GRANT ALL ON TABLE public.ml_ads_daily TO service_role;


--
-- Name: TABLE ml_billing_details; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.ml_billing_details TO authenticated;
GRANT ALL ON TABLE public.ml_billing_details TO service_role;


--
-- Name: TABLE ml_billing_norm; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ml_billing_norm TO authenticated;
GRANT ALL ON TABLE public.ml_billing_norm TO service_role;


--
-- Name: TABLE ml_billing_periods; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.ml_billing_periods TO authenticated;
GRANT ALL ON TABLE public.ml_billing_periods TO service_role;


--
-- Name: TABLE ml_order_items; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.ml_order_items TO authenticated;
GRANT ALL ON TABLE public.ml_order_items TO service_role;


--
-- Name: TABLE ml_orders; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.ml_orders TO authenticated;
GRANT ALL ON TABLE public.ml_orders TO service_role;


--
-- Name: TABLE ml_comissao_item; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ml_comissao_item TO authenticated;
GRANT ALL ON TABLE public.ml_comissao_item TO service_role;


--
-- Name: TABLE ml_items; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.ml_items TO authenticated;
GRANT ALL ON TABLE public.ml_items TO service_role;


--
-- Name: TABLE ml_visits_daily; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.ml_visits_daily TO authenticated;
GRANT ALL ON TABLE public.ml_visits_daily TO service_role;


--
-- Name: TABLE mp_payments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.mp_payments TO authenticated;
GRANT ALL ON TABLE public.mp_payments TO service_role;


--
-- Name: TABLE mp_payments_compras_reserva_20261013; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.mp_payments_compras_reserva_20261013 TO service_role;


--
-- Name: TABLE oauth_states; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.oauth_states TO authenticated;
GRANT ALL ON TABLE public.oauth_states TO service_role;


--
-- Name: TABLE operating_cost_entries; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.operating_cost_entries TO authenticated;
GRANT ALL ON TABLE public.operating_cost_entries TO service_role;


--
-- Name: TABLE operating_cost_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.operating_cost_items TO authenticated;
GRANT ALL ON TABLE public.operating_cost_items TO service_role;


--
-- Name: TABLE operating_costs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.operating_costs TO authenticated;
GRANT ALL ON TABLE public.operating_costs TO service_role;


--
-- Name: TABLE payable_installments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.payable_installments TO authenticated;
GRANT ALL ON TABLE public.payable_installments TO service_role;


--
-- Name: TABLE payable_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.payable_items TO authenticated;
GRANT ALL ON TABLE public.payable_items TO service_role;


--
-- Name: TABLE payable_notes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.payable_notes TO authenticated;
GRANT ALL ON TABLE public.payable_notes TO service_role;


--
-- Name: TABLE payable_recurrences; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.payable_recurrences TO authenticated;
GRANT ALL ON TABLE public.payable_recurrences TO service_role;


--
-- Name: TABLE product_cost_history; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.product_cost_history TO authenticated;
GRANT ALL ON TABLE public.product_cost_history TO service_role;


--
-- Name: TABLE product_skus; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.product_skus TO authenticated;
GRANT ALL ON TABLE public.product_skus TO service_role;


--
-- Name: TABLE rental_group_labels; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.rental_group_labels TO authenticated;
GRANT ALL ON TABLE public.rental_group_labels TO service_role;


--
-- Name: TABLE rental_invoices; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.rental_invoices TO authenticated;
GRANT ALL ON TABLE public.rental_invoices TO service_role;


--
-- Name: TABLE sku_item_links; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sku_item_links TO authenticated;
GRANT ALL ON TABLE public.sku_item_links TO service_role;


--
-- Name: TABLE sku_translation_rules; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sku_translation_rules TO authenticated;
GRANT ALL ON TABLE public.sku_translation_rules TO service_role;


--
-- Name: TABLE sync_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sync_jobs TO authenticated;
GRANT ALL ON TABLE public.sync_jobs TO service_role;


--
-- Name: TABLE sync_logs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.sync_logs TO authenticated;
GRANT ALL ON TABLE public.sync_logs TO service_role;


--
-- Name: TABLE telegram_ad_alert_state; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.telegram_ad_alert_state TO authenticated;
GRANT ALL ON TABLE public.telegram_ad_alert_state TO service_role;


--
-- Name: TABLE telegram_alert_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.telegram_alert_log TO authenticated;
GRANT ALL ON TABLE public.telegram_alert_log TO service_role;


--
-- Name: TABLE telegram_config; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.telegram_config TO authenticated;
GRANT ALL ON TABLE public.telegram_config TO service_role;


--
-- Name: TABLE user_screen_access; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_screen_access TO authenticated;
GRANT ALL ON TABLE public.user_screen_access TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- PostgreSQL database dump complete
--




-- ---------------------------------------------------------------------------
-- Armazenamento: balde privado "logos" (logo da empresa em Configurações).
-- Cada usuário grava só na pasta com o próprio id; qualquer logado lê.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public) VALUES ('logos', 'logos', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated read logos" ON storage.objects FOR SELECT TO authenticated
  USING ((bucket_id = 'logos'::text));
CREATE POLICY "Users upload own logos" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (((bucket_id = 'logos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
CREATE POLICY "Users update own logos" ON storage.objects FOR UPDATE TO authenticated
  USING (((bucket_id = 'logos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
CREATE POLICY "Users delete own logos" ON storage.objects FOR DELETE TO authenticated
  USING (((bucket_id = 'logos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));



-- ---------------------------------------------------------------------------
-- Classificação das cobranças do Mercado Livre (dado de referência, igual para toda conta).
-- Sem estas linhas a conciliação não sabe o que é comissão, frete, parcelamento ou publicidade.
-- ---------------------------------------------------------------------------
INSERT INTO public.billing_subtype_map (sub_type, category, label, escopo, em_sale_fee, conta_no_custo, observacao) VALUES
  ('BDLIT', 'ads', 'Cancelamento da tarifa por campanha de Publicidade de Seguidores', 'periodo', false, true, NULL),
  ('BPAD', 'ads', 'Anulacao do cargo de Product Ads', 'periodo', false, true, NULL),
  ('CDLIT', 'ads', 'Tarifa por campanha de Publicidade de Seguidores', 'periodo', false, true, NULL),
  ('PADS', 'ads', 'Tarifa por campanha Product Ads', 'periodo', false, true, NULL),
  ('BVVFN', 'comissao', 'Cancelamento da taxa de parcelamento', 'pedido', true, false, 'Ja contido em sale_fee'),
  ('BVVFNU', 'comissao', 'Cancelamento da taxa de recebimento', 'pedido', true, false, 'Ja contido em sale_fee'),
  ('BVVML', 'comissao', 'Cancelamento do custo por vender', 'pedido', true, false, 'Ja contido em sale_fee'),
  ('BVVPRC', 'comissao', 'Cancelamento do custo por cobrar', 'pedido', true, false, 'Ja contido em sale_fee'),
  ('CV', 'comissao', 'Tarifa de venda', 'pedido', true, false, 'Legado; tratado como comissao'),
  ('CVVFN', 'comissao', 'Taxa de parcelamento', 'pedido', true, false, 'Ja contido em sale_fee'),
  ('CVVFNU', 'comissao', 'Taxa de recebimento', 'pedido', true, false, 'Ja contido em sale_fee'),
  ('CVVML', 'comissao', 'Custo por vender no Mercado Livre', 'pedido', true, false, 'Ja contido em ml_order_items.sale_fee'),
  ('CVVPRC', 'comissao', 'Custo por cobrar no Mercado Pago', 'pedido', true, false, 'Ja contido em sale_fee'),
  ('CDSDB', 'estorno', 'Tarifa de devolução', 'pedido', false, true, NULL),
  ('CXDED', 'estorno', 'Tarifa de devolucao por envio externo', 'pedido', false, true, NULL),
  ('BDSB', 'frete', 'Cancelamento da tarifa do Mercado Envios', 'pedido', false, true, NULL),
  ('BFFE', 'frete', 'Cancelamento da tarifa de envio extra', 'pedido', false, true, NULL),
  ('BFFI', 'frete', 'Cancelamento da tarifa de envio interno', 'pedido', false, true, NULL),
  ('BXDE', 'frete', 'Cancelamento da tarifa de envio extra', 'pedido', false, true, NULL),
  ('CDSB', 'frete', 'Tarifa do Mercado Envios', 'pedido', false, true, NULL),
  ('CFBA', 'frete', 'Tarifa de envio', 'pedido', false, true, 'Sem ocorrencia na base ate agora'),
  ('CFFE', 'frete', 'Tarifa de envio extra ou intermunicipal', 'pedido', false, true, NULL),
  ('CFFI', 'frete', 'Tarifa por envio interno ao municipio', 'pedido', false, true, NULL),
  ('CXDE', 'frete', 'Tarifa de envio extra ou intermunicipal', 'pedido', false, true, 'Reclassificado de devolucao para frete'),
  ('CFCBE', 'full', 'Custo do servico de coleta Full', 'periodo', false, true, NULL),
  ('CFPB', 'full', 'Custo por inconformidade no Envios Full', 'periodo', false, true, NULL),
  ('CFRS', 'full', 'Tarifa de envio', 'periodo', false, true, 'Sem ocorrencia na base ate agora'),
  ('CFWA', 'full', 'Tarifa de armazenamento Full', 'periodo', false, true, NULL),
  ('BESM', 'outros', 'Cancelamento da tarifa da Minha pagina', 'periodo', false, true, NULL),
  ('CDIFAL', 'outros', 'Cobrança do diferencial de alíquota interestadual (ICMS-DIFAL)', 'periodo', false, true, NULL),
  ('CESM', 'outros', 'Tarifa de manutencao da Minha pagina', 'periodo', false, true, NULL),
  ('CSTP', 'outros', 'Garantia do Programa Decola', 'periodo', false, true, NULL),
  ('CVAF', 'outros', 'Cargo por venda com afiliados', 'pedido', false, true, NULL),
  ('BFONPN', 'parcelamento', 'Cancelamento do acrescimo de parcelamento', 'pedido', false, false, 'Repasse neutro'),
  ('CFONPN', 'parcelamento', 'Acrescimo de parcelamento pago pelo comprador', 'pedido', false, false, 'Repasse: comprador paga o acrescimo e o ML cobra do vendedor. Neutro na margem quando a receita usa transaction_amount')
ON CONFLICT (sub_type) DO NOTHING;



-- ---------------------------------------------------------------------------
-- Instalação: três funções que só existem na base (não vêm do banco de origem).
-- Todas fechadas para o navegador: só o servidor (service_role) e o SQL Editor rodam.
-- ---------------------------------------------------------------------------

-- 1. Primeiro dono. O usuário é criado antes no painel do Supabase
--    (Authentication > Add user); aqui ele vira dono da equipe e administrador.
--    Só funciona enquanto não existe dono: depois disso, usuários entram pela tela do sistema.
CREATE FUNCTION public.definir_primeiro_dono(_email text, _nome text DEFAULT NULL) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
DECLARE
  v_id uuid;
  v_dono uuid;
BEGIN
  SELECT id INTO v_id FROM auth.users WHERE lower(email) = lower(btrim(_email));
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Usuário % não existe. Crie primeiro em Authentication > Add user, no painel do Supabase.', _email;
  END IF;
  SELECT root_owner_id INTO v_dono FROM public.account_members LIMIT 1;
  IF v_dono IS NOT NULL AND v_dono <> v_id THEN
    RAISE EXCEPTION 'Já existe um dono da equipe. Novos usuários são criados em Configurações > Usuários.';
  END IF;
  INSERT INTO public.account_members (root_owner_id, member_id, display_name)
  VALUES (v_id, v_id, COALESCE(NULLIF(btrim(_nome), ''), split_part(_email, '@', 1)))
  ON CONFLICT (member_id) DO NOTHING;
  RETURN v_id;
END;
$$;

-- 2. Endereço do app e segredo do agendador ficam no cofre, nunca em arquivo.
--    O mesmo segredo vai para o Worker (wrangler secret put ML_CRON_SECRET).
CREATE FUNCTION public.configurar_agendador(_endereco_app text, _segredo text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
BEGIN
  IF _endereco_app !~ '^https://[^/]+$' THEN
    RAISE EXCEPTION 'Endereço inválido: use https://... sem barra no final (recebido: %)', _endereco_app;
  END IF;
  IF _segredo IS NULL OR length(_segredo) < 32 THEN
    RAISE EXCEPTION 'Segredo curto demais: use ao menos 32 caracteres aleatórios.';
  END IF;
  PERFORM public.vault_set_secret('app_base_url', _endereco_app,
    (SELECT id FROM vault.secrets WHERE name = 'app_base_url' LIMIT 1));
  PERFORM public.vault_set_secret('ml_cron_secret', _segredo,
    (SELECT id FROM vault.secrets WHERE name = 'ml_cron_secret' LIMIT 1));
END;
$$;

-- 3. O que cada agendamento roda. Enquanto o cofre não tiver endereço e segredo,
--    não chama nada: o banco recém-instalado fica quieto até a configuração.
CREATE FUNCTION public.chamar_gancho(_gancho text, _corpo jsonb DEFAULT '{}'::jsonb, _timeout_ms integer DEFAULT 120000) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'vault', 'net'
    AS $$
DECLARE
  v_base text;
  v_segredo text;
BEGIN
  SELECT decrypted_secret INTO v_base FROM vault.decrypted_secrets WHERE name = 'app_base_url' LIMIT 1;
  SELECT decrypted_secret INTO v_segredo FROM vault.decrypted_secrets WHERE name = 'ml_cron_secret' LIMIT 1;
  IF v_base IS NULL OR v_segredo IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN net.http_post(
    url := v_base || '/api/public/hooks/' || _gancho,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_segredo),
    body := _corpo,
    timeout_milliseconds := _timeout_ms);
END;
$$;

REVOKE ALL ON FUNCTION public.definir_primeiro_dono(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.configurar_agendador(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chamar_gancho(text, jsonb, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.definir_primeiro_dono(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.configurar_agendador(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.chamar_gancho(text, jsonb, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- Agendamentos (horários em UTC). Mesma grade do sistema de origem.
-- ---------------------------------------------------------------------------
SELECT cron.schedule(j.nome, j.quando, format('select public.chamar_gancho(%L, %L::jsonb, %s)', j.gancho, j.corpo, j.timeout))
FROM (VALUES
  ('ml-worker-5min',       '*/5 * * * *',  'ml-worker',           '{}',               170000),
  ('ml-token-refresh',     '17 * * * *',   'ml-refresh',          '{}',               60000),
  ('ml-audit-daily',       '30 6 * * *',   'ml-audit',            '{}',               170000),
  ('ml-sync-today',        '7 * * * *',    'ml-sync-today',       '{}',               120000),
  -- Cancelamentos e devoluções tardias: reconsulta 30 dias de madrugada e 7 dias a cada 3 horas.
  ('ml-recheck-30d',       '40 5 * * *',   'ml-sync-today',       '{"dias":30}',      120000),
  ('ml-recheck-7d-3h',     '25 */3 * * *', 'ml-sync-today',       '{"dias":7}',       120000),
  ('mp-refresh-releases',  '50 5 * * *',   'mp-refresh-releases', '{}',               170000),
  ('telegram-alerts-5min', '*/5 * * * *',  'telegram-alerts',     '{"mode":"sales"}', 120000),
  ('telegram-alerts-daily','0 10 * * *',   'telegram-alerts',     '{"mode":"daily"}', 170000)
) AS j(nome, quando, gancho, corpo, timeout);

-- Telegram nasce desligado: sem bot configurado os dois jobs só acordariam o app.
-- Para ligar depois: select cron.alter_job(jobid, active := true) from cron.job where jobname like 'telegram-alerts-%';
SELECT cron.alter_job(jobid, active := false) FROM cron.job WHERE jobname LIKE 'telegram-alerts-%';

-- Limpezas semanais, domingo de madrugada (UTC), dentro do próprio banco.
SELECT cron.schedule('limpeza-registros-semanal', '0 4 * * 0', 'select public.purge_old_sync_records()');
SELECT cron.schedule('limpeza-historico-agendador', '15 4 * * 0',
  $cmd$delete from cron.job_run_details where end_time < now() - interval '7 days'$cmd$);
