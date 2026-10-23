# Harness 0.2.1-rc.2 升级记录

## 范围

- 稳定版和 Beta 的运行时均切换到 `0.2.1-rc.2`，插件市场更新到 `dshmarket 1.66.44`。
- 上游源码固定在 `687f282e8625c6b8d11ff58211a90524be2e4317`；未修改子模块源码。源码指针检查点为 `c853a4f20a`。
- 343 个官方 npm 运行时包的完整性校验记录位于 `vendor/dsh-runtime/0.2.1-rc.2/manifest.json`。这是官方发布产物，不冒充本地源码构建。
- 移除本次自建的 Office 插件、运行时准备脚本、文档与工具入口，以及失效的 `lib/office.*` 和相关类型入口。保留原有 PPT、模板、旧下载包和备份。没有自动安装 Univer，也没有打包或推送。

## 数据与配置边界

- 未操作真实员工聊天、工作区、账号数据库或 Docker/Dify 数据。
- 原来的 `settings.yaml` 保留；通过桌面自有 ConfigEditor 投影已支持的显示偏好，不允许原生设置服务自动重命名或批量导入旧文档。
- 新设置使用 Profile 的原生配置表单，写入仅修改对应条目，不重组掉企业安全控制行。
- 原始 JSONL 会话记录保留；会话版本升级在新文件中发布。临时测试验证了旧记录不变。
- 原 `.agent-presets` 自定义模式目录保留。旧式模式声明若仍出现在配置中，需要单独迁移到新版声明结构；本次不自动覆盖。
- 企业模型仍经主进程的短期本机能力凭证调用；不读取个人环境变量/API Key，不向插件下发长期登录凭证。未配置输出上限时不自行填充请求上限；上下文容量未知仍需管理员补齐。
- 未开放外部产品遥测；桌面保持明确重启生命周期，不使用原生 HMR 重组业务 Host。

## 备份

源码回退前的快照位于：

`.enterprise-local/harness-upgrade-backups/pre-0.2.1-rc.2-oOoxvj`

备份覆盖 1,580 个文件并已做 SHA-256 校验。恢复应先核对后续改动，再按文件选择恢复；不要整仓覆盖或使用破坏性 Git 重置。旧运行时目录仍保留。

## 已验证的核心路径

- 两版 Host、浏览器客户端、原生登录页的无清理增量构建。
- Beta 核心与包产物验证 20 个测试文件、224 项通过；稳定版核心验证 19 个文件、175 项通过。两组范围不完全相同，不冒称两版全量测试通过。
- 社区市场全部 263 项测试、源文件及测试类型检查。
- 新版提供商默认输出上限的真实 HTTP 请求验证。
- 两版完整业务 Host 无图形启动；默认插件市场挂载；Beta 独立 Host 子进程的启动、鉴权和停止。
- Electron Node 模式的命令行与插件管理验收，不安装外部插件。
- 原生模式依赖解析、桌面变体一致性、运行时产物完整性。
- PPT 的真实服务调用、16 套模板读取、中文 12 页可编辑 PPTX 导出。PPT 独立测试显式绑定选定桌面版的框架，避免读取历史下载缓存中的旧 peer 副本。

这不等于整仓发布验收完成：全量测试仍有 Windows 文件符号链接权限、跨平台路径/显示断言、第三方市场旧验收假设等失败项，详见 `.enterprise-local/harness-upgrade-beta-tests-current.log`。未执行 Windows 安装包验收，未替代用户的 Electron 实机试用。

## 已知兼容限制

现有 `@agents-anywhere/dsh-bridge-next` 私有开发版只声明支持旧内核。新内核会拦截该可选远程控制桥；不会给予不兼容版本豁免。普通企业登录与工作区不依赖此桥。恢复远程控制需要另外评估兼容版及其配置/状态迁移，不能只改版本声明强行加载。

Univer 由用户自行安装与验证。核心版本条件满足不代表插件的下载、原生依赖、网络访问及全部功能已通过实机验收。

### Windows 企业账号长路径修复（2026-10-20）

插件安装曾退回 PATH 中的 `pnpm.cmd`；企业账号目录下该命令路径达 279 字符，Windows 在 pnpm 启动前即报“系统找不到指定的路径”。现在通过原生 CLI 的 `packageManager` 描述直接执行内置 Electron Node 模式与 pnpm JavaScript 入口，保留原生锁、兼容检查及事务机制。仅缩短新生成的 Windows 命令目录名，完整 SHA-256 与文件逐项校验不变；旧目录保留但不再复用。

