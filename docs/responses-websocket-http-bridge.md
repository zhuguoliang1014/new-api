# Responses WebSocket 客户端与 HTTPS 上游桥接

客户端用 Responses WebSocket 连接本站，每轮只发送新增 input 与 previous_response_id；本站在该客户端连接的私有内存中补齐历史，再通过现有 HTTP/HTTPS Responses 接口调用上游。上游连接保持 HTTP/HTTPS，不建立 Krill WSS，也不把多个用户共享到一个有状态上游会话。

## 客户端设置

在原有自定义 provider 配置块中增加一行，其他地址、模型、认证配置保留：

```toml
[model_providers.newapi]
# 继续使用已有 name、base_url、env_key 等字段
supports_websockets = true
```

`true` 允许 Codex 使用 WSS；改为 `false` 使用普通 HTTPS。修改后完全退出并重新启动 Codex/桌面 App。base_url 仍填原有 `https://站点/v1`，不改成 wss://。本站部署和代理配置完成后，客户只需要修改这一项。

HTTP POST /v1/responses 保持原有行为。客户端不能使用 WSS 时，由客户端回退 HTTP；本站不会把已经提交、结果未知的模型请求再发一遍。Codex CLI 0.162.1 的 true、false 和握手 426 回退路径，使用真实 CLI 与本地合成上游验证。

## 服务端与反向代理

部署包含本桥接的代码。此桥接按渠道的 HTTP Responses 能力选路，不要求开启原有上游 Responses WebSocket 开关，也不会拨号上游 WSS。原有开关仍属于原生上游 WSS 转发逻辑。当前支持原生 Responses 端点的 OpenAI、Codex、Sub2API、New API，以及无协议转换的 Advanced Custom 路由。

主站已有 HTTPS server 的 location / 如果清掉了 Connection、没有透传 Upgrade，WSS 握手会失败。可使用同目录 nginx/ 下两份示例：map 文件只在 http {} 中包含一次，location 文件放在目标 HTTPS server {} 中。确认 newapi_backend、可信代理、站点访问控制和已有同名 location 后，再执行 nginx -t 与 reload。示例不会自动修改或发布到生产机器。

浏览器客户端默认只允许同 Host 的 Origin；不发送 Origin 的 CLI 正常使用。TLS 终止、证书和可信代理策略沿用原部署，示例不关闭 TLS 验证。

## 管理员配置每用户客户端 WSS 上限

2026-11-04 已发布，应用 revision `c33eb297141d12069281a7cad4fb246747c98ed9`，Actions `41769210971` 构建部署成功；北京时间11:52生产、后台设置页及真实握手核验通过。

- 默认每用户同时最多 10 条 Responses WSS 物理连接。管理员可在「系统设置 → 附加功能 → Responses WebSocket → 每用户 Responses WebSocket 连接上限」保存 1–1000 之间的整数。配置键为 `ResponsesWSMaxConnectionsPerUser`，复用受保护的管理设置接口及 options 持久化，无需修改代码或重启。此设置独立于模型请求限流开关。
- 按通过鉴权的本站 user_id 统计。同一用户的不同 API Key、模型、设备共用名额；subAgent 只要另建连接，也占一个名额。不会按客户端自报的用户 ID 或 subAgent 名称分配额外名额。
- 默认第 11 条连接在握手升级前返回 HTTP 426，错误文案展示当前配置的上限，Codex 可回退普通 HTTPS POST /v1/responses。调高或调低上限仅影响后续连接，已有连接保持运行；调低后需等待实际连接数降到新上限以下，才接纳新连接。不排队、不抢占，也不重发已经提交的生成。
- 保存即时更新当前进程，其他实例通过原有 options 同步机制加载；配置持久化后重启仍保留。未配置或存储值损坏时使用默认 10。API 拒绝非整数、零、负值及大于 1000 的值，且不改动原配置。
- 在已经连上 WSS 后，不会因新名额释放就自动把已有 HTTPS 会话迁回；客户端重新尝试 WSS 时才重新分配。
- 干净断开、读取错误和握手失败会释放名额；不调用模型、不产生消费记录。连接的全部请求工作结束后才释放，避免仍在处理的请求绕过上限。
- Redis 开启时用原子租约在共用 Redis 的各实例间计数：15 秒续租，60 秒过期，按 Redis 服务端时钟处理。租约丢失或续租失败会关闭对应 WSS 并取消当前上游请求；新握手遇到 Redis 故障也返回426以使用HTTPS，不切到进程内计数绕过限制。进程崩溃遗留名额最长约60秒后释放。Redis 未启用的部署使用单进程计数。
- 限制作用于 /v1/responses 的客户端 WSS，HTTP POST 和上游 HTTPS 请求不占名额。Realtime 音频 /v1/realtime 不属于该 Responses 会话桥接。

