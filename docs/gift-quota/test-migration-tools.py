#!/usr/bin/env python3
"""Validate migration review and generated SQL against an isolated local PG schema."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import unittest

MODULE=Path(__file__).with_name('prepare-yaohuo-migration.py')
spec=importlib.util.spec_from_file_location('gift_migration',MODULE)
migration=importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


def account(**updates):
    row=dict(id=1,quota=4000000,used_quota=1000000,created_at=1794000000,status=1,role=1,deleted_at=None,receipt_quota=2500000,claim_id='receipt',manual_grants=0,manual_changes=0,manual_amount=0,receipt_linked_changes=0,other_credits=0,balance_purchases=0,generic_signup_bonus=0,granted_at=1794000000,evidence_reference='receipt:receipt',wallet_consumed=1000000,refund_count=0,paid_orders=1,active_paid_tasks=0,latest_log_id=100)
    row.update(updates)
    return row


class ReviewTests(unittest.TestCase):
    def test_paid_and_gift_split(self):
        row=migration.review(account())
        self.assertEqual(row['remaining'],1500000)
        self.assertEqual(row['disposition'],'migrate')
        self.assertEqual(row['expires_at'],row['granted_at']+30*86400)

    def test_receipt_linked_manual_log_is_not_a_second_gift(self):
        row=migration.review(account(manual_changes=1,receipt_linked_changes=1,manual_amount=2500000))
        self.assertEqual(row['disposition'],'migrate')

    def test_only_gift_wallet_actual_balance_caps_legacy_log_drift(self):
        row=migration.review(account(quota=946,paid_orders=0,wallet_consumed=2495884))
        self.assertEqual(row['remaining'],946)
        self.assertEqual(row['disposition'],'migrate')

    def test_exhausted_gift_is_recorded_without_refilling_debt(self):
        row=migration.review(account(quota=-511,wallet_consumed=2463522))
        self.assertEqual(row['remaining'],0)
        self.assertEqual(row['disposition'],'migrate')

    def test_ambiguous_paid_wallet_and_refunds_require_review(self):
        self.assertEqual(migration.review(account(quota=500))['reason'],'remaining_gift_exceeds_current_balance')
        self.assertEqual(migration.review(account(refund_count=1))['reason'],'refunds_need_original_charge_review')
        self.assertEqual(migration.review(account(active_paid_tasks=1))['reason'],'active_tasks_must_settle_before_migration')

    def test_nonrecipients_are_not_new_grants(self):
        row=migration.review(account(granted_at=None,receipt_quota=None))
        self.assertEqual(row['reason'],'no_gift_was_granted')
        self.assertEqual(row['granted'],0)


class SQLTests(unittest.TestCase):
    def test_generated_transaction_and_stale_plan_guard(self):
        manifest_path=os.environ.get('GIFT_MIGRATION_MANIFEST')
        if not manifest_path:
            self.skipTest('GIFT_MIGRATION_MANIFEST not set')
        manifest=json.loads(Path(manifest_path).read_text())
        rows=manifest['accounts']
        selected=[r for r in rows if r['disposition']=='migrate']
        stamp=int(__import__('datetime').datetime.fromisoformat(manifest['summary']['as_of']).timestamp())
        schema='gift_migration_tools_test'
        command=['psql','-X','-At','-v','ON_ERROR_STOP=1','-q','image_studio_test']
        environment=dict(os.environ,PGOPTIONS=f'-c search_path={schema},public')
        def run(sql,check=True):
            return subprocess.run(command,input=sql,text=True,capture_output=True,env=environment,check=check)
        run(f'CREATE SCHEMA {schema};')
        try:
            run('''CREATE TABLE users(id bigint PRIMARY KEY,quota bigint,gift_wallet_enabled boolean DEFAULT false,deleted_at timestamptz);
            CREATE TABLE logs(id bigint,user_id bigint);
            CREATE TABLE wallet_gift_allocations(user_id bigint);
            CREATE TABLE gift_quotas(id bigserial PRIMARY KEY,user_id bigint,source varchar(40),reference varchar(128) UNIQUE,granted bigint,remaining bigint,expired bigint,granted_at bigint,expires_at bigint,expired_at bigint);''')
            users=','.join(f"({r['id']},{r['quota']},false,NULL)" for r in selected)
            logs=','.join(f"({r['latest_log_id']},{r['id']})" for r in selected)
            run(f'INSERT INTO users VALUES {users}; INSERT INTO logs VALUES {logs};')
            sql=migration.migration_sql(rows,stamp)
            first=selected[0]['id']
            run(f'UPDATE users SET quota=quota+1 WHERE id={first};')
            failed=run(sql,check=False)
            self.assertNotEqual(failed.returncode,0)
            self.assertIn('wallet or evidence changed',failed.stderr)
            self.assertEqual(run('SELECT count(*) FROM gift_quotas;').stdout.strip(),'0')
            run(f'UPDATE users SET quota=quota-1 WHERE id={first};')
            applied=run(sql)
            self.assertIn(str(len(selected)),applied.stdout)
            expected=sum(r['quota'] for r in selected)
            self.assertEqual(run('SELECT sum(quota) FROM users;').stdout.strip(),str(expected))
            self.assertEqual(run('SELECT sum(remaining) FROM gift_quotas;').stdout.strip(),str(sum(r['remaining'] for r in selected)))
            repeated=run(sql,check=False)
            self.assertNotEqual(repeated.returncode,0)
            self.assertEqual(run('SELECT count(*) FROM gift_quotas;').stdout.strip(),str(len(selected)))
            rollback=migration.rollback_sql(rows)
            run(f'UPDATE users SET quota=quota+1 WHERE id={first};')
            refused=run(rollback,check=False)
            self.assertNotEqual(refused.returncode,0)
            self.assertIn('wallet activity after migration',refused.stderr)
            run(f'UPDATE users SET quota=quota-1 WHERE id={first};')
            run(rollback)
            self.assertEqual(run('SELECT count(*) FROM gift_quotas;').stdout.strip(),'0')
            self.assertEqual(run('SELECT count(*) FROM users WHERE gift_wallet_enabled;').stdout.strip(),'0')
            self.assertEqual(run('SELECT sum(quota) FROM users;').stdout.strip(),str(expected))
        finally:
            run(f'DROP SCHEMA {schema} CASCADE;')


if __name__=='__main__':
    unittest.main()
