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

## 每用户最多三条客户端 WSS

- 按通过鉴权的本站 user_id 统计，同时最多 3 条 Responses WSS 物理连接。同一用户的不同 API Key、模型、设备共用名额；subAgent 只要另建连接，也占一个名额。不会按客户端自报的用户 ID 或 subAgent 名称分配额外名额。
- 第 4 条及后续连接在握手升级前返回 HTTP 426，Codex 可回退普通 HTTPS POST /v1/responses。已经占用的 3 条 WSS 保持运行，不排队、不抢占，也不重发已经提交的生成。
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
- 只缓存成功完成且有完整 output 数组的响应；失败、断流或结果未知的响应不作为下一轮历史。HTTP 上游失败没有应用层自动重放；部分已产生用量继续按已有计费规则结算。
- 取消请求会取消对应的 HTTP 请求；客户端断开也会终止该请求。每轮独立 request_id（`-ws-N`）、日志与结算，终止事件在本轮结算和限流完成后才发送，避免客户端立即续轮的竞态。
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

安全核对参考 OWASP ASVS 5.0.0、Authentication / Session Management / WebSocket Security Cheat Sheets：逐消息鉴权、对象归属、Origin、资源边界、断开清理与日志脱敏。这里只记录本次实现与回归范围，不声称全站通过 ASVS 认证。

官方协议与配置参考：

- https://developers.openai.com/api/docs/guides/websocket-mode
- https://developers.openai.com/codex/config-reference/
- https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- https://asvs.owasp.org/