## 首字计时和用户网络

用户感受到的等待包括请求上传、本站处理/上游首事件等待、响应传回和客户端显示。上传慢、链路抖动、重连和下载慢都会影响实际看到首字的时间。

当前日志的 frt 在服务端开始处理该轮后计时，读到上游第一条有效事件时记录，不等同于客户端屏幕首字：HTTP 通常在读取完请求体并完成选路后开始；WSS 在收到完整帧、通过该轮鉴权后开始。因此客户端上传和响应传回延迟通常不直接包含在该数值内。后续写入被慢客户端阻塞、资源竞争等可能间接增加服务端耗时，但不能仅凭日志 frt 高认定用户网络差。

## 会话、续轮与恢复

- 每条客户端连接独立缓存，并绑定首次通过鉴权的 user_id 和 token_id；每轮重新检查 Key、用户状态、IP、模型权限和限流，并重新应用该轮的会话亲和与请求头覆盖规则。不同用户、不同 Key、不同物理连接都不能凭 response ID 读取其他连接的历史。
- 同一连接当前串行处理 response.create。命名 stream_id 分别保存最近一轮，可交替续问或从仍保留的同连接父响应分支。一个正在执行的请求不能被另一条 create 覆盖。
- 保存原始 input/output 项，保留工具调用、工具结果和 reasoning.encrypted_content；向上游发送完整历史并删除 previous_response_id。拒绝跨上游存储查找的 conversation 和 item_reference，要求发送完整项。协议适配和渠道参数覆盖之后也不允许重新注入上游续轮 ID。
- `generate:false` 在本地预存输入、返回可续接的响应 ID，不调用模型、不生成消费记录。它不代表已在上游预热模型，也不会提前选择渠道、账号或锁定缓存路由；实际生成时再依据完整请求选路。
- 正常完成时缓存完整 output 数组；确认中断时仅保留中断前已交付的完整 output item。其他失败、断流或结果未知的响应不作为下一轮历史。HTTP 上游失败没有应用层自动重放；部分已产生用量继续按已有计费规则结算。
- 取消请求会取消对应的 HTTP 请求；客户端断开也会终止该请求。每轮独立 request_id（`-ws-N`）、日志与结算，终止事件在本轮结算和限流完成后才发送，避免客户端立即续轮的竞态。
- `response.interrupt` 要求当前连接的 `response_id` 和 `mode:"discard_partial_items"`。有效中断返回 `response.interrupt.accepted`，取消该轮 HTTP 请求，结算后返回 `response.incomplete`、原因 `interrupted`；只保留中断前已交付的完整 output item，丢弃未完成项，允许同连接从该 ID 继续。未知用量保持 `null`，真实结算仍走原有上游 usage / 缺失用量保护，不把本地终止事件重新计费。ID 或 stream 不匹配返回 `response.interrupt.failed`，不能影响另一连接或另一轮。重复中断和与最近一轮完成交错的中断可确认成功，不重复生成、结算或修改下一轮；原生上游 WSS 保留原始中断事件及回执。2026-11-04 已部署 revision `ab90fa8e2e1d56f9fd50e62f2c1f49afeacf51fe`；生产协议帧实测已通过，具体记录见下文。
- 历史仅保存在该连接内，断开即释放；重启、多实例之间不共享。未命中的父响应返回 `previous_response_not_found`，客户端需要去掉旧 ID、发送完整上下文重建。已提交但结果未知的生成不能当成安全重试。
- 每连接缓存最多 32 MiB、33 份最近历史（32 个命名 lane 加默认 lane），进程缓存合计最多 256 MiB。缓存不足时仍交付已完成的生成；之后若无法续接，客户端需完整重放上下文。连接最长一小时，之后重连恢复。

