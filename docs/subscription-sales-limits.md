# 订阅套餐限量销售

管理员在新建、编辑套餐时设置「销售总量」。0 表示不限量；例如填 30，表示这个套餐累计最多售出 30 份。已有套餐默认 0，历史成功付费订单也计入限量。重新开一轮独立活动时，应新建套餐；增加原套餐总量则是在原活动上补货。

现有「限购」仍是每个用户的购买上限。管理员赠送不占销售名额；展示销量与真实库存独立。订阅到期、取消或删除不恢复已经售出的名额。将总量调低到已付款和已占用名额以下会被拒绝，填 0 可以取消限量。

前台保留售完的套餐，显示「售罄」并禁用购买按钮。有剩余名额时显示限量和剩余数量。如果剩余名额全被待支付订单占用，则显示「名额暂被占用」。管理列表也显示限量和可下单份数。页面加载、手动刷新、关闭支付弹窗时更新库存；最终库存以服务端下单事务为准。

## 支付占位与并发

在线支付创建本地订单时先占用一个名额，再创建支付链接。余额购买在同一事务内检查库存、扣余额、发放订阅并记录订单。下单、结算和调整总量统一先锁定套餐，跨实例共享数据库锁，不依赖进程缓存或前端按钮。支付成功把占位转为已售；重复回调不重复发放。

Stripe 确认 checkout 过期后释放占位；尚未向网关请求支付链接的明确本地创建失败也不占位。支付请求网络错误结果未知时保留订单和名额，不把超时视为未创建订单。

**易支付和虎皮椒继续支持本地超时后的真实付款，因此本地倒计时到期、expired/canceled 状态或查询「未支付」均不会自动释放其名额。** 现有接口没有统一的网关关单确认能力，这类未决订单可能长期占用名额，不能仅按时间批量释放。不要通过删除订单或修改状态来释放，否则迟到付款可能无法兑现订阅。后续如增加释放流程，必须先实现支付网关的可靠关单和最终到账核对。

## 数据与接口

- `SubscriptionPlan.sales_limit`：非负整数，最大 2147483647，默认 0。
- 套餐 DTO 增加 `paid_count`、`reserved_count`、`remaining_count`、`sold_out`、`sales_unavailable`。`remaining_count` 只在 `sales_limit > 0` 时表示有效库存。
- 库存来自 `SubscriptionOrder`，不使用 `display_sold_count` 或订阅实例条数。原 `sold_count` 展示口径不变。
- SQLite 使用现有追加列迁移；MySQL、PostgreSQL 使用 AutoMigrate。无订单状态回填，无历史金额、余额或价格修改。

## 本地验证（2026-11-08）

SQLite 3.50.4、MySQL 8.4.11、PostgreSQL 15.17 的新建、旧发布结构和变更前当前结构升级、重复迁移、数据/主键保留与库存事务测试通过，库存矩阵也通过 race。管理 API 在三库验证总量保存、过低总量拒绝、取消限量和售罄/占位返回值。

主要命令（MySQL、PostgreSQL 均使用独立临时测试库，不连接生产）：

```sh
TEST_MYSQL_DSN='…' TEST_POSTGRES_DSN='…' go test -race ./model -run '^TestSubscription(PlanMigration|SalesDatabaseMatrix)$' -count=1 -v
TEST_SUBSCRIPTION_CONTROLLER_DIALECT=mysql TEST_SUBSCRIPTION_MYSQL_DSN='…' go test ./controller -run '^TestSubscriptionSalesLimitAPI$' -count=1 -v
TEST_SUBSCRIPTION_CONTROLLER_DIALECT=postgres TEST_SUBSCRIPTION_POSTGRES_DSN='…' go test ./controller -run '^TestSubscriptionSalesLimitAPI$' -count=1 -v
go test ./controller ./service -run 'Subscription|WaffoPancake' -count=1
go test ./model -run Subscription -skip '^TestSubscriptionFreezeDatabaseLifecycle$' -count=1
```

扩展回归中 `TestSubscriptionFreezeDatabaseLifecycle/sqlite/reservation_before_freeze_remains_refundable_and_new_requests_are_excluded` 报 `no active subscription`；在独立的未修改 HEAD 副本运行相同用例也失败。该既有失败未在本功能内修改。

本次未提交、未 push、未部署、未修改生产配置或真实订单。

前端共 6 个测试文件、73 项测试通过，覆盖管理端保存/拒绝、售罄与暂占状态、所有内建支付方式禁用、库存恢复及钱包刷新。`bunx --no-install tsgo -b`、改动文件 oxlint、保护版权头的格式化检查及 `git diff --check` 通过；oxlint 保留两处既有 `isNaN` 建议警告，无 error。`bun run build` 通过，首屏 JS/CSS gzip 为 620.1 / 650 KiB。相关 Go 回归、管理 API race、`go vet ./model ./controller ./service` 和 root `go build` 通过。测试使用的独立数据库已删除，临时启动的 MySQL 实例已停止。
