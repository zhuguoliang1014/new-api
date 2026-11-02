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

## 会话、续轮与恢复

- 每条客户端连接独立缓存，并绑定首次通过鉴权的 user_id 和 token_id；每轮重新检查 Key、用户状态、IP、模型权限和限流。不同用户、不同 Key、不同物理连接都不能凭 response ID 读取其他连接的历史。
- 同一连接当前串行处理 response.create。命名 stream_id 分别保存最近一轮，可交替续问或从仍保留的同连接父响应分支。一个正在执行的请求不能被另一条 create 覆盖。
- 保存原始 input/output 项，保留工具调用、工具结果和 reasoning.encrypted_content；向上游发送完整历史并删除 previous_response_id。拒绝跨上游存储查找的 conversation 和 item_reference，要求发送完整项。协议适配和渠道参数覆盖之后也不允许重新注入上游续轮 ID。
- `generate:false` 在本地预存输入、返回可续接的响应 ID，不调用模型、不生成消费记录。它不代表已在上游预热模型。
- 只缓存成功完成且有完整 output 数组的响应；失败、断流或结果未知的响应不作为下一轮历史。HTTP 上游失败没有应用层自动重放；部分已产生用量继续按已有计费规则结算。
- 取消请求会取消对应的 HTTP 请求；客户端断开也会终止该请求。每轮独立 request_id（`-ws-N`）、日志与结算，终止事件在本轮结算和限流完成后才发送，避免客户端立即续轮的竞态。
- 历史仅保存在该连接内，断开即释放；重启、多实例之间不共享。未命中的父响应返回 `previous_response_not_found`，客户端需要去掉旧 ID、发送完整上下文重建。已提交但结果未知的生成不能当成安全重试。
- 每连接缓存最多 32 MiB、33 份最近历史（32 个命名 lane 加默认 lane），进程缓存合计最多 256 MiB。缓存不足时仍交付已完成的生成；之后若无法续接，客户端需完整重放上下文。连接最长一小时，之后重连恢复。

日志列表在“流”列用 WS 标记客户端 WebSocket 请求，桌面及移动端一致；日志详情显示客户端协议，管理员还能查看上游协议。downstream_transport=websocket 对日志本人可见，upstream_transport=http 仅存于管理员 admin_info；旧记录缺少协议证据时不推测、不补标。Realtime 既有 ws 标记也能识别。不会因为普通 HTTP 使用流式响应就显示 WS，也不将 Responses WS 当成 Realtime 音频。无提示词、回答或新增凭据记录。计费直接复用普通 Responses 的预扣、usage 解析、结算与失败退款，不采用增量上传字节数折算 Token。

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
