# 当前生产环境与运维手册

- **自然拍照姿势库50组上线（2026-11-10）**：按用户指定gpt-image-2.6-sunburst-basic生成50组/250视角，并用本地Depth Anything V2 Large完整FP32、1008处理分辨率生成250对应深度图。第一项目仅参考动作，风格只以本站P015线稿为准；站姿20、行走回身10、坐姿12、轻靠8组，五机位正/斜/侧/俯/仰，归原有分类。最终1500文件83,816,993字节，原图均900×1200，PNG/WebP全解码、源图深度哈希匹配、服务器逐文件SHA256通过；逐组检查并重做3组断线/动作不一致。56请求53成功含重做、3明确400修正补做，账单及令牌增量590000quota=1.18站内额度。功能revision257cdc1d1aee0b2ed9fea7535725a6ce87379be1已push，Actions42747417270 success，核验完整revision后固定镜像sha256:534b591b5d33fada6db52d57d2cf0cf333c515afbf17b98091fd678a3150104c，保留pull_policy never。北京时间11:25核验healthy、1500新媒体GET与哈希全过、三入口27探测及新JS/CSS正常，旧敏感样例仍404；总122组/610视角，原72组/1407服装/1499人物条目逐对象一致。245前端回归、类型/lint/格式、635.0KiB构建、Go/race/隔离root构建及本地图库搜索/机位/深度选用/大预览通过；正式站现有会话未登录，未声称正式站交互验收。发布期间独立审计18211—18282解释claude-fable-5-2计价、GroupRatio、渠道51/56/110修改及81/90/92/93/94删除、Key1500删除，均保留；其他既有配置、套餐/模型、.env和六容器不变。恢复目录/root/upgrade-recovery/new-api-natural-poses-20261110含148317694字节全库归档、SHA256 d87030a5f5f1f6a9523b4dd264b7719ea0de9bd631b2f2ad7b7a11f95eecf7a5与完整读取验证、素材清单/配置/审计/测试/上线核验及revision与Compose保护的回滚；仅切旧应用，不整库恢复，未实际回退。完整提示词/本地成品在桌面AI/自然拍照姿势库-50组，未发公告。详情docs/image-studio/natural-pose-library-20261110.md。

- **生成画布合并与过渡上线（2026-11-10）**：用户授权完成后提交上线，功能28cc9482a与结果自动选中新版dbe34285fbdb5f55d5cb5480cdaa50c4862d0794已push main，Actions42738685238 success。右侧未开始/提交/生成/接收/保存/失败/结果持续复用同一卡片，参考图上移与状态淡入；支持减少动态效果，提交时参考文件快照、多任务项目隔离和新结果自动选中保留。244项相关前端回归、native类型、改动lint/格式、隔离635.0KiB首屏构建及root构建通过；本地浏览器覆盖主要状态、390/320宽度、中浅/英深主题，不进行付费生图。北京时间10:00核验完整revision与healthy；因既有pull_policy never，另行验证完整revision后仅将app镜像固定到sha256:13a94805bd101fdc7fc343b031d2e2bd0c4b7f25e48c66d41d4501c9b38ea397。三入口状态/定价/姿势原图与深度及新JS/CSS正常，旧敏感样例保持404；options/套餐/渠道/abilities/模型/原令牌配置、.env及其余六容器一致。恢复目录/root/upgrade-recovery/new-api-canvas-transition-20261110含148161299字节全库归档、SHA256 66949f124fcef10c91ee6ddeeeb8cba7fabc429c27d90cdd98cdb6e73946c48c及完整读取验证、配置/测试/部署/核验和revision与Compose保护的rollback.sh，仅切旧应用不整库恢复，未实际回退。线上现有会话已退出，未声称线上登录交互验收；未发公告。Blender制作已按用户要求终止，未接入其样板。另按用户要求仅用aiproxy-image生成一张GPT Image 2原生五机位风格试样，账单0.18站内额度，保存在用户桌面AI/姿势图-AI风格试样；画风接近但多视角脚部与角度仍有不一致，待用户确认，不批量、不上传。详情docs/image-studio/canvas-transition-20261110.md。

- **敏感姿势素材下架（2026-11-10）**：按用户要求移除216组姿势，保留72组普通动作/360视角，服装1407和人物1499不变。功能revision `7652b0efae019edb22af420549b07aeed6497af7` 已提交push；Actions42731271329 success，因既有pull_policy never，已拉取核验完整revision后固定到镜像摘要 `sha256:ffcd85f230f85f2e2ee0686290fc8ec9163bd0715e9f5c23e50c30746e3af993`。公开目录移出6474个下架文件676909189字节至受限恢复目录，私有文件SHA-256全过；2160个保留姿势媒体未动。新版本目录同时作为资源允许列表，旧目录缓存/搜索/随机搭配/已存项目和内存草稿均排除下架素材，方案失效重建。239项前端回归、类型/lint/格式、635.0KiB构建、相关Go/race/vet/root构建通过，已查看全部360保留视角。北京时间09:01核验healthy，6474个旧媒体GET逐项404、2160个保留媒体GET逐项200，三入口状态/定价/保留原图深度图200与敏感样例404共21探测通过；options/套餐/渠道/abilities/模型不变，其余六容器未重启。原2453令牌仅1159在08:49:54经独立成功token.status_update审计18030由启用改停用，原样保留未覆盖，其余配置一致。恢复目录 `/root/upgrade-recovery/new-api-studio-pose-cleanup-20261110/` 含148059439字节全库归档及SHA256 `290bf2ee5268342eee1e51e4cfff8e3b206676488b556c90275af947c3ebdc2a`、完整读取校验、下架文件/配置/核验/测试和受revision及Compose摘要保护的应用回滚；不整库恢复、不自动将敏感素材重新公开，未实际回退。未付费生成或发公告；现有登录已退出，未声称完成正式站登录交互验收。用户随后澄清新素材目标为电商/日常/小红书照片常见的自然摆姿，同动作多机位、风格接近现有线稿；当前仅讨论新库方案，尚未批量制作新素材。

- **深度素材与工作台细节上线（2026-11-10）**：用户授权全量深度图、提示词隐藏内部系统段落、大图预览、占位插画、随机搭配及作品复用修复，完成后提交push上线。功能revision `7203676327fa4e69b780090a2531b1434e409907`；234项相关前端回归、类型/lint/格式、635.4KiB首屏构建及相关Go/race/vet/root构建通过。V2 Large完整FP32、1008长边推算1439张900×1200深度PNG，半身400张补齐原稿未闭合裁切轮廓；2878张WebP配套，总4317文件128264681字节，本地对应关系与服务器SHA-256全过。Actions42681496498 success，但部署因既有本地镜像和pull_policy never仅重启旧92b397327；已另行拉取并验证本次完整revision和摘要，Compose仅new-api.image固定到 `ghcr.io/zhuguoliang1014/new-api@sha256:20d2c58ef8d09b85c7069d31f3b4b2a1535796804e0f45f5f40dc546c4fd5b88`，保留never，禁止后续误拉旧latest。北京时间03:24核验新版healthy，香港本机/主站/国内入口状态、定价、三档深度资源及新JS/CSS均200；options/套餐/渠道/abilities/模型/既有Key配置一致、其余六容器未重启。桌面/390/320浅色及英文深色真实本地浏览器已验收，正式站现有会话已退出登录，未冒充完成线上已登录交互验收；未做付费生图、未发送公告。恢复目录 `/root/upgrade-recovery/new-api-studio-depth-20261110/` 含147988291字节完整库备份（SHA256 `541f0ed4be7d62789b78f94972913f23e0eae7b816f7c2859e5a78443c8e62ab`）、完整读取/摘要验证、配置/素材/测试/Actions及受revision与Compose摘要保护的rollback.sh；仅恢复旧应用与本次镜像字段，不整库恢复，未实际回退。其他未提交草稿保留。详情 `docs/image-studio/depth-and-workflow-20261110.md`。

- **GPT Image 2.6 路线与 SVG（2026-11-07，配置已生效、代码仅提交本地主分支）**：126 超分补充 `gpt-image-2.6-flare-basic`、`gpt-image-2.6-sunburst-basic`，均 0.02/张；127 原生补充对应 `-native` 两款，均 0.18/张。接续核验线上四项定价与画图分组正确、容器 healthy，当前应用 `d2b0b7c4b36c`。本地已补齐 2.6 自动/PNG/JPEG/GIF/SVG、SVG 原件预览/单图与 ZIP 下载；GIF 与静态图混合响应保留全部结果，按上游实际张数计费。任务 `MJHZzpY5YzRhV3SS-edTe` 的 GIF/PNG 原始响应仍保存，修复上线后可仅重新处理保存响应、不重发生成。先前误退 0.02 已用独立更正记录撤销，保留原消费/退款/更正证据。原生 flare 实测 SVG 请求返回 PNG，明确 SVG 且无 SVG 结果会报错，不将 PNG 冒充 SVG。180 项前端、相关 Go/race、类型/lint/构建和浏览器 SVG 核验已通过，接续再次通过相关 Go 与类型检查；按用户本次授权将代码提交到本地 `main`，暂不 push、不部署；上线仍等待明确通知。恢复材料 `/root/channel-recovery/gpt26-variants-svg-20261107/`；本机可审查补丁与范围清单 `/tmp/newapi-gpt26-svg-20261107/review-ready/`。

最近实机核对：**2026-10-21（sub2api 域名与数据补齐），北京时间**；其余服务以各节注明的核查日期为准。此文档用于新会话快速接手当前生产环境；具体版本、容量、证书和任务结果会变化，执行操作前按相关命令复核。

- **WSS 稳定性与取消分类修复上线（2026-11-05）**：按用户授权提交并 push main，revision `dc1aabf8b5fbb7109aa3a7cd900eb2bf72e97737`，Actions `41957868263` 构建、部署均 success。北京时间 **10:59** 核验容器 healthy、香港本机/主站/国内入口状态与定价均200、前端资源正常。修复历史缓存元数据预算及标识长度限制、auto 分组续轮锁定、Azure 续轮参数、终止事件不等EOF，以及正常完成缺usage时的输入估算；异常断流仍保留未知缓存输入保护。等待上游响应头时明确 context.Canceled 的请求改记 `request_cancelled`/499、禁止重试并按原失败流程退款，避免误报上游500。三入口 WSS101、generate:false 续问、超长model/父ID拒绝后同连接恢复、迟到/重复中断及未知ID拒绝均通过，无付费生成。SQLite3.50.4/MySQL8.4.11/PostgreSQL15.17真实三库回归、相关race、vet和root构建通过。135项options、31套餐、94模型、43渠道、2367令牌及既有用户设置/权限一致，Compose/.env/Nginx一致；sub2api、两套数据库及Redis容器未重启。耗时统计界面未改，原入群机器人未跟踪草稿保留且未发布。恢复目录 `/root/upgrade-recovery/new-api-wss-fixes-20261105T024915Z/` 含138160242字节全库备份、SHA-256及完整归档读取验证、配置快照、测试/Actions/线上核验记录和带revision保护的 `rollback.sh`；回滚镜像 `ghcr.io/zhuguoliang1014/new-api:rollback-wss-fixes-20261105t024915z`，仅切旧应用、不整库恢复，Compose检查通过，未实际回切。未发送公告。

- **new-api rc.48 升级（2026-11-05）**：按用户授权合并官方 `v1.0.0-rc.48`（上游 `706144769e5bed5a47b78721e3bb11da3cf4c0b9`），提交并 push main，发布 revision `cecbab671b275a26a9950f30c206f88f5303f938`，Actions `41865748394` 构建和部署均 success。北京时间 **09:02** 核验生产版本 `v1.0.0-rc.48+cecbab671b27`、容器 healthy、香港本机/主站/国内入口状态与定价均200、新 JS/CSS 正常；三入口 WSS101、generate:false 本地续问、迟到/重复中断及未知ID拒绝通过，本次未进行付费生成。135项options、31套餐、94模型、43渠道及原2362令牌配置与升级前一致，保留正常新增5令牌和4用户；既有用户设置/权限及Nginx配置保持一致。前端240文件/2872项测试、native tsgo、改动lint/格式及608.9KiB首屏构建通过；root构建/vet、relaykit/tokenkit独立测试构建、48个root测试包（排除两项已在旧版复现的套餐冻结过期夹具与代理环境host断言失败）、相关race通过。SQLite3.50.4/MySQL8.4.11/PostgreSQL15.17真实三库新装/旧定制版升级及两次重复启动、数据/列/索引/唯一性、路由/定价与任务结算核验通过。未跟踪的 `cmd/telegram-order-bot/group_lookup.go` 和对应测试是原有未完成草稿，保持原样且未发布，后端全量验证针对仅含已跟踪发布代码的隔离副本。恢复目录 `/root/upgrade-recovery/new-api-rc48-20261105/` 含137831086字节全库备份、SHA-256、归档完整读取验证、配置快照、测试/部署记录及verify/rollback；回滚镜像 `ghcr.io/zhuguoliang1014/new-api:rollback-rc48-20261105`，带revision保护的 `sh rollback.sh` 仅切旧应用，不整库恢复，Compose检查通过、未实际回切。新版“模型定价105”经现有登录会话逐页核对，全部为任务插件模型“还没设置价格”，按模型名去重，统计范围包含插件声明模型且不以已启用渠道筛选；未为清除提醒修改售价或插件配置，未发送公告。

- **Responses WSS 中断兼容上线（2026-11-04）**：按用户授权提交并 push main，revision `ab90fa8e2e1d56f9fd50e62f2c1f49afeacf51fe`，Actions `41861048539` 镜像构建与部署步骤均 success（截至北京时间23:55，作业汇总状态仍为 in_progress）。北京时间23:55核验生产 revision、容器 healthy、三入口状态/定价及前端资源200。兼容 `response.interrupt` 的 accepted/failed 回执，取消当前 HTTP 上游后返回 `response.incomplete/interrupted`，保留完整 output item、丢弃部分项并支持同连接续问；隔离其他连接和不匹配 ID，处理重复、迟到及结算完成交错的中断，原生 WSS 保留透传。三入口无生成探测的迟到/重复中断、未知 ID 拒绝与本地续问通过；运维用户1经渠道65实际中断后续问返回 OK，两条消费日志1782565/1782568各结算一次：中断无usage、无已交付输出为0 quota，续问212 quota，共0.000424站内额度。未操作用户180凭据或余额；真实 Codex 追加指令触发中断场景仍待用户验收，不以协议帧验证代替。真实SQLite3.50.4/MySQL8.4.11/PostgreSQL15.17回归、race、vet和root构建通过；Codex0.166.0的WSS/HTTPS/426及当前容量回退通过。135项options、31套餐、94模型、43渠道及原2361令牌配置一致（正常新增1令牌保留），无结构/价格配置修改。恢复目录 `/root/upgrade-recovery/new-api-wss-interrupt-20261104T154412Z/`（700/600），137820508字节全库归档、SHA-256、目录及完整读取验证通过；回滚镜像 `ghcr.io/zhuguoliang1014/new-api:rollback-wss-interrupt-20261104t154412z`，带revision保护的 `sh rollback.sh` 仅切旧应用，不整库恢复；Compose配置检查通过，未实际回切。

- **TG公告原生频道同步与格式上线（2026-11-04）**：按用户授权提交push main，revision `86a6deb2f34cd693eec3748e5a5d44b6ae0a616f`，Actions `41779024776` 构建部署success；北京时间13:31核验healthy、三入口状态/定价及新资源200。默认仅向频道发一次，由Telegram转发到关联讨论群；预览/发送前核验目标频道关联本站群，保留仅发群组和其置顶。正文支持Markdown加粗/斜体/代码/引用/链接，标题加粗，落款保留，地址只放按钮；UTF16按实际文本限4096，旧预览须重新确认，历史回执及未知结果不重放。24项前端、native tsgo、改动lint/格式、608.1KiB首屏构建，SQLite3.50.4/MySQL8.4.11/PostgreSQL15.17真实三库与race、路由权限/vet/root构建通过；1314/390/320宽度、中英浅深主题核验。线上真实现有登录会话预览与确认弹窗通过，核验后取消，原2条发布记录不变，未发送测试公告。31套餐、options/模型/渠道及原令牌配置保持一致，无数据库结构修改。恢复目录 `/root/upgrade-recovery/new-api-tg-channel-20261104T052130Z/`（700/600）含136491289字节全库归档、SHA-256及完整归档读取验证、配置快照、验证记录；回滚镜像 `ghcr.io/zhuguoliang1014/new-api:rollback-tg-channel-20261104t052130z`，`sh rollback.sh`仅切旧应用，不整库恢复，Compose回滚配置检查通过、未实际回切。

- **WSS 管理配置与手机上传防护（2026-11-04）**：用户授权后已发布代码 `c33eb297141d12069281a7cad4fb246747c98ed9`，Actions `41769210971` success；北京时间11:52核验 healthy、三入口状态/定价及新资源200。每用户默认10条 Responses WSS，管理员在「系统设置 → 附加功能 → Responses WebSocket」保存1–1000整数，无需重启；本站定制功能设置归入附加功能。真实主站10条101、第11条426，满额时国内入口426、HTTPS模型查询200，释放后国内101；未发起模型生成或扣费。含参考图空文件名/读取失败防护及错误翻译；用户1507故障手机仍需原图复测，不能认定已确认根因。176项前端、类型/lint/构建、真实三库配置持久化/重载与race、真实Redis租约、相关WSS及上传回归通过；options134、套餐27、模型94、43渠道配置与原2339令牌配置一致。恢复目录 `/root/upgrade-recovery/new-api-wss-admin-20261104/`，全库136215096字节，SHA-256和完整归档读取通过；回滚镜像 `ghcr.io/zhuguoliang1014/new-api:rollback-wss-admin-20261104`，仅切旧应用，不整库恢复。11月3日WSS汇总1487条调用记录、输入Token缓存命中93.2%；不同样本首响均值/中位数结论不一致，不将其写成统一提速。未发送TG公告。

- **画图4K首轮上线核验（2026-11-03）**：56967546ffc2b6b3f8caffa654a9729f7cf04fbd已合并main并push，Actions41567645307构建部署success；北京时间10:49核验容器healthy、三入口状态/定价200，新模型菜单仅超分/原生及香蕉/MJ，默认4K。126–129已启用、优先级100，118高级旧线路停用。16个公开/兼容模型售价已更新，MJ1.30/次未改；仅2项options和14条模型说明及6渠道目标字段，27套餐、原2227令牌配置和原用户设置保留（期间两位正常新用户/令牌不覆盖）。13次本站真实正常选路全部200，十个模型首次生成、GPT/香蕉参考图编辑及GPT两张批量均命中126–129，逐项新价一致；合计580000 quota=1.16站内额度。超分/香蕉首次4K为4096×4096，原生正方形4K档受像素限制为2880×2880；原生16:9此前实测3840×2160。备份与verify/rollback及真实响应在/root/upgrade-recovery/new-api-image-4k-20261103/。公告代码25602c388同批上线，新表已创建；主站通过/data/telegram-announcement.json(600)复用既有入群bot凭据，未发送公告、未配置独立广播频道。旧高级作品复用迁移补丁正在随同本次授权追加发布，178项前端测试/类型/lint/构建通过。

## 画图4K与新渠道发布准备（2026-11-03）

- **画图4K与新渠道发布准备（2026-11-03）**：用户授权完成后合并main并将全部本地修改一起push上线；后续补充要求GPT工作台仅保留「超分、原生」，移除高级。工作台最多4K并默认最高档；旧8K草稿按比例降到4K，历史原图不重写；高级与旧1K香蕉在工作台隐藏，已有API别名兼容保留。计划启用126–129、优先级100；117补旧hq兼容，118停用。售价按用户要求：普通GPT（含旧hq别名）0.02、原生GPT0.18、香蕉2 0.08、香蕉Pro/2.1 0.09元/张，MJ1.30元/次不变；1–4K同价。配置事务及带保护的回滚演练通过，备份 `/root/upgrade-recovery/new-api-image-4k-20261103/`，133626258字节，完整归档读取和SHA-256通过，回滚镜像 `ghcr.io/zhuguoliang1014/new-api:rollback-image-4k-20261103`。本地176项工作台/公告/侧栏前端测试、native TypeScript(tsgo)检查、改动文件lint/格式、构建及607.7KiB首屏预算通过；真实SQLite3.50.4/MySQL8.4.11/PostgreSQL15.17工作台授权/限制和四档图片计费/退款矩阵、公告新表迁移/幂等矩阵、相关race/vet通过。扩展controller/model测试仅排除既有套餐冻结SQLite基线失败；补齐原有公开用户榜PAT路由声明后router/middleware全测通过。新上游原生GPT2/sunburst默认参数、香蕉Pro别名/2.1、香蕉原生参考图及GPT multipart参考图均真实200；未用这些直连验证代替本站发布后路由和新售价核验。当前分支另含25602c388公告功能提交及此前未跟踪的入群机器人源码、品牌图片、站点说明和运维交接；无凭据入库。待发布后记录实机结果。

## 新增画图渠道暂存（2026-11-03）

- **新增画图备用渠道，暂不启用（2026-11-03）**：按用户要求添加 TinySnow 四把独立凭据，对应渠道 **126 基础1–4K、127 原生1–4K、128 香蕉Pro1–4K、129 香蕉2 1–4K**，优先级均为 **100**；用户随后明确选择「先保存渠道，暂不启用」，最终均 `status=2`、14条新增 abilities 均 disabled。原渠道117–121继续服务，8K高质量未切换。北京时间 **09:01** 核验三入口状态/定价200、容器healthy、revision仍为d51820495089953a4b35647f70bcc5ad2fbca463，无重启或代码发布。GPT基础2.5公开名映射至上游gpt-image-2.5-flare；上游裸gpt-image-2.5实测503。直接上游实测GPT2、flare、香蕉Pro/香蕉2均4096×4096；原生flare quality=max为3840×2160。8192×8192 flare及8192×4608 GPT2均400拒绝，不可挂现有8K模型。站内现有工作台Key经126两款基础、129两款香蕉2真实生成200，分别15000/62400 quota，共154800 quota（0.3096站内额度）；127及128后续出现上游余额不足，失败无消费日志扣费。四把Key的/v1/usage均显示balance=-0.01，账面单价仍为GPT0.04、香蕉2 0.08、香蕉Pro0.09、原生0.18，尚未确认用户提供优惠价0.01/0.05/0.065/0.12生效，启用前须补余额并复核。参考图编辑未完成验证。options134项、套餐27项、原40渠道配置、94模型资料、2227令牌配置及所有已启用分组模型集合保持一致。恢复目录 `/root/channel-recovery/tinysnow-20261103/`（700/600）含133458381字节全库备份、SHA-256、完整归档读取验证、带保护的写入/回滚事务演练、前后快照、真实出图及verification-final.json；rollback.sh只停用本次四渠道，不覆盖余额/历史消费，不恢复整库。凭据和带签名图片地址仅在受限材料中保存。

