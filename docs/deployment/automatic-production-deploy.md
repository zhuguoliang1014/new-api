# main 自动构建与部署

Push main 后，GitHub Actions 构建 linux/amd64 镜像，并将此次构建输出的不可变摘要直接传给部署作业。服务器先显式拉取该摘要，验证镜像完整Git提交号和架构，仅替换现有Compose中new-api的image字段，再重建这一项。不会依赖latest、短标签或服务器旧Compose镜像。现有pull_policy never保留。

自动检查与操作均在Actions内完成：

1. 工作流concurrency与服务器flock避免并行部署；成功部署的run_number防止重跑旧作业覆盖较新版本。
2. 保存原Compose、环境配置、应用镜像标签；完整pg_dump、SHA256和pg_restore目录／完整读取验证成功后才切换。
3. 检查新容器的镜像ID、完整revision、healthy，并通过容器发布端口访问本机/api/status与/api/pricing。状态返回版本必须包含本次commit前12位。
4. 启动失败、健康失败或HTTP失败时，仅恢复原Compose镜像并重建旧应用、确认旧应用健康，Actions仍标记失败。数据库、用户、余额、订单和套餐配置不回退。配置被另一运维操作改动时停止，避免覆盖别人的修改。
5. 成功后保存部署回执，Actions摘要展示commit和镜像摘要。以后无需Codex在push后再手动拉镜像、改Compose或重复检查。

入口 `.github/workflows/build-aiproxy-image.yml`；执行脚本 `scripts/deploy/deploy_new_api.py`；标准库单元测试 `python3 -m unittest discover -s scripts/deploy -p 'test_*.py' -v`。恢复目录 `/root/upgrade-recovery/newapi-auto-deploy/<GitHub run id>-<attempt>/`，成功发布状态 `/root/new-api/.new-api-deploy-state.json`。

现有SSH／GHCR配置不变。构建／部署失败通过GitHub Actions原有通知处理，不创建本机自动化或依赖本机开机。未提交本机草稿不会进入远端构建。带`[skip ci]`的提交仍按GitHub机制跳过Actions；需要发布代码时不要使用该标记。

验证：17项自动部署回归覆盖固定摘要+never、失败回滚、失败不切换、旧作业降级拦截、并发配置保护、只重建应用、HTTP版本与镜像验证。额外覆盖ssh-action逐行插入退出码检查的实际Shell入口回归；入口使用单行python3 -c，避免heredoc被插件插入语句破坏。actionlint与服务器实际Compose/HTTP只读预演通过。2026-11-11北京时间13:36首次全自动发布通过：修正SSH逐行检查兼容后的revision `a42ec4a82308edd3254fbb9c3eeb8c0a72bb857a`，Actions `42966171961`成功，自动运行镜像`sha256:b458b6ac9ad095d745f43ad1efc52b2359bc0470ddee200db8f81d63f6081aad`，healthy与HTTP版本／定价检查通过。全过程没有手动pull、改Compose或up；只有读取最终回执。自动备份150983913字节，SHA256 `94322527fa185d2a40eb8353125400ace86b2c5cf498381ccc21713486b97831`且完整读取校验通过，材料`/root/upgrade-recovery/newapi-auto-deploy/42966171961-1/`。首次6ae251154的Actions42965578889因ssh-action脚本注入破坏Python heredoc而在执行入口前失败，生产未切换；新增Shell传输回归并改为单行后通过。
