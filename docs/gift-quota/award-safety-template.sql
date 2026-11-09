BEGIN;
SET LOCAL search_path=pg_temp,public;
CREATE TEMP TABLE users(id bigint,username text,password text,role int,status int,quota bigint,used_quota bigint,created_at bigint,deleted_at timestamptz,gift_wallet_enabled boolean DEFAULT false);
CREATE TEMP TABLE user_oauth_bindings(id bigint,user_id bigint,provider_id bigint,provider_user_id text,created_at timestamptz);
CREATE TEMP TABLE custom_oauth_providers(id bigint,slug text,name text,enabled boolean);
CREATE TEMP TABLE oauth_signup_rewards(identity_hash text,claim_id text,user_id bigint,quota bigint,created_at timestamptz);
ALTER TABLE pg_temp.oauth_signup_rewards ADD PRIMARY KEY(identity_hash);
CREATE TEMP TABLE logs(id bigint,user_id bigint,created_at bigint,type int,content text,username text,quota bigint,is_stream boolean,request_id text,other text);
CREATE TEMP TABLE audit_logs(id bigint,event_id text,user_id bigint,username text,actor_role int,created_at bigint,category text,action text,auth_method text,method text,route text,status int,success boolean,request_id text,content text,other json);
CREATE TEMP SEQUENCE yh_log_test_seq;
CREATE TEMP SEQUENCE yh_audit_test_seq;
ALTER TABLE pg_temp.logs ALTER COLUMN id SET DEFAULT nextval('pg_temp.yh_log_test_seq');
ALTER TABLE pg_temp.audit_logs ALTER COLUMN id SET DEFAULT nextval('pg_temp.yh_audit_test_seq');
INSERT INTO users(id,username,password,role,status,quota,used_quota,created_at) VALUES(1,'operator','',100,1,0,0,1700000000);
INSERT INTO users(id,username,password,role,status,quota,used_quota,created_at)
SELECT uid,'test-'||uid,'',1,1,0,0,1700000000 FROM generate_series(101,110) uid;
UPDATE users SET status=2 WHERE id=106;
UPDATE users SET quota=9007199254740991 WHERE id=110;
INSERT INTO custom_oauth_providers(id,slug,name,enabled) VALUES(1,'yaohuo','test',true);
INSERT INTO user_oauth_bindings(id,user_id,provider_id,provider_user_id,created_at)
SELECT uid,uid,1,(uid+1000)::text,to_timestamp(1700000000) FROM generate_series(101,110) uid;
UPDATE user_oauth_bindings SET created_at=to_timestamp(1700000100) WHERE user_id=105;
INSERT INTO audit_logs(id,user_id,created_at,category,action,success,other)
SELECT uid,uid,1700000000,'login','login',true,'{"login_method":"oauth:yaohuo"}'::json
FROM generate_series(101,110) uid WHERE uid<>108;
INSERT INTO oauth_signup_rewards VALUES('hash102','old102',102,2500000,now());
INSERT INTO audit_logs(id,user_id,category,action,success,other)
VALUES(1001,1,'operation','user.quota_add',true,'{"op":{"params":{"target_user_id":103}}}');
INSERT INTO logs(id,user_id,type,content,other) VALUES(1001,109,1,'Increased user quota by 100','{}');

CREATE TEMP TABLE gift_quotas(id bigserial PRIMARY KEY,user_id bigint,source text,reference text UNIQUE,granted bigint,remaining bigint,expired bigint,granted_at bigint,expires_at bigint,expired_at bigint);

