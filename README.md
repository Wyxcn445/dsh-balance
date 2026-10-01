# @wyxcn445/dsh-balance

DSH 插件：在**输入框工具行（模型选择器旁）**实时显示 DeepSeek 账户余额。

## 功能

- 胶囊上显示主钱包余额（人民币优先），带状态色点。
- 点击展开明细面板：
  - 充值余额（各币种）
  - 赠送额度（若平台有下发）
  - 用量明细 / 去充值 入口
  - 最近更新时间
- 每 20 秒自动刷新；标签页重新可见时立即补一次；打开面板时强制刷新。
- 未登录、服务缺失、查询失败都会降级成可读提示，不会让输入框报错。

## 数据来源

浏览器端不直接访问平台接口 —— 账户凭证只在宿主侧可见。链路是：

```
浏览器余额胶囊
  └─ GET /api/dsh-balance        （本插件宿主端注册的只读路由，仅回环可访问）
       └─ ctx.deepseekAccount.getState() / getBalance()
            └─ DeepSeek 平台账户接口
```

宿主端带 15 秒缓存与单飞合并，避免浏览器轮询被放大到平台接口上；上游查询另有 10 秒超时保护。

## 前置条件（重要）

本插件读取的是 **DSH 内置 `deepseekAccount` 服务**的账户数据，因此要求：

> 已在 DSH 中**登录 DeepSeek 账号**（平台会话）。

只配置了 `DEEPSEEK_API_KEY`、但没有在 DSH 里登录账号的用户，胶囊会显示「余额未登录」——
这是预期行为，不是故障。

## 安装

### 从 GitHub 安装（推荐）

```sh
dsh plugin --profile <你的profile名> add github:Wyxcn445/dsh-balance
```

### 从 npm 安装

```sh
dsh plugin --profile <你的profile名> add @wyxcn445/dsh-balance
```

### 本地源码安装（开发用）

`link:` 会把目录软链进 profile，源码改动立即生效：

```sh
dsh plugin --profile <你的profile名> add link:/绝对路径/dsh-balance
```

安装后刷新一次浏览器页面即可看到胶囊。

## 卸载

```sh
dsh plugin --profile <你的profile名> remove @wyxcn445/dsh-balance
```

## 说明

- 接口为只读，不写任何配置；响应中不含任何 token / 凭证。
- 仅接受来自回环地址（127.0.0.1 / ::1）的请求。
- 该路由未走 DSH 的令牌鉴权，仅靠回环限制——与既有同类插件（如 dsh-mcp-manager）姿态一致。
  若要收紧，可改为经 `ctx.connection.authenticatedUrl` 访问。
- 余额查询属于外部网络请求，首次加载可能有短暂延迟，胶囊会先显示「余额 …」。

## 许可

MIT
