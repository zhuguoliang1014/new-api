# AiProxy Telegram 订单验证机器人

独立运行的 Go 长轮询服务，不经过网关发布流程，不提供公网 HTTP 接口。私聊 `/start` 显示「加入群聊」按钮；`/join` 开启 10 分钟提交窗口，`/cancel` 取消。查询主站 `top_ups` 和 `subscription_orders`，只接受精确匹配的 `trade_no`、`status=success` 且所属账号正常、未删除的订单。套餐镜像记录以 `subscription_orders` 状态为准。金额和套餐类型不限，历史成功订单有效，不支持 sub2api 订单或支付平台流水号。

每个订单首次成功后持久关联一个 Telegram 用户，同时记录「Telegram ID ↔ 主站用户 ID」的一一关联。验证成功的消息显示这两个 ID 和动态入群链接，之后 `/start` 也显示本人已关联的主站 ID。同一用户可再次验证生成新链接并撤销旧链接，其他用户不能重复领取，也不能换用同一主站账号的另一笔订单绕过；更换关联须管理员核实后处理。此关联仅供机器人使用，不写主站 `users.telegram_id`，不授予登录能力。每个用户每 10 分钟最多提交 5 次，全局每分钟最多提交 120 次，每人每分钟最多处理 12 条消息；重新 `/join` 或重启均不重置尚在窗口内的计数。群聊消息忽略，订单号和邀请链接仅在私聊处理。失败不返回订单金额、站内账号、是否存在等详情。

## 配置与运行

```json
{
  "token": "BOT_TOKEN_FROM_PROTECTED_STORAGE",
  "bot_username": "aiproxy92_bot",
  "group_id": -1000000000000,
  "driver": "postgres",
  "dsn": "POSTGRES_DSN_FOR_A_DEDICATED_READ_ONLY_ROLE",
  "state_path": "/var/lib/aiproxy-telegram-bot/state.json"
}
```

配置在服务器 `/etc/aiproxy-telegram-bot/config.json`，由 root 持有、专属服务组只读（640），不得提交 Git。`driver` 支持 `postgres`、`mysql`、`sqlite`；使用现有 GORM 驱动，不执行迁移。生产必须使用专属只读角色，授予 `top_ups` 和 `subscription_orders` 的 `trade_no,user_id,status` 列以及 `users` 的 `id,status,deleted_at` 列 SELECT 权限，不能读取凭据或写余额；PostgreSQL 同时设置 `default_transaction_read_only=on`。DSN 设置连接超时，SQLite 使用只读 URI。

```bash
go test ./cmd/telegram-order-bot
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o /tmp/telegram-order-bot ./cmd/telegram-order-bot
/opt/aiproxy-telegram-bot/telegram-order-bot -check -config /etc/aiproxy-telegram-bot/config.json
systemctl enable --now aiproxy-telegram-bot
```

同目录的 systemd unit 使用独立无登录用户。部署前保存已有角色/权限和配置的恢复材料，安装二进制到 `/opt/aiproxy-telegram-bot/`，配置和状态父目录权限分别为 750、700。启动会验证 `getMe` 用户名，已存在 webhook 时拒绝启动，避免覆盖其他程序。机器人必须已是目标群管理员并具有 `can_invite_users` 权限；启动和 `-check` 都会实际核验。`group_id` 必须是目标群的负数 ID，旧 `invite_url` 不再使用，也不会作为失败回退。`-check` 不消费 Telegram 更新。

状态 v3 使用 600 权限的 JSON 文件，保存偏移、订单 SHA-256 摘要、Telegram ID、主站用户 ID 关联、专属邀请授权与限流/会话状态；写入、fsync、原子重命名后才发送邀请并推进更新偏移。启动保留 v1/v2 的订单领取记录和已有用户关联，v1 在重新验证时补充关联；v3 不能交给旧版二进制启动。邀请 URL 仅保存在受限状态中，不写日志。文件锁拒绝同状态文件的多进程运行，损坏的状态不会被自动清空。更新投递具有至少一次语义，进程在发送成功但保存偏移前退出可能重复发送同一消息。网络错误重试、429 尊重 Telegram 的 `retry_after`；用户关闭聊天等 400/403 不阻塞后续更新。日志不记录原始订单号、邀请链接、令牌、DSN 或 Telegram 原始错误正文。