-- GIFT_GRANT_FUNCTION
DO $test$
DECLARE r jsonb; n integer;
BEGIN
 r:=pg_temp.yh_claim(101,'1101',1,'hash101','claim101','test',false);
 IF r->>'status'<>'eligible' THEN RAISE EXCEPTION 'expected eligible: %',r; END IF;
 IF (SELECT quota FROM users WHERE id=101)<>0 OR EXISTS(SELECT 1 FROM oauth_signup_rewards WHERE user_id=101)
   OR (SELECT is_called FROM pg_temp.yh_log_test_seq) THEN RAISE EXCEPTION 'preview changed data or sequence'; END IF;
 IF pg_temp.yh_claim(102,'1102',2,'hash102','claim102','test',true)->>'status'<>'already_received' THEN RAISE EXCEPTION 'historical receipt'; END IF;
 IF pg_temp.yh_claim(103,'1103',3,'hash103','claim103','test',true)->>'status'<>'previous_admin_or_bonus_credit' THEN RAISE EXCEPTION 'admin history'; END IF;
 IF pg_temp.yh_claim(104,'9999',4,'hash104','claim104','test',true)->>'status'<>'identity_mismatch' THEN RAISE EXCEPTION 'identity mismatch'; END IF;
 IF pg_temp.yh_claim(105,'1105',5,'hash105','claim105','test',true)->>'status'<>'registration_not_proven' THEN RAISE EXCEPTION 'post registration binding'; END IF;
 IF pg_temp.yh_claim(106,'1106',6,'hash106','claim106','test',true)->>'status'<>'inactive_or_privileged' THEN RAISE EXCEPTION 'disabled'; END IF;
 IF pg_temp.yh_claim(99999,'1107',7,'hash107','claim107','test',true)->>'status'<>'missing_user' THEN RAISE EXCEPTION 'missing'; END IF;
 IF pg_temp.yh_claim(108,'1108',8,'hash108','claim108','test',true)->>'status'<>'registration_not_proven' THEN RAISE EXCEPTION 'no registration evidence'; END IF;
 IF pg_temp.yh_claim(109,'1109',9,'hash109','claim109','test',true)->>'status'<>'previous_admin_or_bonus_credit' THEN RAISE EXCEPTION 'legacy manual gift'; END IF;
 BEGIN
   PERFORM pg_temp.yh_claim(110,'1110',10,'hash110','claim110','test',true);
   RAISE EXCEPTION 'expected wallet bound rejection';
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM NOT LIKE 'wallet bound failure%' THEN RAISE; END IF;
 END;
 r:=pg_temp.yh_claim(101,'1101',1,'hash101','claim101','test',true);
 IF r->>'status'<>'granted' OR (SELECT quota FROM users WHERE id=101)<>2500000 THEN RAISE EXCEPTION 'actual grant: %',r; END IF;
 IF pg_temp.yh_claim(101,'1101',1,'hash101','claim101','test',true)->>'status'<>'already_received' THEN RAISE EXCEPTION 'duplicate claim'; END IF;
 IF (SELECT quota FROM users WHERE id=101)<>2500000 THEN RAISE EXCEPTION 'duplicate balance'; END IF;
 IF (SELECT count(*) FROM logs WHERE request_id='claim101')<>1 OR (SELECT count(*) FROM audit_logs WHERE event_id='claim101')<>1 THEN RAISE EXCEPTION 'audit count'; END IF;
END $test$;
SELECT jsonb_build_object('claim_id',r.claim_id,'user_id',r.user_id,
      'floor',(l.other::jsonb#>>'{root_info,floor}')::integer,'quota',r.quota,
      'verified', r.quota=2500000 AND
        (SELECT count(*) FROM logs ll WHERE ll.request_id=r.claim_id AND ll.user_id=r.user_id)=1 AND
        (SELECT count(*) FROM audit_logs a WHERE a.event_id=r.claim_id AND a.success)=1)
      FROM oauth_signup_rewards r JOIN logs l ON l.request_id=r.claim_id AND l.user_id=r.user_id
      WHERE l.other::jsonb#>>'{root_info,campaign}'='yaohuo-thread-1603788' ORDER BY l.id;
DO $gift$ BEGIN
 IF (SELECT count(*) FROM gift_quotas WHERE user_id=101 AND granted=2500000 AND remaining=2500000 AND expires_at-granted_at=2592000)<>1 THEN RAISE EXCEPTION 'gift lot or expiry invalid'; END IF;
 IF NOT (SELECT gift_wallet_enabled FROM users WHERE id=101) THEN RAISE EXCEPTION 'gift wallet not enabled'; END IF;
END $gift$;
SELECT json_build_object('test','sql_financial_safety','passed',true); ROLLBACK;