- **充值后价格复测（2026-11-03，北京时间10:12）**：用户确认充值10元对应10站内额度（1:1），仅直接上游各生成一张核对价格，未启用渠道或修改本站售价。四次均HTTP200：GPT基础flare high返回4096×4096，余额9.99→9.98、实扣¥0.01；香蕉2 preview返回4096×4096，9.98→9.93、实扣¥0.05（cost标价0.08，actual_cost0.05）；香蕉Pro preview返回4096×4096，9.93→9.86475、实扣¥0.06525（cost标价0.09，actual_cost0.06525，比口头报价0.065多0.00025元）；原生flare max返回3840×2160，9.86475→9.74475、实扣¥0.12。合计¥0.24525，每把Key请求增量均1，余额差与actual_cost逐项一致。优惠价数字除Pro微小差异外与报价一致，不能再用cost标价单独判断优惠未生效。四渠道126–129仍status=2、priority=100；未通过本站API调用或扣本站余额，参考图编辑及其余别名未在本次补测。审计材料 `/root/channel-recovery/tinysnow-20261103/price-recheck-20261103T020643Z/` 包含前后账单、响应、原图与verification.json，受限保存。

## 每日 Token 榜纳入全部角色（2026-11-03）

- **每日 Token 榜纳入全部角色（2026-11-03）**：按用户授权修改并 push 部署，revision `d51820495089953a4b35647f70bcc5ad2fbca463`，Actions `41492017878` 构建部署 success；北京时间 **01:37** 核验版本 `v1.0.0-rc.47+d51820495089`、容器 healthy、三入口状态/定价 200。移除仅普通用户的角色筛选，正常未删除账号中的普通用户、管理员和超级管理员均入榜，用户名继续脱敏；仍按北京时间每日正值输入+输出汇总。用户 1 当日第 1，29,653,729 Token；昨日第 2，186,426,847 Token，两个日期全榜与只读 SQL 逐项一致。SQLite 3.50.4、MySQL 8.4.11、PostgreSQL 15.17 真实三库回归及 race、go vet、root 构建通过。options134项、套餐27项、渠道40项配置（排除正常累计用量）、模型94项、令牌数量及 Nginx 与发布前一致。恢复目录 `/root/upgrade-recovery/new-api-all-user-rankings-20261102T173053Z/`（UTC 命名），全库备份133,348,669字节、SHA-256及完整归档读取验证通过，含配置快照、verify.sh/rollback.sh和verification.json；回滚镜像 `ghcr.io/zhuguoliang1014/new-api:rollback-all-user-rankings-20261102t173053z`，仅切回应用，不恢复整库，未实际回切。

本次验证命令（本地 DSN 通过环境变量指定专用测试库）：

- `TEST_MYSQL_DSN=… TEST_POSTGRES_DSN=… go test ./service -run '^(TestUserRankingDay|TestDailyUserRankingsDatabaseMatrix)$' -count=1 -v`：SQLite 3.50.4、MySQL 8.4.11、PostgreSQL 15.17 全部通过，未跳过数据库。
- 同环境 `go test -race ./service -run '^(TestUserRankingDay|TestDailyUserRankingsDatabaseMatrix)$' -count=1`：通过。
- `go vet ./model ./service ./controller`、`go build -o /private/tmp/newapi-rankings-all-20261103/new-api .`、`git diff --check`：通过。
- 回归覆盖管理员/超级管理员入榜、各自本人排名及 Token、跨调用缓存身份隔离、匿名不返回本人数据与真实用户名、禁用/删除账号排除，以及原有日期边界、同量排序、前100名外本人排名。
- 线上只读 SQL 与三入口 `/api/rankings/users` 核验 11 月 2 日（35人、1,035,022,908 Token）、11 月 3 日（5人、44,709,743 Token）；当日用量是01:37快照，后续正常变化。未创建替代管理员凭据，未通过浏览器代测登录后的个人卡片；本人字段由三库服务回归验证。

## WSS 缓存修复与连接上限发布（2026-11-03）

- **WSS 连接上限与缓存/断流计费修复上线（2026-11-03）**：用户最终授权测试后 push 上线，revision `24c20b446d37b3df285cfd4cc13b4af86081dfdd` 已在 main 并 push，Actions `41480070697` 构建部署 success；北京时间 **00:27** 核验版本 `v1.0.0-rc.47+24c20b446d37`、容器 healthy、三入口状态/定价 200，新中英语言包、首屏资源及日志 WS 标记生效。并包含此前本地前端优化 `f6c8558cf`。每个用户跨 Key/设备/subAgent 共最多 3 条 Responses WSS，Redis 原子租约计数；超限升级前 426，Codex 本地真实回退测试通过，线上满额时 HTTPS 生成正常。修复本地 generate:false 提前选路、续轮漏会话模板、流中 usage 丢失及明确零值覆盖；仅 WSS→HTTP 无 usage 断流不再将完整历史估为全价未缓存输入，保留已交付输出/工具结算并标记输入未知及上下文估算。线上 root 运维 Key 经渠道65：原有1连接基础上两条新连接101、第4条426；跨连接及重连父ID拒绝、非法输出上限拒绝且无额外消费，完整历史重建续聊成功；正常路由首次/续轮/重连均应用相同缓存亲和标识及模板，6轮WS日志独立、上游请求ID齐全，另1次HTTPS正常。重连测试缓存4736/4916，约96.3%，仅短测试样本，不保证Krill缓存保留或长上下文首字提速。7次正常生成合计2034 quota（0.004068站内额度）；未退款或修改历史账单。options134项/套餐27项/模型94项一致，渠道仅65正常used_quota变化、令牌总数2227不变。SQLite3.50.4/MySQL8.4.11/PostgreSQL15.17、Redis7.2.6、100用户200轮隔离/race、真实Codex0.162.1开关/回退、vet/构建通过；发布前后端相关回归排除两项已在修改前复现的基线失败（套餐冻结SQLite、代理环境host断言），前端44项/类型/构建与585.9KiB首屏gzip预算通过。恢复目录 `/root/upgrade-recovery/new-api-ws-cache-20261102T161628Z/`（UTC命名），133,316,439字节完整数据库归档SHA-256及完整读取校验通过，含配置快照、verify.sh/rollback.sh与verification.json；回滚镜像 `ghcr.io/zhuguoliang1014/new-api:rollback-ws-cache-20261102t161628z`，仅切回旧应用，不整库恢复、不改Nginx。未实际回切。

- **画图模型目录维护约定（2026-11-05）**：工作台模型来自启用渠道的 abilities，GPT 以一个大类下的「超分、原生」展示，分类顺序固定 GPT、香蕉、Midjourney；默认模型为 `gpt-image-2.5-flare-basic`。新建「画图」工作台专用 Key 由画图分组和图片能力校验约束，不再冻结创建时的模型名单；已有自定义模型限制、停用/删除状态及 IP/额度限制仍生效。此次将116把匹配旧版完整自动名单的现存 Key 改为跟随该分组，限定事务及逆向脚本保存在 `/root/upgrade-recovery/new-api-image-catalog-20261105/`；其他 Key 未纳入该迁移。新增模型时须同时验证渠道 abilities、工作台 bootstrap、实际列表和价格，不能仅检查映射或模拟数据。

- **GIF 与订阅页精简上线（2026-11-07）**：按用户授权提交并 push main，功能提交 `e29c7c7cfca76d16b59e06ac397cde927ee9ee48`、黄色警告样式修正 `fdf464c65ee11ffb7f5d5b52986fd5b642840a13`；Actions `42340407963`、`42341085338` 均 success，最终生产 revision 为后者。工作台 `gpt-image-2.6-basic` 提供自动/PNG/GIF，切换进入默认自动，自动保留实际格式；GIF 原始字节/多帧保留，静态结果失败且不自动重放付费请求。钱包提示仅保留单行「GPT 订阅仅限使用 GPT 模型。」，沿用黄色警告浅深主题；我的订阅标题和状态/刷新分开、空状态居中。218项相关前端回归、颜色修正10项回归、类型/改动lint/格式和610.4KiB首屏构建、相关Go回归/race/vet/root构建通过。生产工作台真实任务 `UHoEEVTndKcsyVwVKh-gG` 经126生成成功，消费日志1810393仅结算10000 quota=0.02站内额度；原图414×414、9帧循环GIF，原文件与浏览器本地保存通过。该次请求为1024×1024，上游实际尺寸较小，界面有提示。三入口状态/定价与新资源、容器healthy及订阅页/2.6格式选项均核验通过，原配置及其他六容器保持一致。恢复目录 `/root/upgrade-recovery/new-api-gif-wallet-20261107/` 和 `/root/upgrade-recovery/new-api-wallet-warning-20261107/` 分别保存142427176/142438894字节全库归档及SHA-256、完整归档读取验证、配置快照、测试/Actions/实机核验和带revision保护的回滚；仅切旧应用，不整库恢复，未实际回切。既有机器人与未提交运维草稿保留，未发送公告。

## 1. 范围与连接方式

只维护下列当前机器，不再操作退役环境；CPA 不在部署范围。本文不包含密码、私钥、API key 或完整代理链接。

| 本机 SSH 别名 | 实际连接 | 职责 | 权限与时间 |
| --- | --- | --- | --- |
| `ssh aiproxy-hk` | `root@64.90.21.44`，端口 `18272` | 香港生产：new-api、sub2api、Nginx、手机代理 | root；主机时区 `Etc/UTC` |
| `ssh search` | `ubuntu@1.14.65.7`，端口 `22` | 国内 API 入口与 Nginx 转发 | 管理命令用 `sudo -n`；北京时间 |
| `ssh aliyun` | `root@8.141.100.180`，端口 `22` | 异地数据库备份接收 | root；北京时间 |

三个别名由本机 `~/.ssh/config` 管理，当前使用 `~/.ssh/id_ed25519`。先复用已有密钥和别名，不要重新生成覆盖。核对配置：

用户操作约定（2026-10-22）：能通过数据库完成的查询或修改，直接使用 SSH 与数据库，不使用浏览器操作；修改前保存恢复材料，修改后核对数据与应用缓存生效情况。

用户侧资源命名（2026-11-01 用户确认）：为用户自动创建的 Key、分组、模型说明等资源不含供货商品牌，使用中性用途名称；标准模型名和 flare/sunburst 等路线名保留。历史消费审计记录不做名称清洗。

开发与发布约定（2026-11-01 用户确认）：开发及功能验证先在本地完成，可运行仓库根目录的 `sh dev-local.sh`。所有功能开发完成后，等待用户明确通知提交上线，才提交代码、合并、push 和部署；此前允许验证后直接推送主分支的授权不再适用于后续开发。推送 main 会触发生产部署，不能用于本地验证。

```bash
ssh -G aiproxy-hk | awk '/^(hostname|port|user|identityfile) /'
ssh -G search | awk '/^(hostname|port|user|identityfile) /'
ssh -G aliyun | awk '/^(hostname|port|user|identityfile) /'
```

香港是 UTC，容器日志可能采用不同的时区。关联 Nginx、应用、数据库和支付记录时，先看时间偏移；面向用户统一说明北京时间。

## 2. 服务、数据与访问入口

### 香港服务

| 服务 | 运行方式 / 容器 | Compose 与配置目录 | 入口 / 数据 |
| --- | --- | --- | --- |
| new-api | Docker：`new-api` | `/root/new-api/docker-compose.yml`、`/root/new-api/.env` | `127.0.0.1:3001` → 容器 `3000`；主站 `https://92ai.asia` |
| new-api 主库 | Docker：`postgres`，PostgreSQL **15.17** | 同上 | 库 `new-api`，角色 `root`；命名卷 `new-api_pg_data` |
| new-api 缓存 | Docker：`redis` | 同上 | `/root/new-api/redis_data` |
| sub2api | Docker：`sub2api` | `/opt/sub2api/docker-compose.yml`、`/opt/sub2api/.env` | `127.0.0.1:8089` → 容器 `8080`；`https://sub2api.92ai.asia` |
| sub2api 主库 | Docker：`sub2api-postgres`，PostgreSQL **18.3** | 同上 | 库和角色均为 `sub2api`；`/opt/sub2api/postgres_data` |
| sub2api 缓存 | Docker：`sub2api-redis` | 同上 | `/opt/sub2api/redis_data` |
| Nginx | 系统服务 `nginx` | `/etc/nginx/nginx.conf`、`/etc/nginx/conf.d/` | 公网 `80`、`443` |
| 手机代理 | `shadowsocks-libev.service` | `/etc/shadowsocks-libev/config.json` | `18443/TCP`、`18443/UDP`，`aes-256-gcm`，兼容 Shadowrocket |
| sub2api 出站代理 | `sing-box-jp-proxy.service` | `/root/proxy-client/sing-box-jp.json` | Docker 网桥 `172.19.0.1:7891`；排查 sub2api 出站时关注此服务 |

数据库路径说明：

- new-api 的命名卷实际位于 `/var/lib/docker/volumes/new-api_pg_data/_data`；`/root/new-api/data` **不是主库**。
- sub2api 当前 `PGDATA=/var/lib/postgresql/data`，实机确认主库来自 `/opt/sub2api/postgres_data`。它还有一个挂载到 `/var/lib/postgresql` 的匿名卷，不要仅凭卷名判断主数据位置。
- new-api 配置中没有单独的 `LOG_SQL_DSN`，当前业务日志与主库一起备份。之后如拆分日志库，应扩充备份范围。
- new-api 的数据辅助目录为 `/root/new-api/data`，应用日志目录为 `/root/new-api/logs`。
- sub2api 的持久配置为 `/opt/sub2api/data/config.yaml`，另有同目录的价格、插件、页面和日志文件。
- `.env` 和上述配置可能包含敏感值，只在必要时于受限环境读取，不把完整内容输出到会话或提交到 Git。

### 关于页重设计（2026-10-31）

- 页面内容保存在生产 `options.About`，由现有 `RichContent` / `HtmlContent` 隔离渲染；维护源文件为 [docs/site/about.html](site/about.html)。这是站点自定义中文 HTML 内容，不是前端组件或 locale 文案，更新无需构建或发布镜像。
- **10 月 31 日按用户反馈调整**：页面改为白底、深灰正文、蓝色链接，使用既有品牌标识与分栏正文；删除初版口号、流程图、英文装饰和大色块。内容为平台介绍、服务范围和接入说明，提供模型、文档、令牌与日志入口。无客服微信号、微信二维码、群链接和其他联系方式，仅提示通过网站顶部社群入口加入。不得在此内容中重新增加独立加群方式。
- 通过 SSH 在生产 PostgreSQL **15.17** 中仅更新 `About`。先保存 `options` 表自定义格式归档，`pg_restore --list` 读取验证通过，再执行原值检查、目标行锁及其他 options 摘要保护的事务回滚演练和正式提交；数据库返回内容与源文件一致，其他配置摘要不变。未修改数据库代码、表结构或查询逻辑，不涉及三库迁移验证；无需重启服务。
- **10 月 31 日北京时间 00:04**：主站与国内入口 `/api/about`、`/api/status` 均为 200，内容 SHA-256 与源文件一致，缓存同步生效，容器 running/healthy。Chrome 实页核对桌面、320/390 像素窄屏及浅/深色主题；无横向溢出，品牌图片加载正常，固定页头未遮挡正文。未验证旧版手机内核，不宣称全部移动浏览器兼容。
- 当前恢复材料 `/root/site-recovery/about-corporate-20261030T160039Z/`（UTC 命名），目录 700、文件 600，包含 `options-before.dump`、`about-before.html`、`about-after.html`、演练/提交及 `rollback.sql` 和验证报告。回滚前核对后续是否编辑了关于页，使用 `docker exec -i postgres psql -X -U root -d new-api -v ON_ERROR_STOP=1 < /root/site-recovery/about-corporate-20261030T160039Z/rollback.sql`，只恢复该项。等待现有配置同步后检查 `/api/about`，不要覆盖恢复整个 options 表。10 月 30 日初版恢复材料保留在 `/root/site-recovery/about-redesign-20261030T154704Z/`，不能越过当前版本直接运行其旧回滚脚本。

### 站点品牌图标（2026-10-29）

- 用户选定第一组浅色底 A 字标＋青蓝粉色环绕 PNG。生产 `options.Logo` 为 `https://92ai.asia/static/uploads/images/20261029-aiproxy-brand-light-52157c6838a3.png`；原图为 1024 × 1024、937,718 字节，SHA-256 `52157c6838a36aa43c4fa03c30b258f5f1140770c4698191cf78e3c438cfe941`。
- 文件保存在香港 `/var/www/aiproxy-static/uploads/images/20261029-aiproxy-brand-light-52157c6838a3.png`，权限 644；沿用现有 Nginx `/static/` 静态目录和缓存策略，没有修改 Nginx。使用带内容摘要的新地址避免旧图缓存。
- 通过 SSH 在生产 PostgreSQL **15.17** 修改单个 `Logo` 选项；先保存 options 表自定义格式归档并通过 `pg_restore --list`，保存旧 Logo 和新旧配置，再执行带原值校验的事务回滚演练及正式提交。其余 options 的排序摘要前后一致；这是生产配置修改，未修改数据库代码或结构。
- 北京时间 **22:47** 核对应用现有选项同步已生效，主站及国内入口 `/api/status` 均为 200 并返回新 Logo；图片返回 `image/png`、HTTP 200，公网内容 SHA-256 与本地原图一致。应用容器 running/healthy，实际版本 `v1.0.0-rc.47+5d51c978bd5e`；本次无需重启应用或发布代码。页面已有 Logo 配置用于品牌图片和动态 favicon，浏览器已核对页头显示新图、图片 naturalWidth 为 1024 且加载完成，动态 favicon 指向 Logo；已打开的页面需刷新加载新配置。
- 恢复材料在香港 `/root/brand-recovery/newapi-logo-20261029T144520Z/`，目录 700、配置和数据库归档 600，含 `options-before.dump`、`logo-before.json`、旧图、新图、`change.json`、事务 SQL 和执行记录。回退前先确认 Logo 后续未再次变更，然后执行 `docker exec -i postgres psql -X -U root -d new-api -v ON_ERROR_STOP=1 < /root/brand-recovery/newapi-logo-20261029T144520Z/rollback.sql`；脚本只恢复该 Logo 并校验新值，等待选项同步后核对 `/api/status`。旧图保留，不要用整表备份覆盖其他实时配置。

### Telegram 后台公告页（2026-11-03，本地实现，待发布）

- 管理员侧栏底部新增独立 `TG 公告` 页面 `/telegram-announcements`，仅超级管理员浏览器会话可用，个人访问令牌不允许发布。包含编写、预览确认、发布记录、固定模板设置；默认按钮使用用户指定的频道链接与官网对接链接，未来公告自动附带两行按钮和落款。正文作为纯文本转义，标题自动加粗；完整消息含落款最多 4096 UTF-16 单元。发布不读取或消费入群机器人的 Telegram 更新。
- 应用从环境变量 `TELEGRAM_ANNOUNCEMENT_CONFIG` 指向的受限 JSON 读取 `token`、`bot_username`、`group_id`、可选 `channel_id`，凭据不会通过管理 API 返回。上线时由 root 从既有入群机器人配置提取所需字段，保存为专用 600 文件，通过 Compose 只读挂载到 new-api（例如 `/run/secrets/telegram-announcement.json`），设置同名环境变量；不挂载包含数据库 DSN 的完整入群配置或状态，不重启入群机器人。
- **频道同步（2026-11-03，本地待发布）**：编写公告新增默认不勾选的「同时发布到频道」复选框；勾选后向群组及频道各发一条，确认页显示目标频道，群组和频道分别保存状态/消息链接，部分失败或未知结果不自动重发；置顶选项仅用于群组。用户提供 `https://t.me/c/4472798526/11`，对应频道 ID `-1004472798526`，实际 Bot API `getChat` 核验为 `AiProxy频道` / `channel`，`@aiproxy92_bot` 已是管理员且 `can_post_messages=true`。已准备服务器专用配置 `/root/new-api/secrets/telegram-announcement.json`（600，仅 token/用户名/群 ID/频道 ID），加入 `"channel_id": -1004472798526`；尚未挂载进主站容器，线上主站和入群机器人未重启。正文底部的邀请链接仍只是跳转按钮，不能代替发送所需的数字频道 ID。预览及发布前均核验频道类型和机器人发帖权限；未勾选时只发布群组且不检查频道权限。未因本功能向线上群组/频道发送测试消息。
- 配置模板保存在 `options.TelegramAnnouncementTemplate`；发送收据保存在新增 `telegram_announcements` 主库表。每次确认使用唯一发布 ID 与预览指纹，重复提交只返回已有收据，模板或目标变化要求重新预览。网络中断/未知响应不会自动重发；历史记录中的待确认结果应先到群内核实。发送成功后即保存消息 ID，再单独尝试可选置顶，置顶失败不会重新发送公告。模板修改不编辑既有公告。
- 这段记录说明本地功能及部署要求，不表示已经发布；目前线上机器人与主站均保持原部署。上线前照常准备应用回滚镜像、全库归档与 Compose 备份。回滚仅切回应用并撤回本次专用挂载/环境变量，保留新增收据与后续消费，不整库恢复。

### Telegram 订单验证入群机器人（2026-10-29）