日志列表在“流”列用 WS 标记客户端 WebSocket 请求，桌面及移动端一致；日志详情显示客户端协议，管理员还能查看上游协议。downstream_transport=websocket 对日志本人可见，upstream_transport=http 仅存于管理员 admin_info；旧记录缺少协议证据时不推测、不补标。Realtime 既有 ws 标记也能识别。不会因为普通 HTTP 使用流式响应就显示 WS，也不将 Responses WS 当成 Realtime 音频。无提示词、回答或新增凭据记录。计费直接复用普通 Responses 的预扣、usage 解析、结算与失败退款，不采用增量上传字节数折算 Token。

## 缓存命中与重启

本地续轮历史和上游提示词/KV缓存是两种不同状态。客户端断开时，本地历史按连接清理，不会向上游发送删除缓存请求。新连接不能引用其他连接的父响应；客户端需完整重放历史，本站保留其 prompt_cache_key、instructions、input、tools 和缓存保留参数，不通过更换 key 或修改历史来“模拟”缓存命中。

重连后的缓存命中仍取决于上游实际保留的前缀、账号/路由和请求内容。客户端重启时的历史重写、压缩、截断，或上游过期/换账号，都可能导致冷缓存。本桥接不保证重启后必然命中，也不会未经确认提高缓存保留档位（可能产生不同费用）。

修复后的桥接将本地 generate:false 与上游选路分离，在实际生成及后续轮次应用会话规则，并在成功后记录亲和路由。上游使用 X-Request-Id 时也保存到 upstream_request_id，便于按同一请求找上游核对缓存。

## 缺失用量时的保护

上游明确报告的输入/缓存用量继续按实际数值结算；明确为0的输入不再用本地估算覆盖。若在终止事件之前已报告累计usage，会保留这些统计；最终usage（包含明确的0缓存）优先于中间快照。

WSS→HTTP桥接断流且没有任何上游usage时，缓存命中属于未知，不能当成0缓存把重建的完整历史按全价输入估扣。该路径不计未经确认的输入Token，已交付输出的本地估算与已确认工具用量仍沿用现有结算；按次表达式仍遵守其既有规则。管理员日志标记 input_usage_unavailable=true、local用量来源；输出阶梯仍使用请求上下文长度估算，单独记录 context_length_estimate，不把未知输入计成短上下文或全价输入。缺失终止事件记为异常，失败或结果不确定的输出不能变成下一轮缓存，也不会自动重放。

这里只修复未来请求的用量处理；不自动更改生产历史消费、余额或套餐。正常完成且实际报告低缓存命中的请求不能仅凭“重启”就认定为误扣，需结合上游同一request ID和实际输入核查。

## 验证

```sh
go test ./relay ./controller -run 'TestResponsesHTTPWebSocket|TestResponsesWS|TestResponsesWebSocket|TestResponsesStreamOutcomesPreserveAccounting' -count=1
go test -race ./relay ./controller -run 'TestResponsesHTTPWebSocket|TestResponsesWebSocket(ReusesConnectionAndSettlesEachRequest|IgnoresLateErrorForPreviousResponse)|TestResponsesWSRequestRunnerRejectsRevokedCredentials' -count=1
TEST_CODEX_BINARY=/path/to/codex go test ./controller -run '^TestResponsesHTTPWebSocketCodexProviderFlag$' -count=1 -v
```

