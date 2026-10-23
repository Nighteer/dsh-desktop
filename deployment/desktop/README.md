# LETS 企业桌面端正式打包

通用安装包默认不预置服务地址。安装后由用户填写服务端地址，继续保留更换企业服务和身份确认流程。

## 命令

在仓库根目录使用固定的 Yarn 4.18.0。先验证 Beta，再验证正式版；新输出位于 `.artifacts/enterprise-<edition>-随机目录`，保留历史文件。

```text
corepack yarn enterprise:release:candidate --beta
corepack yarn enterprise:release:candidate
corepack yarn enterprise:release:desktop --check-only
corepack yarn enterprise:release:desktop
```

以上命令根据当前构建主机生成原生平台、原生架构的安装包：Windows NSIS EXE，Mac DMG。候选包明确使用 `-beta.0` 版本号、无签名、`readyForProduction=false`；不应通过正式通道发布。正式命令要求签名，不能悄悄退化为未签名包。`--check-only` 只检查当前平台、参数及发布凭据，不执行构建，不代表通过完整发布验收。

如需明确允许一个纯内网 HTTP 入口，但仍由用户填写地址：

```text
corepack yarn enterprise:release:candidate --allow-http-origin http://10.10.0.5
```

可重复该选项添加多个精确源地址。也可不预置列表，由 IT 在实际启动环境配置 `DSH_ENTERPRISE_HTTP_ORIGINS`。保持 HTTPS 为默认。发布入口不读取 `DSH_ENTERPRISE_SERVER_URL`，并拒绝包含预置服务地址的源配置；服务地址始终由用户在运行后填写。

## Windows

需要 Windows x64/arm64 构建主机及匹配架构的依赖、Office 资源。正式签名配置 `WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD`（或 Electron Builder 的 `CSC_LINK` + `CSC_KEY_PASSWORD`）；也支持证书存储中的 `WIN_CERTIFICATE_SHA1`。可选 `WIN_PUBLISHER_NAME` 与证书中的发布者保持一致。正式产物会验证安装程序和应用 EXE 的 Authenticode 签名。

未配置证书时只构建待验收候选包，不安装或自动启动程序。签名凭据仅传给打包进程，不传给普通构建、类型检查和测试，不写入安装包配置或交付清单。

正式发行设置 `LETS_COMPANY_NAME` 为公司确认的发行者名称，核对 EXE 公司字段、签名证书主体和安装器发布者。通用构建默认维护者品牌为 LETS，保留第三方许可及署名。当前两版运行内核均固定为 Electron 44.0.0；旧 43.3.0 依赖目录保留不动，发布入口会查找匹配源码声明的已验证运行时，新构建机应按锁文件安装。

## macOS

需要真实 Mac、Xcode Command Line Tools、Apple Developer 账号、Developer ID Application 签名和公证凭据。沿用包内 `release-preflight.ts` 的证书/Apple ID/API key/keychain profile 检查。正式打包后验证 codesign、spctl 和 stapler。

首版按构建机原生架构产出单架构 DMG：Apple Silicon 在 arm64 Mac 构建，Intel 在 x64 Mac 构建。分别准备匹配架构的 Office 资源，分别发布 mac arm64 / mac x64 记录；当前脚本不宣称已支持 Universal DMG，也不在 Windows 上伪造 Mac 包。

## 构建与验收

构建入口执行增量构建、品牌资源生成、类型检查、单元测试、平台原生依赖准备与现有打包验证 Hook。不执行现有 clean 脚本，也不覆盖既有发布目录。mac 原生依赖准备和打包工具自身会管理其临时构建文件，不操作用户工作区数据。

输出包括安装程序、SHA-256 和 `release-manifest.json`。版本、企业模式、图标、快捷方式、签名发布者必须以实际产物为准；待验收包和未提交源码不等同于可正式发布。

如完整单元检查尚未通过，只能显式使用 `--candidate --acceptance-only` 构建隔离测试包；该路径仍执行类型检查、企业连接/更新/安装器专项测试及打包验证 Hook，并记录 `validationScope=targeted-enterprise-installer-tests`。它禁止用于正式发布，不代表完整测试通过。无论是否签名，产物清单的 `readyForProduction` 均保持 false，直到团队另行完成完整 gate、干净电脑安装升级及业务验收。

本机曾出现依赖文件损坏。可用 `node scripts/rehydrate-release-dependency.mjs <包名> <Yarn缓存zip路径>`，按根锁文件 SHA-512 校验并提取到全新目录；它不会删除或覆盖原依赖。仅候选构建可通过 `DSH_RELEASE_DEPENDENCY_OVERLAYS` 指向生成的 overlays.json，正式构建必须使用经过检查的完整依赖目录。候选包使用 ZIP 载荷加快验收构建，正式 NSIS 包保留原压缩配置。

需要另外在干净 Windows/Mac 上完成：首次安装、用户填写地址、HTTP 显式允许、HTTPS 信任、企业登录、角色权限、模型与知识库、Office/PPT、插件、退出任务保护，以及真实旧版到新版的升级和用户数据保留。构建通过不能替代这些验收。

首发前确认试用机的现有版本号：原项目 2.0.x 到新产品 1.0.x 不会被版本比较识别为升级。此类试用机需单独验收手工切换、安装器行为和数据保留，或决定使用更高的首发版本号；不要承诺后台发布 1.0.0 后会自动覆盖 2.0.x。

正式发版还需执行仓库规定的完整 headless gate。现有 `yarn check` 会调用 clean 等脚本，须在独立构建工作区中运行，不能在保留历史产物的当前工作区未经确认执行清理。