- 机器人 `@aiproxy92_bot` 与 new-api **分开部署**，同在香港服务器；独立 systemd 服务 `aiproxy-telegram-bot`，专属无登录系统用户同名，已 active/enabled。它通过 Telegram HTTPS 长轮询工作，没有公网监听端口。源码与验证说明在 [cmd/telegram-order-bot/README.md](../cmd/telegram-order-bot/README.md)，单独构建 Linux amd64 二进制，主站镜像及 Actions 发布流程不变。
- 二进制 `/opt/aiproxy-telegram-bot/telegram-order-bot`；unit `/etc/systemd/system/aiproxy-telegram-bot.service`；配置 `/etc/aiproxy-telegram-bot/config.json`（root:专属服务组 640、父目录 750）；状态 `/var/lib/aiproxy-telegram-bot/state.json`（专属用户 600、父目录 700）。Bot token 和 DSN 仅保存在受限配置中，不记录值。动态链接位于受限状态文件，配置使用 `group_id`，已移除原 `invite_url`。当前二进制 SHA-256 为 `944f3c3b11c507bf627ae682feb81ce319aa0bbeb049d5d11aa91c6b0c4a7379`（2026-10-30 动态邀请更新）。
- PostgreSQL 专属角色 `aiproxy_order_bot`，默认事务只读、语句超时 5 秒；只授予 `top_ups`/`subscription_orders` 的 `trade_no,user_id,status` 与 `users` 的 `id,status,deleted_at` 列 SELECT。连接本机既有 PostgreSQL 映射地址 `10.241.0.2:5432`，不会暴露新端口。实测 API key、用户密码、订单金额读取以及写操作均被拒绝；没有修改业务表结构、订单、余额、主站 options 或认证绑定。
- 私聊 `/start` 展示「加入群聊」和官网按钮，`/join` 进入 10 分钟订单输入窗口，`/cancel` 取消。仅支持主站，任意成功充值/套餐订单有效，账号须正常未删除，套餐镜像以套餐订单状态为准。成功回复主站用户 ID、Telegram ID、关联说明和邀请链接；在机器人状态中记录一一关联，重复 `/start` 显示本人主站 ID。每笔订单限一个 Telegram 用户，同一主站用户换订单也不能关联第二个 Telegram 用户；同一用户可重新验证生成专属新链接，旧链接先撤销。**这是机器人内的关联，不写 `users.telegram_id`，不能用它登录主站。** 每用户 10 分钟 5 次验证、每分钟 12 条消息，全局每分钟 120 次验证；错误统一提示，群聊消息不处理。
- 状态格式为 v3（2026-10-30 升级；旧文件加载后在首次处理更新时写回 v3），保存更新偏移、订单 SHA-256 摘要、TG/站内用户关联、动态邀请授权与限流/会话状态，先 fsync 原子落盘再发邀请或批准入群。损坏状态拒绝启动，文件锁限制同状态文件的多实例；保留 v1/v2 原订单领取及关联，v1 重新验证时补齐关联。不要清空状态以解决报错，也不要在 v3 状态上启动旧版二进制。
- 北京时间 **23:33** 核验：实际 Telegram `/start` 菜单、按钮回调、无效订单拒绝，以及用户自己提交已付款订单后的成功回复均正常，生产状态中的用户关联与回复一致。主站容器原镜像保持 `sha256:d696965bfb1f7d269738ab0ce392e1fc4892771e40d11fd4ca1cd78bf960f069`、healthy，本机/主站/国内入口 `/api/status` 均 200。随后按用户明确要求，停止机器人并备份状态，仅删除本次测试用户的关联、订单领取和临时会话记录，保留更新偏移与其他记录，再启动服务；实际入群动作未代测。
- 验证命令与完整案例在机器人 README；真实 SQLite **3.50.4**、MySQL **8.4.11**、PostgreSQL **15.17** 全部通过，`go vet ./cmd/telegram-order-bot` 通过。覆盖真实查询兼容性、状态/账号检查、重复领取/关联冲突、用户 ID 展示、限流、重启恢复、会话过期、私聊隔离与查询/持久化失败。无主站业务表迁移。
- **2026-10-30 北京时间 00:33**：订单输入提示改用 HTML 明确限定「我的订单」链接范围，修复裸网址紧接中文时后续说明被识别成链接；仅 `/join`（含按钮回调）使用 HTML，其他消息仍为纯文本。`go test ./cmd/telegram-order-bot -count=1`、`go vet ./cmd/telegram-order-bot` 与 Linux amd64 构建通过，未修改数据库行为。本次独立更新机器人二进制，数据库与 Telegram 身份检查通过，服务 active/running；实际在 Telegram 发送 `/join`，确认仅「我的订单」为蓝色链接、后续说明为普通文字。旧二进制和更新前状态保存在 `/root/telegram-bot-recovery/link-format-20261030-oDn7JW/`，受限配置摘要核对一致。
- 恢复材料 `/root/telegram-bot-recovery/order-bot-20261029T151727Z/`（700）保存角色修改前导出、原 Bot 简介/菜单、初始受限配置、部署和权限验证、实际联调及测试记录重置前状态；敏感副本 600。停用使用 `systemctl disable --now aiproxy-telegram-bot`；配置/状态保留可恢复，撤销数据库角色前确认服务已停止。不得用整库/全角色快照覆盖后续正常变更。
- **2026-10-30 北京时间 01:07**：独立部署动态邀请版，目标 `AiProxy群组`（`group_id=-1004204512295`）。实际核对机器人为 administrator 且 `can_invite_users=true`；每次订单验证后创建 10 分钟、`creates_join_request=true` 的专属链接，只审批对应 TG 账号、目标群和精确链接，其他账号被拒绝，成功后撤销；重新验证先撤销旧链接。消费事件在审批前持久化，重启只允许同一事件继续完成；权限或状态失败不回退固定链接。旧 1 条订单领取和 1 条账号关联完整保留。服务 active/enabled，三入口 `/api/status` 均 200、主站 healthy；目标群实际创建/到期参数/撤销 API 探测通过。真实非成员入群动作尚未代测；其他管理员手动批准以及其他直达邀请入口不在机器人控制之内。**2026-10-30 用户明确决定保留原固定主链接，不撤销**。机器人继续发送动态专属链接；原固定链接仍为独立入群入口，可绕过机器人验证，不再将撤销列为待办。
- 动态版执行 `TEST_MYSQL_DSN=... TEST_POSTGRES_DSN=... go test ./cmd/telegram-order-bot -count=1 -v`，真实 SQLite **3.50.4**、MySQL **8.4.11**、PostgreSQL **15.17** 及全部机器人回归通过，`go vet`、Linux amd64 构建通过。未修改数据库行为、查询或表结构。安全依据沿用 README 的 OWASP ASVS **5.0.0** 及 Authentication / Session Management / Authorization Cheat Sheets；新增服务端账号/群/链接授权、短时效和一次性消费回归，不声称订单号等价于付款人身份认证。恢复材料 `/root/telegram-bot-recovery/dynamic-invites-20261029T170529Z/`（UTC 命名）保存旧配置、旧二进制、升级前状态、部署与核验记录；不得直接恢复旧状态覆盖升级后的新领取/关联，旧版也不能读取 v3。
- 订单号准入不证明登录了订单所属主站账号；未实现站内登录确认的一次性授权码。机器人配置和状态**尚未纳入现有异地数据库备份**，需要另行安排备份，不能将主站每日数据库备份视为已覆盖该关联记录。
- **2026-10-30 北京时间 10:17**：按用户明确授权，为主站用户 **118、992、217、41** 各插入一条入群专用虚拟订单，共 4 条；`top_ups.amount=0`、`money=0`、`status=success`、`payment_method=虚拟订单`、`payment_provider=telegram_access`，订单号使用带随机部分的 `VIRTUAL` 前缀。这是入群资格记录，不是历史收款凭证，不新增余额，也不调用支付平台或补款接口。用户可从「我的订单」复制用于机器人验证；仍受已有订单领取与站内/TG 一一关联限制。
  - 仅通过 SSH 操作生产 PostgreSQL **15.17**，未修改应用数据库代码、查询行为或表结构；执行 `docker exec -i postgres psql -X -U root -d new-api -v ON_ERROR_STOP=1 -qAt`，先事务回滚演练，再执行相同带保护的插入并提交。事务内锁定目标用户，逐条比较全部用户行与已有订单行摘要，确认完全不变；4 条新订单均为零金额、零额度。随后以只读机器人角色查询，与实际验证函数的账号、订单状态及套餐镜像条件一致，4 条均符合且尚未领取，四个用户均尚未关联。订单列表直接查询数据库，无需刷新余额缓存或重启。机器人 active、主站 healthy，主站/国内/本机三入口 `/api/status` 均 200；未代替用户领取订单或发送邀请。
  - 恢复材料 `/root/telegram-bot-recovery/virtual-orders-20261030T021711Z/`（目录 700、文件 600）含用户必要字段快照、原订单数据、`pg_dump -Fc -t public.top_ups` 归档（`pg_restore --list` 验证通过）、4 条订单映射、演练/提交 SQL 与输出、核验报告和仅删除本次 4 条新记录的保护性回滚 SQL。订单号不写入仓库。回滚前先核对机器人是否已领取及生成邀请；删除订单不会自动撤销已经发出的入群授权。不得用整表归档覆盖后续正常订单。

- **2026-10-30 北京时间 10:33**：按用户追加授权，批量为当前 `users.group=vip`、`status=1`、未删除，且在 `top_ups` 和 `subscription_orders` **均无任何记录**的账号各补 1 条入群专用虚拟订单，共 **22 人、22 条**。按全部历史及全部订单状态排除已有订单的账号，不把「最近 30 天不可见」或「仅有未付款订单」当成无订单；先前已处理的 118、992、217、41 不重复补录。处理用户 ID：3、5、7、34、43、57、61、63、72、98、107、138、146、154、179、188、285、605、647、821、1068、1217。范围为精确 `vip` 分组，不扩展至其他分组。
  - 沿用零金额订单标记：`amount=0`、`money=0`、`status=success`、`payment_method=虚拟订单`、`payment_provider=telegram_access`，带随机部分的 `VIRTUAL` 订单号只保存在服务器受限映射中。生产 PostgreSQL **15.17** 执行 `docker exec -i postgres psql -X -U root -d new-api -v ON_ERROR_STOP=1 -qAt`，事务回滚演练与提交均通过；短事务对订单表使用 `NOWAIT` 锁并锁定目标用户，提交前重新确认账号分组、状态和无订单条件。逐条比较全部目标用户行、全部原充值订单行与套餐订单行摘要及订单数量，确认仅新增本次 22 条，用户余额及其他字段、原订单和套餐均不变。未改数据库代码或表结构，无余额缓存写入，无重启。
  - 提交后以只读机器人角色复核 **22 条均符合实际订单查询条件、均未领取、22 个用户均未关联**。当前正常未删除 VIP 共 195 人，其中没有任何订单记录的数量已为 **0**；机器人 active、主站 healthy，主站/国内/本机三入口 `/api/status` 均 200。只进行订单数据补录，不代替用户发起 Telegram 验证或入群，也未设置后续自动补录任务。
  - 恢复材料 `/root/telegram-bot-recovery/vip-virtual-orders-20261030T023227Z/`（目录 700、文件 600）含必要用户字段快照、充值及套餐订单 `pg_dump -Fc` 归档（均经 `pg_restore --list` 核验）、本次订单映射、演练及提交 SQL/输出、核验报告与保护性回滚 SQL。回滚只删除这 22 条精确匹配的新增零金额订单；先检查机器人领取及邀请，不得用整表归档覆盖后续订单，删除记录也不会撤销已发出的入群授权。

- **2026-10-30 北京时间 10:38**：按用户点名追加，为 `oyxqinvyp`（ID **104**）新增 1 条入群专用虚拟订单；该用户已有历史付款订单，本次属于明确指定的追加，不受上次「无任何订单」批量筛选条件限制。沿用 `amount=0`、`money=0`、`status=success`、`payment_method=虚拟订单`、`payment_provider=telegram_access`；不新增余额。生产 PostgreSQL **15.17** 通过 `docker exec -i postgres psql -X -U root -d new-api -v ON_ERROR_STOP=1 -qAt` 完成回滚演练及带保护的提交，全部用户行摘要、所有原充值/套餐订单摘要及行数校验通过，用户记录及余额保持不变；只读机器人角色查询符合实际验证条件，订单尚未领取，账号尚未关联。机器人 active、主站 healthy，无重启或缓存修改。恢复材料 `/root/telegram-bot-recovery/virtual-order-user104-20261030T023805Z/`（目录 700、文件 600）含必要字段快照、原订单数据、经 `pg_restore --list` 验证的充值订单归档、订单映射、演练/提交 SQL 与输出、核验及保护性回滚；订单号不写入仓库。回滚仍需先核对机器人领取与邀请，仅删除本次记录，不恢复整表。

- **2026-10-30 北京时间 10:42，订单可见范围纠正**：用户指出 `cyihui`（215）和 `heaven2028`（59）未补录。核对两人分别有 5 条、2 条历史充值订单，均超过最近 30 天；此前批次按「全部历史无订单」筛选，因此排除了这类页面无订单的用户。实际 `model/topup.go` 的 `GetUserTopUps` / `SearchUserTopUps` 仅返回 `create_time >= 当前时间 - 30 天` 的 `top_ups`，管理员全量列表不受此限制。后续为用户复制入群订单排查时，必须区分「历史无订单」与「本人页面无可见订单」，不可再用历史存在订单直接认定用户能在「我的订单」复制。
  - 本次按已说明的页面口径，为正常、未删除、精确 `vip` 分组且最近 30 天 **没有任何 `top_ups` 记录**的 **125 人**各新增 1 条零金额入群虚拟订单，包含上述两人。已有近 30 天订单的账号不重复添加（无论其订单状态），先前的 4 人、22 人批次及点名用户 104 均未重复。沿用 `amount=0`、`money=0`、`status=success`、`payment_method=虚拟订单`、`payment_provider=telegram_access`，订单号不写入仓库。未修改页面查询范围、历史付款订单、用户余额或其他用户字段，也未设置自动任务。
  - 生产 PostgreSQL **15.17** 使用 `docker exec -i postgres psql -X -U root -d new-api -v ON_ERROR_STOP=1 -qAt` 执行事务回滚演练及带保护的提交；订单表及目标用户 `NOWAIT` 锁保护，提交前重查分组/账号状态/时间范围。125 条新增均为零金额、零额度；全部目标用户行以及全部原充值/套餐订单行摘要与行数核对一致。只读机器人角色实查 **125 条均满足既有验证条件、均未领取**；按本人列表实际 30 天查询条件复查 **125 条均可见**。当前正常 VIP **195 人**中「最近 30 天无订单」为 **0**；这不表示所有已有订单均已付款。主站 healthy、机器人 active，三入口 `/api/status` 均 200，无重启或缓存修改，未代用户领取入群授权。
  - 恢复材料 `/root/telegram-bot-recovery/vip-visible-virtual-orders-20261030T024202Z/`（目录 700、文件 600）保存必要用户快照、充值/套餐订单归档（均经 `pg_restore --list` 核验）、125 条精确映射、演练/提交 SQL 与输出、核验报告和保护性回滚 SQL。回滚只删除本批次新增 125 条，先检查机器人领取与邀请；不得覆盖历史或后续订单，也不能把删除订单当成撤销已发出的入群授权。

- **2026-10-30 北京时间 11:36，未付款记录排除条件纠正**：用户指出 `Pj`（ID **797**）没有可用于入群的订单。该用户有 2 条历史成功充值，但最近 30 天只有一笔未付款套餐订单及其充值镜像，因此被此前「近期有任何订单即跳过」条件排除。按用户点名新增 1 条入群虚拟订单，`amount=0`、`money=0`、`status=success`、`payment_method=虚拟订单`、`payment_provider=telegram_access`；原未付款充值及套餐订单仍为原状态。今后为复制入群补录时，应判断是否有**本人页面近期可见且实际可通过机器人验证的成功订单**；仅有待付款、关闭或失败记录不能当作已有入群凭证，套餐镜像以套餐订单状态为准。
  - 生产 PostgreSQL **15.17** 使用 `docker exec -i postgres psql -X -U root -d new-api -v ON_ERROR_STOP=1 -qAt` 完成事务回滚演练及带保护的提交；目标用户完整行摘要、全部原充值/套餐订单行摘要与数量均不变，用户余额及缓存未修改。只读机器人角色查询通过，新订单符合本人列表 30 天查询条件、尚未领取，用户未关联。追加核对全部 **195 名**正常、未删除的 `vip` 用户，按页面 30 天范围并以套餐订单优先的有效状态判定，**没有可见成功订单的人数为 0**。机器人 active、主站 healthy，无重启或代码/表结构变更。
  - 恢复材料 `/root/telegram-bot-recovery/virtual-order-user797-20261030T033617Z/`（目录 700、文件 600）包含必要字段快照、原订单数据、经 `pg_restore --list` 验证的充值订单归档、精确订单映射、演练/提交 SQL 与结果、核验和保护性回滚 SQL；订单号不写入仓库。回滚仅删除本次新增记录，先核对机器人领取及邀请，不覆盖历史/后续订单或余额，删除订单不自动撤销已有入群授权。

- **2026-10-30 北京时间 11:40，用户最终确认筛选范围**：用户明确要求按**全部历史**成功订单判断，不能限制到最近 30 天。最终执行规则为：正常、未删除 VIP 账号，历史充值及套餐订单均没有任何成功记录时，才补 1 条零金额入群虚拟订单；仅有待付款、关闭或失败记录不算成功，套餐订单优先于充值镜像。此前 10:42/11:36 段落中的近期页面范围仅记录当时处理方式，**不作为后续补录规则**。本人列表 30 天限制属于现有页面查询行为，本次未修改该查询。
  - 使用生产 PostgreSQL **15.17**，执行 `docker exec -i postgres psql -X -U root -d new-api -v ON_ERROR_STOP=1` 的只读事务，对正常 VIP 全量检查 `subscription_orders.status=success`，或 `top_ups.status=success` 且没有同订单号的套餐记录；查询**不包含任何日期条件**。结果：正常 VIP **195 人**，有历史成功订单 **195 人**，缺少历史成功订单 **0 人**。本次仅核查，未再新增订单或修改余额，也未撤销此前累计 153 条虚拟订单。后续重复执行须按这条最终规则，不能仅因本人页面缺少近期可见记录而补录。

常用管理：

```bash
ssh aiproxy-hk 'systemctl status aiproxy-telegram-bot --no-pager'
ssh aiproxy-hk 'journalctl -u aiproxy-telegram-bot -n 40 --no-pager'
ssh aiproxy-hk 'runuser -u aiproxy-telegram-bot -- /opt/aiproxy-telegram-bot/telegram-order-bot -check'
```

### sub2api 域名与历史数据补齐（2026-10-21）

- 正式入口为 `https://sub2api.92ai.asia`，DNS 指向香港 `64.90.21.44`；原 `sub2api-main.92ai.asia` 的 Nginx 路由仍兼容。新入口首页、健康检查与证书验证已通过。
- 原数据库早在 2026-10-13 已迁入香港，原始快照的所有表计数和核心数据校验当时一致。本次复核旧源 `ssh aiproxy`（`192.220.24.120`）的 users、accounts、api_keys、groups、proxies、settings 六表哈希仍与原迁移快照一致；仅为本次用户明确授权的旧源核验，不将退役机重新纳入常规维护。不要连接 `aiproxy-old`。
- 香港原 90 天日志保留策略已清理历史记录。本次从已校验的旧源完整归档提取日志，在暂存 schema 中核对主键、请求唯一约束和五类外键，经事务回滚演练后只追加缺失的 **26,359** 条。提交时日志共 **619,042** 条（旧源 618,687 + 香港新增 355），ID 370124–989165；新机 355 条新增记录逐条比较保留，既有记录不覆盖。
- `data/config.yaml` 中 usage_logs、usage_billing_dedup、hourly、daily 保留期均为 **36,500 天**；对应已存在的 `.env` 保留期同步调整。该配置是延长保留期，不代表已部署无限保留或小时级备份。分组日汇总已由现有应用任务重算为 356 条；四张仪表盘汇总表均核对无旧源独有主键，未覆盖新机汇总。
- `api_base_url` 与 `balance_low_notify_recharge_url` 均改为 `https://sub2api.92ai.asia`，应用已重启加载；数据库中未再发现包含旧 IP 或 aicloudroute.com 的设置。
- 香港恢复目录 `/root/sub2api-usage-merge-20261021/` 保存 `before-merge.dump`、`after-merge.dump`、校验和、变更前配置与增量材料；暂存 schema 为 `migration_sub2api_20261021`，保留核验来源。原完整迁移归档为 `/root/migration-aiproxy-20261013/sub2api-final.dump`（SHA-256 `190e82b7cd47471ca34a02df6da23d7f620c6137a002803a49f4680bcaac0ccb`）。本次另在旧源固化当前完整逻辑备份 `/root/sub2api-current-snapshot-20261021T030517Z/sub2api.dump`；旧服务器与数据库保留。上述材料含私人业务数据，仅限服务器受限目录，不提交到 Git。
- 验证使用生产实际 PostgreSQL **18.3** 的 `psql` 事务及 `pg_dump` / `pg_restore --list`；这是生产数据补齐，未修改本项目数据库代码，也不代表完整应用恢复演练。

### sub2api 分段延迟诊断上线（2026-11-01）

- **当前状态：2026-11-02 已按用户要求回滚**。北京时间 **00:11:28** 切回部署前实际运行的 `0.2.19`（commit `dece26153621959ccd7635814f4b2d08304e681a`），Compose 当前镜像为 `sub2api-local:rollback-latency-20261101t145713z`，程序 SHA-256 `57b857ab51ecc22657423c1b8144abc96d666491aa10156fef7409b66d71c10f` 与部署前保存程序一致；恢复原页面，移除诊断采集环境变量。00:13核验容器healthy、本机/公网健康及页面/原版资源200、匿名用量401；settings/groups/账号凭据及路由相关摘要、回滚前101条既有用量逐行摘要一致，new-api镜像及启动时间未变。独立诊断表、已保存诊断和迁移记录保留，未回退数据库/余额/后续用量。执行前最新全库归档完整流读取通过；执行记录和验证 `/root/sub2api-recovery/latency-20261101T145713Z/rollback-execution-20261101T161100Z/`。下列为此前诊断版历史部署记录，不代表当前运行版本。