Codex 互操作测试使用 --ignore-user-config、--ephemeral、本地模拟接口与临时测试 Key，不改客户配置、不调用付费模型。设置 TEST_RESPONSES_SQL_DSN 和 TEST_RESPONSES_LOG_SQL_DSN 可对隔离的真实 MySQL/PostgreSQL 主库与日志库运行相同回归；未设置时使用 SQLite。

中断协议按 OpenAI Codex `codex-rs/codex-api/src/endpoint/responses_websocket.rs` 的 `response.interrupt` / accepted / failed 交互，以及 `codex-rs/codex-api/src/sse/responses.rs` 对 `response.incomplete`、`interrupted` 的解析核对。新增回归覆盖中断与续问、完整 reasoning 保留、部分工具参数丢弃、未知用量、三库独立结算、跨连接隔离、重复控制、已结算但尚未发送完成事件时的竞态，以及原生 WSS 事件透传。

2026-11-04 本地验证：真实 SQLite 3.50.4、MySQL 8.4.11、PostgreSQL 15.17（MySQL/PostgreSQL 各自隔离主库与日志库）通过上述 HTTP WSS / 中断回归；`go test -race ./relay ./controller -run 'TestResponsesHTTPWebSocket|TestResponsesWebSocket|TestResponsesWS' -count=1`、`go vet ./relay ./controller`、root `go build` 通过。真实 Codex CLI 0.166.0 的 WSS、HTTPS、426 回退及连接满额回退验证通过，满额用例改为占满当前配置值，修正原先硬编码 3 条的过时假设。完整“追加指令触发中断”场景在该真实客户端中未成功复现，不能将协议帧回归表述成此场景的实机验收。

2026-11-04 北京时间23:55生产核验：三入口WSS握手、本地预存及续问、迟到/重复中断accepted、未知ID failed均通过。运维用户1经渠道65发起实际生成，收到response.created后中断，得到accepted及response.incomplete/interrupted，usage为null、完整output为空；同连接从该响应ID续问正常完成并返回OK。消费日志1782565/1782568分别0与212 quota，共0.000424站内额度，各结算一次；未调整用户180账户。此测试直接发送协议帧，仍不能替代真实Codex追加指令场景的验收。恢复与验证材料位于 `/root/upgrade-recovery/new-api-wss-interrupt-20261104T154412Z/`。

安全核对参考 OWASP ASVS 5.0.0、Authentication / Session Management / WebSocket Security Cheat Sheets：逐消息鉴权、对象归属、Origin、资源边界、断开清理与日志脱敏。这里只记录本次实现与回归范围，不声称全站通过 ASVS 认证。

官方协议与配置参考：

- https://developers.openai.com/api/docs/guides/websocket-mode
- https://developers.openai.com/codex/config-reference/
- https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- https://asvs.owasp.org/


## 首日完整运行统计（2026-11-03，北京时间）

只读生产日志统计11月3日00:00至11月4日00:00的 Responses/compact 调用记录：WSS 1487条、9位用户，其中1476条消费日志、11条错误日志；消费日志中1449条流状态正常、27条异常。因此不能用消费日志占比声称调用成功率。握手/鉴权阶段未写入业务日志的拒绝不在此统计内。

WSS输入Token共233603460，缓存Token217715599，输入Token加权缓存命中率93.1988%。1476个有效服务端首响样本平均7.021秒、中位5.0525秒、P90为11.585秒；同期HTTPS有效样本8244个，平均7.422秒、中位4.3395秒。均值低约5.4%但中位数高约16.4%，模型、线路、用户及上下文长度不同，不能将差异归因于WSS并宣传统一提速。服务端首响也不是客户端实测首字，未包含用户网络上传/传输时间。

本次可明确量化的升级是连接容量3→10，为原来的3.33倍、提升233.3%，不是模型生成速度提升。公告仅使用汇总数据；未代用户发布到Telegram。审计SQL和原始聚合结果位于上述服务器恢复目录。
