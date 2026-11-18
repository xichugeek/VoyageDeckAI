# VoyageDeck AI 容器部署

镜像内的 FastAPI 在 `8080` 同源提供 React 指挥台、静态资源和 API。Compose 启动单个非 root 进程，应用目录只读，SQLite 使用项目专属数据卷，临时目录使用内存文件系统。运行上限为 1 CPU、256 MiB、64 个进程或线程，日志最多保留三个 5 MiB 文件。

## Windows 本地验收

用 Docker Desktop 的 Linux 容器，先确认本地 `18288` 可用，然后从仓库根目录运行。任务之间可用 `-p` 选择各自的项目名。

```powershell
docker --context desktop-linux compose --env-file .env.example -p voyagedeck-local -f deploy/docker-compose.yml config --quiet
docker --context desktop-linux compose --env-file .env.example -p voyagedeck-local -f deploy/docker-compose.yml up -d --build --wait app
Invoke-RestMethod 'http://127.0.0.1:18288/api/health'
Invoke-RestMethod 'http://127.0.0.1:18288/api/admin/session'
docker --context desktop-linux compose -p voyagedeck-local -f deploy/docker-compose.yml ps
```

访问 `http://127.0.0.1:18288/`，管理状态应为 `enabled: false`。本地 API 文档在 `/api/docs`，端口通过 `VOYAGEDECK_HTTP_PORT` 调整。若要验收管理流程，可在 PowerShell 环境载入自己生成的 `VOYAGEDECK_ADMIN_PASSWORD_HASH`，并仅在本地 HTTP 设置 `VOYAGEDECK_INSECURE_COOKIE=1`。配置参考 [.env.example](../.env.example)。

```powershell
docker --context desktop-linux compose -p voyagedeck-local -f deploy/docker-compose.yml down
```

这条命令仅关闭该 Compose 项目并保留 SQLite 数据卷。

## 公网访客部署

生产覆盖文件要求支持 `!reset` 的 Docker Compose v2.24.4 或更新版本。它把应用接入已有的 `xg_edge` 网络，用网络别名 `xg-voyagedeck` 供网关解析，移除主机端口映射，并关闭文档与管理员认证。公开浏览器直接运行模拟工作流，SQLite 只保存该应用的服务端状态。

执行前核对实际仓库提交、网关单站点配置的接入方式、现有 `xg_edge` 网络和别名、计划域名的 DNS、主机 CPU 和内存余量、当前服务健康、HTTPS 证书签发方式以及回滚窗口。每次发布记录版本标签和构建后的镜像 ID。先验收容器，再按现有网关流程接入域名。Compose 本身管理该应用容器和专属数据卷。

```bash
docker compose -p xg-voyagedeck -f deploy/docker-compose.yml -f deploy/docker-compose.edge.yml config --quiet
docker compose -p xg-voyagedeck -f deploy/docker-compose.yml -f deploy/docker-compose.edge.yml up -d --build --wait app
docker compose -p xg-voyagedeck -f deploy/docker-compose.yml -f deploy/docker-compose.edge.yml ps
```

根据已有网关的配置结构加入仅匹配 `voyagedeck.demo.xichugeek.com` 的站点。若网关是连接到 `xg_edge` 的 Caddy，该站点的上游应为 `xg-voyagedeck:8080`。配置校验后按该网关的现有热加载流程应用变更。通过公网 HTTPS 验收 `/`、`/api/health`、`/api/admin/session`、HTML 引用的构建资源和一次访客演示。确认 `/api/admin/session` 为 `enabled: false`，且 `/api/workflows` 返回 `401`。

## 回滚

首次发布出现异常时，仅移除该域名的新增网关规则，按原方式校验并热加载网关，再关闭 `xg-voyagedeck` 项目。保留该项目的数据卷和审计记录。

```bash
docker compose -p xg-voyagedeck -f deploy/docker-compose.yml -f deploy/docker-compose.edge.yml down
```

已有版本时，将 `VOYAGEDECK_IMAGE_TAG` 切回事先保留并验证过的镜像标签，使用同一 Compose 项目的 `up -d --no-build --wait app`。如果版本改变数据库结构，按发布前留存的 SQLite 一致性备份恢复。经 `ps`、健康检查、HTTPS 和其他站点冒烟验证确认服务恢复。
