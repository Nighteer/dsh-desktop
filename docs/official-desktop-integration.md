# 官方桌面能力集成清单

核对基线：Harness `0.2.1-rc.2`，提交 `687f282e8625c6b8d11ff58211a90524be2e4317`。
LETS 维护独立 Electron 适配层，不修改 `deepseek-harness/` 源码。

## 已补齐

- 官方 Office：七项技能、依赖查询、独立 Python/Node、LibreOffice Kit，见 `official-office.md`。
- 文件路径：保留旧接口，同时为可信主页面提供官方 `__DSH_HOST_PATHS__.pathFor`。
- 快捷键：复用官方协议和持久化协调器；配置保存于当前 Electron userData 的 `keybindings.json`，不修改系统快捷键。
- 内嵌浏览器：复用官方 Sidebar 浏览器桥。每个工作区使用独立内存分区，不共享企业登录、Harness Cookie 或其他工作区的状态。
- 浏览器安全：只接受主进程发放的租约，禁用 Node、预加载脚本、嵌套 webview、下载、设备访问；阻止访问本地 Harness 宿主及 file 等特权协议。
- 退出/重启保护：真实 Host 查询执行中、等待审批、排队、后台与已挂起提醒；无任务时不弹框，有任务时默认取消。确认后锁定新 API 请求，等待已接纳请求结束并复查；取消或锁失败会解锁。
- 隔离 Host 与进程内 Host 采用同一任务检查口径。系统结束会话、安全锁定和明确的恢复操作不被普通确认阻塞。

浏览器和快捷键仅向主进程指定来源的主 frame 暴露；任意网页、子 frame 和辅助窗口不能调用。
这不是 AI 浏览器自动操作或远程控制，原有远程控制仍停用。

## 暂不调整

- 用户要求暂不处理更新渠道，检查与下载安装包的既有地址保持原样；仅在现有 Windows 安装交接前加入任务保护。正式发布给员工前必须单独配置 LETS 自有渠道。
- 不接入官方账号、充值或产品遥测，不引入外部搜索凭据。
- SSH、LSP、电脑控制和其他实验插件不是必装项，需另行评估与授权。

## 升级与验收要求

每次升级依次核对包版本、默认装配、Host 注册、预加载桥、打包资源，不能以“依赖已安装”代替可用性验证。
先验证 Beta，再同步稳定版，保持版本身份差异。

定向测试覆盖来源校验、文件路径、浏览器租约/隔离、快捷键配置读取、任务竞态与取消、子进程控制、窗口安全配置。

隐藏原生验收：`node scripts/verify-desktop-native-capabilities.mjs --edition=dsh-plugin-desktop-beta`，稳定版替换 edition。
它只访问本机测试服务器，创建全新的 `.enterprise-local/native-capabilities-acceptance-*`，不显示窗口、不使用账号、不清理文件。

真实无图形 Host 验收：`node scripts/verify-harness-upgrade.mjs dsh-plugin-desktop-beta --office --market --tasks --keep`。
验证 Office/市场可加载、API 正常返回、锁定返回 503、解锁后恢复 200。
`--keep` 保留全新验收目录，不删除产物。不调用模型、不改变现有账号或工作区。

人工回归：重启桌面后测试拖入文件/文件夹、快捷键修改与重启保留、右侧网页浏览；任务运行时从托盘退出并取消，再发送一条消息；空闲时退出应直接结束。