新增验收覆盖中文／空格企业路径、245 字符 Node 命令路径、原生插件管理器离线安装本地测试包、生命周期子进程，以及没有系统 Node 的终端入口。测试包只安装在新建临时 Profile 中；未安装 Univer、未改动真实账号。两版增量构建后，需要完全退出桌面（含托盘）再打开，才能让 Host 启用新的命令目录。

## 本机服务

- 管理后台：`http://127.0.0.1:5180/`
- 接口健康检查：`http://127.0.0.1:4310/api/v1/health`
- 数据库：现有本机 PostgreSQL `127.0.0.1:55432`，本次没有迁移或清理。
- 本次后台启动日志：`.enterprise-local/server-start-20261020-202609.*.log`、`.enterprise-local/admin-start-20261020-202609.*.log`。

桌面试用入口仍是仓库根目录的 `corepack yarn enterprise:desktop`；需要可用的 Node 24/Corepack。命令会执行开发构建并打开 Electron。登录、账号切换及安装插件请在企业入口验证，不使用未登录的开发入口代替。

## 无界面复核

```powershell
node scripts/sync-vendored-runtime.mjs --check --channel beta
node scripts/sync-vendored-runtime.mjs --check --channel stable
node scripts/verify-desktop-variants.mjs
node scripts/verify-harness-upgrade.mjs dsh-plugin-desktop-beta --market
node scripts/verify-harness-upgrade.mjs dsh-plugin-desktop --market
```

上述完整 Host 验证使用新建临时目录，不打开 Electron，不使用真实员工账号，也不安装插件。

## 桌面交互兼容修复（2026-10-21）

- 通知只跟踪直接用户发起的回复结束／失败，不再订阅后台命令完成事件；取消、子代理及插件续跑不弹完成通知。经后续试用反馈，改为前后台均发送完成提醒，仅后台附加任务栏闪烁／Dock 标记，不抢焦点。中文文案明确区分“回复结束”和“交付文件可用”，不替模型认证任务成功。
- 系统通知显式使用现有蓝色品牌图标。Windows 启动时只注册当前桌面版本自己的 AppUserModelId 的 DisplayName（LETS）和 IconUri，不修改共享 Electron 身份项、不改变账号数据目录。真实 Windows 通知呈现仍需完全退出桌面（含托盘）再启动后试用。
- 企业桌面的左下角使用直接设置入口，移除上游“意见反馈／登录”菜单；原企业账号显示、切换企业和退出登录保留。
- 停用不兼容的远程控制加载、菜单、设置和首次启动引导入口。旧启用接口完成同源校验后返回 410，不写入启用偏好、不自动重启。已有配置、文件和依赖包均保留。
- 知识来源不再包装原生回答渲染器；改为组合公开 ChatFileMentions 服务及追加 turnTail 插槽，避免新版子插槽权限导致扩展退出。正文引用点击打开对应账号、会话和回答的来源侧栏，保留原生文件链接；来源数据仍由本机鉴权接口读取，不接受模型提供的 URL 作为来源地址。

两版 Host、客户端、原生页面及测试的五组类型检查通过；两版各 220 项定向测试通过（其中通知运行时仅筛选了相关用例），237 个共享源码文件对齐。无清理增量构建和带市场的完整 Host 启动通过，均未使用真实账号、未启动 Electron。扩展测试仍有既有的 Windows 符号链接权限、跨平台路径及旧首次启动默认值断言失败，不代表整仓全量发布验收通过。

### 通知和任务栏的后续复核

- 真实 SessionStore 集成测试确认新版会话结束事件能到达通知插件。新增前台／后台运行时测试，并记录原生通知不可用或 failed 事件；不自动更改 Windows 的通知开关或勿扰设置。
- Windows AppUserModelId 和显示元数据提前到企业认证之前注册，所有窗口只安装一次品牌处理。补齐任务栏要求成对提供的 RelaunchCommand／RelaunchDisplayName，与 ICO 一起设置；开发入口采用原生 argv 引号规则，不经 cmd.exe，并在任务栏重新启动时恢复企业模式和原有显式隔离目录，不携带密码或登录令牌。
- 使用独立临时 Electron 数据目录实际发送了“LETS · 测试通知”，原生 show 事件返回成功。未接入真实账号、未调用模型、未关闭正在运行的桌面。系统接受不等于已肉眼确认横幅；横幅仍受 Windows 设置影响。
- 独立原生验证脚本为 `scripts/verify-windows-native-notification.mjs`，必须用 Electron 显式传入 `--show` 才会发通知；临时产物留在 `.artifacts/native-notification-check-*`，没有清理任何既有缓存、固定快捷方式或文件。
