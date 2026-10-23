# LETS 桌面工程

稳定版、Beta、只读 Harness 子模块、桌面插件、官方 Office/PPT 和 EXE 打包由本工程维护。

## 常用命令

在此目录执行：

- 安装：`node .yarn/releases/yarn-4.18.0.cjs install --immutable`
- 企业桌面 Beta：`node .yarn/releases/yarn-4.18.0.cjs enterprise:desktop`
- 企业桌面稳定版：`node .yarn/releases/yarn-4.18.0.cjs enterprise:desktop:stable`
- 类型检查：`node .yarn/releases/yarn-4.18.0.cjs typecheck`
- 目录边界检查：`node .yarn/releases/yarn-4.18.0.cjs check:boundaries`
- Windows 候选安装包：`node .yarn/releases/yarn-4.18.0.cjs enterprise:release:candidate`

先用 Beta 验证，再同步稳定版。共享协议和 UI 使用 vendor/shared 内的固定版本包；不依赖 enterprise/shared 源码目录。

本机 local-development.json 只记录原开发目录，不含密码；企业桌面启动器沿用原 .runtime-appdata，首次迁移不新建账号目录、不搬聊天。不要同时启动新旧工程的同一账号实例。旧发布文档保留供参考；启动入口以本页为准。