- 用户明确授权修改并部署。北京时间 **23:47:54** 重建 sub2api 应用容器，实际版本 `0.2.19+latency.20261101`，基于原运行程序提交 `dece26153621959ccd7635814f4b2d08304e681a`，镜像 `sub2api-local:0.2.19-latency-20261101`。旧 Compose 镜像元数据仍是 0.1.155，但容器内程序早已替换为 0.2.19；此次以实际运行版本为基线，不能按旧镜像标签降级。
- 本地源码 `/Users/zhuguoliang/Documents/sub2api-latency`，变更补丁 `latency-diagnostics.patch`。HTTP Responses 开启 `SUB2API_LATENCY_DIAGNOSTICS=1`，保留现有 `first_token_ms` 口径，新增同一单调时钟的 DNS/TCP/TLS、连接复用、请求发送、响应头首字节、首 SSE 数据/完整事件、首推理/文字增量、下游 Write/Flush 等分段日志；包含本地、客户端及上游请求标识，不记录提示词、回答或凭据。标记 `ops_system_log_skip`，诊断明细保存在应用日志，非用量计费字段。
- 用量页面新增「首响应 / 首事件 / 首吐字 / 总耗时」并有口径提示：前三者以本次转发开始为起点，分别为上游响应头首字节、首个完整 SSE 数据事件（包含元数据、排除心跳）和首个非空 `response.output_text.delta`；首吐字不包含推理或工具调用，也不等于客户端屏幕显示时间。历史记录不回填推测值，保留单独的「原首字」。WebSocket、其他未埋点协议及无文字增量的任务允许新指标为空。
- 新增迁移 `249_add_usage_latency_diagnostics.sql`，只创建独立诊断表，不改写 `usage_logs`、计费或历史记录。按请求 ID、API key ID、用户 ID、账号 ID 精确关联已授权的用量列表，读取/写入诊断有独立超时，失败不阻断用量查询或结算；环境变量设为 `0` 时停止采集并继续读取已有诊断，删除变量则同时关闭诊断查询。此表随完整 PostgreSQL 数据库备份覆盖。
- 36 项前端回归、类型/翻译键/构建、相关 Go 回归、竞态、go vet、Linux amd64 含前端构建通过。真实 PostgreSQL **15.17** 验证重复迁移、重复写入不覆盖、四身份隔离、NULL 观测及关闭采集后的历史读取；生产 PostgreSQL **18.3** 另在隔离 schema 事务完成重复迁移/写入回滚验证。部署前确认 299 条已有迁移校验和全部匹配，仅待新增本条；实际启动成功执行本条。
- 发布后容器 healthy、本机及公网健康检查与用量页面/新资源 200，匿名用量接口保持 401；new-api 主站及国内入口状态 200。settings、groups、账号凭据/代理/并发/优先级摘要一致，未重启 new-api。1440/390/320 宽度、浅深主题和中英文本地实页检查通过；生产未使用替代登录凭据打开认证用量页，已验证实际正常请求诊断日志和独立表入库。
- 正常流量样本 `client:8ab54693-5e56-4001-b72b-08d1d919ae1a`（23:48:29 完成）首响应 **12.250803s**、首事件 **12.327512s**、首文字 **24.473902s**、总耗时 **32.807s**；连接复用约 0.002ms、上传约 1.363s、上传后至首响应约 10.626s、首文字读到至写出约 0.546ms。该样本等待主要在上游方向，不能单靠此日志进一步归因为 Krill 内部排队、其下游模型或上游网络段；需用同一上游 request ID 对照 Krill 接收/发出日志。未额外重放付费生成请求。
- 恢复目录 `/root/sub2api-recovery/latency-20261101T145713Z/`，含部署前最新全库归档、实际 0.2.19 程序、源码归档、配置快照、验证记录及 `rollback.sh`。回滚镜像 `sub2api-local:rollback-latency-20261101t145713z` 保存了旧容器实际程序；脚本带 Compose 摘要保护，仅恢复旧应用镜像与原环境，不整库恢复、不删除诊断表或后续正常用量。归档完整流读取通过，未演练整库恢复或实际回切。

### 国内 API 转发

```text
客户端
  → https://api.sousousouju6212.top
  → search 的 Nginx
  → https://64.90.21.44:443
  → 香港 Nginx
  → http://127.0.0.1:3001
  → new-api → 配置的上游
```

关键配置：

| 所在机器 | 文件 | 要点 |
| --- | --- | --- |
| search | `/etc/nginx/conf.d/api.sousousouju6212.top.conf` | `upstream newapi_hk_inference` 指向 `64.90.21.44:443` |
| search | 同上 | HTTP `Host: api-relay-origin.internal`；TLS SNI `92ai.asia`；开启上游证书验证 |
| 香港 | `/etc/nginx/conf.d/api-relay-origin.conf` | 接收该内部 Host；仅允许 `1.14.65.7`；转到 `newapi_backend` |
| 香港 | `/etc/nginx/conf.d/92ai.conf` | 主站与 `newapi_backend`（`127.0.0.1:3001`） |
| 香港 | `/etc/nginx/conf.d/sub2api-main-92ai.conf` | sub2api 管理入口，转到 `127.0.0.1:8089` |

国内入口用于 API 调用，根路径 `/`、前端资源及浏览器页面导航被有意拦截。**访问首页返回 404 不表示代理故障**；用 `/api/status` 或具体 API 路径验证。OpenAI 兼容客户端通常填 `https://api.sousousouju6212.top/v1`，仍需遵守该客户端是否自动补 `/v1` 的约定。

转发链路使用 HTTPS 到香港，即使目标是固定 IP，仍需保留正确 SNI 和证书验证。不要把 `proxy_ssl_verify` 关掉来绕过配置错误。主站当前直接解析到香港。

### TLS 与主机防护

- 香港 `92ai.asia`、`sub2api.92ai.asia` 与 `sub2api-main.92ai.asia` 共用 Let’s Encrypt 证书：`/etc/letsencrypt/live/92ai.asia/`；`certbot.timer` 已启用。
- 2026-10-21 已扩展证书覆盖新入口，到期日为 **2027-01-19**；以 `certbot certificates` 为准。
- 香港 SSH：`PasswordAuthentication no`、`KbdInteractiveAuthentication no`、`PubkeyAuthentication yes`，root 只允许密钥认证；监听 `18272`。
- 2026-10-22 实机复核：`AuthenticationMethods publickey`，SSH 服务 active；按用户要求向 `/root/.ssh/authorized_keys` 追加另一台电脑的 RSA 2048 公钥（备注 `gitLab`，指纹 `SHA256:xWAFK2N9XXhJ3w5dWjE+tCTtsrMSRNZ+sbXCGDUe0VM`）。原有登录、部署及受限备份授权保留，文件权限仍为 `600`，`sshd -t` 通过，无需重启服务。修改前备份为 `/root/security-recovery/ssh-add-computer-20261022T043213Z/authorized_keys.before`。未持有该电脑私钥，尚未从该电脑完成实际登录验证；连接须使用对应私钥及端口 `18272`。
- Fail2ban 已启用 `sshd` jail。UFW 已启用，SSH、HTTP/HTTPS 和手机代理端口有放行规则。
- 2026-10-22 北京时间 **13:46**，按用户确认将自有机器 IP `106.38.52.62` 加入香港 Fail2ban 持久白名单：`/etc/fail2ban/jail.d/aiproxy-ssh.local` 的 `[DEFAULT]` 中设置 `ignoreip = 106.38.52.62`。`fail2ban-client -t` 通过后执行 reload，并仅解除该 IP 的 `sshd` 封禁；运行时 `ignoreip` 已包含该地址，封禁列表和 nftables `f2b-table/addr-set-sshd` 均已无该地址，其他原有封禁保留，Fail2ban 仍 active。原配置在 `/root/security-recovery/fail2ban-allow-own-ip-20261022T054632Z/aiproxy-ssh.local.before`；尚未从该自有机器验证 SSH 实际登录。
- 出站代理的 `172.19.0.1:7891` 规则限制在对应 Docker 网段。改防火墙或数据库绑定前，先核对容器网络依赖。

## 3. 已运行的异地备份

备份由 **阿里云主动拉取香港数据库**，不依赖本机开机或 Codex 定时任务。

| 项目 | 当前实现 |
| --- | --- |
| 调度机 | `aliyun`：`8.141.100.180` |
| 调度文件 | `/etc/cron.d/aiproxy-database-backup` |
| 运行时间 | `CRON_TZ=Asia/Shanghai`；每天 `00:30` |
| 拉取脚本 | 阿里云 `/usr/local/sbin/backup-aiproxy-databases` |
| 导出脚本 | 香港 `/usr/local/sbin/export-aiproxy-database` |
| 数据范围 | `new-api`、`sub2api` 两个完整 PostgreSQL 数据库，依次导出 |
| 格式 | 容器内对应版本 `pg_dump --format=custom --compress=6`，生成 `*.dump` |
| 保存目录 | 阿里云 `/var/backups/aiproxy-databases/YYYY-MM-DD/` |
| 每组文件 | `new-api.dump`、`sub2api.dump`、`SHA256SUMS`、`backup.info` |
| 保留规则 | 最近 **7 个成功日期目录**；新一轮全部成功后才清理更早备份 |
| 运行日志 | 阿里云 `/var/log/aiproxy-database-backup.log` |
| SSH 凭据位置 | 阿里云 `/etc/aiproxy-database-backup/id_ed25519` 与 `known_hosts`，不导出私钥 |

阿里云专用备份密钥连接 `root@64.90.21.44:18272`。香港 `authorized_keys` 上有 `restrict`、来源 `8.141.100.180` 和强制导出命令限制；不能用这把密钥获得普通交互终端。不要为了修复备份移除这些限制。

脚本有执行锁、超时、临时目录和 2 GiB 剩余空间检查；通过后再发布当天目录。完整性检查包括 `PGDMP` 文件头、SHA-256 校验，以及通过阿里云已缓存的 `postgres:18-alpine` 执行 `pg_restore --file=/dev/null`。这会完整读取归档，但**不等于恢复数据库并通过应用验证**。

2026-10-15 实机核查：

- 当天 `00:32:55 +08:00` 备份成功；两个归档合计约 **253 MB**。
- `SHA256SUMS` 校验通过，两个 `pg_restore --list` 均成功，来源版本分别为 PostgreSQL 15.17、18.3。
- 阿里云 `crond` 正常运行；当时已有 3 个成功日期目录，策略上限是 7 个。
- 香港剩余空间约 61 GiB，阿里云约 13 GiB；容量数字会变化，不能代替后续检查。

### 手动检查或运行备份

```bash
ssh aliyun 'systemctl is-active crond; cat /etc/cron.d/aiproxy-database-backup'
ssh aliyun 'tail -n 40 /var/log/aiproxy-database-backup.log'
ssh aliyun 'du -sh /var/backups/aiproxy-databases; df -h /'
```

在阿里云检查最近一份备份：

```bash
cd /var/backups/aiproxy-databases
backup_day=$(find . -mindepth 1 -maxdepth 1 -type d -name '20??-??-??' | sort | tail -n 1)
test -n "$backup_day" && cd "$backup_day"
cat backup.info
sha256sum --check SHA256SUMS
```

手动调用现有任务：

```bash
ssh aliyun '/usr/local/sbin/backup-aiproxy-databases'
```

**若当天目录已存在，脚本只校验已有文件并退出，不会生成当下的新快照。** 数据修复前要备份时，应另存带时间戳的专用归档；不要把已有凌晨备份当作操作前备份，也不要为了重跑直接删除当天的有效副本。

### 覆盖边界与恢复准备

当前是**每日逻辑备份**，正常情况下的数据丢失窗口可接近 24 小时；失败未补救时可能更久。不是每 30 分钟备份，没有已部署的 WAL 归档或已验证的小时级恢复保证。

当前脚本只备份两个数据库，**没有包含**：Compose、`.env`、应用外部配置与加密密钥、PostgreSQL 全局角色、Redis 快照、Nginx/TLS/代理配置；也没有部署 Restic、OSS 第三副本或专门的备份失败告警。恢复这些内容需要另行保管的配置和密钥。建议改进不能写成已经运行。

恢复时按下面顺序操作：

1. 选定阿里云上的有效日期，校验 `backup.info`、`SHA256SUMS` 和归档目录列表。
2. 准备隔离的 PostgreSQL **15** 与 **18** 环境，分别恢复两个库；重建需要的角色和扩展。不能用 PostgreSQL 15 的工具直接处理 PostgreSQL 18 归档。
3. 使用 `pg_restore` 恢复到新建空库，核对用户、渠道/账号、订阅、余额和关键记录；不把运行中的数据目录复制当作一致性备份。
4. 恢复对应应用配置和加密密钥，选定已验证的应用镜像；不要因使用 `latest` 在恢复时顺带升级。
5. 隔离真实上游调用及有副作用的后台任务，完成数据库和应用验证后，再安排正式切换。

本次未执行隔离库或完整应用恢复演练，不能承诺恢复耗时。不要把 `pg_restore --file=/dev/null` 的成功记录描述为完整恢复演练通过。

## 4. new-api 发布与版本核查

### 客户端 WSS 与上游 HTTPS 桥接（2026-11-02，22:46 北京时间核验）

- **客户端 WSS / 上游 HTTPS 与日志标记上线（2026-11-02）**：按用户授权，revision `0c030c9d03d3a8f0a6a575cbcf88bce5c3f28aa9` 已提交 push main，Actions `41463423261` 构建部署 success；北京时间 **22:46** 核验版本 `v1.0.0-rc.47+0c030c9d03d3`、容器 healthy、三入口状态/定价 200、新日志 JS/CSS 生效。主站 Nginx 已补精确 `/v1/responses` 的 Upgrade/Connection 透传并通过 nginx -t/reload，主站及国内入口 WSS 实测101。客户端自定义 provider 的 `supports_websockets=true/false` 控制 WSS/HTTPS，需完全重启；本站按连接隔离重建历史后走 HTTPS 上游，不使用 Krill 共享 WSS，不要求开启渠道上游 WSS 开关。每轮独立鉴权、限流、日志、结算，未知结果不重放；上下文仅保留在当前物理连接内，断开/缓存未命中需完整历史重建。日志“流”列紫色 WS 代表客户端协议，详情仅管理员显示上游HTTP；普通流式与历史未记录协议不误标。真实 root 运维Key经渠道65做两会话四轮WSS及一次HTTPS全部200/完成，四轮标记正确，无跨会话串用；跨连接父ID及非法max_output_tokens拒绝且无额外消费，普通本人日志API仅返回客户端协议、不暴露admin_info。五次生成共正常扣1528 quota（0.003056站内额度）。options134项、套餐27项、模型94项完全一致，渠道仅65/116正常used_quota变化，token总数2227不变。SQLite3.50.4/MySQL8.4.11/PostgreSQL15.17、100用户200轮隔离/race、真实Codex0.162.1开关及426回退、473项日志前端测试/类型/lint/格式/构建通过；1440/390/320浅深主题验证通过。恢复目录 `/root/upgrade-recovery/new-api-ws-http-20261102T143310Z` 含133,254,138字节全库归档、配置快照、verify.sh/rollback.sh与verification.json，SHA-256及归档完整读取通过；回滚镜像 `ghcr.io/zhuguoliang1014/new-api:rollback-ws-http-20261102t143310z`，回滚仅恢复本次Nginx及旧应用、不整库恢复；未演练实际回切。实测未证明生产长上下文首字稳定提速。

- 主站新增 `/etc/nginx/conf.d/00-newapi-responses-websocket-map.conf` 和 `/etc/nginx/snippets/newapi-responses-websocket-location.conf`，仅在原 `92ai.conf` 引入精确 Responses location；普通 HTTP 连接仍清空 Connection，其他站点和国内入口原配置保留。
- 实际五笔消费日志 ID：1752994–1752998，其中前四条是 WS（每轮独立 -ws-N），最后一条为 HTTPS；共同 user_id=1、token_id=2108、channel_id=65。两条连接各自的标记正确；首文字约1.67/2.11/2.08/1.70秒，样本较小，不作为提速承诺。
- 桥接缓存每连接32MiB、进程合计256MiB、最多33份最近历史、连接最长1小时；只保留成功完成的原始output，包括reasoning密文和工具项。generate:false只本地预存，不调用模型、不计消费。
- 原生上游WSS旧代码仍有单独内部入口回归，公共 `/v1/responses` WSS现走HTTP桥接。此前对Krill单连接A/B交替测试两次出现A续轮返回B标记，不应重新启用跨用户共享有状态上游WSS。
- 线上未使用浏览器替代登录凭据查看受保护日志页；通过已授权本人运维API Key只读接口与数据库核对日志、归属和协议字段，公开新日志chunk返回200且含WS标记代码。
- 相关维护源与客户端配置见 `docs/responses-websocket-http-bridge.md`，Nginx示例在 `docs/nginx/`。

本地仓库 `/Users/zhuguoliang/Documents/new-api`。2026-10-15 核查时：

- 本地 Git `origin`：`git@github.com:coder-glzhu/new-api.git`；`upstream`：`https://github.com/QuantumNous/new-api.git`。
- 工作流：`.github/workflows/build-aiproxy-image.yml`，在 `main` push 后构建并部署；镜像名称是 `ghcr.io/zhuguoliang1014/new-api`。
- 香港正在运行该镜像的 `latest` 标签，当时的 OCI revision 为 `67fbf51bb2ceda85b98c6a5a88e0ab591d3f667a`。
- 本地 Git revision 与线上镜像可能不同。镜像命名空间不同于当前 `origin`，不能据此认定某个仓库的 Actions 已部署；发布时核对实际运行的工作流、镜像和 revision。

### 已有作品时的风格示例已更新（2026-11-01）

### 画图统一分组与香蕉/MJ已上线（2026-11-01）

- **香蕉 Images 适配与 MJ 高清上线（2026-11-02）**：用户授权修改、验证后提交 push 部署，revision 33ade7bcee032eac85df42f6d01e27fe383cdebf，Actions 41332718841 success；北京时间 **01:58** 核验 healthy，三入口状态/定价 200、JS/CSS 正常。香蕉渠道 120 改为 Gemini type=24 并清除旧 Images 参数覆盖；原有本站 Images generations/edits 转换为原生 generateContent，结果转换为 data[].b64_json，支持 JSON/multipart 参考图。候选数固定1，校验参考图/数量，拒绝 mask 和非法URL；无有效图片失败退款，提交后未知结果不自动重试。用户确认高清与标准同价，MJ 渠道121及工作台改 hd=true、quality=1，仍 ¥1.30/次。仅改变两渠道的协议/覆盖/中性名称及模型95/100说明，options/套餐/Key权限/其余路由保持原值。生产现有工作台 Key 真正调用六款香蕉全部200：五款4096×4096，一款 gemini-2.5-flash-image 为1024×1024（工作台限制1K）；各扣62,400 quota = ¥0.1248。MJ真正调用200，四张1648×2944 PNG，共扣一次650,000 quota = ¥1.30；另一次上游原生参考图编辑通过。本地隔离服务回放真实响应，任务/原图保存和JSON参考图编辑通过，非法数量/引用400且不扣费。SQLite3.50.4/MySQL8.4.11/PostgreSQL15.17授权/按张按次计费/失败退款、相关race、relay包全测、go vet和root构建通过。7组已有Key的模型列表与发布前一致，旧图片兼容名称/价格保留，已撤销Key401及IP限制403仍生效；香蕉目录额外增加Gemini端点类型。未改上游凭据或调整用户余额，正常调用产生用量。恢复目录 /root/upgrade-recovery/new-api-banana-mj-fix-20261101T172412Z/（UTC命名），完整备份132,503,006字节，归档读取及SHA-256通过，保护性配置/回滚演练、verify.sh、rollback.sh及verification.json齐备；回滚先恢复本次目标配置，再切旧镜像 ghcr.io/zhuguoliang1014/new-api:rollback-banana-mj-fix-20261101T172412Z，不恢复整库。真实生成结果与带签名URL仅在受限恢复目录中保留。

- **画图默认模型修复上线（2026-11-01）**：用户明确授权后，revision `480306f188c1960d264ebb742396219d45b6333e` 已提交 push main，Actions `41315662690` 构建部署 success；北京时间 **22:27** 核验版本 `v1.0.0-rc.47+480306f188c1`、容器 healthy、三入口状态/定价 200。仅调整工作台 bootstrap 模型顺序，首次优先 `gpt-image-2.5-basic`（¥0.03/张），仍按 Key 的模型限制筛选，保留手动模型选择；API 请求模型、路由、计费及已有令牌配置保持原值。7 个分组的已有 Key 在发布前后实际 GET /v1/models 返回模型列表完全一致，三个保留工作台 Key 仍返回 14 款，原始图片模型兼容路由保留，五个已删除重复 Key 仍为 401，既有 IP 白名单拒绝仍为 403。options、套餐、渠道路由/凭据、模型资料、用户设置一致，渠道 77/116 与两个令牌仅正常用量变化；公共定价逐字段一致（忽略无序列表及固定全局 pricing_version 在首行的附着位置，版本值未变）。SQLite3.50.4/MySQL8.4.11/PostgreSQL15.17 默认及限制回归、竞态、相关 Go 回归、root 构建、独立本地服务 bootstrap 均通过；未使用替代生产登录凭据验证工作台，也未发起付费生成。恢复目录 `/root/upgrade-recovery/new-api-studio-default-20261101T141709Z/`，完整数据库归档 132,346,214 字节、SHA-256 与归档目录核验通过，含部署前后配置、7 分组目录基线、`verification.json`、`verify.sh`、`rollback.sh`；回滚镜像 `ghcr.io/zhuguoliang1014/new-api:rollback-studio-default-20261101T141709Z`。此回滚仅切回上一镜像，保留已完成的画图数据库清理，不恢复整库。

- **画图旧分组与 Key 清理（2026-11-01）**：按用户明确授权，于北京时间 **22:06** 完成生产数据库迁移，**22:13** 核验三入口状态/定价 200、容器 healthy。旧 `画图专用` 及三个 `【生图】` 分组已从当前配置、渠道能力及令牌归属清除，统一为 `画图`（倍率 1）；迁移 150 条令牌记录（原有未删除 117 条），不更换任何 Key 值。8 个自动工作台令牌合并为对应 3 位用户各 1 个（保留 2212、2202、2213，软删除并停用 2196、2197、2198、2201、2203），手动 Key 保留，既有停用/删除/到期/IP/额度限制保留。删除重复旧渠道 104–106 和已停用的 109；117–121 改用中性画图用途名称，不含供货商名称。保留 GPT、Gemini、MJ、flare、sunburst 模型名称。新增四个原始模型名兼容路由：`gpt-image-2`/`gpt-image-2.5` → 基础渠道 ¥0.03/张，flare/sunburst → 原生渠道 ¥0.225/张；工作台仍显示 14 款带路线的模型，统一 API 路由含 4 个兼容名称共 18 款，手动模型限制只增加同一路线别名。三个保留工作台 Key 实查返回 14 款，五个重复 Key 均 401；受限 Key 的 IP 拒绝仍为 403。套餐、模型资料、用户设置保持一致，历史日志和任务中的分组事实保留。恢复目录 `/root/upgrade-recovery/new-api-image-cleanup-20261101T135003Z/`，含全库归档、配置快照、保护性事务/回滚演练、`rollback.sh` 与 `verification.json`；回滚只恢复此次目标字段/删除行，不覆盖余额或后续消费。未重启、未进行付费生成，生产代码仍为 `bdf6defd60ed`。清理核验时，默认首次选中 `gpt-image-2.5-basic` 的代码仅在本地完成，三库及竞态回归和本地服务 bootstrap 验证通过；后续已获授权发布，见默认模型修复记录；API Key 没有默认模型，API 请求仍需指定 `model`。

