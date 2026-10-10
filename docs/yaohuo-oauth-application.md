# 妖火网 OAuth 授权申请材料

## 论坛申请正文

申请为以下网站开通妖火网 OAuth 账号授权登录：

| 项目 | 内容 |
| --- | --- |
| 网站名称 | AiProxy |
| 网站地址 | https://aiproxy.chydocx.cn |
| 网站简介 | AiProxy 是一个面向开发者和团队的 AI API 聚合与管理平台，提供多模型 API 接入、统一调用转发、额度管理、用量统计、调用日志和团队协作功能。妖火 OAuth 仅用于本站账号登录和注册，不读取或保存用户密码。 |
| 授权用途 | 用户可使用妖火网账号登录或注册本站。本站仅保存妖火用户的唯一 ID 和昵称，不读取或保存妖火账号密码。 |
| 对接协议 | OAuth 2.0 Authorization Code |
| Scope | `profile` |
| 回调 URL | `https://aicloudroute.com/oauth/yaohuo` |

请提供该应用的 Client ID 和 Client Secret。Client Secret 仅用于本站服务端向妖火网换取 Access Token，不会展示给本站用户。

## 对接参数

- 授权端点：`https://yaohuo.me/OAuth/Authorize.aspx`
- Token 端点：`https://yaohuo.me/OAuth/Token.aspx`
- 用户信息端点：`https://yaohuo.me/OAuth/Profile.aspx`
- 用户 ID 字段：`userid`
- 用户名字段：`nickname`
- 昵称字段：`nickname`
- 邮箱字段：留空（妖火 Profile 不返回邮箱）
- Token 客户端认证：`client_secret_post`，即将 Client ID 和 Client Secret 放在 POST 表单中

## 拿到凭据后的 new-api 配置

在“系统设置 → 身份认证 → Custom OAuth → 添加 OAuth Provider”中填写：

| 配置项 | 值 |
| --- | --- |
| Provider Name | `妖火网` |
| Slug | `yaohuo` |
| Enabled | 开启 |
| Client ID | 妖火返回的 Client ID |
| Client Secret | 妖火返回的 Client Secret |
| Authorization Endpoint | `https://yaohuo.me/OAuth/Authorize.aspx` |
| Token Endpoint | `https://yaohuo.me/OAuth/Token.aspx` |
| User Info Endpoint | `https://yaohuo.me/OAuth/Profile.aspx` |
| Scopes | `profile` |
| User ID Field | `userid` |
| Username Field | `nickname` |
| Display Name Field | `nickname` |
| Email Field | `email` |
| Auth Style | `Params (in body)` |

回调地址必须与论坛登记值完全一致：`https://aicloudroute.com/oauth/yaohuo`。

参考：[妖火 OAuth 对接文档](https://yaohuo.me/oauth/docs.html)
