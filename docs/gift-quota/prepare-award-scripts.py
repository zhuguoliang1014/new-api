#!/usr/bin/env python3
"""Prepare reviewed replacements for the two existing Yaohuo grant scripts.

Read-only on the server. Install these ONLY after the gift-wallet schema and
application are deployed, while automation 5 is paused. Keep originals/receipts.
"""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import subprocess

CAMPAIGNS = ('1603788','1604928')


def replace_once(source, old, new):
    if source.count(old)!=1:
        raise ValueError(f'Expected exactly one source anchor: {old[:75]}')
    return source.replace(old,new,1)


def patch(source):
    source=replace_once(source,
        'metadata jsonb; log_id bigint; audit_id bigint; before_quota bigint;',
        'metadata jsonb; log_id bigint; audit_id bigint; before_quota bigint; expired_quota bigint; grant_time bigint;',
    )
    source=replace_once(source,'  before_quota := u.quota;', '''  IF to_regclass('gift_quotas') IS NULL THEN
    RAISE EXCEPTION 'Gift-wallet release must be installed before granting';
  END IF;
  grant_time := floor(extract(epoch from clock_timestamp()))::bigint;
  SELECT coalesce(sum(remaining),0) INTO expired_quota FROM gift_quotas
    WHERE user_id=p_uid AND expires_at<=grant_time AND remaining>0;
  UPDATE gift_quotas SET expired=expired+remaining,remaining=0,expired_at=grant_time
    WHERE user_id=p_uid AND expires_at<=grant_time AND remaining>0;
  IF expired_quota>0 THEN UPDATE users SET quota=quota-expired_quota WHERE id=p_uid; END IF;
  before_quota := u.quota-expired_quota;''')
    source=replace_once(source,'  UPDATE users SET quota=quota+2500000 WHERE id=p_uid;', '''  INSERT INTO gift_quotas(user_id,source,reference,granted,remaining,expired,granted_at,expires_at,expired_at)
    VALUES(p_uid,'yaohuo','yaohuo:'||p_claim,2500000,2500000,0,grant_time,grant_time+2592000,0);
  UPDATE users SET quota=quota+2500000,gift_wallet_enabled=true WHERE id=p_uid;''')
    source=replace_once(source,"'requested_quota',2500000,'from',before_quota", "'requested_quota',2500000,'quota_type','gift','from',before_quota")
    source=replace_once(source,
        "redis.call('HINCRBY',KEYS[1],'Quota','2500000'); redis.call('HDEL',KEYS[1],ARGV[2]); status='incremented'",
        "redis.call('DEL',KEYS[1]); status='invalidated'",
    )
    source=replace_once(source,
        "'verified', r.quota=2500000 AND",
        "'verified', r.quota=2500000 AND EXISTS(SELECT 1 FROM gift_quotas g WHERE g.user_id=r.user_id AND g.reference='yaohuo:'||r.claim_id AND g.granted=r.quota AND g.expires_at-g.granted_at=2592000) AND",
    )
    source=replace_once(source,'SELECT id,username,role,status,quota,used_quota,created_at,deleted_at',
                       'SELECT id,username,role,status,quota,used_quota,created_at,deleted_at,gift_wallet_enabled')
    source=replace_once(source,"      SELECT jsonb_build_object('kind','receipts'", """      SELECT jsonb_build_object('kind','gift_quotas','rows',COALESCE(jsonb_agg(t),'[]')) FROM
        (SELECT * FROM gift_quotas WHERE user_id IN ({ids}) ORDER BY id) t;
      SELECT jsonb_build_object('kind','receipts'""")
    ast.parse(source)
    return source


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',required=True,type=Path)
    parser.add_argument('--host',default='aiproxy-hk')
    args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=False,mode=0o700)
    os.chmod(args.output,0o700)
    manifest=[]
    for campaign in CAMPAIGNS:
        remote=f'/root/yaohuo-post-rewards/{campaign}/grant.py'
        source=subprocess.run(['ssh',args.host,f'cat {remote}'],check=True,capture_output=True,text=True).stdout
        updated=patch(source)
        path=args.output/f'grant-{campaign}.py'
        path.write_text(updated)
        os.chmod(path,0o600)
        manifest.append({'campaign':campaign,'remote':remote,'original_sha256':hashlib.sha256(source.encode()).hexdigest(),'prepared_sha256':hashlib.sha256(updated.encode()).hexdigest(),'installed':False})
    (args.output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    os.chmod(args.output/'manifest.json',0o600)
    print(json.dumps(manifest,indent=2))


if __name__=='__main__':
    main()