- **画图模型选择与 MJ 创作参数上线（2026-11-01）**：用户验收并明确授权后，revision `bdf6defd60edcef50a03fd8c891e8dbff94b7682` 已提交 push main，Actions `41302468547` 构建部署 success；北京时间 **19:45** 核验版本 `v1.0.0-rc.47+bdf6defd60ed`、容器 healthy、香港本机/主站/国内入口状态与定价均 200，新 JS/CSS 与八张风格示例图正常。模型选择置顶并按渠道分类，弹窗与输入框等宽，模型下方灰字展示描述及单价；MJ 显示通常 4 张/次，增加创作参数与最多五张参考图，标准质量及按次计费保持固定。渠道 120 香蕉扩至六款，均按用户确认成本 ¥0.096×1.3=¥0.1248/张，MJ ¥1.30/次；画图共 14 款模型。仅修改三个计费 options、渠道 120 的名称/模型、增加五条 abilities/模型资料，并扩展两个仍采用旧默认九模型列表的工作台令牌（2212、2213），定向清理其令牌缓存；手动模型限制、停用/撤销令牌和既有凭据保留。套餐及其他配置一致，渠道 77 仅正常 used_quota 变化。154 项前端回归、类型/lint/格式/构建、相关 Go 与竞态、relaykit 独立构建及 SQLite3.50.4/MySQL8.4.11/PostgreSQL15.17 授权/计费/退款回归通过；两个既有工作台令牌实际 GET /v1/models 均返回 14 款，匿名工作台接口 401。香港及国内入口均允许 200M 请求，覆盖新增 72MiB 任务体上限。全库归档、配置快照、带旧值保护的写入及回滚演练、`rollback.sh` 和 `verification.json` 位于 `/root/upgrade-recovery/new-api-studio-controls-20261101T112644Z/`，回滚镜像 `ghcr.io/zhuguoliang1014/new-api:rollback-studio-controls-20261101T112644Z`。本次未进行真实付费生图，既有套餐冻结测试和排行榜权限规则缺口保留，详见模型路由说明。

- **画图统一分组与香蕉/MJ（2026-11-01）**：revision `f31aeabdd5fb57ae50588124e565699f7cbaae1e` 已push main，Actions `41275953140` 构建部署success；北京时间13:19核验容器healthy、三入口状态/定价200、新JS/CSS及示例图生效。用户界面统一为“画图”，分组倍率1，通过9个公开模型别名分别计费；后台新增渠道117–121，旧三个图片分组/渠道/Key保留兼容并在新选择中隐藏。GPT基础0.03、高质量0.12、原生0.225元/张不变，香蕉Pro `gemini-3-pro-image-preview` 为0.1248元/张，MJ `mj-v8.2` 标准档1.30元/次（固定quality=1、hd=false、n=1，通常4张独立图，拼图封面不算第5张）。MJ参考图使用JSON generations；提交后失败禁止自动重发。124项前端、类型/lint/格式/构建、相关Go及竞态、SQLite3.50.4/MySQL8.4.11/PostgreSQL15.17计费与授权回归通过；全量model包既有套餐冻结测试失败，变更前代码同样复现，详见模型路由说明。仅5项options新增配置和9项模型资料，套餐及旧渠道保持一致（77、116仅正常used_quota变化）。生产全库备份、配置事务回滚演练及验证记录位于 `/root/channel-recovery/image-unify-20261101T043356Z/`，回滚入口 `rollback.sh`（先带旧值保护恢复配置，再切回旧镜像）；凭据仅在服务器受限目录及渠道中保存。本次未发起真实付费生成，上游sunburst既有451问题保留。

- 配置细节和验证边界见 `docs/image-studio-model-routing.md`。备份 `before.dump` 为131,990,937字节，归档目录读取及SHA-256通过，未演练整库恢复；本次5个options为GroupRatio、UserUsableGroups、ModelPrice及billing_setting的billing_mode/billing_expr。恢复脚本保留新模型资料和渠道记录，仅停用新渠道、删除对应能力并恢复目标配置，不回退后续消费和用户数据。若配置已被后续修改，保护条件会阻止直接回滚，应先人工核对。

- **已有作品时的风格示例（2026-11-01）**：左侧风格选择器下方持续显示已选风格的示例图，切换即更新，选择无风格时收起；点击或键盘可复用图片预览放大查看，不提交生成任务。示例不再依赖空作品页。revision `0f1b79cf2124e11b296a08f934c227ed6a4a1fc9` 已push main，Actions `41271425987` 构建部署success；北京时间12:08核验容器healthy、三入口状态/定价200、新JS/CSS及八张示例图200。119项工作台测试、类型/lint/格式/构建、七语言既有标签检查通过；1440/390/320宽度、浅深主题、八风格切换、放大及收起验证通过。options与套餐一致，渠道77仅正常used_quota变化，无数据库或计费修改。恢复目录 `/root/upgrade-recovery/new-api-studio-style-preview-20261101T035932Z/`，回滚镜像 `ghcr.io/zhuguoliang1014/new-api:rollback-studio-style-preview-20261101T035932Z`；全库备份归档读取通过，含配置快照、rollback.sh及verification.json，未演练整库恢复。

### 画图预览布局与缩放已更新（2026-11-01）

- **画图预览布局与缩放（2026-11-01）**：图片详情移除可见顶部标题区（保留无障碍标题），缩放及翻页按钮移至图片下方，图片区由52vh增至64vh；修复低比例大图触控板缩放按整数百分比跳动的问题，保留焦点与边界，并减少拖动/细微缩放时的工具栏重渲染。revision `58156338a8fb4876df63781ede19f9d1eb2f7d1f` 已push main，Actions `41270346820` success；北京时间11:49核验容器healthy、三入口状态/定价200、新预览JS/CSS生效。117项工作台测试、类型/lint/格式/构建通过，1440/390/320宽度及浅深主题、连续滚轮与CDP双指缩放验证通过；真实手机/触控板的主观手感未代测。options与套餐一致，渠道77仅正常used_quota变化，无数据库或计费代码修改。恢复目录 `/root/upgrade-recovery/new-api-studio-preview-20261101T034306Z/` 含全库备份、配置快照、验证记录与rollback.sh，回滚镜像 `ghcr.io/zhuguoliang1014/new-api:rollback-studio-preview-20261101T034306Z`；备份归档读取通过，未演练整库恢复。

### 画图工作台卡片与默认分辨率已更新（2026-11-01）

- **画图工作台卡片与默认分辨率（2026-11-01）**：按用户反馈移除卡片刷新/10小时保留及到期说明，任务和作品卡统一520px高度，单图/多图使用相同296px图片区；用途说明改为日常批量出图、高清海报封面、精细创作，首次及切换分组默认最高分辨率并保留比例，手动低档/Auto/历史复用保留。revision `22b66932171c1142f4dc6fc60a1a12fd092526df` 已push main，Actions `41264381516` success，10:21北京时间核验healthy、三入口状态/定价200、新JS/CSS生效；options/套餐一致，渠道仅正常used_quota变化。113项前端回归、类型/lint/格式/构建通过，1440桌面与320窄屏卡片等高无横向溢出；纯前端无计费/数据库修改。恢复目录 `/root/upgrade-recovery/new-api-studio-refinements-20261101T020749Z/`，回滚镜像 `ghcr.io/zhuguoliang1014/new-api:rollback-studio-refinements-20261101T020749Z`。服务器任务10小时保留功能继续运行，只隐藏提示。

- 首轮构建Actions41264020933在发布前取消，未替换生产；补齐多图错误提示/原图入口的滚动布局，最终Actions41264381516于北京时间10:20:10部署成功。10:21:10核验版本 `v1.0.0-rc.47+22b66932171c`，新JS `/static/js/async/99614.a0766bcf86.js` 200，包含用途文案且不再包含保留时间提示；新CSS `/static/css/async/99614.3152d94af3.css` 200且卡片共享height520px。任务目录0700，匿名任务路由仍401，未额外付费生图。
- 验证：web目录 `bun run test src/features/image-playground` 7文件113项通过，`bunx --package typescript@latest tsc -b`、`bunx oxlint -c .oxlintrc.json src/features/image-playground`、`bun run build`、定向保留版权头格式化及 `git diff --check`通过。异常布局用例先失败后修复；最终8项布局回归再次通过。三条用途键经脚本插入七种语言并完成 `bun run i18n:sync`。没有改数据库代码或计费，无三库重测要求。仅本地模拟浏览器验收，不代表旧手机内核或付费上游再次实测。
- 恢复材料包括完整数据库131946450字节、SHA256 `dec3e9c3c55201a34e33a8572f00be2be9c4677f6a811c08db313ef355fe05f4`（pg_restore --list通过）、受限配置前后快照、Compose/.env及rollback.sh。回滚只重建应用，保留现有image-studio目录及后续数据；verification.json的passed=true。options/套餐未变，渠道77仅正常used_quota变化。

### 画图工作台服务端任务已上线（2026-11-01）

- **画图工作台服务端任务上线（2026-11-01）**：按用户最终授权，revision `85ae33f2ec51aeab1dffedaeeecdacef44e7c1c8` 已合并并 push main，Actions `41261332090` 构建部署 success；北京时间 09:35 核验版本 `v1.0.0-rc.47+85ae33f2ec51`、容器 healthy、三入口状态/定价 200及新JS生效。任务提交返回ID，刷新恢复查询，服务器保留10小时，缩略图先显、原图自动缓存浏览器，下载失败可只重试下载；未知生成结果不自动重放。生产任务目录 `/root/new-api/data/image-studio`（0700，文件0600）随既有/data挂载持久化，仅适用当前单实例，同目录不能多进程共享；尚未纳入异地数据库备份。当前上游实测高质量组最大边8192、最大67108864像素，8K原图尺寸一致，已测更大组合均拒绝，UI保留6K/8K并撤下10K；基础4096边/16777216像素、原生3840边/8294400像素。原生sunburst仍有独立上游451可用性问题。111项前端、类型/lint/格式/构建、Go及竞态、SQLite3.50.4/MySQL8.4.11/PostgreSQL15.17回归通过。options/套餐完全一致，渠道仅77与116的正常used_quota变化；匿名任务创建/读取/图片访问均401。恢复目录 `/root/upgrade-recovery/new-api-image-studio-tasks-20261101T012726Z/` 含完整数据库备份、配置快照、verification.json及rollback.sh，回滚镜像 `ghcr.io/zhuguoliang1014/new-api:rollback-image-studio-tasks-20261101T012726Z`。发布后未额外付费生成，仍保留基线排行榜路由权限规则缺口，详见运维手册。

- 上游尺寸探测发生于2026-10-31北京时间23:35至11月1日00:00，直接使用当前PandaTK渠道；高质量gpt-image-2.5的8192×8192返回原图8192×8192、23,149,165字节；8208×4624、9216×5184、10000×5632、10240×5760均INVALID_IMAGE_ROUTE。gpt-image-2的8192×4608尺寸一致。原生flare请求4096×2304会自动返回3840×2160，不能把HTTP200视为原尺寸成功。未修改业务分组名称或定价。
- 提交前再次执行 `go test ./service ./middleware ./controller ./router -run 'TestStudioTask|TestStudioRelayForm|TestStudioVerifiedSizeBoundary|TestImageStudio|TestPlaygroundAgentConfigurationDatabase' -count=1`、`go test -race ./service -run TestStudioTask -count=1`、`go build ./...`，均通过。MySQL/PG使用隔离本地库分别设 `TEST_TASK_DB_DIALECT=mysql TEST_MYSQL_DSN='root@unix(/tmp/studio-size-fix-mysql/mysql.sock)/image_studio_test?charset=utf8mb4&parseTime=True&loc=Local'`、`TEST_TASK_DB_DIALECT=postgres TEST_POSTGRES_DSN='host=localhost port=5432 dbname=image_studio_test user=zhuguoliang sslmode=disable'`，执行 `go test ./controller -run 'TestImageStudio|TestPlaygroundAgentConfigurationDatabase|TestStudioRelayForm' -count=1` 通过。版本实查8.4.11及15.17；SQLite使用项目3.50.4驱动。无数据库模型/查询/迁移变更。
- web目录执行 `bun run test src/features/image-playground` 7文件111项通过，含新增任务到期不再滞留生成中回归；`bunx --package typescript@latest tsc -b`、`bunx oxlint -c .oxlintrc.json src/features/image-playground`、`bun run build`通过；150个静态翻译键七语言齐全。复用现有ConfirmDialog、CopyButton、Button与既有工作台组件；任务进度属于新的业务状态展示，没有新增通用交互实现。
- 安全核对沿用OWASP ASVS5.0.0及Authentication、Session Management、SSRF Prevention Cheat Sheets；任务逐次按登录用户授权，执行前复查账号/key权限，PAT拒绝，下载严格限制公共网络及80/443，未存储浏览器会话或上游key。局部验证不代表全站ASVS认证。跨账号、到期、撤销key、SSRF及重启不重放均有回归。
- 部署于北京时间09:34:47完成，09:35:26实机核验，服务器恢复目录verification.json的passed=true；新工作台资源 `/static/js/async/99614.f97b1d8974.js` 200且包含任务API。数据库备份131,924,953字节、SHA256 `4d1e4390409e6dc894d4be3b3b6f7786355d5de7635fb9926f0a37c657e6e738`，pg_restore --list验证通过。回滚只运行恢复目录rollback.sh重建应用，保留任务目录和后续业务数据，不整库恢复。

### 画图工作台重写已上线（2026-10-31）

- 用户本地验收后明确授权提交、合并和推送，revision **`52527d45729825c54c7ab4cec0205a930aee0157`** 已快进合并 main 并 push origin main。旧 origin 地址由 GitHub 重定向到 `zhuguoliang1014/new-api`；Actions **`41204675107`** 在北京时间 **21:20:28** 完成部署，构建、部署均 success。
- 重写为白灰创作面板与作品区，集中比例、分辨率、质量、张数、格式、背景、风格参数；按分组选择当前可用模型，高质量组支持提交 6K/8K/10K，最多四个独立生成任务并发，生成期间可以继续编辑。保留本地图片历史、预览、下载、复用设置，增加按当前有效定价及基础充值比例计算的人民币费用预估。尚未代测真实收费上游生成 10K 成品，不将本地尺寸及传输回归称为上游画质验收。
- `POST /api/image-playground/bootstrap` 仅允许面板登录会话；首次打开时为符合当前分组权限的账号幂等创建三组图片专用 key，不是部署时批量为所有账号插入。key 只限相应图片模型，不向页面或审计日志返回可用凭据，禁用/删除后不自动重建。逐请求重新检查用户、分组、模型、key 状态/到期/额度/IP 限制，生成仍只能消费余额。已有提示词 Agent 设置保留。没有新增表结构或数据库迁移。
- 发布前最终检查：107 项前端测试通过；TypeScript、oxlint、25 个文件保护版权头的格式检查、117 个静态文案七语言完整性、前端构建及根模块 Go 构建通过。`go test ./controller ./middleware ./router ./relay/helper` 中 controller、middleware、relay/helper 通过，router 仅基线已有的 `TestAccessTokenRouteRulesCoverEveryDashboardRoute` 失败，原因为 `GET /api/rankings/users` 在基线已缺少 access-token 规则；`go test ./router -skip '^TestAccessTokenRouteRulesCoverEveryDashboardRoute$'` 通过，没有顺带修改排行榜权限策略。
- 三库工作台验证：SQLite **3.50.4**，MySQL **8.4.11**，PostgreSQL **15.17**，覆盖并发首次打开、重复初始化、跨用户/禁用/删除/到期/额度/IP/模型/分组权限限制、JSON 与 multipart 尺寸及数量边界、PAT 拒绝、原设置及余额保持不变。命令：`go test ./controller -run 'TestImageStudio|TestPlayground' -v -count=1`；MySQL 使用隔离本地库设置 `TEST_TASK_DB_DIALECT=mysql TEST_MYSQL_DSN='root@unix(/tmp/new-api-studio-preview/mysql.sock)/image_studio_test?charset=utf8mb4&parseTime=True&loc=Local'` 后运行 `go test ./controller -run 'TestImageStudio|TestPlaygroundAgentConfigurationDatabase' -v -count=1`；PostgreSQL 使用 `TEST_TASK_DB_DIALECT=postgres TEST_POSTGRES_DSN='host=127.0.0.1 user=zhuguoliang dbname=image_studio_test port=5432 sslmode=disable'` 运行同一测试。未改 schema，未新增迁移验证要求。
- 安全核对参考 OWASP ASVS **5.0.0** 的 V8.2.1–V8.2.3、V8.3.1，以及 Authentication、Session Management、CSRF Prevention Cheat Sheets；上述服务端授权和失败回归属于本次核对范围，不代表全站获得 ASVS 认证。**21:21** 实机核对 OCI revision、版本 `v1.0.0-rc.47+52527d457298` 一致、容器 running/healthy；香港本机、主站、国内入口 `/api/status` 与 `/api/pricing` 均 200，匿名 bootstrap 及 `/api/user/self` 均 401。新资源 `/static/js/async/99614.b368925263.js` 与 `/static/css/async/99614.2b344a49c3.css` 均 200，包含新分组请求及工作台样式；options、套餐及渠道快照与发布前一致，token 数量仍 2200。未代替用户创建生产密钥或执行付费生图。
- 恢复目录 **`/root/upgrade-recovery/new-api-image-studio-redesign-20261031T131226Z/`** 保存完整 PostgreSQL 归档 **131,717,030 字节**，SHA-256 **`a64ae3ef36c7026656110bf4669b6b6614041883291e7637e23a8eb8bd85f297`**，`pg_restore --list` 验证通过；另有受限 Compose/.env、配置前后快照、metadata.json、verification.json、rollback-compose.yml 和 rollback.sh。回滚镜像 `ghcr.io/zhuguoliang1014/new-api:rollback-image-studio-redesign-20261031` 保留 revision `2c5ed1cd1cf0`；需要时在香港执行恢复目录的 `rollback.sh`，只重建应用。未实际执行回滚，不应整库恢复覆盖期间新增业务数据。

### 图片价格配置归一化（2026-10-31）

- 按用户授权，**北京时间 21:04** 在生产 PostgreSQL **15.17** 仅更新 `GroupRatio`、`ModelPrice`、`billing_setting.billing_expr` 三行配置。`gpt-image-2`、`gpt-image-2.5`、`gpt-image-2.5-flare`、`gpt-image-2.5-sunburst` 的有效表达式统一为 `tier("image", fixed(1)) * image_count`；原值为 `fixed(0.1)`。`ModelPrice` 仅同步既有的前两个模型为 1，不新增 flare/sunburst 的旧式价格项。其他模型与计费模式保持原值。
- 分组 `【生图】超分基础版1-4k`、`【生图】超分高质量1-10k`、`【生图】官逆原生1-4k` 的倍率分别由 `0.3`、`1.2`、`2.25` 调整为 **`0.03`、`0.12`、`0.225`**。在当前 1:1 充值口径下对应每张人民币费用，实际售价保持不变；官逆原生并非 0.025。没有修改渠道、套餐、API key 或用户余额。
- 图片生成已由当前线上 revision `2c5ed1cd1cf0` 的 `service/billing_session.go` 在套餐选择之前强制走钱包，因此不会使用 GPT 文本套餐额度，也不会因本次基础价调整使套餐图片消耗增加十倍。此前仅查看套餐模型匹配得出的相反结论已纠正。生成模型、图片协议、图片别名及 Responses 图片工具等均在钱包识别范围内；普通视觉输入仍可使用符合条件的文本套餐。只读核对北京时间 10 月 30 日起的 **73 条 GPT 图片消费记录，全部为 `wallet`**；最近 10000 行容器日志另有 17 条 `wallet_only` 图片审计事件。
- 验证：`go test ./service -run '^TestSubscriptionBillingModelProviders/sqlite$' -count=1 -v` 在 SQLite **3.50.4** 通过，覆盖图片不能用套餐、余额不足不借用套餐、普通文本及视觉输入继续使用套餐。临时 Go 校验程序直接调用 `billingexpr.ComputeTieredQuotaWithRequest`，对 7 条启用模型/分组路由、生成数量 1–128 共 **896 组**检查，调整前后最终整数额度完全相等。本次仅修改现有配置数据，没有修改数据库代码、查询或表结构，不涉及三库迁移验证；未发起付费生成。
- 生产执行 `docker exec -i postgres psql -X -U root -d new-api -v ON_ERROR_STOP=1 -qAt`，先备份并验证 `pg_restore --list` 与 SHA-256，执行带旧值和其他 options 摘要保护的事务回滚演练，再提交相同变更。134 项 options 中仅目标三项变化，其余 **131 项原值完全一致**。**21:05** 核对香港本机、主站、国内入口 `/api/pricing` 均显示四个新表达式及三组新倍率，`/api/status` 均 200、充值比例 1、版本不变，容器 running/healthy。配置及价格缓存已自动同步，无需重启或发布镜像。
- 恢复材料 `/root/billing-recovery/image-price-normalize-20261031T125652Z/`（UTC 命名）保存 `options-before.dump`、`SHA256SUMS`、目标前后值、`apply.sql`、`dry-run.sql`、`rollback.sql`、`plan.json` 及 `api-verification.json`；目录 700、文件 600。回滚只恢复这三项，执行前核对是否有后续定价编辑。`rollback.sql` 也检查其他 options 摘要，后续其他设置变化时会主动拒绝；应重新核对并刷新无关配置摘要保护，保留目标原值检查，不得整表恢复覆盖实时配置。

### 画图工作台体验修复已上线（2026-10-31）

