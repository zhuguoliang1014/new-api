#!/usr/bin/env python3
"""Read-only production inventory; emit a reviewed, guarded migration transaction.

The generated transaction is for a maintenance window AFTER the gift-wallet
release. This program never applies it or changes the reward automations.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import subprocess

GIFT = 2_500_000
LIFETIME = 30 * 86400


def inventory_sql(as_of, registered_as_of=None):
    if registered_as_of is None:
        registered_as_of = as_of
    return f"""
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
WITH registered AS (
 SELECT u.id,u.quota,u.used_quota,u.created_at,u.status,u.role,u.deleted_at
 FROM users u JOIN user_oauth_bindings b ON b.user_id=u.id
 JOIN custom_oauth_providers p ON p.id=b.provider_id AND p.slug='yaohuo'
 CROSS JOIN LATERAL (
   SELECT a.created_at,a.other::jsonb->>'login_method' AS method
   FROM audit_logs a WHERE a.user_id=u.id AND a.category='login' AND a.success
   ORDER BY a.created_at,a.id LIMIT 1
 ) login
 WHERE u.created_at BETWEEN {registered_as_of - 10 * 86400} AND {registered_as_of}
 AND extract(epoch from b.created_at) BETWEEN u.created_at AND u.created_at+3
 AND login.method='oauth:yaohuo' AND login.created_at BETWEEN u.created_at AND u.created_at+30
), evidence AS (
 SELECT u.*,r.claim_id,r.quota AS receipt_quota,
   floor(extract(epoch from r.created_at))::bigint AS receipt_time,
   credits.manual_grants,credits.manual_log_id,credits.manual_time,
   coalesce(credits.receipt_linked_changes,0) AS receipt_linked_changes,
   coalesce(credits.other_credits,0) AS other_credits,
   coalesce(credits.manual_changes,0) AS manual_changes,
   coalesce(credits.manual_amount,0) AS manual_amount,
   coalesce(credits.balance_purchases,0) AS balance_purchases,
   coalesce(credits.generic_signup_bonus,0) AS generic_signup_bonus
 FROM registered u LEFT JOIN oauth_signup_rewards r ON r.user_id=u.id
 LEFT JOIN LATERAL (
  SELECT count(*) FILTER (WHERE type=1 AND NULLIF(other,'')::jsonb#>>'{{op,action}}'='user.quota_add'
    AND NULLIF(other,'')::jsonb#>>'{{op,params,quota}}'='{GIFT}') AS manual_grants,
    min(id) FILTER (WHERE type=1 AND NULLIF(other,'')::jsonb#>>'{{op,action}}'='user.quota_add'
      AND NULLIF(other,'')::jsonb#>>'{{op,params,quota}}'='{GIFT}') AS manual_log_id,
    min(created_at) FILTER (WHERE type=1 AND NULLIF(other,'')::jsonb#>>'{{op,action}}'='user.quota_add'
      AND NULLIF(other,'')::jsonb#>>'{{op,params,quota}}'='{GIFT}') AS manual_time,
    count(*) FILTER (WHERE NULLIF(other,'')::jsonb#>>'{{op,action}}' IN ('user.quota_add','user.quota_subtract','user.quota_override')) AS manual_changes,
    coalesce(sum(CASE WHEN NULLIF(other,'')::jsonb#>>'{{op,action}}' IN ('user.quota_add','user.quota_subtract','user.quota_override')
     AND NULLIF(other,'')::jsonb#>>'{{op,params,from}}' ~ '^-?[0-9]+$'
     AND NULLIF(other,'')::jsonb#>>'{{op,params,to}}' ~ '^-?[0-9]+$'
     THEN (NULLIF(other,'')::jsonb#>>'{{op,params,to}}')::bigint-(NULLIF(other,'')::jsonb#>>'{{op,params,from}}')::bigint ELSE 0 END),0) AS manual_amount,
    count(*) FILTER (WHERE NULLIF(other,'')::jsonb#>>'{{op,action}}'='user.quota_add'
      AND NULLIF(other,'')::jsonb#>>'{{op,params,quota}}'='{GIFT}'
      AND (request_id=r.claim_id OR NULLIF(other,'')::jsonb#>>'{{op,params,claim_id}}'=r.claim_id)) AS receipt_linked_changes,
    count(*) FILTER (WHERE type=1 AND coalesce(NULLIF(other,'')::jsonb#>>'{{op,action}}','')<>'user.quota_add') AS other_credits,
    count(*) FILTER (WHERE type=1 AND content LIKE 'Subscription purchased with balance%') AS balance_purchases,
    count(*) FILTER (WHERE type=4 AND (content LIKE 'New user sign-up bonus%' OR content LIKE 'Invitation code bonus%')) AS generic_signup_bonus
  FROM logs WHERE user_id=u.id AND type IN(1,3,4) AND created_at<={as_of}
 ) credits ON true
), grants AS (
 SELECT *,CASE WHEN receipt_quota={GIFT} THEN receipt_time ELSE manual_time END AS granted_at,
 CASE WHEN receipt_quota={GIFT} THEN 'receipt:'||claim_id ELSE 'admin-log:'||manual_log_id END AS evidence_reference
 FROM evidence
), reviewed AS (
 SELECT g.*,coalesce(usage.wallet_consumed,0) AS wallet_consumed,
   coalesce(usage.refund_count,0) AS refund_count,
   (SELECT count(*) FROM top_ups t WHERE t.user_id=g.id AND t.money>0 AND t.status='success' AND t.payment_method<>'balance') AS paid_orders,
   (SELECT count(*) FROM tasks t WHERE t.user_id=g.id AND t.status NOT IN ('SUCCESS','FAILURE') AND t.quota>0) AS active_paid_tasks
 FROM grants g LEFT JOIN LATERAL (
   SELECT sum(CASE WHEN type=2 THEN quota ELSE -quota END) AS wallet_consumed,
   count(*) FILTER(WHERE type=6) AS refund_count
   FROM logs WHERE user_id=g.id AND type IN(2,6) AND created_at>=g.granted_at AND created_at<={as_of}
   AND coalesce(NULLIF(other,'')::jsonb->>'billing_source','wallet')<>'subscription'
 ) usage ON true
)
SELECT row_to_json(x) FROM (
 SELECT id,quota,used_quota,created_at,status,role,deleted_at,receipt_quota,claim_id,
 manual_grants,manual_changes,manual_amount,receipt_linked_changes,other_credits,balance_purchases,generic_signup_bonus,
 granted_at,evidence_reference,wallet_consumed,refund_count,paid_orders,active_paid_tasks,
 (SELECT coalesce(max(id),0) FROM logs WHERE user_id=reviewed.id) AS latest_log_id
 FROM reviewed ORDER BY id
) x;
COMMIT;
"""


def review(row):
    row = dict(row)
    reason = None
    if row['deleted_at'] is not None:
        reason = 'deleted_account'
    elif row['granted_at'] is None:
        reason = 'no_gift_was_granted'
    elif row['receipt_quota'] not in (None, GIFT):
        reason = 'unexpected_receipt_amount'
    elif row['receipt_quota'] is None and row['manual_grants'] != 1:
        reason = 'ambiguous_manual_gifts'
    elif row['manual_changes'] != (row['receipt_linked_changes'] if row['receipt_quota'] == GIFT else row['manual_grants']) or row['manual_grants'] > 1:
        reason = 'additional_manual_balance_changes'
    elif row['balance_purchases'] or row['generic_signup_bonus']:
        reason = 'other_wallet_movements_need_reconstruction'
    elif row['refund_count']:
        reason = 'refunds_need_original_charge_review'
    elif row['active_paid_tasks']:
        reason = 'active_tasks_must_settle_before_migration'
    elif row['wallet_consumed'] < 0:
        reason = 'negative_net_wallet_usage'
    remaining = max(0, GIFT - row['wallet_consumed'])
    remaining_source = 'original_grant_less_logged_wallet_usage'
    if reason is None and remaining > max(0, row['quota']):
        if row['quota'] <= 0:
            remaining = 0
            remaining_source = 'actual_wallet_exhausted'
        elif row['paid_orders'] == 0 and row['other_credits'] == 0:
            # The gift was the only credit. Preserve the actual smaller wallet;
            # missing historical funds must never be recreated by migration.
            remaining = max(0, row['quota'])
            remaining_source = 'actual_wallet_cap_without_other_credits'
        else:
            reason = 'remaining_gift_exceeds_current_balance'
    row.update(
        disposition='migrate' if reason is None else 'skip',
        reason=reason,
        remaining_source=remaining_source,
        granted=GIFT if row['granted_at'] is not None else 0,
        remaining=remaining if row['granted_at'] is not None else 0,
        expires_at=row['granted_at'] + LIFETIME if row['granted_at'] is not None else None,
    )
    return row


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def migration_sql(rows, as_of):
    eligible = [row for row in rows if row['disposition'] == 'migrate']
    if not eligible:
        raise ValueError('No reviewed gift grants to migrate')
    values = ',\n'.join(
        f"({r['id']},{r['quota']},{r['latest_log_id']},{r['granted']},{r['remaining']},"
        f"{r['granted_at']},{r['expires_at']},{quote('yaohuo-legacy:' + r['evidence_reference'])})"
        for r in eligible
    )
    return f"""-- Generated from read-only evidence at {dt.datetime.fromtimestamp(as_of,dt.timezone.utc).isoformat()}.
-- After release: pause the two award automations and drain/stop the application
-- so there are no in-flight charges/refunds. Back up the database and verify it.
-- Review the manifest SHA-256 before executing with psql -v ON_ERROR_STOP=1.
-- A stale wallet or new log refuses the whole transaction; regenerate the plan.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE TEMP TABLE gift_migration_plan (
 user_id bigint PRIMARY KEY,expected_quota bigint,latest_log_id bigint,
 granted bigint,remaining bigint,granted_at bigint,expires_at bigint,reference varchar(128)
) ON COMMIT DROP;
INSERT INTO gift_migration_plan VALUES
{values};
SELECT u.id FROM users u JOIN gift_migration_plan p ON p.user_id=u.id ORDER BY u.id FOR UPDATE OF u;
DO $guard$
BEGIN
 IF to_regclass('gift_quotas') IS NULL THEN RAISE EXCEPTION 'gift wallet release is not installed'; END IF;
 IF (SELECT count(*) FROM users u JOIN gift_migration_plan p ON p.user_id=u.id WHERE u.deleted_at IS NULL)<>{len(eligible)} THEN RAISE EXCEPTION 'candidate accounts changed'; END IF;
 IF EXISTS(SELECT 1 FROM users u JOIN gift_migration_plan p ON p.user_id=u.id
   WHERE u.quota<>p.expected_quota OR u.gift_wallet_enabled
     OR (SELECT coalesce(max(id),0) FROM logs WHERE user_id=u.id)<>p.latest_log_id)
 THEN RAISE EXCEPTION 'wallet or evidence changed; regenerate and review the plan'; END IF;
 IF EXISTS(SELECT 1 FROM gift_quotas g JOIN gift_migration_plan p ON p.user_id=g.user_id OR p.reference=g.reference)
 THEN RAISE EXCEPTION 'existing gift wallet requires individual reconciliation'; END IF;
 IF EXISTS(SELECT 1 FROM gift_migration_plan WHERE granted<remaining OR remaining<0 OR remaining>greatest(0,expected_quota)
   OR expires_at<extract(epoch from now()) OR granted_at>{as_of} OR expires_at<>granted_at+{LIFETIME})
 THEN RAISE EXCEPTION 'invalid or expired migration plan'; END IF;
END $guard$;
INSERT INTO gift_quotas(user_id,source,reference,granted,remaining,expired,granted_at,expires_at,expired_at)
 SELECT user_id,'yaohuo_migration',reference,granted,remaining,0,granted_at,expires_at,0 FROM gift_migration_plan;
-- Reclassification changes no user's total funds, usage, or paid-order history.
UPDATE users SET gift_wallet_enabled=true WHERE id IN(SELECT user_id FROM gift_migration_plan);
DO $verify$
BEGIN
 IF EXISTS(SELECT 1 FROM gift_migration_plan p JOIN users u ON u.id=p.user_id
   JOIN gift_quotas g ON g.reference=p.reference
   WHERE u.quota<>p.expected_quota OR g.remaining<>p.remaining OR g.granted<>p.granted
     OR g.expires_at<>p.expires_at OR NOT u.gift_wallet_enabled)
 THEN RAISE EXCEPTION 'migration verification failed'; END IF;
END $verify$;
SELECT count(*) AS migrated_accounts,sum(p.granted) AS original_gifts,
 sum(p.remaining) AS remaining_gifts,sum(u.quota-p.remaining) AS permanent_balance
 FROM gift_migration_plan p JOIN users u ON u.id=p.user_id;
COMMIT;
"""


def rollback_sql(rows):
    selected = [r for r in rows if r['disposition'] == 'migrate']
    values = ',\n'.join(
        f"({r['id']},{r['quota']},{r['latest_log_id']},{r['granted']},{r['remaining']},"
        f"{r['granted_at']},{r['expires_at']},{quote('yaohuo-legacy:' + r['evidence_reference'])})"
        for r in selected
    )
    return f"""-- Reverse only this reclassification, before any wallet activity.
-- Never use this to undo spending or expiry after release; it refuses changed rows.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE TEMP TABLE gift_migration_rollback (
 user_id bigint PRIMARY KEY,expected_quota bigint,latest_log_id bigint,
 granted bigint,remaining bigint,granted_at bigint,expires_at bigint,reference varchar(128)
) ON COMMIT DROP;
INSERT INTO gift_migration_rollback VALUES
{values};
SELECT u.id FROM users u JOIN gift_migration_rollback p ON p.user_id=u.id ORDER BY u.id FOR UPDATE OF u;
DO $guard$
BEGIN
 IF (SELECT count(*) FROM gift_quotas g JOIN gift_migration_rollback p ON p.reference=g.reference)<>{len(selected)}
 THEN RAISE EXCEPTION 'migration records changed'; END IF;
 IF EXISTS(SELECT 1 FROM users u JOIN gift_migration_rollback p ON p.user_id=u.id
   JOIN gift_quotas g ON g.reference=p.reference
   WHERE u.quota<>p.expected_quota OR NOT u.gift_wallet_enabled OR g.user_id<>p.user_id
     OR g.source<>'yaohuo_migration' OR g.remaining<>p.remaining OR g.granted<>p.granted
     OR g.granted_at<>p.granted_at OR g.expires_at<>p.expires_at OR g.expired<>0 OR g.expired_at<>0
     OR (SELECT count(*) FROM gift_quotas WHERE user_id=u.id)<>1
     OR EXISTS(SELECT 1 FROM wallet_gift_allocations WHERE user_id=u.id)
     OR (SELECT coalesce(max(id),0) FROM logs WHERE user_id=u.id)<>p.latest_log_id)
 THEN RAISE EXCEPTION 'wallet activity after migration; rollback refused'; END IF;
END $guard$;
UPDATE users SET gift_wallet_enabled=false WHERE id IN(SELECT user_id FROM gift_migration_rollback);
DELETE FROM gift_quotas WHERE reference IN(SELECT reference FROM gift_migration_rollback);
COMMIT;
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--as-of', help='ISO-8601 with timezone; defaults to current time')
    parser.add_argument('--registered-as-of', help='Freeze the approved 10-day registration cohort while refreshing current balances')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--host', default='aiproxy-hk')
    args = parser.parse_args()
    moment = dt.datetime.fromisoformat(args.as_of) if args.as_of else dt.datetime.now(dt.timezone.utc)
    if moment.tzinfo is None:
        parser.error('--as-of must include a timezone')
    as_of = int(moment.timestamp())
    cohort_moment = dt.datetime.fromisoformat(args.registered_as_of) if args.registered_as_of else moment
    if cohort_moment.tzinfo is None or cohort_moment > moment:
        parser.error('--registered-as-of must include a timezone and cannot follow --as-of')
    registered_as_of = int(cohort_moment.timestamp())
    args.output.mkdir(parents=True, exist_ok=False, mode=0o700)
    os.chmod(args.output,0o700)
    result = subprocess.run(
        ['ssh',args.host,'docker exec -i postgres psql -X -U root -d new-api -At -v ON_ERROR_STOP=1'],
        input=inventory_sql(as_of, registered_as_of),text=True,capture_output=True,check=True,
    )
    rows = [review(json.loads(line)) for line in result.stdout.splitlines() if line.startswith('{')]
    selected = [r for r in rows if r['disposition']=='migrate']
    summary = {
        'as_of':moment.isoformat(),'registered_as_of':cohort_moment.isoformat(),'window_days':10,'registered_accounts':len(rows),
        'migrate_accounts':len(selected),'original_gift_quota':sum(r['granted'] for r in selected),
        'remaining_gift_quota':sum(r['remaining'] for r in selected),
        'with_paid_orders':sum(bool(r['paid_orders']) for r in selected),
        'skip_reasons':{reason:sum(r['reason']==reason for r in rows) for reason in sorted({r['reason'] for r in rows if r['reason']})},
        'production_changes_applied':False,
    }
    manifest={'summary':summary,'accounts':rows}
    for filename,content in [
        ('manifest.json',json.dumps(manifest,ensure_ascii=False,indent=2)+'\n'),
        ('apply.sql',migration_sql(rows,as_of)),
        ('rollback.sql',rollback_sql(rows)),
        ('inventory.sql',inventory_sql(as_of,registered_as_of)),
    ]:
        path=args.output/filename
        path.write_text(content)
        os.chmod(path,0o600)
    hashes=''.join(f"{hashlib.sha256((args.output/name).read_bytes()).hexdigest()}  {name}\n" for name in ['manifest.json','apply.sql','rollback.sql','inventory.sql'])
    (args.output/'SHA256SUMS').write_text(hashes)
    os.chmod(args.output/'SHA256SUMS',0o600)
    print(json.dumps(summary,ensure_ascii=False,indent=2))


if __name__=='__main__':
    main()
