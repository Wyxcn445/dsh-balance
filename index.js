// dsh-balance — 宿主端（Host half）
//
// 职责：把「账户余额」这一份数据以只读 HTTP 接口暴露给浏览器端。
// 余额本身由 DSH 内置的 deepseekAccount 服务提供（它持有平台登录凭证，
// 只有宿主侧能取到请求凭证），因此浏览器端不能直接查询，必须经这里中转。
//
// 设计要点：
//   1. 只读接口，不做任何写操作，也绝不返回任何凭证 / token。
//   2. 带 TTL 缓存：平台余额查询是一次外部网络请求，浏览器端会周期性轮询，
//      缓存可以避免把高频轮询直接放大到平台接口上。
//   3. 单飞（single-flight）：并发的首次请求共用同一次查询，避免打爆上游。
//   4. 一切失败都归一化成 { ok: false, reason } 的常规值，不向客户端抛错。

export const name = 'dsh-balance'

// webServer 是硬依赖（没有它就没有接口可注册）；
// deepseekAccount 走可选获取，缺失时接口降级返回 not-available，而不是让插件加载失败。
export const inject = ['webServer']

/** 浏览器端轮询的固定只读路由。 */
const ROUTE = '/api/dsh-balance'

/** 缓存有效期：15 秒内重复轮询直接命中缓存。 */
const CACHE_TTL_MS = 15_000

/** 上游查询超时：避免平台接口卡住时把浏览器轮询一起拖死。 */
const UPSTREAM_TIMEOUT_MS = 10_000

// 统一的 JSON 响应写出。
function writeJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    // 余额属于私密信息，禁止被当作 referrer 外泄，也禁止任何缓存层留存。
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

// 只允许本机回环地址访问：余额接口不需要对外可达。
function isLoopbackRequest(req) {
  const address = req.socket?.remoteAddress ?? ''
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1' ||
    address.startsWith('127.')
  )
}

// 从查询串里取一个字符串参数；缺失或类型不对时回退到默认值。
function queryParam(url, key, fallback) {
  try {
    const value = url.searchParams.get(key)
    return typeof value === 'string' && value !== '' ? value : fallback
  } catch {
    return fallback
  }
}

export function apply(ctx) {
  // 缓存与单飞状态都属于本插件实例，随插件卸载一起消失。
  let cached = null // { at: number, value: object }
  let inflight = null // Promise<object>

  // 真正去问 deepseekAccount 要一次余额；绝不抛错。
  async function queryBalance(client) {
    const account = ctx.get('deepseekAccount')
    if (!account || typeof account.getBalance !== 'function') {
      return { ok: false, reason: 'not-available' }
    }

    // 先看账户状态：未登录时不必发起平台查询，也顺带拿到用量/充值入口链接。
    let state
    try {
      state = await account.getState()
    } catch {
      state = undefined
    }
    const links = state && state.links ? state.links : undefined

    if (state && state.status === 'signed-out') {
      return { ok: false, reason: 'signed-out', links }
    }

    // 平台查询本身可能抛错（网络、凭证过期等），超时保护一并加在这里。
    let balance
    try {
      balance = await withTimeout(account.getBalance(client), UPSTREAM_TIMEOUT_MS)
    } catch (error) {
      return { ok: false, reason: 'query-failed', detail: String(error?.message ?? error), links }
    }

    // 凭证在查询途中失效时会得到 null。
    if (!balance) return { ok: false, reason: 'signed-out', links }
    if (balance.status !== 'ready') {
      return { ok: false, reason: 'query-failed', links }
    }

    return {
      ok: true,
      wallets: Array.isArray(balance.value) ? balance.value : [],
      bonusWallets: Array.isArray(balance.bonusWallets) ? balance.bonusWallets : [],
      links,
    }
  }

  // 带缓存的对外读数入口。
  async function readBalance(client, force) {
    const now = Date.now()
    if (!force && cached !== null && now - cached.at < CACHE_TTL_MS) {
      return { ...cached.value, cached: true }
    }
    // 单飞：并发请求只触发一次上游查询。
    if (inflight !== null) return inflight

    inflight = (async () => {
      try {
        const value = await queryBalance(client)
        cached = { at: Date.now(), value }
        return { ...value, cached: false }
      } finally {
        inflight = null
      }
    })()
    return inflight
  }

  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'exact',
      path: ROUTE,
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          writeJson(res, 405, { error: `method not allowed: ${req.method}` })
          return
        }
        if (!isLoopbackRequest(req)) {
          writeJson(res, 403, { error: 'forbidden: loopback-only' })
          return
        }

        // 客户端把自己的语言/时区带上来，平台返回的文案与金额格式会更贴合本地。
        const url = new URL(req.url ?? ROUTE, 'http://localhost')
        const client = {
          version: '0.1.0',
          locale: queryParam(url, 'locale', 'zh-CN'),
          timezoneOffsetSeconds: Number(queryParam(url, 'tz', '480')) || 0,
        }
        const force = queryParam(url, 'force', '') === '1'

        try {
          const value = await readBalance(client, force)
          writeJson(res, 200, { ...value, fetchedAt: Date.now() })
        } catch (error) {
          // 兜底：readBalance 理论上不抛，这里保证接口永远给出结构化结果。
          writeJson(res, 200, {
            ok: false,
            reason: 'internal',
            detail: String(error?.message ?? error),
            fetchedAt: Date.now(),
          })
        }
      },
    })
    return dispose
  })
}

// 给上游查询加一个超时；超时后放弃等待（不中断上游，只是不再阻塞本次响应）。
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
      // Node 定时器不应阻止进程退出。
      if (typeof timer.unref === 'function') timer.unref()
    }),
  ])
}