- 已提交并推送 main，revision `2c5ed1cd1cf0c276f9172e68e309f9dae290960e`，Actions `41169414570` 构建及部署均 success；北京时间 **12:47** 实机核对版本 `v1.0.0-rc.47+2c5ed1cd1cf0`、镜像 OCI revision 一致、容器 running/healthy，主站和国内 API 入口 `/api/status` 均 200。
- 扩大工作台图片展示区并压缩底部输入面板；远程图片尝试下载为 data URL 并存入既有按用户隔离的 IndexedDB 历史，旧链接记录在加载历史时尝试补存，部分失败时保留成功副本和可用链接并提示；图片预览弹窗跟随浅色/深色主题。浏览器本地历史仍最多保留 30 条，跨域限制或已过期链接可能使补存失败，已失效且无副本的图片无法恢复；此次没有增加服务器图片存储。
- 发布前运行 `bun run test src/features/image-playground`（5 文件、**89 项通过**）、`bunx --no-install tsgo -b`、涉及文件的 `oxlint -c .oxlintrc.json`、保护版权头的定向 oxfmt 格式检查、`bun run i18n:sync` 及七种语言新增键核对、`bun run build`，均通过。当前 `bun run typecheck` 脚本调用不存在的 `bun check`，因此类型检查使用已安装的 `tsgo -b` 完成，未修改其他工具链文件。仅修改前端，不涉及后端数据库代码或结构，无需三数据库迁移矩阵；本次未重新声称旧版手机浏览器兼容性已验证。
- 线上实际新资源 `/static/js/async/55643.13ad9412e0.js` 和 `/static/css/async/55643.1ea2c4a8ca.css` 均 200，包含本地保存状态逻辑及 52px 输入区新样式；首页入口 JS 资源通过。两个入口无凭据的 `/v1/models`、`/api/user/self` 均 401，独立 Telegram 机器人服务仍 active。未发起新的付费生图或支付请求。
- options 与渠道配置摘要前后一致。套餐差异仅为 **ID 20** 的 `expires_at: 0 → 1796054400`（北京时间 2026-12-01 00:00），`updated_at` 为 **12:40:52**；本次新容器 **12:43:13** 才启动，该独立变更早于本次部署，已保留，未覆盖或回滚。逐字段对比在恢复目录 `plan-differences.json`。
- 发布前恢复材料 `/root/upgrade-recovery/new-api-image-studio-20261031T043730Z/` 保存 **131,516,805 字节**完整 PostgreSQL 归档，`pg_restore --list` 与 SHA-256 复核通过；SHA-256 `98c64cbb9f2ef242c60f974e590f2d26c5a8390b78310f7f72d4ab6d0e6b815e`。受限目录另存 Compose/.env、配置摘要、回滚脚本与 `verification.json`。回滚镜像 `ghcr.io/zhuguoliang1014/new-api:rollback-image-studio-20261031` 保留旧 revision `45887ab866f61686bd9f6467f1a6c47186d3cd2c`；必要时在香港执行该目录 `rollback.sh`，仅重建 new-api。未执行回滚或整库恢复演练；本次纯前端回退无需恢复数据库，不应覆盖期间新增业务数据。

### 每日 Token 用户榜已上线（2026-10-29）

- 已快进合并并推送 main，revision `a27b4fbd1b42ac7abbe7233acbae1ab645541ce6`；Actions `40845804428` 构建、部署均 success。北京时间 **17:02** 实机核对版本 `v1.0.0-rc.47+a27b4fbd1b42`、OCI revision 一致、容器 healthy；从国内服务器验证主站与国内入口 `/api/status`、`/api/rankings/users?date=2026-10-28` 均 200。
- `/rankings` 默认每日用户榜，原模型榜通过 `?view=models` 保留。统计北京时间自然日内消费日志的正值输入 + 输出 Token，跨模型汇总、不按价格加权、不额外叠加缓存 Token。上线当时仅正常普通账号入榜（2026-11-03 已扩展到全部角色，见本文新记录），用户名脱敏、不返回账号 ID；公开前 100 名，登录用户可查看本人排名。服务端缓存及前端刷新周期均为 60 秒，支持最近 30 天；历史榜以保留日志和当前账号资格为准。此次无表结构或迁移变化。
- 线上历史榜核验：**2026-10-28** 共 **26** 人、**653,417,951 Token**，接口每行的排名、脱敏名、输入/输出/总量与只读 SQL 聚合逐项一致。当前日接口、非法日期 400、匿名身份隔离、私有 no-store 响应、排行榜页面和三项前端资源均通过；浏览器已看到真实榜单及金银铜领奖台。受保护接口匿名均 401，已授权只读模型列表 200。options、套餐、渠道、OAuth provider、既有封禁状态快照与发布前一致，虎皮椒与 Turnstile 保持启用。
- 发布前备份 `/root/upgrade-recovery/new-api-leaderboard-20261029T085556Z/new-api.dump` 为 **130,007,294 字节**，`pg_restore --list`、`sha256sum --check SHA256SUMS` 通过；受限目录保存配置副本、前后快照及 `verification.json`。回滚镜像 `ghcr.io/zhuguoliang1014/new-api:rollback-leaderboard-20261029` 对应旧 revision `4a3f51f8ba0f5daff087b0fe0cb2956bb584bc66`。未执行整库恢复演练。
- 本地数据库验证：真实 SQLite **3.50.4**、MySQL **8.4.11**、PostgreSQL **15.17**，独立主库/日志连接，覆盖跨日边界、多模型聚合、账号资格、并列排名、脱敏、负值/零用量、本人在前 100 名外、匿名与登录缓存隔离。执行 `TEST_MYSQL_DSN='root@unix(/tmp/rc47-mysql.sock)/user_rankings_test?charset=utf8mb4&parseTime=true' TEST_POSTGRES_DSN='postgres://zhuguoliang@localhost/user_rankings_test?sslmode=disable' go test ./service -run 'TestUserRankingDay|TestDailyUserRankingsDatabaseMatrix' -count=1 -v`，以及相同环境变量下 `go test ./service ./controller ./router -run 'Ranking' -count=1`，均通过。ClickHouse 未做本次运行验证，生产使用 PostgreSQL。
- 前端两文件九项测试、类型检查、涉及文件 lint/format、七语言键检查和生产构建均通过；390px 窄屏无横向溢出，1280px 桌面领奖台及历史切换、查看更多验证通过。精确命令与结果保存在本机 `/tmp/new-api-user-rankings-preview/validation.txt`。

### 妖火注册赠送已下线（2026-11-03）

- 移除自定义 OAuth 注册事务中的妖火专属5美元奖励发放及新奖励日志；妖火登录、注册与绑定继续运行。账号及绑定仍在同一事务创建，失败回滚；通用 `QuotaForNewUser` 行为保留。历史余额不追扣，`oauth_signup_rewards` 表/迁移及原日志七语言翻译保留。
- 真实 SQLite **3.50.4**、MySQL **8.4.11**（`clientFoundRows=true`）、PostgreSQL **15.17** 验证：首次注册/重注册零专属奖励、既有余额和完整历史收据保留、一般注册额度及最大余额注册、非法绑定回滚；MySQL/PostgreSQL 使用隔离主库和日志库。命令：各库环境 `TEST_SECURITY_DIALECT=sqlite|mysql|postgres` 配合本地 `TEST_MYSQL_DSN` / `TEST_POSTGRES_DSN`，执行 `go test ./controller -run '^TestYaohuo' -count=1 -v`。
- `go test -race ./controller -run 'Test(Yaohuo|GenerateOAuthCode|OAuthLogin|OAuthBind)' -count=1`、`go test ./oauth -count=1`、`go vet ./controller ./model ./oauth`、root `go build` 及 `git diff --check` 通过。
- 安全依据：OWASP ASVS **5.0.0**（本次不声明全站合规），Authentication / Session Management / OAuth2 Cheat Sheets；保留服务端 state 的浏览器绑定、期限及单次消费、HTTPS Cookie 属性。回归覆盖缺失/过期/错误提供方 state、缺失/错误浏览器 Cookie、错误 code、关闭注册及回调重放。既有其他 OAuth 浏览器绑定/Turnstile 缺口未在本次变更范围内。
- 已按用户授权提交push main：revision `d92539390faee68dbdb2eecaa9d746c0448f04fe`，Actions `41574535162` 构建及部署success。北京时间 **11:55:07** 新应用启动，**11:57** 核验OCI revision/版本一致、容器healthy；香港本机、主站、国内入口状态及定价200，匿名本人401、非法妖火state403，首页八项JS/CSS资源200。
- 发布后只读观察到一位自然妖火新注册账号，账号和绑定均在新应用启动后创建，余额0、已用额度0、奖励收据0，确认真实注册已不发放专属奖励；未代注册或创建替代生产凭据。原68笔历史收据逐字段一致；备份后旧版本在 **11:52:53** 正常发放的一笔5美元奖励发生于切换前，保留原值。此观察材料是当时快照，用户后续充值/消费可正常变化。
- 134项options、27套餐、44渠道配置（忽略正常用量/健康探测字段）、94项模型资料、原2230令牌配置（忽略正常用量）及原用户设置前后一致；期间3位正常新用户和3个新Key保留，OAuth provider配置一致，普通注册 `QuotaForNewUser=0`。未执行生产余额/配置修改或付费生成。
- 恢复目录 `/root/upgrade-recovery/new-api-yaohuo-disable-20261103/`（目录700/文件600），完整PostgreSQL归档 **133,825,246字节**，SHA-256 `cdabcdb38951b0ac5a7409cb12cd9cf8bc45b987af88edfd9a1d39d083141640`、归档目录及完整内容读取验证通过。目录含配置快照、三库日志、自然注册观察、`verification.json`、`verify.sh`及`rollback.sh`；回滚镜像 `ghcr.io/zhuguoliang1014/new-api:rollback-yaohuo-disable-20261103` 对应上一revision `c9ffe4d78a339d728f972dae9b82ad23f2a8e0cb`，Compose回滚配置检查通过。回滚只切应用，不恢复整库，不追扣历史赠送；未实际回切。

### 妖火授权注册福利已上线（2026-10-29）

- 已部署 revision `4a3f51f8ba0f5daff087b0fe0cb2956bb584bc66`，Actions `40834229236` 构建和部署均 success。北京时间 **15:22** 实机版本 `v1.0.0-rc.47+4a3f51f8ba0f`、OCI revision 一致、容器 healthy，主站与国内入口 `/api/status` 均 200。
- 仅使用 `yaohuo` 授权新建账号时赠送 **5 美元站内额度（2,500,000 quota）**，无需充值。普通注册 `QuotaForNewUser=0` 保持不变，其他 OAuth、已有账号登录或绑定不领取此奖励。独立收据表 `oauth_signup_rewards` 的身份哈希唯一；账号、绑定、收据和余额同事务创建，收据不随解绑/账号删除清除，防止同一身份重复领取。日志支持七种语言；分离日志库的展示日志在事务提交后写入，主库收据保留发放证据。
- 妖火登录 state 新增服务端浏览器 Cookie 绑定；HTTPS 站点强制 Secure、HttpOnly、`__Host-` 前缀、Path=/、无 Domain、SameSite=Lax，10 分钟有效，回调响应清除。同浏览器新授权替换前一次待完成授权。线上验证缺失/错误 Cookie 返回 403，带匹配 Cookie 的取消授权正常处理且 Cookie 清除，state 重放返回 403。其他提供方的既存 OAuth 浏览器绑定/Turnstile 缺口未在本次修复范围内；妖火官方对接文档要求关闭 PKCE，本次使用绑定浏览器的 state，不宣称全站 ASVS 合规。
- SQLite **3.50.4**、MySQL **8.4.11**（含 `clientFoundRows=true`）、PostgreSQL **15.17** 功能与回滚测试通过；新库与 rc.47 基线升级重复启动、既有数据/索引和奖励唯一性检查通过，MySQL/PostgreSQL 覆盖分离日志库。controller/model/oauth 回归、前端类型检查和构建通过。生产验证未代注册真实妖火账号或调整用户余额，真实用户授权领取尚未代测。
- 发布前备份 `/root/upgrade-recovery/new-api-yaohuo-20261029T071155Z/new-api.dump` 为 **129,897,552 字节**，`pg_restore --list` 及 SHA-256 通过；该受限目录保存配置与快照、`verification.json`。回滚镜像 `ghcr.io/zhuguoliang1014/new-api:rollback-yaohuo-20261029` 对应旧 revision `ac497c35ca79a92ee30fb4c7b9dfe1c5133c4e93`。未演练整库恢复；程序回退不删除收据表，避免丢失已领取记录。
- 上线后 options、套餐、渠道、OAuth provider 和既有封禁状态快照与备份一致；虎皮椒支付、Turnstile 配置保持启用，鉴权与前端资源检查正常。

### rc.47 已上线（2026-10-25）

- 已合并官方 `v1.0.0-rc.47`（`e835b1bfc`），升级提交 `ac497c35ca79a92ee30fb4c7b9dfe1c5133c4e93`。保留套餐倍率/冻结与预扣字段、虎皮椒支付、root 专属实际人民币消耗、定制依赖与七种语言文案；原有 GitHub OAuth Turnstile 缺口没有在本次修改。
- 验证通过：`go test ./...` 共 47 个测试包及根模块构建；relaykit、tokenkit 分别执行 `GOWORK=off go build ./...` 和 `GOWORK=off go test ./...`；Bun 1.4.4 冻结安装、`bun check -b`、`bun run build`、涉及文件的 oxlint/oxfmt、七语言键与占位符检查；前端 217 文件/2,629 项测试。针对 Responses 完成、12h 缓存及写流预算的 race 检查通过。
- 数据库验证使用真实 SQLite **3.50.4**、MySQL **8.4.11**、PostgreSQL **15.17**；`python3 /tmp/new-api-rc47-db-matrix.py` 覆盖新库与现有 rc.46 定制版升级 6 场景，每场景启动迁移两次，验证数据、索引及唯一性，MySQL/PostgreSQL 使用单独日志库。设置 `TEST_MYSQL_DSN`、`TEST_POSTGRES_DSN` 执行 model/controller 测试，controller 另设置 `AUDIT_*` 验证实际消耗权限；`TEST_SUBSCRIPTION_*` 套餐测试及 `TEST_TASK_DB_DIALECT=mysql/postgres` 即时任务结算通过。MySQL 为本机一次性 127.0.0.1:13347 实例，PostgreSQL 使用本机隔离测试库；未在生产库运行测试。
- 发布前备份 `/root/upgrade-recovery/new-api-rc47-20261025T140309Z/new-api.dump`，127,416,745 字节，SHA-256 与 `pg_restore --list` 已通过；受限保存原 Compose/.env、options、套餐、渠道和已封禁账号状态快照。回滚镜像 `ghcr.io/zhuguoliang1014/new-api:rollback-rc47-20261025` 对应旧 revision `ec4b11d3bb066c089ea6fb1e16bc0cfc40784df8`。未进行整库恢复演练。
- 已推送 main，GitHub 确认仓库已从 `coder-glzhu/new-api` 迁至 `zhuguoliang1014/new-api`；本机 origin 仍是旧 URL，通过 GitHub 重定向成功推送。新仓库 Actions `40200568349` 构建、部署均 success。北京时间 **22:12** 实机 OCI revision 与提交一致，容器 healthy，版本 `v1.0.0-rc.47+ac497c35ca79`；从 search 验证主站与国内入口 `/api/status` 均 200 并返回该版本。
- 线上 `/api/pricing` 返回 34 个模型，首页及 3 个 JS/CSS 资源返回 200；现有 root API key 的只读 `/v1/models` 返回 200，无认证的 `/v1/models`、`/api/log/self/stat`、`/api/log/stat`、`/api/user/self` 均返回 401。options、subscription_plans、渠道路由配置、1319–1349 封禁状态/认证版本/活动 key 数与备份逐字一致，`HupijiaoEnabled=true`、`turnstile_check=true`。未发起付费模型或支付请求；这不替代真实上游生成或支付成功路径的端到端验证。核验结果保存在恢复目录 `verification.json`。

### rc.46 已上线（2026-10-22）

- 官方 `v1.0.0-rc.46`（`7d8b91268`）已合并；main 与生产 revision 均为 `ec4b11d3bb066c089ea6fb1e16bc0cfc40784df8`，版本 `v1.0.0-rc.46+ec4b11d3bb06`。Actions `39729432981` 构建、部署成功；实机容器 healthy，主站及国内入口 `/api/status` 均 200，无凭据的 `/v1/models` 和 `/api/log/self/stat` 均 401。未发起付费模型或支付请求。
- 人民币“实际消耗”按用户补充要求仅 root（role 100）可见；root 在所有日志和本人日志中均可查看，其他管理员、普通用户和未认证身份均不显示该标签，两个统计接口也不计算或返回 `actual_cost_cny` / `actual_cost_estimated`，伪造请求参数不能放宽权限。普通用量、RPM、TPM 保持原行为。
- 保留虎皮椒支付、套餐倍率/冻结、人民币实际消耗及原有定制功能。发布前后 options、subscription_plans 配置哈希、1319–1349 的禁用状态/认证版本/活动 key 数、香港 Nginx 配置均一致；`HupijiaoEnabled=true`、`TurnstileCheckEnabled=true`。search 的 Nginx 检查通过。此前 GitHub OAuth 未接入 Turnstile 的缺口仍存在，本次未修改该路径。
- PostgreSQL 已有 `quota_data.cache_read_tokens`、`quota_data.cache_creation_tokens` 及 `audit_logs(created_at,event_id)` 的 `idx_audit_time_event`。真实 SQLite 3.50.4、MySQL 8.4.11、PostgreSQL 15.17 的全新安装、当前定制版/官方 rc.45 升级共 9 场景均完成重复迁移，保留原数据、索引与唯一约束；实际消耗/权限也通过 ClickHouse 26.11.1.485 日志库验证。后端 47 个测试包及独立子模块、前端 217 文件/2583 项原测试及改后 7 项实际消耗测试通过；类型检查、构建和本次变更文件检查通过，历史全量格式问题保留。
- 部署前全库备份 `/root/upgrade-recovery/new-api-rc46-20261022T053404Z/new-api.dump` 为 125,260,417 字节，`pg_restore --list` 与 SHA256 验证通过；同目录受限保存原 Compose/config、配置哈希、禁用用户快照与旧 revision。回滚镜像 `ghcr.io/zhuguoliang1014/new-api:rollback-rc46-20261022` 保留旧 revision `d2c1750f47805a8ad9300ce4b14e39f61ee56fe8`。这是归档可读性检查，未进行整库恢复演练；回退程序不会自动回退数据库迁移。
- 本次读取部署配置时曾意外输出敏感字段，已停止此类输出；相关凭据仍需单独轮换，本次未更改会话密钥或数据库认证。文档不记录任何凭据值。

工作流使用以下 GitHub Secrets；这里列的是香港部署应对应的目标，**不是读取到的 Secret 值**：

| Secret 名称 | 应对应的含义 |
| --- | --- |
| `SSH_HOST` | `64.90.21.44` |
| `SSH_PORT` | `18272` |
| `SSH_USER` | `root` |
| `DEPLOY_PATH` | `/root/new-api` |
| `SSH_PRIVATE_KEY` | 专用部署私钥；对应公钥须已在香港授权。此项不能填写公钥 |

部署执行 `docker compose pull new-api` 和 `docker compose up -d --force-recreate new-api`，之后清理未使用镜像。不要因为只改应用就重建 PostgreSQL/Redis；不要执行 `docker compose down -v`。

只读核查：

```bash
git remote -v
git log -1 --oneline
ssh aiproxy-hk 'docker inspect new-api --format "{{.Config.Image}} {{.Image}}"'
ssh aiproxy-hk 'docker inspect new-api --format "{{index .Config.Labels \"org.opencontainers.image.revision\"}}"'
ssh aiproxy-hk 'cd /root/new-api && docker compose ps'
```

部署和数据迁移前记录镜像 ID / digest、准备新的数据备份，并明确回滚方案。应用版本回退不能自动回退已经发生的数据库迁移。

## 5. 常用检查与排障入口

### 服务健康与安全

以下命令不创建付费模型请求：

```bash
ssh aiproxy-hk 'docker ps --format "{{.Names}}\t{{.Status}}\t{{.Ports}}"'
ssh aiproxy-hk 'curl -fsS http://127.0.0.1:3001/api/status'
ssh aiproxy-hk 'curl -fsS http://127.0.0.1:8089/health'
curl -fsS https://92ai.asia/api/status
curl -fsS https://api.sousousouju6212.top/api/status
ssh aiproxy-hk 'nginx -t'
ssh search 'sudo -n nginx -t'
ssh aiproxy-hk 'fail2ban-client status sshd; ufw status verbose'
ssh aiproxy-hk 'sshd -T | awk "/^(port|passwordauthentication|kbdinteractiveauthentication|pubkeyauthentication|permitrootlogin) /"'
ssh aiproxy-hk 'systemctl is-active shadowsocks-libev sing-box-jp-proxy; systemctl is-enabled certbot.timer'
ssh aiproxy-hk 'certbot certificates'
```

只有配置实际变更并且 `nginx -t` 通过时才需要 reload；香港执行 `systemctl reload nginx`，search 执行 `sudo -n systemctl reload nginx`。不要为一次只读检查重启应用或 Nginx。

### 手机白屏与静态资源截断（2026-11-02）

- 北京时间 **21:24:08–22:26:58**，主站错误日志记录 81 条 Nginx `proxy` 临时文件 `Permission denied`，涉及首页及登录页的 JS/CSS。`/var/lib/nginx/proxy` 当时为 `nobody:root 0700`，实际 worker 为 `www-data`，无法穿越该目录。首次请求即便返回 HTTP 200，资源正文仍会被中途截断，不能仅用 HEAD/状态码验证前端健康。
- 本机实测主脚本 `/static/js/index.3cdc2fb947.js` 应为 **5,553,343 字节**；修复前 HTTP/1.1 只收到 65,018 字节即报剩余正文未传完，HTTP/2 报流 `INTERNAL_ERROR`。应用本机原始资源完整。该故障足以造成新浏览器白屏；电脑已有资源缓存可能掩盖故障，不能据此归因为近期 CSS 兼容性。
- 北京时间 **22:27:18**，使用生产配置执行 `nginx -T` 时，Nginx 自身将临时目录属主恢复为 `www-data`；核对 `proxy`、`body`、`fastcgi`、`uwsgi`、`scgi` 均为 UID 33、GID 0、0700。未 reload/restart Nginx 或应用，未变更前端代码、数据库、计费与镜像；revision 仍为 `33ade7bcee032eac85df42f6d01e27fe383cdebf`。目录先前为何变为 `nobody` 尚未确认。
- 修复后香港 HTTPS 回环、国内 `search` 实际公网及本机压缩公网 GET 均完整读取主脚本，SHA-256 均为 `1b3f00a7ca01deeba4aaafffecb1626fdfcc9c6fbdcf27a101e3a01c35ab43d9`；国内节点另对首页五个初始 JS 和 CSS 完整读取通过。恢复/核验材料在香港 `/root/site-recovery/nginx-mobile-white-20261102T142718Z/`，包含故障前观察值、修复后权限、脱敏错误日志及受限配置副本。注意副本在检查自动修复之后保存，未保存故障前目录完整 ACL。
- 后续若复现：先记录目录权限和 worker 身份，再使用正式配置检查并核对资源完整长度/摘要；不要用省略 `user www-data;` 的临时 Nginx 配置共享生产的默认 temp path，以免测试过程将目录属主改为默认 `nobody`。该提醒是防范已知机制，并非本次属主变化的已证实来源。