应单独备份配置和状态。当前异地备份脚本仅包含业务数据库，不包含该机器人的本地状态。回退先 `systemctl disable --now aiproxy-telegram-bot`，保留状态及配置，不要清空领取记录；更新二进制前保存旧版本，需要时停止服务后原样恢复。撤销权限时仅删除本服务的专属角色。

## 验证

必须使用独立测试库：测试会重建其中 `users`、`top_ups`、`subscription_orders` 三张夹具表。

```bash
TEST_MYSQL_DSN='root@unix(/tmp/telegram-bot-mysql.sock)/telegram_order_bot_test?charset=utf8mb4&parseTime=true' \
TEST_POSTGRES_DSN='postgres://zhuguoliang@localhost/telegram_order_bot_test?sslmode=disable' \
go test ./cmd/telegram-order-bot -count=1 -v
```

2026-10-30 重新执行上述完整矩阵，通过真实 SQLite 3.50.4、MySQL 8.4.11、PostgreSQL 15.17。覆盖充值/套餐、镜像冲突、待支付/过期/取消/退款、删除/封禁账号、大小写与 SQL 注入、跨用户重复领取、同站内账号换订单冲突、Telegram 切换关联拒绝、用户 ID 展示、会话过期、限流与持久状态恢复、私聊身份隔离、数据库/状态写入失败和 Telegram 协议错误。新增动态链接创建、10 分钟过期、他人使用拒绝、错误群/未知链接不审批、一次性消费、审批前持久化、失败重试/重启恢复、重新验证撤销旧链接以及审批成功撤销链接的回归。`go vet ./cmd/telegram-order-bot` 与 Linux amd64 构建通过；正式目标群实际创建审批链接并撤销的 API 探测通过，尚未使用非群成员账号代测真实加入。只读查询不改变订单和余额，生产没有应用表结构变化。

## 安全依据与边界

实施前核对 OWASP ASVS 稳定版 **5.0.0**（`v5.0.0_release`，不使用 `latest` 的 Bleeding Edge）；参考 Authentication Cheat Sheet 的 Login Throttling / Authentication Responses、Session Management Cheat Sheet 的服务端会话和超时、Authorization Cheat Sheet 的默认拒绝/每次验证权限。对应设计依据为 ASVS 6.1.1、6.3.1、8.1.1、8.3.1：服务端决策、按 Telegram 用户限流、持久状态、最小数据库权限、私聊隔离与非秘密审计。Telegram 接口以官方 Bot API 的 getUpdates、sendMessage、answerCallbackQuery、createChatInviteLink、approveChatJoinRequest、declineChatJoinRequest、revokeChatInviteLink、getChatMember 为准。

- https://github.com/OWASP/ASVS/releases/tag/v5.0.0_release
- https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- https://core.telegram.org/bots/api

用户指定的准入方式是「持有已付款订单号」。它不证明提交者登录了该订单所属的站内账号，部分旧订单号可预测，因此不能作为站内登录/绑定或付款所有权认证，也不声称达到 ASVS 身份认证合规。动态邀请使用 `creates_join_request=true` 和 10 分钟 `expire_date`，不混用 Telegram 不兼容的 `member_limit`。机器人只审批目标群、精确链接、已关联 Telegram 本人的未过期授权；链接转发给其他账号会被拒绝。审批前先持久化消费事件 ID，重启后只允许同一事件继续完成，获批后撤销；重新验证先撤销旧链接再创建新链接。未知链接不自动审批，其他群不处理。链接持有者不能凭 URL 直接入群，但其他管理员仍可手动批准，现有其他直达邀请链接也可能绕过机器人；上线时必须由链接创建者撤销原固定链接，并检查其他入群入口。只按订单号验证仍不能证明付款本人身份；如需加强该项，仍须站内登录后的一次性授权码。本功能不会授予站内会话或主站登录绑定。

## 2026-10-30 动态邀请更新

独立部署，未修改数据库查询、表结构或主站服务。配置由固定 `invite_url` 改为 `group_id`；旧配置、二进制和升级前状态保存在服务器受限恢复目录。恢复旧版本前必须先停止服务，并核对升级后的新增订单领取/用户关联，不能直接用旧状态覆盖新记录；旧版不能读取 v3 状态，且被撤销的旧固定链接不能恢复使用。优先保留 v3 状态并修复或向前更新。
