# LETS 官方 Office 工作流

## 当前实现

LETS 复用固定内核 `0.2.1-rc.2` 的 `@deepseek-ai/dsh-skill-office` 和 `@deepseek-ai/dsh-tool-workspace-dependencies`，未修改 Harness 子模块，也没有恢复已回退的自建 Office 工具。

七个官方技能为 `office`、`office-docx`、`office-xlsx`、`office-pptx`、`office-render`、`office-recalculate`、`office-export-pdf`。依赖查询工具返回随应用准备的独立 Python、Node 和库目录；模型应使用这些绝对路径，不需要员工先安装 Python，不应为默认 Office 工作流临时执行 pip/npm 安装或探测系统解释器。用户明确指定项目环境时仍尊重其要求。

两种 Host 启动方式均接入。独立环境原地只读使用，不复制进账号目录、不更改 PATH 或 pip 配置；启动缺少环境时明确记录警告，损坏或错误架构的显式环境校验失败。正式打包前必须通过资源检查，避免把缺少环境的客户端发给员工。

原有 PPT 模式和 Univer 保留。PPT 模式继续使用已有工作流；Univer 用于其交互式编辑体验，不能代替官方 Python 环境。默认可下载 Office 文件优先加载官方技能。简单内容生成按官方要求做内容与结构检查，不强制转换、截图或分页；字体警告不等同于文件生成失败，不能为了清除警告反复改写文档。

## 准备运行环境

当前实机验收平台为 Windows x64。仓库根目录执行：

```powershell
corepack yarn office:prepare
```

该显式命令使用仓库固定 Yarn，复用只读上游准备脚本和锁定下载清单。新建的构建工具、下载缓存、临时文件及验收目录全部位于 `.enterprise-local/official-office-build-*`。下载保持 TLS 验证，并校验官方 SHA-256；必要时只使用当前进程已有代理，不修改系统代理设置。现有不完整下载保留，不自动删除未知文件。

验证通过后，为两版创建 `build/official-office/<payloadDigest>/` 快照和 `current.json`。不覆盖旧快照。再次执行会复用已准备的相同版本；输入发生变化时拒绝静默覆盖，需单独审阅升级。此次环境为 Python 3.12.14、Node 24.21.0，库版本以官方 `runtime.json` 为准。

打包使用 `extraResources` 把该目录复制到应用资源目录的 `official-office/`，不放进 ASAR。`beforePack` 校验核心版本、架构、解释器、技能及关键库。Mac/Linux 及跨架构包仍需在对应目标环境独立准备、签名和验收；当前结果不代表这些平台已通过。

## 验证命令

先增量构建所选桌面包，再在根目录运行：

```powershell
node scripts/verify-official-office.mjs dsh-plugin-desktop-beta
node scripts/verify-official-office.mjs dsh-plugin-desktop
node scripts/verify-harness-upgrade.mjs dsh-plugin-desktop-beta --market --office
node scripts/verify-harness-upgrade.mjs dsh-plugin-desktop --market --office
node scripts/verify-desktop-variants.mjs
```

前两项使用真实官方依赖查询工具，在新建的中文／空格验收目录生成并重开 DOCX、XLSX、PPTX，再使用官方 LibreOffice Kit 原生后端导出 PDF、刷新 Excel 公式缓存。验证不调用模型，不使用真实员工账号，不启动 Word、打印机或桌面 GUI。产物及 `verification.json` 保留在 `.enterprise-local/official-office-acceptance-*`。

完整 Host 检查还验证标准模式的技能／工具可见性。两版各 80 项定向测试及 Host、客户端、测试类型检查通过；Yarn 锁文件解析通过，锁文件模式跳过了 node_modules 链接，未重装正在使用的桌面依赖。没有执行整仓发布验收或生成安装包。

实际 PDF 导出成功，但引擎报告了 Courier 字体警告。此类警告应按实说明，不代表已完成像素级排版检查，也不保证与 Microsoft Office 分页完全相同。

## 员工试用

完全退出桌面端（包括托盘）后重新打开，建议使用新会话测试，避免旧会话中已加载的旧技能说明干扰。可发送：“把下面的内容生成一个可下载的 Word 文件，使用内置 Office 环境，不安装依赖。”

运行环境已经随本机开发产物准备好，员工机器正常使用不需要下载 Python 库；企业登录、模型调用及远程知识库仍遵守各自网络和授权要求。本次没有改账号、聊天、数据库、系统 Python、旧 Office 目录、已有 PPT 模板或 Univer 插件。
