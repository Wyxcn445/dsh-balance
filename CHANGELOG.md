# Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## 0.1.1

- 补齐发布元数据：`repository` / `bugs` / `homepage` / `author` 与 `LICENSE` 文件。
- 新增 `dsh.engines.dsh` 版本约束，避免在未验证的 DSH 版本上被安装后崩溃。
- 关键词补充 `dsh-plugin`（GitHub 发现用）与 `deepseek`。

## 0.1.0

- 首个可用版本：Host 端注册只读接口 `/api/dsh-balance`（15 秒缓存 + 单飞合并 + 回环限制）。
- 浏览器端在 `conversation.input.right` 渲染余额胶囊，点击展开明细面板。
- 明细面板改为 `fixed` 定位，避免被输入框祖先的 `overflow:hidden` 裁切。
