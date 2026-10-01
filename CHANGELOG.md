# Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## 0.1.1

- **包名改为 `@wyxcn445/dsh-balance`**：原无作用域名 `dsh-balance` 已被 npm 上的同名插件占用
  （功能高度重叠），改用作用域名以避免冲突；npm 作用域强制小写。
  改名同步更新了 `package.json`、`cordis.patch.yml` 与 `client.js` 的 `__ModuleLoader__` id 三处
  硬耦合点。
- 补 `publishConfig.access: public`（作用域包发 npm 必须声明，否则默认按私有发布）。
- README 补充「前置条件：需在 DSH 中登录 DeepSeek 账号」的真实限制说明。
- 补齐发布元数据：`repository` / `bugs` / `homepage` / `author` 与 `LICENSE` 文件。
- 新增 `dsh.engines.dsh` 版本约束（注：DSH 是否强制执行未经验证）。
- 关键词补充 `dsh-plugin`（GitHub 发现用）与 `deepseek`。

## 0.1.0

- 首个可用版本：Host 端注册只读接口 `/api/dsh-balance`（15 秒缓存 + 单飞合并 + 回环限制）。
- 浏览器端在 `conversation.input.right` 渲染余额胶囊，点击展开明细面板。
- 明细面板改为 `fixed` 定位，避免被输入框祖先的 `overflow:hidden` 裁切。
