// dsh-balance — 浏览器端（Client half）
//
// 契约外壳：dsh web 的客户端插件加载器按 window.__ModuleLoader__.load({ id, factory })
// 的约定装载本模块。factory 内注入的 require 只能解析宿主放行的外部依赖（React 等），
// 产物因此是自包含单文件、零运行时依赖。
//
// 界面职责：在「输入框工具行」右侧（conversation.input.right 插槽）渲染一个余额胶囊，
// 数据经本插件的宿主端只读接口 /api/dsh-balance 获取，按固定周期轮询刷新。
window.__ModuleLoader__.load({
  id: 'dsh-balance',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    'use strict'

    // React 互操作：不同构建下可能是命名空间对象或 default 导出。
    var React = require('react')
    if (React && typeof React.createElement !== 'function' && React.default) React = React.default

    var API = '/api/dsh-balance'
    var POLL_MS = 20000

    // 客户端样式：前缀 db- 避免与 shell / 其他插件冲突；
    // 颜色一律走 --dsw-alias-* 主题变量并带浅色回退，明暗自适应。
    var CSS = [
      '.db-wrap{position:relative;display:inline-flex;align-items:center}',
      '.db-pill{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 9px;',
      'border:1px solid var(--dsw-alias-border-l1,#d7dae0);border-radius:99px;',
      'background:var(--dsw-alias-bg-base,transparent);',
      'color:var(--dsw-alias-label-secondary,#6b7280);font-size:12px;line-height:1;',
      'font-family:system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer;white-space:nowrap}',
      '.db-pill:hover{background:var(--dsw-alias-interactive-bg-hover,#f2f4f8);',
      'color:var(--dsw-alias-label-primary,#1c1e26)}',
      '.db-dot{width:6px;height:6px;border-radius:50%;flex:none;',
      'background:var(--dsw-alias-label-tertiary,#9aa1ad)}',
      '.db-dot[data-state="ready"]{background:var(--dsw-alias-state-success-primary,#0f9d6e)}',
      '.db-dot[data-state="empty"]{background:var(--dsw-alias-state-warn-primary,#e08b1e)}',
      '.db-dot[data-state="error"]{background:var(--dsw-alias-state-error-primary,#e0483e)}',
      '.db-num{font-variant-numeric:tabular-nums}',
      // 面板用 fixed 定位并在打开时按胶囊实测坐标摆放：
      // 输入框工具行的祖先链上可能有 overflow:hidden，absolute 面板会被裁掉。
      '.db-panel{position:fixed;z-index:90;',
      'width:260px;box-sizing:border-box;max-width:calc(100vw - 32px);padding:10px 12px;',
      'border:1px solid var(--dsw-alias-border-l1,#e2e4ea);border-radius:10px;',
      'background:var(--dsw-alias-bg-base,#fdfdfd);color:var(--dsw-alias-label-primary,#1c1e26);',
      'box-shadow:0 10px 32px rgba(0,0,0,.18);font-size:12px;text-align:left;',
      'font-family:system-ui,-apple-system,"Segoe UI",sans-serif}',
      '.db-row{display:flex;align-items:baseline;justify-content:space-between;gap:14px;padding:3px 0}',
      '.db-row .db-k{color:var(--dsw-alias-label-secondary,#8a8f9c);font-size:11px}',
      '.db-row .db-v{font-variant-numeric:tabular-nums;font-weight:600}',
      '.db-sec{margin-top:8px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1,#eceef2)}',
      '.db-sec-t{color:var(--dsw-alias-label-tertiary,#9aa1ad);font-size:10px;margin-bottom:4px}',
      '.db-note{color:var(--dsw-alias-label-secondary,#8a8f9c);font-size:11px;line-height:1.5}',
      '.db-links{display:flex;gap:8px;margin-top:9px;flex-wrap:wrap}',
      '.db-links a{flex:1;text-align:center;text-decoration:none;padding:5px 8px;border-radius:6px;',
      'border:1px solid var(--dsw-alias-border-l1,#d7dae0);',
      'color:var(--dsw-alias-label-primary,#1c1e26);font-size:11px}',
      '.db-links a:hover{background:var(--dsw-alias-interactive-bg-hover,#eef1f5)}',
      '.db-foot{margin-top:7px;color:var(--dsw-alias-label-tertiary,#9aa1ad);font-size:10px}',
    ].join('')

    // 货币符号：仅覆盖平台实际会返回的两种。
    function symbolOf(currency) {
      return currency === 'USD' ? '$' : '¥'
    }

    // 金额展示：保留 2 位小数，避免把平台下发的高精度小数整串铺出来。
    function formatAmount(value) {
      var num = Number(value)
      if (!isFinite(num)) return String(value)
      return num.toFixed(2)
    }

    // 主钱包：优先人民币，否则取第一个。
    function primaryWallet(wallets) {
      if (!Array.isArray(wallets) || wallets.length === 0) return null
      for (var i = 0; i < wallets.length; i++) {
        if (wallets[i] && wallets[i].currency === 'CNY') return wallets[i]
      }
      return wallets[0]
    }

    // 读取一次余额；任何失败都折成 { ok:false, reason } 形态，不抛错。
    function fetchBalance(force) {
      var tz = new Date().getTimezoneOffset() * -60 // 换算成「东八区为 +28800」的秒偏移
      var locale = (navigator && navigator.language) || 'zh-CN'
      var url = API + '?locale=' + encodeURIComponent(locale) + '&tz=' + tz + (force ? '&force=1' : '')
      return fetch(url, { headers: { accept: 'application/json' } })
        .then(function (res) {
          return res.json().then(function (body) {
            if (!res.ok) return { ok: false, reason: 'http-' + res.status }
            return body && typeof body === 'object' ? body : { ok: false, reason: 'bad-body' }
          })
        })
        .catch(function () {
          return { ok: false, reason: 'network' }
        })
    }

    // 余额胶囊本体。
    function BalanceBadge() {
      var statePair = React.useState({ phase: 'loading', data: null })
      var state = statePair[0]
      var setState = statePair[1]
      var openPair = React.useState(false)
      var open = openPair[0]
      var setOpen = openPair[1]
      // 面板的 fixed 定位坐标（打开时按胶囊实测），以及胶囊自身的 DOM 引用。
      var coordPair = React.useState(null)
      var coords = coordPair[0]
      var setCoords = coordPair[1]
      var pillRef = React.useRef(null)

      React.useEffect(function () {
        var alive = true

        function load(force) {
          return fetchBalance(force).then(function (data) {
            if (!alive) return
            var phase = data.ok ? 'ready' : 'empty'
            if (!data.ok && data.reason !== 'signed-out' && data.reason !== 'not-available') phase = 'error'
            setState({ phase: phase, data: data })
          })
        }

        load(false)
        var timer = setInterval(function () { load(false) }, POLL_MS)
        // 隐藏的标签页不必继续轮询；重新可见时立刻补一次。
        function onVisible() { if (!document.hidden) load(false) }
        document.addEventListener('visibilitychange', onVisible)

        return function () {
          alive = false
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [])

      var data = state.data || {}
      var wallet = data.ok ? primaryWallet(data.wallets) : null

      // 胶囊上的短文案。
      var label
      var dotState = state.phase === 'ready' ? 'ready' : state.phase === 'loading' ? 'idle' : state.phase
      if (state.phase === 'loading') label = '余额 …'
      else if (state.phase === 'ready' && wallet) label = symbolOf(wallet.currency) + formatAmount(wallet.balance)
      else if (data.reason === 'signed-out') label = '余额未登录'
      else if (data.reason === 'not-available') label = '余额不可用'
      else label = '余额 --'

      // 明细面板内容。
      var rows = []
      if (state.phase === 'ready') {
        var wallets = Array.isArray(data.wallets) ? data.wallets : []
        for (var i = 0; i < wallets.length; i++) {
          rows.push(React.createElement('div', { className: 'db-row', key: 'w' + i },
            React.createElement('span', { className: 'db-k' }, wallets[i].currency === 'USD' ? '充值余额 (USD)' : '充值余额 (CNY)'),
            React.createElement('span', { className: 'db-v' }, symbolOf(wallets[i].currency) + formatAmount(wallets[i].balance))
          ))
        }
        var bonuses = Array.isArray(data.bonusWallets) ? data.bonusWallets : []
        if (bonuses.length > 0) {
          var bonusRows = []
          for (var j = 0; j < bonuses.length; j++) {
            bonusRows.push(React.createElement('div', { className: 'db-row', key: 'b' + j },
              React.createElement('span', { className: 'db-k' }, '赠送额度'),
              React.createElement('span', { className: 'db-v' }, symbolOf(bonuses[j].currency) + formatAmount(bonuses[j].balance))
            ))
          }
          rows.push(React.createElement('div', { className: 'db-sec', key: 'bonus' },
            React.createElement('div', { className: 'db-sec-t' }, '赠送额度'),
            bonusRows
          ))
        }
      } else if (data.reason === 'signed-out') {
        rows.push(React.createElement('div', { className: 'db-note', key: 'n' },
          '当前未登录 DeepSeek 账号。请在「设置 → 模型」中登录后即可看到实时余额。'))
      } else if (data.reason === 'not-available') {
        rows.push(React.createElement('div', { className: 'db-note', key: 'n' },
          '宿主未提供账户服务（deepseekAccount），余额暂时无法读取。'))
      } else {
        rows.push(React.createElement('div', { className: 'db-note', key: 'n' },
          '余额查询失败：' + String(data.reason || 'unknown') + (data.detail ? '（' + data.detail + '）' : '')))
      }

      // 平台下发的入口链接（用量明细 / 去充值）。
      var links = data.links || {}
      var linkNodes = []
      if (links.usageUrl) {
        linkNodes.push(React.createElement('a', { key: 'u', href: links.usageUrl, target: '_blank', rel: 'noreferrer noopener' }, '用量明细'))
      }
      if (links.topUpUrl) {
        linkNodes.push(React.createElement('a', { key: 't', href: links.topUpUrl, target: '_blank', rel: 'noreferrer noopener' }, '去充值'))
      }
      if (linkNodes.length > 0) {
        rows.push(React.createElement('div', { className: 'db-links', key: 'links' }, linkNodes))
      }

      var fetchedAt = data.fetchedAt ? new Date(data.fetchedAt) : null
      if (fetchedAt) {
        rows.push(React.createElement('div', { className: 'db-foot', key: 'foot' },
          '更新于 ' + fetchedAt.toLocaleTimeString() + ' · 每 ' + (POLL_MS / 1000) + ' 秒自动刷新'))
      }

      // 打开面板时顺手强制刷新一次，避免看到过期数字。
      function toggle() {
        var next = !open
        setOpen(next)
        if (!next) return
        // 按胶囊当前实测位置摆放 fixed 面板：优先贴在其正上方，空间不足则改到下方。
        var rect = pillRef.current ? pillRef.current.getBoundingClientRect() : null
        if (rect) {
          var panelWidth = 260
          var left = rect.right - panelWidth
          if (left < 8) left = 8
          var above = rect.top > 260
          setCoords({
            left: left + 'px',
            top: above ? 'auto' : (rect.bottom + 8) + 'px',
            bottom: above ? (window.innerHeight - rect.top + 8) + 'px' : 'auto',
          })
        }
        fetchBalance(true).then(function (d) {
          var phase = d.ok ? 'ready' : 'empty'
          if (!d.ok && d.reason !== 'signed-out' && d.reason !== 'not-available') phase = 'error'
          setState({ phase: phase, data: d })
        })
      }

      return React.createElement('div', { className: 'db-wrap' },
        React.createElement('button', {
          type: 'button',
          className: 'db-pill',
          ref: pillRef,
          title: 'DeepSeek 账户余额 — 点击查看明细',
          onClick: toggle,
        },
          React.createElement('span', { className: 'db-dot', 'data-state': dotState }),
          React.createElement('span', { className: 'db-num' }, label)
        ),
        open ? React.createElement('div', { className: 'db-panel', style: coords || undefined }, rows) : null
      )
    }

    // 插件入口：宿主在客户端运行时装配好 ctx 后调用。
    function apply(ctx) {
      var disposers = []
      try {
        // 样式只注入一次（热重载时避免重复堆叠）。
        if (!document.querySelector('style[data-dsh-balance-style]')) {
          var styleEl = document.createElement('style')
          styleEl.setAttribute('data-dsh-balance-style', '')
          styleEl.textContent = CSS
          document.head.appendChild(styleEl)
        }

        // slots 是硬依赖（见文件末尾的 inject）；优先走 ctx.slots 直取，
        // 取不到时退回 ctx.get 做一次带 undefined 检查的兜底。
        var slots = ctx.slots || ctx.get('slots')
        if (slots && typeof slots.inject === 'function' && typeof slots.register === 'function') {
          var dispose = slots.inject('conversation.input.right', function () {
            return slots.register(
              { name: 'conversation.input.right', id: 'dsh-balance', order: 50, label: function () { return '账户余额' } },
              BalanceBadge
            )
          })
          if (typeof dispose === 'function') disposers.push(dispose)
        } else {
          console.warn('[dsh-balance] slots 服务不可用，余额胶囊未挂载')
        }
      } catch (error) {
        console.warn('[dsh-balance] 挂载失败：', error)
      }

      ctx.effect(function () {
        return function () {
          for (var i = 0; i < disposers.length; i++) {
            try { disposers[i]() } catch (e) { /* 卸载期忽略 */ }
          }
          disposers.length = 0
        }
      }, 'dsh-balance: ui')
    }

    // 硬依赖：没有 slots 就没有可挂载的位置。
    var inject = ['slots']

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
