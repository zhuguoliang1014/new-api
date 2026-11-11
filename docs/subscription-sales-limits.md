# 订阅套餐限量销售

管理员在新建、编辑套餐时设置「销售总量」。未开启“限量套餐”时0表示不限量，开启时0表示无库存；例如填30，表示这个套餐累计最多售出30份。已有套餐默认 0，历史成功付费订单也计入限量。固定月卡的活动复用原商品并设置折扣时间；增加原套餐销售总量即补货，历史已售不重置。

现有「限购」仍是每个用户的购买上限。管理员赠送不占销售名额；展示销量作为额外已售数量占用名额。例如总量5、展示销量2、无真实订单时，已售显示2、剩余可购买3。后续真实付款和待支付占位继续扣减剩余名额。订阅到期、取消或删除不恢复已经售出的名额。将总量调低到已付款、待支付占位和展示销量合计以下，或提高展示销量导致超过总量，都会被拒绝，填 0 可以取消限量。

前台保留售完的套餐，显示「售罄」并禁用购买按钮。有剩余名额时显示限量和剩余数量。如果剩余名额全被待支付订单占用，则显示「名额暂被占用」。管理列表也显示限量和可下单份数。页面加载、手动刷新、关闭支付弹窗时更新库存；最终库存以服务端下单事务为准。

## 支付占位与并发

在线支付创建本地订单时先占用一个名额，再创建支付链接。余额购买在同一事务内检查库存、扣余额、发放订阅并记录订单。下单、结算和调整总量统一先锁定套餐，跨实例共享数据库锁，不依赖进程缓存或前端按钮。支付成功把占位转为已售；重复回调不重复发放。

**2026-11-11用户最终规则：30分钟未支付自动关闭并释放席位；取消／过期订单不能恢复成功。** 库存只计创建30分钟内的pending、成功付款和展示销量；后台每分钟批处理关闭旧pending及账单镜像，前端统一30分钟。迟到入账只记录异常收款供核对，不发权益、不转余额；详见 `docs/subscriptions/payment-timeout-20261111.md`。原先“易支付／虎皮椒本地关闭仍永久占库存并接受晚到付款”的规则已被替代。

## 数据与接口

- `SubscriptionPlan.sales_limit`：非负整数，最大 2147483647，默认 0。
- 套餐 DTO 增加 `paid_count`、`reserved_count`、`remaining_count`、`sold_out`、`sales_unavailable`。`remaining_count` 只在 `sales_limit > 0` 时表示有效库存。
- 实际付款与占位来自 `SubscriptionOrder`，再叠加 `display_sold_count`；`sold_count` 为实际成功付款订单数加展示销量。展示销量不生成订单、收入、用户订阅或消费日志，管理员赠送不计已售。`display_sold_count` 为0至2147483647的整数。
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


## 支付占位展示（2026-11-11）

限量与剩余数量旁增加“支付占位：N份”，有占位时才显示。已售仍只计成功付款及展示销量，库存算法与支付状态不变。生产套餐36在核对时限量20、成功付款6、展示0、本地取消且网关仍待支付1，因此实际可购买13；原界面漏掉占位说明而显得少1份。该订单为北京时间2026-11-09 15:56创建，当时只读查询网关返回WP、订单号与金额匹配，因此旧逻辑仍占位；用户随后明确重申30分钟释放席位，最终改为上文新规则。本次原始查询未关单、改订单或修改售价。查询材料服务器`/root/upgrade-recovery/plan36-reservation-review-20261111/`。

新增部分占位（20总量／6已售／1占位／13剩余）与无占位不显示冗余说明的回归；140相关前端、native类型、lint/格式、640.7KiB构建与本地390宽度预览通过。