### 数据库只读确认

数据库角色与库名已知，容器内现有认证可用，不必从 `.env` 打印口令：

```bash
ssh aiproxy-hk "docker exec postgres psql -X -U root -d new-api -Atc 'SELECT current_database(), version();'"
ssh aiproxy-hk "docker exec sub2api-postgres psql -X -U sub2api -d sub2api -Atc 'SELECT current_database(), version();'"
```

改生产数据优先复用管理 API；需要直接改库时，先保存目标记录、限定主键/模型名/订单号，并使用事务和变更后复核。不要批量打印用户、令牌或支付配置。

### 注册滥用处置与 Turnstile（2026-10-22）

- 截至北京时间 **09:41**，当天新增 29 个账号（ID **1319–1347**），创建时间 **04:38:16–07:01:00**，对应 29 个不同 GitHub ID。创建时的 GitHub OAuth 回调、首次登录及创建 API key 的来源均为 `103.130.18.29`；Nginx 连接 IP 与应用审计一致，外部 `X-Forwarded-For` 为空。05:48 的一批在 7 秒内创建 5 个账号，后续操作高度重复，判断高度疑似自动化批量注册；同一出口 IP 不单独证明同一个自然人。
- 按用户明确指令，已将上述 **29 个账号禁用**，递增认证版本，停用 **57 个未删除 API key**，撤销 **29 个浏览器会话**，清除旧版面板凭据并处理相关认证缓存。没有删除用户、修改余额或价格。写入 29 条 `user.manage` 安全审计，认证来源如实标记 `ops_ssh`，不伪装为浏览器管理员验证。
- 管理接口要求管理员会话及敏感操作证明；本次未创建替代管理员凭据，采用已有 SSH 运维权限执行限定主键的 PostgreSQL **15.17** 事务。执行前完成专用全库备份、归档目录读取验证及目标快照；为避免并发写入旧认证缓存，短暂停止并重新启动原版本应用。恢复材料在香港 `/root/security-recovery/signup-abuse-20261022/`，其中包含受限备份、目标快照、执行 SQL、缓存处理结果及验证记录；不得提交这些文件到 Git。
- 已复用现有正式 Turnstile 配置，设置 **`TurnstileCheckEnabled=true`**。Cloudflare Siteverify 对无效测试响应返回 `invalid-input-response`，未报告无效密钥。北京时间 **09:47** 验证：公开 `/api/status` 显示启用及站点公钥；普通注册、密码登录和邮件验证码接口均拒绝缺失验证；注册接口拒绝无效验证。57 个原 API key 的只读 `/v1/models` 请求全部返回 **401**；主站与国内 API `/api/status` 均为 **200**，应用容器 healthy。未发起付费模型请求，未人工完成验证码正向流程。
- **已知缺口，尚未修复**：当前程序的 `/api/oauth/state` 和 GitHub 授权回调没有接入 Turnstile，前端 OAuth 请求也不发送验证码。早间验证无 Turnstile 的 GitHub 登录授权流程仍能创建；该测试不创建用户。启用全局开关不能宣称已阻止同类 GitHub 批量建号。早间处置未关闭 GitHub 登录、未封禁来源 IP，也未部署代码变更；中午追加 IP 封禁见下文。
- **中午追加处置（2026-10-22）**：`sarisantoso2497`（ID 1348，12:09:29）、`ekoyuliana4804`（ID 1349，12:16:36）再次从 `103.130.18.29` 经 GitHub 注册，随后创建相同的 `hrv-claude`、`hrv-gpt` API key。按用户追加指令禁用这两个账号、递增认证版本，停用全部 4 个未删除 API key，撤销 2 个浏览器会话，清理旧版面板凭据并使未完成认证流程失效；各有一条 `ops_ssh` 来源的安全审计。数据库及 Redis 认证版本、用户状态、令牌缓存同步完成，利用现有版本下限及缓存写入保护阻止旧缓存覆盖；本次未停止或重启应用。账号复核均无活动 key、会话或 PAT；4 个原 API key 的只读 `/v1/models` 验证均为 401，无付费请求。
- **IP 封禁已经运行**：香港主站和 search 国内 API 入口均新增 `/etc/nginx/conf.d/00-signup-abuse-blocklist.conf`，通过 `geo` 匹配实际客户端地址 `103.130.18.29`；在香港 `/etc/nginx/conf.d/92ai.conf`、search `/etc/nginx/conf.d/api.sousousouju6212.top.conf` 的 HTTP/HTTPS server 中直接返回 403。香港原有 Cloudflare 真实 IP 信任范围及国内入口 HTTPS 上游证书验证保持不变。两机 `nginx -t`、reload 通过；香港访问日志北京时间 12:20:09–12:20:11、12:23:32 已观察到该实际来源请求返回 403，`upstream_addr` 为空，证明确实在入口拦截。处置后应用 healthy，从 search 访问主站及国内入口 `/api/status` 均返回 200。该规则只封这一个 IP，GitHub OAuth 的 Turnstile 缺口仍未修复，不能据此声称阻止了换出口注册。
- **追加恢复材料**：两机 `/root/security-recovery/signup-abuse-followup-20261022/` 保存各自 Nginx 修改前配置；香港另有完整主库备份 `before.dump`（125,213,546 字节，SHA-256 已记录、`pg_restore --list` 通过）、目标快照、限定 ID 的事务 SQL、执行脚本和缓存/接口验证结果。材料仅限服务器受限目录，不提交到 Git。恢复入口规则时应先核对期间新增规则，再还原对应 server 修改、处理本次 geo 文件，`nginx -t` 通过后 reload；不要直接覆盖整库恢复账户状态。
- 参考 OWASP Authentication、Session Management、OAuth 2.0 Cheat Sheets 与当前稳定 ASVS **5.0.0**，核对服务器禁用状态、认证版本失效、会话撤销、缓存一致性及不含可用凭据的审计；这是本次运维处置的控制核查，不是全站合规结论。

### 网络滥用请求文本过滤（2026-10-27）

