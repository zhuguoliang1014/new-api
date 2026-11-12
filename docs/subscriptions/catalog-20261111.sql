\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT id FROM subscription_plans ORDER BY id FOR UPDATE;
CREATE TEMP TABLE catalog_before ON COMMIT DROP AS SELECT id,to_jsonb(p) row FROM subscription_plans p;
CREATE TEMP TABLE catalog_subscriptions_before ON COMMIT DROP AS SELECT id,to_jsonb(s)-'plan_snapshot' row FROM user_subscriptions s;
CREATE TEMP TABLE catalog_orders_before ON COMMIT DROP AS SELECT id,to_jsonb(o)-'plan_snapshot' row FROM subscription_orders o;
UPDATE user_subscriptions s SET plan_snapshot=to_jsonb(p)::text FROM subscription_plans p
 WHERE s.plan_id=p.id AND (s.plan_snapshot IS NULL OR s.plan_snapshot='');
UPDATE subscription_orders o SET plan_snapshot=to_jsonb(p)::text FROM subscription_plans p
 WHERE o.plan_id=p.id AND (o.plan_snapshot IS NULL OR o.plan_snapshot='');
DO $guard$
BEGIN
 IF EXISTS(SELECT 1 FROM user_subscriptions WHERE (status='frozen' OR (status='active' AND end_time>extract(epoch FROM now()))) AND COALESCE(plan_snapshot,'')='') THEN RAISE EXCEPTION 'Missing snapshot for a valid subscription'; END IF;
 IF EXISTS(SELECT 1 FROM subscription_orders WHERE COALESCE(plan_snapshot,'')='') THEN RAISE EXCEPTION 'Missing order snapshot'; END IF;
 IF EXISTS(SELECT 1 FROM subscription_plans WHERE id>37) THEN RAISE EXCEPTION 'Catalog changed; inspect new products before migration'; END IF;
 IF (SELECT count(*) FROM subscription_plans WHERE enabled)<>7 THEN RAISE EXCEPTION 'Enabled catalog changed'; END IF;
END $guard$;
-- Existing sale products remain byte-for-byte unchanged. Disabled legacy
-- products are removed; purchased records and pending checkouts keep snapshots.
DELETE FROM subscription_plans WHERE NOT enabled;
CREATE TEMP TABLE new_catalog_plans ON COMMIT DROP AS
SELECT title,price,rate,sort_order,limited_sale,
       trunc(price/rate,6) usd_quota,
       floor(trunc(price/rate,6)*500000)::bigint total_quota
FROM (VALUES
 ('启航版',49::numeric,0.29::numeric,104,false),
 ('逐光版',99::numeric,0.28::numeric,105,false),
 ('凌云版',199::numeric,0.27::numeric,103,false),
 ('苍穹版',399::numeric,0.26::numeric,102,false),
 ('星瀚版',999::numeric,0.23::numeric,101,true)
) AS v(title,price,rate,sort_order,limited_sale);
INSERT INTO subscription_plans(title,subtitle,price_amount,price_cny,currency,duration_unit,duration_value,custom_seconds,enabled,sort_order,
 allow_balance_pay,allow_wallet_overflow,stripe_price_id,creem_product_id,waffo_pancake_product_id,max_purchase_per_user,sales_limit,limited_sale,
 allowed_channel_types,billing_ratio,upgrade_group,downgrade_group,total_amount,quota_reset_period,quota_reset_custom_seconds,
 starts_at,expires_at,display_sold_count,discount_rate,discount_starts_at,discount_ends_at,minimum_effective_ratio,created_at,updated_at)
SELECT title,'GPT 专属月卡',usd_quota,price,'USD','month',1,0,false,sort_order,
 false,true,'','','',0,0,limited_sale,'1',1,'vip','',total_quota,'never',0,
 0,0,0,1,0,0,0.18,extract(epoch FROM now())::bigint,extract(epoch FROM now())::bigint
FROM new_catalog_plans ORDER BY sort_order DESC;
DO $verify$
BEGIN
 IF EXISTS (SELECT 1 FROM catalog_before b LEFT JOIN subscription_plans p ON p.id=b.id WHERE (b.row->>'enabled')::boolean AND (p.id IS NULL OR b.row<>to_jsonb(p))) THEN RAISE EXCEPTION 'Enabled product was modified'; END IF;
 IF EXISTS (SELECT 1 FROM catalog_subscriptions_before b LEFT JOIN user_subscriptions s ON s.id=b.id WHERE s.id IS NULL OR b.row<>to_jsonb(s)-'plan_snapshot') THEN RAISE EXCEPTION 'Purchased subscription was changed'; END IF;
 IF EXISTS (SELECT 1 FROM catalog_orders_before b LEFT JOIN subscription_orders o ON o.id=b.id WHERE o.id IS NULL OR b.row<>to_jsonb(o)-'plan_snapshot') THEN RAISE EXCEPTION 'Existing order was changed'; END IF;
 IF (SELECT count(*) FROM subscription_plans WHERE NOT enabled)<>5 OR (SELECT count(*) FROM subscription_plans)<>12 THEN RAISE EXCEPTION 'Unexpected catalog size'; END IF;
 IF EXISTS (SELECT 1 FROM subscription_plans WHERE NOT enabled AND (max_purchase_per_user<>0 OR allowed_channel_types<>'1' OR duration_unit<>'month' OR duration_value<>1 OR quota_reset_period<>'never' OR discount_rate<>1 OR discount_starts_at<>0 OR discount_ends_at<>0 OR starts_at<>0 OR expires_at<>0 OR sales_limit<>0 OR display_sold_count<>0 OR minimum_effective_ratio<>0.18)) THEN RAISE EXCEPTION 'New catalog constraints are incorrect'; END IF;
 IF (SELECT count(*) FROM subscription_plans WHERE NOT enabled AND limited_sale)<>1 THEN RAISE EXCEPTION 'Expected one zero-stock limited plan'; END IF;
END $verify$;
SELECT json_build_object('id',p.id,'title',p.title,'enabled',p.enabled,'price_cny',p.price_cny,'usd_quota',p.price_amount,'total_amount',p.total_amount,'regular_effective_ratio',p.price_cny*500000/p.total_amount,'effective_ratio_at_20pct_off',p.price_cny*0.8*500000/p.total_amount,'limited_sale',p.limited_sale,'sales_limit',p.sales_limit) FROM subscription_plans p WHERE NOT enabled ORDER BY sort_order DESC;
\if :commit_changes
COMMIT;
\else
ROLLBACK;
\endif