- **已经运行**：北京时间 **20:05:20**，经 SSH 直接向香港 PostgreSQL **15.17** 的 `options` 写入 `CheckSensitiveEnabled=true`、`CheckSensitiveOnPromptEnabled=true` 和 `SensitiveWords`。原三项均无持久化记录，运行默认关闭；现为 **112 条滥用短语 + 1 条无害运维测试标记**，大小写不敏感、字面子串匹配、全局生效。20:05:31 已观察到选项自动同步；无需重启，镜像及版本仍为 `v1.0.0-rc.47+ac497c35ca79`。
- **规则取舍**：覆盖恶意软件制作 33、凭据窃取 28、钓鱼盗号 13、攻击入侵 25、恶意软件免杀 13 条，含中文简繁体和英文常见表达。未把“破解、逆向、漏洞、木马、ransomware、DDoS”等宽泛单词或通用 Agent 指令单独拉黑。词表是本次结合业务整理的基础规则，**不是上游认证的模板，也不是从某个仓库完整导入的标准词库**。原始词表和分类说明在恢复目录 `keywords.txt`、`policy.json`。
- **检索依据（2026-10-27 读取 GitHub 原始文件/API）**：[LLM Guard BanSubstrings](https://github.com/protectai/llm-guard/blob/main/docs/input_scanners/ban_substrings.md) 支持字符串/整词扫描，[BanTopics](https://github.com/protectai/llm-guard/blob/main/docs/input_scanners/ban_topics.md) 使用主题分类；[NVIDIA NeMo Guardrails](https://github.com/NVIDIA-NeMo/Guardrails) 提供输入、输出、主题、安全及越狱检测的组合；[Llama Guard 3-8B](https://github.com/meta-llama/PurpleLlama/tree/main/Llama-Guard3/8B) 是输入/输出安全分类模型；[HarmBench](https://github.com/centerforaisafety/HarmBench) 是红队评估框架，不能把评估题目当作生产黑名单。LLM Guard 文档所链接的 `llm_guard/resources/prompt_stop_substrings.json` 在本次查询返回 404，未导入；未找到可直接用于本服务且保证覆盖 Cyber Abuse 的通用词库。读取的文档、来源 URL 和 SHA-256 保存在恢复目录。
- **验证**：本地使用当前相同 revision 的 `service.CheckSensitiveText` 实际匹配器，113 行规则的原文/大写均命中；20 条正常开发、防御、授权测试样例均未命中；Chat、Responses、Claude DTO 文本提取检查通过。北京时间 **20:06–20:07**，线上六种检查覆盖 Chat、Responses 字符串/结构化流式请求、Claude 文本块，以及主站和国内 API 入口，全部命中无害测试标记并由本地拒绝，逐个 request_id 的服务器日志已核对；未向业务上游提交恶意内容。两个现有运维 key 的只读 `/v1/models` 均 200，容器 healthy，两个入口 `/api/status` 均 200。正常内容样例属于本地验证，不代表全部真实业务都无误报。
- **已知边界**：当前版本拦截返回 HTTP **500**；OpenAI 格式包含 `sensitive_words_detected`，Claude 格式为 `new_api_error` 和本地拒绝说明，部分客户端可能自动重试。检查只覆盖请求解析时提取的文本，无法判断否定、引用、授权或攻击意图，也可能匹配历史/system/tool 文本；未部署图片/音频审核、完整会话分析、语义安全模型或自动封号。因此仍有误报和漏报风险，不能承诺上游不封号。建议后续按上游违规定义增加经过评估的独立输入语义审核，并将策略拒绝改成明确的非重试 4xx；这些均**尚未实施**。
- **恢复材料**：香港 `/root/security-recovery/newapi-cyber-filter-20261027/`（目录 700、文件 600）包含 `options-before.dump`（仅 options 表，16,751 字节）、校验和及可读归档目录、目标项原快照、其他配置校验值、规则及来源、事务 `dry-run.sql` / `apply.sql` / `rollback.sql`、前后配置和验证记录。回滚演练通过后才正式提交；只改三个选项，其他 options 保持一致，未修改数据库代码或结构，不涉及三数据库迁移矩阵，也未做整库恢复演练。回滚先核对后续是否改过词表，再运行 `docker exec -i postgres psql -X -U root -d new-api -v ON_ERROR_STOP=1 < /root/security-recovery/newapi-cyber-filter-20261027/rollback.sql`，随后等待至少一次选项同步并核验。脚本有并发变更保护；原本缺失的三项用显式 `false` / 空串恢复有效默认值，避免仅删除数据库行后内存缓存仍保留旧规则。不要整表覆盖恢复其他实时设置。

### 模型广场

- 描述、图标、厂商、端点等资料在 `models` 表，价格与渠道配置是另外的数据。仅修改说明通常不需要改前端或重新部署。
- 新模型要核对精确模型名；没有元数据记录时才添加，保留既有厂商与端点信息。不要为了给后缀模型加说明而随意扩大匹配规则。
- 说明使用简洁中文和具体用途；两个 `*-ultrafast` 描述保留用户确认的“极致速度版本”定位。不编造测评、速度数字或未验证的独有能力。
- 模型广场数据有约 1 分钟缓存，管理接口可触发刷新。修改后检查 `https://92ai.asia/api/pricing` 的实际结果，不仅看数据库写入成功。
- 2026-10-15 已统一补充当时 32 个可见模型的描述。记录备份在 `/root/new-api/data/model-metadata-backups/`；此目录尚不在当前异地备份脚本范围内。
- 任何改价格、额度、倍率或结算逻辑的工作，先完整读取 `.agents/rules/billing.md`，不得将元数据修改扩展为改收费。

### 支付 Pending 与订阅

- **订单操作上线（2026-10-16）**：最终 revision `30ed82cfcf2a995dea038bad09a6347a8adc9b26`，Actions 构建部署成功，容器 revision、`/api/status` 200、两种后台补查任务均已实机核对。`top_ups` 新增私有 `pay_url`、`qrcode_url` TEXT 字段；SQLite 3.50.4、MySQL 8.4.11、PostgreSQL 15.17 的新库及旧表升级均重复迁移两次通过，原数据与订单号唯一约束保留。
- 管理员 `/api/user/topup/complete` 改为先核实虎皮椒或历史易支付平台订单号、付款状态及金额，再复用幂等到账；不再直接无条件加余额。新增 `/api/user/topup/close`，必须管理员权限和 `billing:write` 令牌范围；线上无登录请求均返回 401。其他未实现主动查单的支付渠道不允许凭空补款。
- 用户继续支付与取消均校验本人订单；取消/关闭/过期在一个事务中更新充值及关联订阅状态。仍有效的直连支付链接可以续付，旧链接失效时按原报价生成直连替代订单，原平台订单号保留。页面状态中文化，操作后立即刷新，列表每 5 秒同步。关闭是站内关闭，未承诺平台退款或远程撤销；迟到的真实付款经核实仍只到账一次。
- 该版本部署前备份 `/root/payment-recovery/pre-order-actions-20261016T060055Z/new-api.dump`，124516912 字节，`pg_restore --list` 通过；回滚镜像保留为 `ghcr.io/zhuguoliang1014/new-api:rollback-order-actions-20261016`。本次联调未调整真实客户余额或发起实际付款。

- **2026-10-16 更新**：用户因两层手续费决定恢复虎皮椒直连；钱包充值和订阅购买均走直连，不再经过易支付平台。生产配置为 `HupijiaoEnabled=true`、`PayMethods=[]`；后者关闭易支付新订单，商户凭据继续保留以处理已生成的订单。 最终 revision `e153cacc5da66d560fcc2b229cc4b2ea0a9b6e63` 已部署并核对容器，`/api/status` 返回 200；两种补查任务均执行成功。
- 虎皮椒直连 API 为 `https://api.xunhunet.com/payment/do.html`；`HupijiaoPrice=1`、`HupijiaoMinTopUp=10`。基础比例为 1 元人民币对应 1 美元站内额度，档位 30/50/100/200/500，50/100/200 档 95 折、500 档 9 折保持不变；现有套餐人民币售价、额度、VIP 升级和余额兑换规则保持不变。
- 易支付曾使用 new-api 原生 V1/MD5，网关 `https://pay.hupijiao.cn/`。充值通知 `/api/user/epay/notify`、订阅通知 `/api/subscription/epay/notify`、订阅返回 `/api/subscription/epay/return`，`CustomCallbackAddress=https://92ai.asia`；这些保留用于历史订单，密钥仅在服务器受限配置中保存。
- 已真实验证易支付充值：订单 ID 585，用户 1，实付 10 元，2026-10-16 北京时间 13:21:36 平台签名通知结算成功，增加 5,000,000 quota（10 美元站内额度）；数据库与 Redis 一致。13:22:22 重复通知幂等忽略，无重复加款。此记录不代表真实订阅付款验证；订阅仅有隔离账户受控联调和自动测试证据。
- `epay_reconcile` 与 `hupijiao_reconcile` 均每 30 秒补查近 7 天未结订单。原生查单兼容平台实际返回的字符串状态和未选渠道时 `type=false`，修复 revision `9dced9ff38e333563b396c6b1ddd5986cc4eca5e` 已部署，线上连续补查成功。易支付未付款订单仍为 pending，不补余额；关闭新订单不应阻断历史支付通知。
- 旧虎皮椒共用异步通知路径为 `/api/hupijiao/webhook`，另有订阅专用路径 `/api/hupijiao/subscription/webhook`。`HupijiaoNotifyUrl` 为 `https://92ai.asia/api/hupijiao/webhook`，返回地址为 `https://92ai.asia/my-wallet`。
- 2026-10-16 的 `45b6a980b` 已修复旧虎皮椒 3 分钟超时阻断已付款订单的问题，并添加后台查单兜底。后台系统任务类型 `hupijiao_reconcile`，调度间隔 30 秒，覆盖近 7 天待支付/已过期订单；线上已核实任务执行成功。
- 补单先核对 `subscription_orders`、`top_ups`、实际用户订阅与平台交易状态。充值到账与订阅发放不是同一个操作；仅把订单 `status` 改为成功不等于补单完成。优先复用幂等结算逻辑，复核余额、缓存、订阅与用户分组，避免重复发放。
- 2026-10-16 用户 1307 的 20 元订单已核实平台付款后补齐，订单成功，缓存同步，补单审计一条。另两笔近 7 天未结订单经平台查询均为 `WP` 未付款，未补款。
- 支付原始记录、补单核对材料与迁移备份在香港 `/root/payment-recovery/`，包含私人业务数据，不得提交到 Git。原生迁移配置备份为 `native-epay-20261016T042728Z/options-before.json`；部署前数据库归档为 `pre-native-epay-20261016T043015Z/new-api.dump`，归档目录读取验证通过。
- 平台报告 `empty callback` 的一次手动通知未出现在香港 HTTP 访问日志；香港与两台国内服务器访问正常，正确签名的已成功订单重复通知返回 `200 success` 且未重复加款。平台的具体 DNS、连接、TLS 投递错误仍未取得，不能把原因认定为应用、证书或香港网络故障。

### 渠道 111 零消费对账与官方代码回退（2026-10-21）

- 截至北京时间 **19:35:05**，精确匹配渠道 111 的上游收费 `client_gone` 共 157 笔，其中 **101 笔**原为零消费，已按历史表达式和实际资金来源补记 **75.361320** 站内额度：钱包 3 笔 **2.002230**，订阅 98 笔 **73.359090**。现无已匹配的收费 `client_gone` 零消费记录。
- 用户、令牌、渠道累计量，原订阅实例用量、钱包余额、消费日志及仪表盘汇总已同步；原日志带 `admin_info.billing_reconciliation` 审计快照。事务回滚演练通过，正式提交后幂等复核新增为 0。应用为保持数据库/Redis同步短暂停顿约 2.06 秒后恢复，受影响额度缓存当时均不存在。
- 专用材料在 `/root/billing-recovery/client-gone-reconcile-20261021T0848Z/`。正式执行前 `before-final.dump` SHA256 为 `a661a509840f204af11b46db02f7d0686df3801ee0e2ec70c25a0f27ca07086a`，归档目录读取验证通过；保存前后快照、逐笔来源、复算结果和幂等 SQL。不要盲目覆盖整库恢复，以免覆盖期间正常消费。
- `c14547ef7e600c34fae67638f39bc85c6221540a` 删除本地空流拦截与其对应测试，三个变更文件与本次获取的官方版本一致。相关五个包测试及 `go build ./...` 通过；已推送 main，Actions `39592885892` 的部署结果待最终实机核查。
- **结论边界**：不能确定把示例零消费归因于此前的提前返回，因为该分支会跳过消费日志写入，而实际示例存在零消费日志。官方 Responses 首事件前断流仍可能无 usage，回退不会自动从上游账单追补；本次补齐的是已核实历史请求，未新增持续后台对账任务。恢复官方 Claude 逻辑也恢复其既有缺失 usage 的估算路径。2026-10-16 的记录作为历史保留，不能继续视为当前回退后的行为。

### 空流估算误扣修复与补偿（2026-10-16 核查）

- 修复 revision `6714841447bb2c64f013b3417c7eb99f72a16e18` 已通过 GitHub Actions 构建、部署并核对生产容器。随后上线的 `30ed82cfcf2a995dea038bad09a6347a8adc9b26` 包含该修复；本次最后核对主站和国内 API 入口的 `/api/status` 均成功，版本为 `v1.0.0-rc.41+30ed82cfcf2a`。
- Claude 流没有上游用量或实际内容时，返回空响应错误并进入原有失败退款流程；公共文本结算入口同时阻止“收到上游事件为零、只有本地输入估算”的扣费，并以零费用结算释放预留。已有实际上游用量或部分输出的请求继续按原规则结算。
- 回溯现有日志，按“流异常、没有首个上游事件、零输出、仅本地估算、无缓存用量”的证据核实，已向 **118 个现存账户**补偿 **1,139 笔**，合计 **671.460550 美元站内额度**。钱包和订阅误扣均按原扣金额补入钱包，订阅额度不再重复返还；用户、令牌和渠道累计用量已相应校正，请求次数保持不变。历史上被重置的令牌累计用量扣减至零为止。
- 每笔补偿写入类型 6 的退款日志并关联原消费日志；原记录保留扣费证据并附 `billing_correction` 标记。事务重复执行新增补偿为零，缓存同步重复执行也未重复加款。
- 另有 **1 个已删除账户的 4 笔**，合计 **0.373268 美元**，因主库已无该账户无法入账，未创建替代账户；待核对清单保留在受限恢复目录。
- 操作前完整主库归档、目标快照、补偿 SQL、退款明细和缓存核对材料位于香港 `/root/billing-recovery/claude-empty-stream-20261016/`，权限受限，不得提交到 Git。归档目录读取成功，补偿先经事务回滚演练再正式执行；这不等于完成了整库恢复演练。
- 相关常规回归与本次修复的 race 检查通过。扩展执行整个 `service` 包的 race 检查时，视频任务轮询测试报告了与本次变更无关的并发访问问题，尚未在本次修复中处理。

### 首字延迟与 Nginx

- 香港应用日志：`docker logs --since 30m new-api`；sub2api：`docker logs --since 30m sub2api`。
- 香港主站：`/var/log/nginx/92ai-access.log`、`92ai-error.log`；国内转发接收：`api-relay-origin-access.log`、`api-relay-origin-error.log`。
- search 转发日志：`/var/log/nginx/api-sousousouju6212-access.log`、`api-sousousouju6212-error.log`。
- 当前关键流式代理已关闭响应/请求缓冲，保留 HTTP/1.1、连接复用及较长读取超时。不能仅凭“请求慢”推断 Nginx 缓冲设置有问题。
- 香港访问日志记录 `request_time`、`upstream_response_time`、`upstream_connect_time`、`upstream_header_time`；完整响应时间**不是首字时间**，流式响应还应结合 new-api 对应请求日志。
- 日志里的 Nginx upstream 是本机 new-api，不是 Krill。`request_time` 接近 `upstream_response_time` 只能帮助定位代理开销，不能直接证明 Krill 的首字时间，也不能排除用户侧网络背压；不同平台的首字统计口径要单独核对。

### 渠道标签整理（2026-10-22）

- 按用户确认的模型用途，将 38 条渠道分为 `图片` 4、`codex` 11、`claude` 15、`grok` 5、`国模` 2、`测试` 1；`codex` 包括 GPT 号池。原 `【新渠道】`、`PandaTK` 及空标签均已归类，国模渠道 #103 从 `claude` 移至 `国模`。渠道名称统一为“来源 / 模型 / 号池或用途”，保留 QQ、Gmail、Jame 等区分标识。
- 通过香港 SSH 直接操作生产 PostgreSQL **15.17**，未使用浏览器修改。只更新 `channels.name`、`channels.tag` 及 `abilities.tag`；事务内锁定目标行并逐项比较其余字段，确认用户业务分组、模型、路由启用状态、权重、优先级、备注、凭据及其他配置均未变。原名和原标签保存在恢复快照中。
- 专用恢复目录 `/root/channel-recovery/model-tags-20261022T141850Z/` 保存 `before.dump`（125,776,775 字节）、`SHA256SUMS`、前后渠道及路由标签快照、`plan.json`、`dry-run.sql`、`apply.sql`、`rollback.sql` 和验证记录。执行 `docker exec postgres pg_dump -U root -d new-api -Fc` 保存全库备份，`pg_restore --list` 读取通过；限定字段的事务先 `ROLLBACK` 演练，再于北京时间 **22:19:52** 开始正式提交，38 条映射与渠道/路由标签一致性核对通过。未执行整库恢复演练，未修改数据库代码或结构。
- 回退时先核对后续是否再次修改渠道名称或标签，再通过 `psql -X -U root -d new-api -v ON_ERROR_STOP=1` 执行目录内 `rollback.sql`；脚本仅恢复本次名称和标签，不覆盖实时用量及其他配置。渠道缓存由现有每 60 秒同步任务自动刷新，无需为此次整理重启应用。
- 北京时间 **22:20:41** 观察到提交后的渠道缓存同步完成；容器保持 running/healthy，主站和国内 API 入口 `/api/status` 均为 200，版本保持 `v1.0.0-rc.46+ec4b11d3bb06`。未发起付费模型请求。
- **最终名称约定（22:31 更新）**：用户认为中间的模型系列多余，已将 32 条三段式名称改成“来源 / 具体用途”两段式，其余 6 条原本两段式名称保留；例如 `Sub2API / 普通池`、`GetElucid / Max号池`、`PandaTK / 超分基础1–4K`。为避免同一来源出现同名，Krill 的 Grok 账号保留 `Grok-QQ` / `Grok-Gmail` / `Grok-Jame`，CodeGoAI 使用 `Claude混池` / `GPT混池`。本次仅更新 `channels.name`，六类标签及其余字段均未变；PostgreSQL 15.17 中完成事务回滚演练、正式提交、其余字段逐项比较及 38 个名称唯一性核验。名称前后快照、映射和仅恢复名称的 SQL 位于香港 `/root/channel-recovery/short-names-20261022T143100Z/`；如需回退最初标签整理，须先核对这次名称变更，不能直接执行最初恢复脚本。

### 分组改名（2026-10-17 实机核查）

- new-api 的 `claude-max` 先改为 `kiro-正价-power`，后按用户最终要求改为 **`claude混池`**。10 个渠道、86 条模型路由、90 个未删除 API key 及 25 个已删除 key 的归属记录已同步迁移；6 个包含旧分组标识的 key 显示名称同步替换，其余自定义名称保留。
- `GroupRatio`、`UserUsableGroups`、`AutoGroups` 已同步改名，倍率仍为 **0.8**。API key 值、额度、到期时间、模型/IP 限制、渠道状态和上游凭据保持原值；历史消费日志保留旧名以便追溯。
- 操作前备份与目标快照在香港 `/root/group-recovery/rename-claude-max-20261017T102829Z/`，事务先回滚演练后提交；刷新缓存并重启应用后，容器 `healthy`。主站和国内 API 入口 `/api/status` 均为 200，`/api/pricing` 已无旧分组并显示新分组及 0.8 倍率；现存管理员 key 的只读 `/v1/models` 验证 200，无凭据请求 401，没有发起付费模型请求。
- 最终更名的备份与快照在香港 `/root/group-recovery/rename-kiro-正价-power-20261017T110644Z/`。备份期间分组说明发生独立更新，补迁移时保留该最新说明，仅替换分组键名；记录见 `usable-groups-before-finalize.json`。最终 `/api/pricing` 新分组可选且保留 0.8 倍率，现有管理员 key 的 `/v1/models` 返回 200，无凭据请求仍为 401。
- 本次参考 OWASP Authentication、Session Management、Authorization Cheat Sheets，核对凭据不暴露、权限等价和鉴权仍有效；这是生产配置迁移核查，不代表全站 ASVS 合规审计。

### 服务器 AI CLI（2026-11-01）

- 安装范围为香港服务器的 **root 用户**，`ssh aiproxy-hk` 登录后可直接运行 `codex` 或 `claude`，无需安装 Node.js/npm，也无需浏览器登录。
- Codex CLI **0.166.0** 使用官方发布的 Linux x86_64 musl 完整包，安装在 `/opt/codex/0.166.0/`，命令链接为 `/usr/local/bin/codex`。下载后已核对 GitHub release asset 的 SHA-256。配置在 `/root/.codex/config.toml`，独立 API key 在 `/root/.codex/auth.json`；默认模型 `gpt-6.1-sol`，自定义 provider `aiproxy`，Responses 端点基址为当前可用的 `https://api-slb.kbsfdxc.net/v1`。凭据使用文件存储；更新时下载并校验新的官方完整包，再切换命令链接，保留配置与凭据。交互界面另用 `/root/.codex/packages/app-server-daemon/current/bin/codex` 后台服务，单独更新 CLI 不会自动替换其已安装的旧包；本次用 `codex app-server daemon update --from-cli --yes` 同步并固定为 **0.166.0**。以后升级应同时核对 `codex app-server daemon version` 的 CLI、managed 和 running 版本；再次使用 `--from-cli` 可同步当前 CLI，运行不带 `--from-cli` 的 daemon update 会恢复官方生产版本自动更新策略。
- Claude Code **2.1.308** 使用官方原生 Linux x64 二进制，已核对官方分发 manifest 的 SHA-256；安装在 `/root/.local/share/claude/versions/2.1.308`，经 `/root/.local/bin/claude` 链接到 `/usr/local/bin/claude`。官方安装脚本入口当时返回 403，因此直接使用官方分发文件；未安装第三方 npm 包。配置在 `/root/.claude/settings.json`，其中 `env.ANTHROPIC_BASE_URL=https://92ai.asia`，`env.ANTHROPIC_AUTH_TOKEN` 保存其独立 API key；默认模型 `claude-sonnet-5-5`。可使用 `claude update` 更新，但本次未执行更新操作。
- 两个配置目录权限均为 `700`，上述配置与凭据文件权限均为 `600`。不在 shell 启动文件中导出 key，也不向仓库复制实际凭据。
- 实测两个 key 的 `/v1/models` 均返回 200；`codex exec`（严格配置检查、只读沙箱、临时会话）及 `claude -p`（禁用工具、不保存会话）均通过各自默认模型返回 `OK`，进程退出码为 0。这两条验证包含真实模型调用；未执行模型生成的命令或修改业务文件。
- **2026-11-01 北京时间 19:06**：按用户提供的 Codex API key 重写香港 root 的 `/root/.codex/auth.json`（文件 600），保留 `/root/.codex/config.toml` 的 `api-slb.kbsfdxc.net` Responses 配置；`/v1/models` 返回 200，`codex exec --sandbox read-only --ephemeral` 使用 `gpt-6.1-sol` 返回 `OK`。同一 key 访问 `https://92ai.asia/v1` 会返回 401，因此不能把端点改回 `92ai.asia/v1`。修改前配置和凭据备份在 `/root/codex-recovery/codex-config-20261101T110617Z/`，未把 key 写入仓库。
- **2026-11-01 北京时间 19:32**：继续处理用户交互界面401反馈。前一会话已将 CLI 升到0.166.0，但本次接手时 daemon 仍是0.163.0；接手后的首次交互调用已成功，因此不能断言版本差异是原401的唯一原因。本次通过官方 daemon 管理命令同步、固定并重启后台，CLI、managed 与 running 均为0.166.0，运行后台与 CLI 二进制摘要一致；端点和 auth/config 文件与操作前逐字节一致。普通 `codex`（仅关闭终端交替屏幕）在 root 登录目录连续两轮返回 `CODEX_INTERACTIVE_ONE`、`CODEX_INTERACTIVE_TWO`，无401，正常退出；`codex exec` 返回 `CODEX_EXEC_OK`、退出0，带凭据模型列表200。验证包含真实模型调用，未让模型执行命令；旧界面退出后重新运行 `codex`。恢复目录 `/root/codex-recovery/codex-daemon-fix-20261101T112934Z/`（700，文件600）保存操作前配置/凭据、daemon包选择元数据、更新记录及交互验证和 `verification.json`；历史0.163.0与0.166.0安装包保留。配置目录仍700、凭据及配置600；未更改主站服务、数据库或Claude配置。

## 6. 文档维护

新会话先读根目录 `AGENTS.md` 和本文件，按任务只检查相关机器。架构、备份策略、域名、端口、配置路径或发布流程变更后更新两处记录，并写明核查日期。不要把建议、排查猜测和未执行的恢复演练记成事实。

## 订阅布局与充值邀请返利上线（2026-11-07）

- 已提交、合并并 push main，最终应用 revision `f309aa428b7eefbf2a7ecf502d5cf5664f7f3b83`，Actions `42257527328` 构建和部署 success；北京时间 **01:07** 核验 healthy，香港本机/主站/国内入口状态与定价均200，前端初始资源完整读取通过。订阅卡片压缩间距、桌面四列，倒计时移至顶部红色提示条并显示中文“天”；GPT订阅及侧栏钱包共享最高优惠，呼吸动效遵循减少动画偏好。
- 已按用户要求启用 `ReferralRewardPercent=5`。后台入口「系统设置 → 计费与支付 → 额度设置 → 充值邀请返利（%）」；用户入口「钱包 → 推荐计划」。人民币钱包充值按实付金额5%奖励邀请人待转额度，100元对应5刀，可转入余额；订阅购买和兑换码不参与，不追补已完成的历史订单。充值与返利/私有订单收据同事务，重复通知及补单不重复奖励；原注册固定奖励配置不变。
- 114项相关前端测试、追加19项侧栏回归、类型/lint/格式/构建（首屏609.6KiB gzip），真实 SQLite3.50.4/MySQL8.4.11/PostgreSQL15.17 的返利/旧表迁移及重复迁移、相关race、Go构建/vet通过。原44渠道、2402令牌、1570既有用户配置/权限、套餐/模型/abilities及其他容器保持一致；仅新增返利选项及top_ups三列私有收据。未代发真实付款或转账。
- 恢复目录 `/root/upgrade-recovery/new-api-wallet-referral-20261107/`：141600718字节全库归档，SHA-256及归档目录/完整内容读取通过，包含配置快照、核验和带revision保护的 `rollback.sh`。回滚仅将返利比例恢复0并切回旧应用，保留现有余额、订单和返利收据，不整库恢复；配置正逆事务演练及Compose检查通过，未实际回切。

验证命令（本机隔离测试库，非生产库）：

```sh
TEST_MYSQL_DSN='root@unix(/tmp/studio-unify-mysql/mysql.sock)/wallet_referral_test?charset=utf8mb4&parseTime=True&loc=Local' TEST_POSTGRES_DSN='host=127.0.0.1 user=zhuguoliang dbname=wallet_referral_test port=5432 sslmode=disable' go test ./model -run 'TestTopUpReferral|TestReferralRewardPercent|TestHupijiao' -count=1 -v
go test -race ./model -run 'TestTopUpReferral|TestReferralRewardPercent|TestHupijiao' -count=1
go test ./controller -run 'Test.*(TopUp|Topup|Hupijiao|PaymentCompliance|QuotaSettings|Epay)' -count=1
go build ./...
go vet ./...
```

三库矩阵覆盖新库、保留历史成功订单和订单号唯一约束的旧表升级、两次迁移、并发/重复回调、按折后实付金额计算、停用/未确认/本人/封禁/额度上限与失败回滚、订阅排除。后端构建/vet在仅含已跟踪发布代码及本次修改的隔离副本执行，原机器人未提交修改未进入发布。前端使用 `bunx --no-install tsgo -b`（现有 `bun check -b` 脚本不可用）、改动文件oxlint/oxfmt及 `bun run build`；1440/390/320宽度与中英文、深浅主题浏览器核验通过，未代替真实旧手机内核验收。本机证据与正式页面截图在 `~/.codex/operations/wallet-referral-20261107/`，服务器详细结果为恢复目录 `local-validation.json`、`verification.json` 和 `actions.json`。

## 订阅返利与方案卡片重排上线（2026-11-07）

- 历史复核：`c86151e8d` 于2026-05-12加入虎皮椒充值与订阅付费返利及设置入口；`e4344907b` 于2026-10-01合并rc.41时明确删除相关后端逻辑、测试和前端入口。当前库仍有旧参数 `HupijiaoInviteRewardRatio=0.03`，新代码不使用它；保持旧记录，不叠加或改写为新比例。
- 按用户追加要求，人民币实付购买订阅也纳入既有 `ReferralRewardPercent=5`；虎皮椒及易支付订阅结算复用同一返利事务与TopUp私有收据，重复/并发通知只奖励一次，不增加购买者钱包余额。钱包余额兑换订阅及兑换码不重复返利，不追补历史成功订单；推广奖励仍先到 `aff_quota`，用户手动转入钱包后使用，最低0.01刀。原“待确认”已改为“待转入余额”，后台设置改称“付费邀请返利（%）”。
- 方案卡移除外层套框和大圆角，价格/额度并排，优惠一行可展开详情，顶部中文倒计时保留；无订阅占位缩小。本机样例中文卡片约357px高，1440/390/320宽度、中英文及深浅主题检查通过。115项相关前端测试、类型/lint/格式与610.0KiB首屏构建通过；SQLite3.50.4/MySQL8.4.11/PostgreSQL15.17真实三库的充值/订阅并发结算、既有订单镜像、失败回滚及余额兑换排除、race、Go构建/vet和相关controller测试通过。未代发真实付款或转账，无新增数据库结构。
- 发布应用 revision `2be5d4e873c31d3f2e4513b79161502f5216798b`，Actions `42335535622` 构建及部署success；北京时间 **11:53** 核验healthy，三入口状态/定价及初始资源完整读取通过。配置options（含5%）、套餐、模型、abilities及既有渠道/令牌/用户权限与发布前一致，其他容器及Compose/.env/Nginx一致。
- 恢复目录 `/root/upgrade-recovery/new-api-subscription-referral-20261107/`：142348044字节全库归档、SHA-256及目录/完整内容读取通过；含快照、验证与带revision保护的 `rollback.sh`，回退旧应用 `f309aa428`、保留5%配置、现有余额/订单/返利收据，不整库恢复。回滚镜像 `ghcr.io/zhuguoliang1014/new-api:rollback-subscription-referral-20261107` 保留，Compose检查通过，未实际回切。

本机证据与线上截图：`~/.codex/operations/subscription-referral-20261107/`。真实三库命令（隔离测试库）：

```sh
TEST_MYSQL_DSN='root@unix(/tmp/studio-unify-mysql/mysql.sock)/wallet_referral_v2_test?charset=utf8mb4&parseTime=True&loc=Local' TEST_POSTGRES_DSN='host=127.0.0.1 user=zhuguoliang dbname=wallet_referral_v2_test port=5432 sslmode=disable' go test ./model -run 'TestTopUpReferral|TestReferralRewardPercent|TestHupijiao' -count=1 -v
go test -race ./model -run 'TestTopUpReferral|TestReferralRewardPercent|TestHupijiao' -count=1
go test ./controller -run 'Test.*(Subscription|TopUp|Topup|Hupijiao|Epay|PaymentCompliance)' -count=1
go build ./...
go vet ./...
```

构建和vet在已跟踪发布代码的隔离副本运行，机器人既有未提交修改不在发布内。前端类型检查为 `bunx --no-install tsgo -b`，测试为 `bun run test src/features/my-wallet src/features/wallet src/hooks/__tests__/sidebar-config.test.tsx src/features/system-settings/general/__tests__/pre-consume-settings.test.tsx`。服务端恢复目录保存 `new-api-subscription-v2-validation.json`、三库/race/controller测试日志、`verification.json`、`actions.json`；本次无配置写入，无需回滚返利比例。桌面浏览器响应式核验不替代真实旧手机内核验收。

## 财务管理与微信社群上线（2026-11-07）

- 用户确认后已提交并 push `main`，功能 revision `61497c9968004d4d57285502e03edbebe3f0688d`，携带已有 SVG 提交 `a58df6d86`。Actions `42382715931` 镜像构建和部署均 success；北京时间22:51—22:53核验应用 `v1.0.0-rc.48+61497c996800`、容器 healthy，主站/国内入口状态与定价正常，真实登录会话中的财务入口、十月月报和微信社群信息可见。
- `/finance` 提供实际收付款月报、自动收入、微信补记、支出/退款、凭证、分类管理、费率/对账、月结及CSV导出。权限为 `finance:read/write/export/manage`，默认仅超管、管理员按需授权。付款人固定「西强、国良」；自定义分类可新增、重命名和停用。自动收入只读取成功外部订单，充值/订阅镜像按订单去重，余额购订阅及零金额虚拟订单排除；不修改原订单或用户余额。
- 历史源按用户确认：2026年4—10月净到账取「工作表1」，不再扣手续费；支出取「朱西强」及主表gl，gl归入2026-10，姓名分别映射西强/国良。已正式导入339条（7条月收入、332条支出），每月及合计核对通过，本地重复导入339条均识别为重复。历史累计退款680元保留待分月说明，未擅自抵扣。46笔当期自动收款与直接SQL逐项核对，缺失/重复/金额/月归属/单笔手续费差异均0；后续新增订单正常增量归集。
- 213项相关前端测试通过（财务最终8项）、native tsgo、改动lint/格式、619.6KiB首屏构建；SQLite3.50.4、MySQL8.4.11、PostgreSQL15.17真实三库新表/已有支付表升级、重复迁移、来源唯一、退款并发上限、分类停用和双付款人校验通过，相关race、路由/权限、Go vet/root build及SVG回归通过。浏览器本地实际接口录入及320/390宽度、中英文浅深主题通过，不代替旧手机内核验收。复用Dialog、ConfirmDialog、StaticDataTable及已有表单组件。
- 恢复目录 `/root/upgrade-recovery/new-api-finance-20261107/`：全库143330929字节，SHA-256 `6f450f2ad1d1c94a10c0a497a0e2358834bdcc9a4d1f088c1ea4bfc46463cd94`，归档目录与完整读取校验通过；另含财务导入前局部归档、源输入/逐月核验、配置前后快照、Actions及线上核验。`rollback.sh` 带revision及Compose/.env保护，只切旧应用镜像 `ghcr.io/zhuguoliang1014/new-api:rollback-finance-20261107`，保留财务账本及后续业务数据，不整库恢复；Compose检查通过，未实际回切。原options/套餐/渠道/模型/既有令牌与用户设置一致，另6个容器ID和启动时间不变。
- 官方社群已增加微信号及备注提示，复制使用共享组件。此次未发布TG公告。原机器人和运维未提交草稿保留。验证日志、私有历史CSV、转换脚本和实机截图在本机 `~/.codex/operations/finance-20261107/`，不入Git。

验证命令：`TEST_MYSQL_DSN=<本机隔离库> TEST_POSTGRES_DSN=<本机隔离库> go test -race ./model -run '^TestFinance' -count=1 -v`；`go test ./controller -run '^TestFinance' -count=1 -v`；`go test ./router ./service/authz -count=1`；前端 `bun run test src/features/finance src/components/layout/__tests__/official-community.test.tsx src/hooks/__tests__/sidebar-config.test.tsx src/features/image-playground`，`bunx --no-install tsgo -b`、改动oxlint/oxfmt、`bun run build`。

## 赠送余额上线与妖火历史迁移（2026-11-10）

- 用户授权提交上线，功能revision `92b397327cd64a31b6f76054c6b53bf35f2b4882` 已push main；北京时间02:33:51恢复访问，容器healthy、三入口状态/定价200。账户余额永久，赠送余额按原发放时间30天到期、优先扣除、原路退款、过期记录可查；前台只分两类，不细分赠送来源。
- 固定原核对的近10天名单118人迁移，原赠590美元，剩余529.987648美元；总可用额度及付款记录不变。两帖赠送脚本同步更新，自动化5原本PAUSED，保持暂停，未代发论坛消息或公告。
- Actions42673435445两次均未启动构建，部署skipped。改用隔离提交的Linux构建包和原运行时构建镜像，程序SHA-256 `55510c0c1a3a757997d326b5f2e750d52d92eedf435fe0c8aa6b371f49ba1015`；GHCR推送unauthenticated，远程未更新。Compose仅new-api固定本地 `ghcr.io/zhuguoliang1014/new-api:gift-quota-92b397327cd6` 并pull_policy never，后续不能拉取旧latest。
- 恢复目录 `/root/upgrade-recovery/new-api-gift-quota-20261110/` 含两次已完整校验全库147972688/147983585字节、配置/迁移/逆向演练及最终核验。138 options/32套餐/44渠道/235 abilities/101模型/2452令牌及原158奖励收据不变，其他六容器不变。赠送账本使用后禁止直接切旧应用扣费，不整库恢复；见该目录recovery.md及 `docs/gift-quota/README.md`。生产网页登录会话失效，未代建凭据，本地实机与线上资源/接口验收范围已如实记录。
