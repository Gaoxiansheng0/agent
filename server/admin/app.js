// PearlKin admin panel. Plain JS, no build step. All user-supplied text goes through html`` which escapes it.
'use strict'

// ---------- tiny helpers ----------
class Raw { constructor(s) { this.s = s } }
const raw = s => new Raw(s)
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const fmt = v => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(fmt).join('') : v === false || v == null ? '' : esc(v))
const html = (strings, ...vals) => raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? fmt(vals[i]) : ''), ''))
const $ = s => document.querySelector(s)
const main = $('#main')

const num = v => Number(v || 0).toLocaleString('zh-CN')
const pct = (a, b) => (b ? `${Math.round((a / b) * 1000) / 10}%` : '—')
const money = v => `$${Number(v || 0).toFixed(Number(v) < 1 ? 4 : 2)}`
const time = ts => (ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '')
const day = ts => (ts ? new Date(ts).toLocaleDateString('zh-CN') : '')

function toast(msg, bad) {
  const t = $('#toast')
  t.textContent = msg
  t.className = 'toast' + (bad ? ' bad' : '')
  t.hidden = false
  clearTimeout(toast.t)
  toast.t = setTimeout(() => (t.hidden = true), bad ? 5000 : 2200)
}

async function api(method, path, body) {
  const res = await fetch('/admin/api' + path, {
    method, headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin',
  })
  if (res.status === 401 && path !== '/login') { showLogin(); throw new Error('请先登录') }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) { const e = new Error(data.error || `请求失败（${res.status}）`); e.data = data; throw e }
  return data
}

const SEV = { good: '适合', care: '谨慎使用', not_recommended: '不建议', ask_doctor: '先问医生', unsupported: '暂不支持该年龄' }
const sev = s => html`<span class="pill sev-${s}">${SEV[s] || s}</span>`
const BANDS = ['8-12', '13-17', '18+', '0-3', '4-7']
const STAGES = { pregnancy: '孕期', breastfeeding: '哺乳期' }
const CONCERNS = { sensitive: '敏感肌', acne_prone: '易长痘' }

function chart(rows, key, label, color) {
  if (!rows.length) return html`<p class="muted">暂无数据</p>`
  const max = Math.max(1, ...rows.map(r => Number(r[key]) || 0))
  return html`<div class="chart">${rows.map(r => html`<div class="col" data-tip="${r.day}\n${label}：${num(r[key])}"><i style="height:${((Number(r[key]) || 0) / max) * 100}%;${color ? `background:${color}` : ''}"></i></div>`)}</div>
    <div class="chart-x"><span>${rows[0].day}</span><span>${rows[rows.length - 1].day}</span></div>`
}
function hbars(rows, labels = {}) {
  if (!rows.length) return html`<p class="muted">暂无数据</p>`
  const total = rows.reduce((s, r) => s + r.n, 0)
  const max = Math.max(...rows.map(r => r.n))
  return rows.map(r => html`<div class="hbar"><span>${labels[r.k] ?? (r.k || '(未知)')}</span><span class="track"><i style="width:${(r.n / max) * 100}%"></i></span><span class="num">${num(r.n)} · ${pct(r.n, total)}</span></div>`)
}
const stat = (label, value, sub, extra) => html`<div class="card stat"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div>${extra}</div>`
const rangeTabs = (cur, opts = [7, 30, 90]) => html`<div class="tabs">${opts.map(n => html`<button class="btn sm ${n === cur ? 'on' : ''}" data-act="range" data-days="${n}">最近 ${n} 天</button>`)}</div>`

// ---------- routing ----------
const state = { days: 7, tab: {}, prefill: null }
const pages = {}
const actions = {}
const forms = {}

async function render() {
  const page = (location.hash.slice(1) || 'overview').split('?')[0]
  document.querySelectorAll('.side a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + page))
  try {
    main.innerHTML = fmt(await (pages[page] || pages.overview)())
  } catch (e) {
    if (e.message !== '请先登录') main.innerHTML = fmt(html`<div class="card err">加载失败：${e.message}</div>`)
  }
}
async function refreshBadges() {
  try {
    const o = await api('GET', '/overview?days=7')
    $('#badge-reports').textContent = o.queue.reports || ''
    $('#badge-submissions').textContent = o.queue.submissions || ''
    $('#badge-unknowns').textContent = o.queue.unknowns || ''
  } catch { /* shown by the page itself */ }
}
window.addEventListener('hashchange', render)

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]')
  if (!el) return
  e.preventDefault()
  const fn = actions[el.dataset.act]
  if (!fn) return
  el.disabled = true
  try { await fn(el) } catch (err) { if (err.message !== '请先登录') toast(err.message, true) } finally { el.disabled = false }
})
document.addEventListener('submit', async e => {
  const f = e.target.closest('[data-form]')
  if (!f) return
  e.preventDefault()
  const fn = forms[f.dataset.form]
  const btn = f.querySelector('[type=submit]')
  if (btn) btn.disabled = true
  try { await fn(f, Object.fromEntries(new FormData(f))) } catch (err) { if (err.message !== '请先登录') toast(err.message, true) } finally { if (btn) btn.disabled = false }
})

actions.range = el => { state.days = Number(el.dataset.days); return render() }
actions.tab = el => { state.tab[el.dataset.page] = el.dataset.tab; return render() }
actions.logout = async () => { await api('POST', '/logout'); showLogin() }

function showLogin() { $('#shell').hidden = true; $('#login').hidden = false }
forms.login = async (f, v) => {
  try {
    await api('POST', '/login', { password: v.password })
    $('#login').hidden = true
    $('#shell').hidden = false
    f.reset()
    $('#login-err').textContent = ''
    render()
    refreshBadges()
  } catch (e) { $('#login-err').textContent = e.message }
}

// ---------- 概览 ----------
pages.overview = async () => {
  const [o, st] = await Promise.all([api('GET', `/overview?days=${state.days}`), api('GET', '/settings')])
  const s = st.settings, status = st.status
  const todos = [
    { done: status.password, text: '设置后台密码', how: '已完成才能看到这个页面' },
    { done: status.deepseekKey, text: '配置 DeepSeek key（测肤、搭配建议、拍成分表都要用）', how: html`运行 <code>ssh -t -i ~/.ssh/resume.pem root@8.218.190.208 pearlkin-set-key</code>` },
    { done: status.email, text: '配置 Resend，让登录验证码真正发到用户邮箱', how: '见「设置」页的步骤；没配之前验证码显示在「用户」页' },
    { done: status.revenueCat, text: 'App 上架后配置 RevenueCat，订阅状态才能同步到服务器', how: '见「设置」页' },
    { done: o.rulePack.todoSources === 0, text: `补齐规则来源（还有 ${o.rulePack.todoSources} 条是 TODO）`, how: '「规则包」→ 编辑规则 → 来源' },
    { done: o.rulePack.unreviewed === 0, text: `请皮肤科医生审核规则（${o.rulePack.unreviewed}/${o.rulePack.rules} 条未签字）`, how: '「规则包」→ 编辑规则 → 审核人签字' },
    { done: s.paywallEnabled, text: '订阅配好后打开付费墙（打开后，测肤报告要订阅或试用才能看）', how: '「设置」→ 付费墙；现在关着，所有人都能看完整报告，方便你测试' },
  ]
  const L = o.landing
  return html`
    <div class="head"><div><h1>概览</h1><div class="muted">数字按北京时间统计</div></div>${rangeTabs(state.days)}</div>
    <div class="grid">
      ${stat('落地页访客', num(L.visitors), html`点了购买按钮 ${num(L.clicks)} 人（${pct(L.clicks, L.visitors)}）`)}
      ${stat('创始会员预售', html`${num(L.presales)} <span class="muted small">/ ${L.presaleTarget}</span>`, `止损线：少于 ${L.presaleTarget} 单就停止这个方向`,
        html`<div class="progress"><i style="width:${Math.min(100, (L.presales / L.presaleTarget) * 100)}%"></i></div>`)}
      ${stat('等候名单', num(L.waitlist), `最近 ${o.days} 天新增`)}
      ${stat('App 新安装', num(o.app.newInstalls), `活跃 ${num(o.app.active)} · 查了 ${num(o.app.products)} 个产品`)}
      ${stat('付费成功', num(o.app.purchases), s.paywallEnabled ? '付费墙已开启' : '付费墙未开启')}
      ${stat('拍照识别', num(o.ocr.calls), html`失败 ${num(o.ocr.failed)} · 花费 ${money(o.ocr.cost)}`)}
    </div>
    <div class="grid two">
      <div class="card"><h2>待处理</h2>
        <p><a href="#reports">用户报错</a>：<b>${o.queue.reports}</b> 条未完成</p>
        <p><a href="#products">用户补录的产品</a>：<b>${o.queue.submissions}</b> 条待审核</p>
        <p><a href="#unknowns">未识别成分</a>：<b>${o.queue.unknowns}</b> 个待处理</p>
        <p><a href="#rules">规则包</a>：线上 v${o.rulePack.published}${o.rulePack.draftChanged ? html` · <span class="tag warn">草稿有未发布的改动</span>` : ''}</p>
      </div>
      <div class="card"><h2>上线清单</h2>
        <ul class="todo">${todos.map(t => html`<li class="${t.done ? 'done' : ''}">${t.done ? '✅' : '⬜'} ${t.text}${t.done ? '' : html`<div class="small muted">${t.how}</div>`}</li>`)}</ul>
      </div>
    </div>
    <div class="grid two">
      <div class="card"><h2>落地页每日访客</h2>${chart(o.daily, 'visitors', '访客')}</div>
      <div class="card"><h2>App 每日活跃</h2>${chart(o.daily, 'active', '活跃', 'var(--bar3)')}</div>
    </div>`
}

// ---------- 落地页 ----------
pages.landing = async () => {
  const n = Math.max(state.days, 30)
  const [l, p, sv] = await Promise.all([api('GET', `/landing?days=${n}`), api('GET', '/presales'), api('GET', '/survey')])
  const HOOKS = { a: 'A：AI 30 秒读懂你的皮肤（主打）', b: 'B：扫了 11 岁孩子的 Sephora 战利品（引流）', c: 'C：全家人的皮肤和产品一个 App 管' }
  const paid = p.rows.filter(r => r.status === 'paid')
  return html`
    <div class="head"><div><h1>落地页与预售</h1><div class="muted">钩子 = 广告链接里的 <code>?h=a</code> / <code>b</code> / <code>c</code>，用来比较哪条广告最有效</div></div>${rangeTabs(n, [30, 90, 365])}</div>
    <div class="card"><h2>按钩子对比</h2><div class="table-wrap"><table>
      <tr><th>钩子</th><th class="num">访客</th><th class="num">点了打开 App</th><th class="num">点击率</th><th class="num">等候名单</th><th class="num">预售（累计）</th><th class="num">访客→预售</th></tr>
      ${l.hooks.map(h => html`<tr><td>${HOOKS[h.hook] || h.hook}</td><td class="num">${num(h.visitors)}</td><td class="num">${num(h.clicks)}</td><td class="num">${pct(h.clicks, h.visitors)}</td>
        <td class="num">${num(h.waitlist)}</td><td class="num">${num(h.presales)}</td><td class="num">${pct(h.presales, h.visitors)}</td></tr>`)}
    </table></div>
    <p class="small muted">投广告时用这样的链接：<code>https://pearlkin.pearlwren.com/?h=a&amp;utm_source=tiktok</code>。每个钩子花多少广告费要去广告平台看，用「广告费 ÷ 预售单数」算出每单成本，选最便宜的钩子主打。</p></div>
    <div class="grid two">
      <div class="card"><h2>每日访客</h2>${chart(l.daily, 'visitors', '访客')}</div>
      <div class="card"><h2>访客来源</h2>${hbars(l.sources.map(s => ({ k: s.source, n: s.visitors })))}</div>
    </div>
    <div class="card"><div class="row spread"><h2>创始会员预售（${paid.length} / ${p.target}）</h2><a class="btn sm" href="/admin/api/export/presales.csv">导出 CSV</a></div>
      <div class="callout small">预售用户付了 $19.99。App 上架后，在 App Store Connect 给年订阅生成「优惠码（Offer Code）」，每人一个，送他们第一年免费；填在下面，发出后勾选「已发送」。</div>
      ${p.rows.length ? html`<div class="table-wrap"><table>
        <tr><th>时间</th><th>邮箱</th><th class="num">金额</th><th>钩子</th><th>状态</th><th>App Store 优惠码</th><th>已发送</th></tr>
        ${p.rows.map(r => html`<tr><td>${time(r.ts)}</td><td>${r.email}</td><td class="num">${(r.amount / 100).toFixed(2)} ${r.currency.toUpperCase()}</td><td>${r.hook}</td>
          <td>${r.status === 'paid' ? html`<span class="tag good">已付款</span>` : html`<span class="tag bad">已退款</span>`}</td>
          <td><form class="row" data-form="offer" data-id="${r.session_id}"><input name="offer_code" value="${r.offer_code}" size="12"><button class="btn sm" type="submit">保存</button></form></td>
          <td><label class="inline"><input type="checkbox" data-act="codeSent" data-id="${r.session_id}" ${r.code_sent_at ? raw('checked') : ''}> ${r.code_sent_at ? day(r.code_sent_at) : ''}</label></td></tr>`)}
      </table></div>` : html`<p class="muted">还没有预售订单。要先在「设置」里填 Stripe 链接并配好 Webhook。</p>`}
    </div>
    ${surveyCard(sv)}
    <div class="card"><div class="row spread"><h2>等候名单（${p.waitlist.length}）</h2><a class="btn sm" href="/admin/api/export/waitlist.csv">导出 CSV</a></div>
      ${p.waitlist.length ? html`<div class="table-wrap"><table><tr><th>时间</th><th>邮箱</th><th>钩子</th></tr>
        ${p.waitlist.slice(0, 200).map(w => html`<tr><td>${time(w.ts)}</td><td>${w.email}</td><td>${w.hook}</td></tr>`)}</table></div>` : html`<p class="muted">暂无</p>`}
    </div>`
}
const SURVEY_LABELS = {
  kids: { under8: '8 岁以下', '8-12': '8–12 岁', '13-17': '13–17 岁', none: '没有孩子' },
  checks: { google: '上网搜', label: '自己看成分表', doctor: '问医生', parents: '问其他家长', social: '看 TikTok / 网红', dont: '不怎么查' },
  price: { easy: '很值，马上买', fair: '价格合理', bit_much: '有点贵', too_much: '太贵了' },
}
function surveyCard(sv) {
  const q = (title, rows, labels) => html`<div><h3>${title}</h3>${hbars(rows.filter(r => r.n), labels)}</div>`
  return html`<div class="card"><div class="row spread"><h2>小问卷（${sv.total} 人答过）</h2><a class="btn sm" href="/admin/api/export/survey.csv">导出 CSV</a></div>
    <p class="small muted">用户留下邮箱后看到的 3 个问题，可以跳过。重点看「家里有 8–12 岁孩子的人怎么看价格」：觉得「很值」和「合理」的占大多数，说明 $19.99 定价站得住。</p>
    ${sv.total ? html`<div class="grid two" style="margin-top:8px">
      ${q('孩子几岁（可多选）', sv.kids, SURVEY_LABELS.kids)}
      ${q('现在怎么判断产品能不能给孩子用', sv.checks, SURVEY_LABELS.checks)}
      ${q('$19.99 买第一年，你觉得', sv.price, SURVEY_LABELS.price)}
      ${q('其中有 8–12 岁孩子的家长怎么看价格', sv.tweenPrice, SURVEY_LABELS.price)}
    </div>` : html`<p class="muted">还没有人答。</p>`}
  </div>`
}

forms.offer = async (f, v) => { await api('PATCH', `/presales/${encodeURIComponent(f.dataset.id)}`, { offer_code: v.offer_code }); toast('已保存') }
actions.codeSent = async el => {
  // Checkbox clicks are prevented by the delegate; flip it ourselves.
  const on = !el.checked
  await api('PATCH', `/presales/${encodeURIComponent(el.dataset.id)}`, { code_sent: on })
  render()
}

// ---------- App 使用 ----------
pages.usage = async () => {
  const n = Math.max(state.days, 30)
  const u = await api('GET', `/usage?days=${n}`)
  const top = u.funnel[0].n
  const g3 = u.perWeek >= 1
  return html`
    <div class="head"><div><h1>App 使用情况</h1><div class="muted">只统计匿名设备编号，不含任何家庭成员信息</div></div>${rangeTabs(n, [30, 90, 365])}</div>
    <div class="grid">
      ${stat('活跃设备', num(u.active), `最近 ${u.days} 天打开过 App`)}
      ${stat('每台设备每周查几个产品', u.perWeek, raw(g3 ? '<span class="ok">达标（目标 ≥ 1）</span>' : '<span class="err">未达标（目标 ≥ 1，止损线 G3）</span>'))}
      ${stat('查了的产品', num(u.products), `用户报错 ${num(u.reports)} 条（${pct(u.reports, u.products)}，目标 ≤ 2%）`)}
    </div>
    <div class="card"><h2>新用户漏斗（最近 ${u.days} 天新装的设备）</h2>
      ${u.funnel.map(f => html`<div class="hbar"><span>${f.step}</span><span class="track"><i style="width:${top ? (f.n / top) * 100 : 0}%"></i></span><span class="num">${num(f.n)} · ${pct(f.n, top)}</span></div>`)}
    </div>
    <div class="grid two">
      <div class="card"><h2>每日活跃设备</h2>${chart(u.daily, 'active', '活跃')}</div>
      <div class="card"><h2>每日查产品数</h2>${chart(u.daily, 'products', '产品', 'var(--bar2)')}</div>
      <div class="card"><h2>扫条形码结果</h2>${hbars(u.barcode, { ours: '自己的产品库命中', obf: 'Open Beauty Facts 命中', miss: '都没查到', error: '网络错误' })}
        <p class="small muted">「都没查到」占比高，说明要多补录产品（计划要求条形码命中率 ≥ 50%）。</p></div>
      <div class="card"><h2>产品是怎么加进来的</h2>${hbars(u.methods, { barcode: '扫条形码', photo: '拍成分表', manual: '手动输入', sample: '试用样例' })}</div>
      <div class="card"><h2>拍照识别结果</h2>${hbars(u.photo, { ok: '识别成功', empty: '照片里没有成分表', error: '出错' })}</div>
      <div class="card"><h2>付费墙</h2>
        <h3>在哪里看到的</h3>${hbars(u.paywall, { scan_limit: '扫描次数用完', member_limit: '成员数到上限', reasons: '想看原因', routine: '流程体检', settings: '设置页' })}
        <h3>购买结果</h3>${hbars(u.purchases, { started: '点了购买', success: '成功', cancel: '取消', error: '出错', restored: '恢复购买' })}
        <h3>碰到免费版上限</h3>${hbars(u.limits, { scans: '扫描次数', members: '成员数' })}</div>
      <div class="card"><h2>平台与版本</h2>${hbars(u.platforms, { ios: 'iPhone', android: 'Android', web: '网页版' })}<h3>App 版本</h3>${hbars(u.versions)}</div>
    </div>
    <div class="card"><h2>App 报错（最近 30 条）</h2>
      ${u.errors.length ? html`<div class="table-wrap"><table><tr><th>时间</th><th>平台</th><th>版本</th><th>页面</th><th>错误</th></tr>
        ${u.errors.map(e => html`<tr><td>${time(e.ts)}</td><td>${e.platform}</td><td>${e.app_version}</td><td>${e.screen}</td><td class="mono">${e.message}</td></tr>`)}</table></div>` : html`<p class="muted">没有报错 🎉</p>`}
    </div>`
}

// ---------- 拍照识别 ----------
pages.ocr = async () => {
  const n = Math.max(state.days, 30)
  const o = await api('GET', `/ocr?days=${n}`)
  const t = o.totals
  return html`
    <div class="head"><div><h1>拍照识别</h1><div class="muted">照片不保存；这里只记录时间、匿名 IP 编号、用量和结果</div></div>${rangeTabs(n, [30, 90, 365])}</div>
    <div class="grid">
      ${stat('今天成功识别', html`${num(o.today)} <span class="muted small">/ 上限 ${num(o.cap)}</span>`, '到上限后当天自动停用，防止被刷', html`<div class="progress"><i style="width:${Math.min(100, (o.today / Math.max(1, o.cap)) * 100)}%"></i></div>`)}
      ${stat('调用次数', num(t.calls), `失败 ${num(t.failed)}（${pct(t.failed, t.calls)}）· ${num(t.people)} 个不同 IP`)}
      ${stat('花费（估算）', money(t.cost), `平均每次 ${money(t.calls ? t.cost / t.calls : 0)} · 平均 ${num(t.avg_ms)} 毫秒`)}
    </div>
    <div class="grid two">
      <div class="card"><h2>每日调用</h2>${chart(o.daily, 'calls', '调用')}</div>
      <div class="card"><h2>常见失败原因</h2>${o.errors.length ? html`<table>${o.errors.map(e => html`<tr><td class="mono">${e.error}</td><td class="num">${e.n}</td></tr>`)}</table>` : html`<p class="muted">没有失败</p>`}
        <h3>过去 24 小时用得最多的 IP（匿名编号）</h3>${o.topIps.length ? html`<table>${o.topIps.map(x => html`<tr><td class="mono">${x.ip_hash}</td><td class="num">${x.n}</td></tr>`)}</table>` : html`<p class="muted">暂无</p>`}
        <p class="small muted">同一个编号一天上百次，多半是被刷了：先在「设置」里调低每日上限。</p></div>
    </div>
    <div class="card"><h2>最近 50 次</h2><div class="table-wrap"><table>
      <tr><th>时间</th><th>IP 编号</th><th>结果</th><th class="num">耗时</th><th class="num">输入/输出 token</th><th class="num">花费</th><th class="num">成分数</th><th>说明</th></tr>
      ${o.recent.map(r => html`<tr><td>${time(r.ts)}</td><td class="mono">${r.ip_hash}</td><td>${r.status === 200 ? html`<span class="tag good">成功</span>` : html`<span class="tag bad">${r.status}</span>`}</td>
        <td class="num">${num(r.ms)}ms</td><td class="num">${num(r.input_tokens)} / ${num(r.output_tokens)}</td><td class="num">${money(r.cost)}</td><td class="num">${r.ingredients}</td><td class="small">${r.error}</td></tr>`)}
    </table></div></div>`
}

// ---------- 报错 ----------
const KIND = { ingredients: '成分表不对', verdict: '结论不对', product: '产品信息不对', other: '其他' }
const RSTATUS = { new: '待处理', doing: '处理中', done: '已完成' }
pages.reports = async () => {
  const tab = state.tab.reports || 'open'
  const rows = await api('GET', `/reports${tab === 'all' || tab === 'open' ? '' : `?status=${tab}`}`)
  const list = tab === 'open' ? rows.filter(r => r.status !== 'done') : rows
  return html`
    <div class="head"><div><h1>用户报错</h1><div class="muted">用户在 App 产品页点「Report a problem」提交的内容</div></div><a class="btn sm" href="/admin/api/export/reports.csv">导出 CSV</a></div>
    <div class="tabs">${[['open', '未完成'], ['new', '待处理'], ['doing', '处理中'], ['done', '已完成'], ['all', '全部']].map(([k, l]) =>
      html`<button class="btn sm ${tab === k ? 'on' : ''}" data-act="tab" data-page="reports" data-tab="${k}">${l}</button>`)}</div>
    ${list.length ? list.map(r => html`<div class="card">
      <div class="row spread"><div><b>${r.product_name}</b> ${r.brand ? html`<span class="muted">· ${r.brand}</span>` : ''} <span class="tag">${KIND[r.kind]}</span> <span class="tag ${r.status === 'done' ? 'good' : 'warn'}">${RSTATUS[r.status]}</span></div>
        <div class="item-meta">${time(r.ts)} · ${r.platform} ${r.app_version} · 规则包 v${r.pack_version}</div></div>
      ${r.message ? html`<p>${r.message}</p>` : html`<p class="muted">（没有填说明）</p>`}
      ${r.contact ? html`<p class="small">联系邮箱：<a href="mailto:${r.contact}">${r.contact}</a></p>` : ''}
      ${r.barcode ? html`<p class="small muted">条形码 ${r.barcode}</p>` : ''}
      ${r.raw ? html`<details><summary>用户当时的成分表</summary><pre class="raw">${r.raw}</pre></details>` : ''}
      <form class="form" data-form="report" data-id="${r.id}" style="margin-top:8px">
        <textarea name="note" placeholder="处理备注（只有你看得到）">${r.note}</textarea>
        <div class="row">
          <select name="status">${Object.entries(RSTATUS).map(([k, l]) => html`<option value="${k}" ${k === r.status ? raw('selected') : ''}>${l}</option>`)}</select>
          <button class="btn sm primary" type="submit">保存</button>
          ${r.barcode ? html`<button class="btn sm" data-act="fixProduct" data-barcode="${r.barcode}" data-name="${r.product_name}" data-brand="${r.brand}" data-raw="${r.raw}">修正到产品库</button>` : ''}
          ${r.raw ? html`<button class="btn sm" data-act="tryRaw" data-raw="${r.raw}">用规则包试算</button>` : ''}
        </div>
      </form></div>`) : html`<div class="card muted">这里是空的。</div>`}`
}
forms.report = async (f, v) => { await api('PATCH', `/reports/${f.dataset.id}`, v); toast('已保存'); render(); refreshBadges() }
actions.fixProduct = el => { state.prefill = { barcode: el.dataset.barcode, name: el.dataset.name, brand: el.dataset.brand, raw: el.dataset.raw }; state.tab.products = 'library'; location.hash = 'products' }
actions.tryRaw = el => { state.previewRaw = el.dataset.raw; state.tab.rules = 'preview'; location.hash = 'rules' }

// ---------- 产品库 ----------
pages.products = async () => {
  const tab = state.tab.products || 'queue'
  const tabs = html`<div class="tabs">${[['queue', '用户补录待审核'], ['library', '产品库']].map(([k, l]) =>
    html`<button class="btn sm ${tab === k ? 'on' : ''}" data-act="tab" data-page="products" data-tab="${k}">${l}</button>`)}</div>`
  const head = html`<div class="head"><div><h1>产品库与补录</h1><div class="muted">App 扫条形码时先查这里，再查 Open Beauty Facts。用户补录的产品审核通过后进入产品库。</div></div></div>`
  if (tab === 'queue') {
    const rows = await api('GET', '/submissions')
    return html`${head}${tabs}
      ${rows.length ? rows.map(s => html`<form class="card form" data-form="accept" data-id="${s.id}">
        <div class="row spread"><b>条形码 ${s.barcode}</b><span class="item-meta">${time(s.ts)}${s.same_barcode > 1 ? ` · 共 ${s.same_barcode} 人补录过这个条形码` : ''}${s.in_library ? ' · 产品库里已有' : ''}</span></div>
        <div class="form cols"><label>名称<input name="name" value="${s.name}"></label><label>品牌<input name="brand" value="${s.brand}"></label></div>
        <label>成分表（用户拍照或手打的，可以先改再采纳）<textarea name="raw">${s.raw}</textarea></label>
        <div class="row"><button class="btn sm primary" type="submit">采纳到产品库</button><button class="btn sm danger" data-act="reject" data-id="${s.id}">拒绝</button></div>
      </form>`) : html`<div class="card muted">没有待审核的补录。</div>`}`
  }
  const q = state.productQuery || ''
  const rows = await api('GET', `/products?q=${encodeURIComponent(q)}`)
  const p = state.prefill || { barcode: '', name: '', brand: '', raw: '' }
  state.prefill = null
  return html`${head}${tabs}
    <form class="card form" data-form="product">
      <h2>${p.barcode ? '修正产品' : '新增 / 修改产品'}</h2>
      <div class="form cols"><label>条形码<input name="barcode" value="${p.barcode}" required pattern="\\d{6,20}"></label><label>名称<input name="name" value="${p.name}" required></label><label>品牌<input name="brand" value="${p.brand}"></label></div>
      <label>成分表（按包装原样，用逗号分隔）<textarea name="raw" required>${p.raw}</textarea></label>
      <div class="row"><button class="btn primary" type="submit">保存</button><span class="small muted">同一个条形码再保存一次就是修改</span></div>
    </form>
    <div class="card"><form class="row" data-form="productSearch"><input name="q" value="${q}" placeholder="搜条形码、名称、品牌"><button class="btn sm" type="submit">搜索</button></form>
      ${rows.length ? html`<div class="table-wrap"><table><tr><th>条形码</th><th>名称</th><th>品牌</th><th>来源</th><th>更新</th><th></th></tr>
        ${rows.map(r => html`<tr><td class="mono">${r.barcode}</td><td>${r.name}</td><td>${r.brand}</td><td>${r.source === 'user' ? '用户补录' : '后台录入'}</td><td>${day(r.updated_at)}</td>
          <td class="row"><button class="btn sm" data-act="fixProduct" data-barcode="${r.barcode}" data-name="${r.name}" data-brand="${r.brand}" data-raw="${r.raw}">编辑</button>
          <button class="btn sm danger" data-act="delProduct" data-barcode="${r.barcode}">删除</button></td></tr>`)}</table></div>` : html`<p class="muted">产品库还是空的。</p>`}
    </div>`
}
forms.accept = async (f, v) => { await api('POST', `/submissions/${f.dataset.id}/accept`, v); toast('已加入产品库'); render(); refreshBadges() }
actions.reject = async el => { await api('POST', `/submissions/${el.dataset.id}/reject`); toast('已拒绝'); render(); refreshBadges() }
forms.product = async (f, v) => { await api('PUT', `/products/${encodeURIComponent(v.barcode)}`, v); toast('已保存'); render() }
forms.productSearch = (f, v) => { state.productQuery = v.q; return render() }
actions.delProduct = async el => { if (!confirm(`删除条形码 ${el.dataset.barcode}？`)) return; await api('DELETE', `/products/${el.dataset.barcode}`); render() }

// ---------- 未识别成分 ----------
pages.unknowns = async () => {
  const tab = state.tab.unknowns || 'new'
  const u = await api('GET', `/unknowns?status=${tab}`)
  return html`
    <div class="head"><div><h1>未识别成分</h1><div class="muted">用户查产品时，规则包不认识的成分名。按「多少台设备遇到过」排序，越靠前越该先处理。</div></div><a class="btn sm" href="/admin/api/export/unknowns.csv">导出 CSV</a></div>
    <div class="callout small">处理方式：① 它是已有成分的另一种写法（比如 vitamin b5 = panthenol）→「映射」；② 是新成分 →「新增到成分组」，不需要规则的放进 <code>base</code> 组；③ 不是成分（错字、乱码）→「忽略」。改动先进草稿，到「规则包」点发布后，用户 App 才会更新。</div>
    ${tab === 'new' && u.rows.length ? html`<div class="row" style="margin-bottom:12px"><button class="btn primary" data-act="suggestUnknowns">✦ AI 建议标准名（本页前 40 个）</button>
      <span class="small muted">AI 只帮你填好表单，确认后还要你自己点「映射」或「新增」。</span></div>` : ''}
    <div class="tabs">${[['new', '待处理'], ['mapped', '已处理'], ['ignored', '已忽略']].map(([k, l]) =>
      html`<button class="btn sm ${tab === k ? 'on' : ''}" data-act="tab" data-page="unknowns" data-tab="${k}">${l}</button>`)}</div>
    <datalist id="inci-list">${u.inci.map(i => html`<option value="${i}">`)}</datalist>
    <div class="card">${u.rows.length ? html`<div class="table-wrap"><table>
      <tr><th>成分名（用户标签上的写法）</th><th class="num">设备数</th><th class="num">次数</th><th>最近</th><th>${tab === 'new' ? '处理' : '结果'}</th></tr>
      ${u.rows.map(r => html`<tr><td><b>${r.token}</b>${state.suggest?.[r.token] ? html`<div class="small" style="color:var(--good)">AI：${state.suggest[r.token].inci || '不是成分'}${state.suggest[r.token].group ? ` → ${state.suggest[r.token].group}` : ''}<br><span class="muted">${state.suggest[r.token].note}</span></div>` : ''}</td><td class="num">${r.installs}</td><td class="num">${r.count}</td><td>${day(r.last_ts)}</td><td>
        ${tab === 'new' ? html`
          <form class="row" data-form="mapUnknown" data-token="${r.token}"><input name="inci" list="inci-list" placeholder="映射到已有成分" size="18" value="${state.suggest?.[r.token]?.exists ? state.suggest[r.token].inci : ''}"><button class="btn sm" type="submit">映射</button></form>
          <form class="row" data-form="addUnknown" data-token="${r.token}" style="margin-top:4px"><select name="group">${u.groups.map(g => html`<option ${g === (state.suggest?.[r.token]?.group || 'base') ? raw('selected') : ''}>${g}</option>`)}</select><input name="inci" placeholder="标准名（可不填）" size="14" value="${state.suggest?.[r.token] && !state.suggest[r.token].exists ? state.suggest[r.token].inci : ''}"><button class="btn sm" type="submit">新增到成分组</button>
          <button class="btn sm" data-act="ignoreUnknown" data-token="${r.token}">忽略</button></form>`
        : html`${r.mapped_to || '已忽略'} <button class="link small" data-act="reopenUnknown" data-token="${r.token}">撤回</button>`}
      </td></tr>`)}</table></div>` : html`<p class="muted">没有了。</p>`}</div>`
}
actions.suggestUnknowns = async () => {
  const tokens = [...document.querySelectorAll('[data-form=mapUnknown]')].map(f => f.dataset.token).slice(0, 40)
  toast('AI 正在识别…')
  const list = await api('POST', '/unknowns/suggest', { tokens })
  state.suggest = Object.fromEntries(list.map(x => [x.token, x]))
  toast(`已给出 ${list.length} 条建议，逐条确认后点「映射」或「新增」`)
  render()
}
const unk = (token, action, body) => api('POST', `/unknowns/${encodeURIComponent(token)}/${action}`, body)
forms.mapUnknown = async (f, v) => { await unk(f.dataset.token, 'map', v); toast('已映射，记得去规则包发布'); render(); refreshBadges() }
forms.addUnknown = async (f, v) => { await unk(f.dataset.token, 'add', v); toast('已加入草稿，记得去规则包发布'); render(); refreshBadges() }
actions.ignoreUnknown = async el => { await unk(el.dataset.token, 'ignore'); render(); refreshBadges() }
actions.reopenUnknown = async el => { await unk(el.dataset.token, 'reopen'); render(); refreshBadges() }

// ---------- 规则包 ----------
let rp = null // { draft, errors, changed, published, nextVersion, history }
async function saveDraft(msg) {
  const r = await api('PUT', '/rule-pack/draft', { pack: rp.draft })
  toast(r.errors.length ? `已保存草稿，但有 ${r.errors.length} 个问题` : msg || '已保存草稿', r.errors.length > 0)
  return render()
}
const appliesText = a => [
  a.age_band ? a.age_band.map(b => `${b} 岁`).join('、') : '',
  a.life_stage ? a.life_stage.map(s => STAGES[s]).join('、') : '',
  a.concern ? a.concern.map(c => CONCERNS[c] || c).join('、') : '',
].filter(Boolean).join(' · ') || '所有人'

pages.rules = async () => {
  rp = await api('GET', '/rule-pack')
  const tab = state.tab.rules || 'rules'
  const d = rp.draft
  const TABS = [['rules', `规则（${d.rules.length}）`], ['routine', '流程规则'], ['groups', '成分组'], ['aliases', '别名'], ['messages', '文案'], ['preview', '试算'], ['json', 'JSON'], ['history', '发布历史']]
  const body = await ruleTabs[tab](d)
  return html`
    <div class="head"><div><h1>规则包</h1><div class="muted">规则决定每个家人看到的结论。改动先存草稿，发布后 App 下次打开时自动更新，不用重新上架。</div></div></div>
    <div class="card">
      <div class="row spread">
        <div>线上版本 <b>v${rp.published.version}</b> <span class="muted small">${time(rp.published.published_at)} ${rp.published.note}</span><br>
          ${rp.changed ? html`<span class="tag warn">草稿有未发布的改动</span> 发布后版本号为 v${rp.nextVersion}` : html`<span class="tag good">草稿和线上一致</span>`}</div>
        ${rp.changed ? html`<form class="row" data-form="publish"><input name="note" placeholder="这次改了什么（可选）" size="24"><button class="btn primary" type="submit" ${rp.errors.length ? raw('disabled') : ''}>发布 v${rp.nextVersion}</button></form>` : ''}
      </div>
      ${rp.errors.length ? html`<div class="callout warn" style="margin:10px 0 0"><b>草稿有 ${rp.errors.length} 个问题，修好才能发布：</b><ul>${rp.errors.map(e => html`<li class="mono">${e}</li>`)}</ul></div>` : ''}
      <div class="callout small" style="margin:10px 0 0">${d.status}</div>
    </div>
    <div class="tabs">${TABS.map(([k, l]) => html`<button class="btn sm ${tab === k ? 'on' : ''}" data-act="tab" data-page="rules" data-tab="${k}">${l}</button>`)}</div>
    ${body}`
}
forms.publish = async (f, v) => {
  if (!confirm(`发布 v${rp.nextVersion}？所有用户的 App 会在下次打开时用上新规则。`)) return
  const r = await api('POST', '/rule-pack/publish', v)
  toast(`已发布 v${r.version}`)
  render(); refreshBadges()
}

const ruleTabs = {}
ruleTabs.rules = d => {
  const editing = state.editRule
  const r = editing === '__new' ? { id: '', group: d.groups[0]?.id, severity: 'care', message_key: '', applies_to: {}, sources: [], reviewed_by: null, reviewed_at: null }
    : d.rules.find(x => x.id === editing)
  return html`
    ${r ? ruleForm(d, r) : ''}
    <div class="card"><div class="row spread"><h2>规则</h2><button class="btn sm" data-act="editRule" data-id="__new">+ 新增规则</button></div>
    <div class="table-wrap"><table>
      <tr><th>编号</th><th>适用人群</th><th>成分组</th><th>结论</th><th>来源</th><th>医生审核</th><th></th></tr>
      ${d.rules.map(x => html`<tr>
        <td class="mono">${x.id}</td><td>${appliesText(x.applies_to)}</td><td>${x.group}</td><td>${sev(x.severity)}</td>
        <td>${x.sources.map(s => html`<span class="tag ${/TODO/i.test(s.ref) ? 'warn' : ''}" title="${s.ref}">${s.org}${/TODO/i.test(s.ref) ? ' · 待补' : ''}</span>`)}</td>
        <td>${x.reviewed_by ? html`<span class="tag good">${x.reviewed_by} ${x.reviewed_at}</span>` : html`<span class="tag warn">未审核</span>`}</td>
        <td><button class="btn sm" data-act="editRule" data-id="${x.id}">编辑</button></td></tr>`)}
    </table></div></div>`
}
function ruleForm(d, r) {
  const a = r.applies_to || {}
  const checks = (name, opts, cur) => Object.entries(opts).map(([k, l]) => html`<label class="inline"><input type="checkbox" name="${name}" value="${k}" ${cur?.includes(k) ? raw('checked') : ''}> ${l}</label>`)
  return html`<form class="card form" data-form="rule" data-id="${r.id}">
    <h2>${r.id ? `编辑规则 ${r.id}` : '新增规则'}</h2>
    <div class="form cols">
      <label>编号<input name="id" value="${r.id}" required pattern="[A-Z0-9-]+" placeholder="R-XXX-AGE-01"></label>
      <label>成分组<select name="group">${d.groups.filter(g => g.id !== 'base').map(g => html`<option ${g.id === r.group ? raw('selected') : ''}>${g.id}</option>`)}</select></label>
      <label>结论<select name="severity">${Object.entries(SEV).filter(([k]) => k !== 'unsupported').map(([k, l]) => html`<option value="${k}" ${k === r.severity ? raw('selected') : ''}>${l}</option>`)}</select></label>
      <label>文案<select name="message_key">${Object.keys(d.messages).map(k => html`<option ${k === r.message_key ? raw('selected') : ''}>${k}</option>`)}</select></label>
    </div>
    <p class="small muted">${d.messages[r.message_key] || ''}</p>
    <div><div class="small muted">年龄段（都不勾 = 所有年龄）</div><div class="row">${checks('age_band', Object.fromEntries(BANDS.map(b => [b, `${b} 岁`])), a.age_band)}</div></div>
    <div><div class="small muted">人生阶段（勾了 = 只对这些人生效）</div><div class="row">${checks('life_stage', STAGES, a.life_stage)}</div></div>
    <div><div class="small muted">皮肤情况（勾了 = 只对这些人生效）</div><div class="row">${checks('concern', CONCERNS, a.concern)}</div></div>
    <label>来源（每行一条：机构 | 链接或文献）<textarea name="sources">${r.sources.map(s => `${s.org} | ${s.ref}`).join('\n')}</textarea></label>
    <div class="form cols"><label>审核医生（签字后填姓名）<input name="reviewed_by" value="${r.reviewed_by || ''}" placeholder="例如 Dr. Jane Doe, MD"></label>
      <label>审核日期<input name="reviewed_at" type="date" value="${r.reviewed_at || ''}"></label></div>
    <p class="small muted">改了成分组、结论、人群、文案或来源后，审核签字会自动清空，需要医生重新确认。</p>
    <div class="row"><button class="btn primary" type="submit">保存到草稿</button><button class="btn" data-act="editRule" data-id="">取消</button>
      ${r.id ? html`<button class="btn danger" data-act="deleteRule" data-id="${r.id}">删除这条规则</button>` : ''}</div>
  </form>`
}
actions.editRule = el => { state.editRule = el.dataset.id || null; return render() }
forms.rule = async f => {
  const fd = new FormData(f)
  const list = k => fd.getAll(k)
  const applies = {}
  if (list('age_band').length) applies.age_band = list('age_band')
  if (list('life_stage').length) applies.life_stage = list('life_stage')
  if (list('concern').length) applies.concern = list('concern')
  const sources = String(fd.get('sources')).split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const [org, ...ref] = l.split('|')
    return { org: org.trim(), ref: ref.join('|').trim() || 'TODO' }
  })
  const next = {
    id: String(fd.get('id')).trim(), group: fd.get('group'), applies_to: applies, severity: fd.get('severity'),
    message_key: fd.get('message_key'), sources, reviewed_by: String(fd.get('reviewed_by')).trim() || null, reviewed_at: fd.get('reviewed_at') || null,
  }
  const old = rp.draft.rules.find(x => x.id === f.dataset.id)
  const substance = x => JSON.stringify([x.group, x.applies_to, x.severity, x.message_key, x.sources])
  if (old && old.reviewed_by && next.reviewed_by === old.reviewed_by && substance(old) !== substance(next)) {
    next.reviewed_by = null
    next.reviewed_at = null
  }
  if (next.reviewed_by && !next.reviewed_at) next.reviewed_at = new Date().toISOString().slice(0, 10)
  if (!f.dataset.id && rp.draft.rules.some(x => x.id === next.id)) throw new Error('这个编号已经存在')
  rp.draft.rules = old ? rp.draft.rules.map(x => (x.id === old.id ? next : x)) : [...rp.draft.rules, next]
  state.editRule = null
  return saveDraft()
}
actions.deleteRule = el => {
  if (!confirm(`删除规则 ${el.dataset.id}？（发布前都可以从「发布历史」恢复）`)) return
  rp.draft.rules = rp.draft.rules.filter(x => x.id !== el.dataset.id)
  state.editRule = null
  return saveDraft('已删除')
}

ruleTabs.routine = d => html`<div class="card"><h2>流程规则</h2>
  <p class="small muted">「流程体检」用的规则：重复活性成分、视黄醇+酸、早上没防晒、步骤太多。字段较少改，直接改 JSON。</p>
  <form class="form" data-form="routineJson"><textarea class="code" name="json">${JSON.stringify(d.routine_rules, null, 2)}</textarea><div><button class="btn primary" type="submit">保存到草稿</button></div></form></div>`
forms.routineJson = (f, v) => { rp.draft.routine_rules = JSON.parse(v.json); return saveDraft() }

ruleTabs.groups = d => html`
  <div class="callout small">成分组 = 一类作用相同的成分。规则按组生效，比如 retinoids 组里的成分都会触发视黄醇规则。<code>base</code> 组是「已知但不需要提醒」的成分。成分名一律小写，用 INCI 标准名，每行一个。</div>
  ${d.groups.map(g => html`<form class="card form" data-form="group" data-id="${g.id}">
    <div class="row spread"><b class="mono">${g.id}</b><span class="small muted">${g.members.length} 个成分 · ${d.rules.filter(r => r.group === g.id).length} 条规则用到</span></div>
    <label>作用（逗号分隔，App 成分说明里显示）<input name="functions" value="${(g.functions || []).join(', ')}"></label>
    <label>成分（每行一个）<textarea name="members" rows="${Math.min(14, g.members.length + 1)}">${g.members.join('\n')}</textarea></label>
    <div><button class="btn sm primary" type="submit">保存到草稿</button></div></form>`)}
  <form class="card row" data-form="newGroup"><input name="id" placeholder="新成分组 id，如 peptides" pattern="[a-z_]+" required><button class="btn sm" type="submit">新增成分组</button></form>`
forms.group = (f, v) => {
  const g = rp.draft.groups.find(x => x.id === f.dataset.id)
  g.functions = v.functions.split(',').map(s => s.trim()).filter(Boolean)
  g.members = [...new Set(v.members.split('\n').map(s => s.trim().toLowerCase()).filter(Boolean))]
  return saveDraft()
}
forms.newGroup = (f, v) => {
  if (rp.draft.groups.some(g => g.id === v.id)) throw new Error('已存在')
  rp.draft.groups.push({ id: v.id, functions: [], members: [] })
  return saveDraft()
}

ruleTabs.aliases = d => {
  const rows = Object.entries(d.aliases).sort()
  return html`<div class="card"><h2>别名（${rows.length}）</h2>
    <p class="small muted">标签上的写法 → 规则包里的标准成分名。例如 water → aqua、vitamin c → ascorbic acid。</p>
    <form class="row" data-form="alias"><input name="alias" placeholder="标签上的写法" required><span>→</span><input name="inci" list="inci-all" placeholder="标准成分名" required><button class="btn sm primary" type="submit">添加</button></form>
    <datalist id="inci-all">${[...new Set(d.groups.flatMap(g => g.members))].sort().map(i => html`<option value="${i}">`)}</datalist>
    <div class="table-wrap"><table>${rows.map(([a, t]) => html`<tr><td>${a}</td><td>→ ${t}</td><td><button class="btn sm danger" data-act="delAlias" data-alias="${a}">删除</button></td></tr>`)}</table></div></div>`
}
forms.alias = (f, v) => { rp.draft.aliases[v.alias.trim().toLowerCase()] = v.inci.trim().toLowerCase(); return saveDraft() }
actions.delAlias = el => { delete rp.draft.aliases[el.dataset.alias]; return saveDraft() }

const MSG_LANGS = [['en', 'English（原文）'], ['zh-Hans', '简体中文'], ['zh-Hant', '繁體中文'], ['es', 'Español']]
ruleTabs.messages = d => {
  const lang = state.msgLang || 'en'
  const tr = (d.translations || {})[lang] || {}
  const missing = lang === 'en' ? 0 : Object.keys(d.messages).filter(k => !tr[k]).length
  return html`
  <div class="callout small">App 里给用户看的解释文字。英文是医生审核的原文，其他语言是翻译；某条没有翻译时，App 显示英文。规定：不用 toxic / safe / dangerous（有毒 / 安全 / 危险）这类吓人的词，只说「适不适合」和原因。<b>改了英文原文，记得同步改各语言的翻译。</b></div>
  <div class="tabs">${MSG_LANGS.map(([k, l]) => html`<button class="btn sm ${lang === k ? 'on' : ''}" data-act="msgLang" data-lang="${k}">${l}</button>`)}</div>
  ${missing ? html`<p class="small err">${missing} 条还没有${MSG_LANGS.find(x => x[0] === lang)[1]}翻译，App 会显示英文。</p>` : ''}
  <form class="card form" data-form="messages" data-lang="${lang}">
    ${Object.entries(d.messages).map(([k, m]) => lang === 'en'
      ? html`<label><span class="mono">${k}</span><textarea name="${k}" rows="2">${m}</textarea></label>`
      : html`<label><span class="mono">${k}</span><span class="small muted" style="color:var(--muted)">${m}</span><textarea name="${k}" rows="2" placeholder="（未翻译，显示英文）">${tr[k] || ''}</textarea></label>`)}
    <div class="row">${lang === 'en' ? html`<input name="__new_key" placeholder="新文案的 key，如 peptide_young" pattern="[a-z_]*">` : ''}<button class="btn primary" type="submit">保存到草稿</button></div>
  </form>`
}
actions.msgLang = el => { state.msgLang = el.dataset.lang; return render() }
forms.messages = (f, v) => {
  const lang = f.dataset.lang
  if (lang === 'en') {
    const { __new_key, ...rest } = v
    rp.draft.messages = { ...rest }
    if (__new_key) rp.draft.messages[__new_key] = rp.draft.messages[__new_key] || 'TODO'
  } else {
    rp.draft.translations = rp.draft.translations || {}
    rp.draft.translations[lang] = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.trim()]).filter(([, x]) => x))
  }
  return saveDraft()
}

ruleTabs.preview = async () => {
  const p = state.preview
  const rawText = state.previewRaw ?? 'Aqua, Glycerin, Retinol, Glycolic Acid, Parfum, Sodium Hyaluronate'
  const m = state.previewMember || { ageBand: '8-12' }
  let result = ''
  if (p) {
    const card = (title, r) => r.errors ? html`<div class="card"><h3>${title}</h3><p class="err">草稿有错误，先修好</p></div>` : html`<div class="card"><h3>${title}</h3>${sev(r.verdicts[0].severity)}
      ${r.verdicts[0].reasons.map(x => html`<p class="small">${sev(x.severity)} <span class="mono">${x.ruleId}</span> ${x.message}<br><span class="muted">因为：${x.ingredients.join(', ')}</span></p>`)}</div>`
    result = html`<div class="grid two">${card('草稿规则', p.draft)}${card(`线上规则 v${rp.published.version}`, p.published)}</div>
      ${p.normalized ? html`<div class="card small"><b>认出的成分：</b>${p.normalized.inci.join(', ')}<br><b>不认识：</b>${p.normalized.unknown.join(', ') || '无'}</div>` : ''}`
  }
  return html`<form class="card form" data-form="preview">
    <h2>试算：这个产品对某位家人是什么结论？</h2>
    <label>成分表<textarea name="raw">${rawText}</textarea></label>
    <div class="row">
      <label>年龄段<select name="ageBand">${BANDS.map(b => html`<option ${b === m.ageBand ? raw('selected') : ''}>${b}</option>`)}</select></label>
      <label>人生阶段<select name="lifeStage"><option value="">无</option>${Object.entries(STAGES).map(([k, l]) => html`<option value="${k}" ${k === m.lifeStage ? raw('selected') : ''}>${l}</option>`)}</select></label>
      ${Object.entries(CONCERNS).map(([k, l]) => html`<label class="inline"><input type="checkbox" name="c_${k}" ${m.concerns?.includes(k) ? raw('checked') : ''}> ${l}</label>`)}
      <button class="btn primary" type="submit">试算</button>
    </div></form>${result}`
}
forms.preview = async (f, v) => {
  const member = { ageBand: v.ageBand, lifeStage: v.lifeStage || undefined, concerns: Object.keys(CONCERNS).filter(k => v[`c_${k}`]) }
  state.previewRaw = v.raw
  state.previewMember = member
  state.preview = await api('POST', '/preview', { raw: v.raw, member })
  return render()
}

ruleTabs.json = d => html`<div class="card"><h2>整个草稿（高级）</h2><p class="small muted">直接改 JSON，适合批量操作。保存前会检查格式。</p>
  <form class="form" data-form="draftJson"><textarea class="code" name="json">${JSON.stringify(d, null, 2)}</textarea><div><button class="btn primary" type="submit">保存到草稿</button></div></form></div>`
forms.draftJson = (f, v) => {
  try { rp.draft = JSON.parse(v.json) } catch (e) { throw new Error('JSON 格式错误：' + e.message) }
  return saveDraft()
}

ruleTabs.history = () => html`<div class="card"><h2>发布历史</h2>
  <p class="small muted">「载入到草稿」可以回滚：载入旧版本后再发布一次（会用新的版本号）。</p>
  <table><tr><th>版本</th><th>发布时间</th><th>说明</th><th></th></tr>
  ${rp.history.map(h => html`<tr><td class="mono">v${h.version}</td><td>${time(h.published_at)}</td><td>${h.note}</td>
    <td><button class="btn sm" data-act="loadVersion" data-version="${h.version}">载入到草稿</button></td></tr>`)}</table></div>`
actions.loadVersion = async el => {
  if (!confirm(`用 v${el.dataset.version} 覆盖当前草稿？`)) return
  await api('POST', '/rule-pack/load', { version: el.dataset.version })
  toast('已载入，确认后点发布')
  render()
}

// ---------- 测肤 ----------
const DIM_LABELS = { dark_circles: '黑眼圈', sensitivity: '敏感泛红', acne: '痘痘', pigmentation: '色沉色斑', wrinkles: '细纹皱纹', blackheads: '黑头', oiliness: '油光', eye_bags: '眼袋', pores: '毛孔' }
const TYPE_LABELS = { dry: '干性', normal: '中性', combination: '混合性', oily: '油性', sensitive: '敏感性' }
const KIND_LABELS = { skin: 'AI 测肤', advice: 'AI 搭配建议', ocr: '拍成分表' }
pages.skin = async () => {
  const n = Math.max(state.days, 30)
  const s = await api('GET', `/skin?days=${n}`)
  return html`
    <div class="head"><div><h1>测肤</h1><div class="muted">照片不保存，这里只有分数和调用记录</div></div>${rangeTabs(n, [30, 90, 365])}</div>
    <div class="grid">
      ${stat('注册用户', num(s.users), `最近 ${s.days} 天新增 ${num(s.newUsers)} · 有效会员 ${num(s.pro)}`)}
      ${stat('测肤次数', num(s.tests), `${num(s.testers)} 人测过`)}
      ${stat('平均总分', s.avgOverall ?? '—', '分数越高皮肤状态越好')}
    </div>
    <div class="grid two">
      <div class="card"><h2>每日测肤</h2>${chart(s.daily, 'tests', '测肤')}</div>
      <div class="card"><h2>AI 调用和花费</h2>${s.ai.length ? html`<table><tr><th>用途</th><th class="num">次数</th><th class="num">失败</th><th class="num">平均耗时</th><th class="num">花费</th></tr>
        ${s.ai.map(r => html`<tr><td>${KIND_LABELS[r.kind] || r.kind}</td><td class="num">${num(r.calls)}</td><td class="num">${num(r.failed)}</td><td class="num">${num(r.avg_ms)}ms</td><td class="num">${money(r.cost)}</td></tr>`)}</table>` : html`<p class="muted">暂无</p>`}</div>
      <div class="card"><h2>用户肤质分布</h2>${hbars(s.types, TYPE_LABELS)}</div>
      <div class="card"><h2>各维度平均分（低的排前面）</h2>${s.dims.length ? s.dims.map(x => html`<div class="hbar"><span>${DIM_LABELS[x.k] || x.k}</span><span class="track"><i style="width:${x.avg}%"></i></span><span class="num">${x.avg}</span></div>`) : html`<p class="muted">暂无</p>`}
        <p class="small muted">分数最低的维度，是用户最普遍的困扰，可以用来定落地页和广告的主打卖点。</p></div>
    </div>
    <div class="card"><h2>测肤失败原因</h2>${s.errors.length ? html`<table>${s.errors.map(e => html`<tr><td>${e.error}</td><td class="num">${e.n}</td></tr>`)}</table>` : html`<p class="muted">没有失败</p>`}</div>`
}

// ---------- 用户 ----------
pages.users = async () => {
  const q = state.userQuery || ''
  const [rows, codes] = await Promise.all([api('GET', `/users?q=${encodeURIComponent(q)}`), api('GET', '/dev-codes')])
  const now = Date.now()
  return html`
    <div class="head"><div><h1>用户</h1><div class="muted">注册账号。家人信息、产品和测肤报告存在用户自己的账号下。</div></div></div>
    ${codes.length ? html`<div class="callout warn"><b>测试模式验证码</b>（还没配 Resend，邮件不会真的发出，登录时用这里的码）
      <table>${codes.map(x => html`<tr><td>${x.email}</td><td class="mono" style="font-size:18px">${x.dev_code}</td><td class="small muted">${time(x.expires)} 过期</td></tr>`)}</table></div>` : ''}
    <div class="card"><form class="row" data-form="userSearch"><input name="q" value="${q}" placeholder="搜邮箱或用户编号"><button class="btn sm" type="submit">搜索</button></form>
      ${rows.length ? html`<div class="table-wrap"><table>
        <tr><th>邮箱</th><th>登录方式</th><th>注册</th><th>最近活跃</th><th class="num">家人</th><th class="num">产品</th><th class="num">测肤</th><th>会员</th><th></th></tr>
        ${rows.map(u => html`<tr><td>${u.email || html`<span class="muted">(Apple 隐藏邮箱)</span>`}</td><td>${u.apple ? 'Apple' : '邮箱'}</td>
          <td>${day(u.created_at)}</td><td>${day(u.last_seen)}</td><td class="num">${u.members}</td><td class="num">${u.products}</td><td class="num">${u.reports}</td>
          <td>${u.pro_until && u.pro_until > now ? html`<span class="tag good">赠送至 ${day(u.pro_until)}</span>` : html`<span class="muted small">看 RevenueCat</span>`}</td>
          <td class="row"><button class="btn sm" data-act="grantPro" data-id="${u.id}" data-days="30">送 30 天</button>
            ${u.pro_until && u.pro_until > now ? html`<button class="btn sm danger" data-act="grantPro" data-id="${u.id}" data-days="0">取消赠送</button>` : ''}</td></tr>`)}
      </table></div>` : html`<p class="muted">还没有用户。</p>`}
      <p class="small muted">「送 30 天」用于测试或补偿：不经过苹果，直接让这个账号享有会员功能。真正付费的订阅状态在 RevenueCat 后台看。</p>
    </div>`
}
forms.userSearch = (f, v) => { state.userQuery = v.q; return render() }
actions.grantPro = async el => {
  const days = Number(el.dataset.days)
  if (days && !confirm(`给这个账号赠送 ${days} 天会员？`)) return
  await api('PATCH', `/users/${el.dataset.id}`, { pro_days: days })
  toast(days ? '已赠送' : '已取消')
  render()
}

// ---------- 问卷 ----------
const Q_LANGS = [['en', 'English（必填）'], ['zh-Hans', '简体中文'], ['zh-Hant', '繁體中文'], ['es', 'Español']]
let qs = null
// Called with a local list to re-render unsaved edits; render() calls it bare to load from the server.
pages.questions = async local => {
  qs = local || await api('GET', '/questions')
  const locInputs = (prefix, v) => Q_LANGS.map(([l, label]) => html`<label>${label}<input name="${prefix}.${l}" value="${v?.[l] || ''}" ${l === 'en' ? raw('required') : ''}></label>`)
  return html`
    <div class="head"><div><h1>测肤问卷</h1><div class="muted">用户拍照后要答的题。答案会和照片一起交给 AI，让报告更准。保存后立即生效。</div></div></div>
    <div class="callout small">每题至少 2 个选项。编号用小写英文（如 after_wash），发布后尽量不要改编号，否则历史答案对不上。没填的语言会显示英文。</div>
    <form data-form="questions">
      ${qs.map((q, i) => html`<div class="card form">
        <div class="row spread"><h2>第 ${i + 1} 题</h2><div class="row">
          ${i > 0 ? html`<button class="btn sm" data-act="moveQ" data-i="${i}" data-dir="-1">上移</button>` : ''}
          <button class="btn sm danger" data-act="delQ" data-i="${i}">删除这题</button></div></div>
        <div class="form cols"><label>编号<input name="q${i}.id" value="${q.id}" pattern="[a-z0-9_]+" required></label>
          <label>类型<select name="q${i}.type"><option value="single" ${q.type === 'single' ? raw('selected') : ''}>单选</option><option value="multi" ${q.type === 'multi' ? raw('selected') : ''}>多选</option></select></label></div>
        <div class="form cols">${locInputs(`q${i}.title`, q.title)}</div>
        <h3>选项</h3>
        ${q.options.map((o, j) => html`<div class="form cols" style="border-top:1px solid var(--line);padding-top:8px">
          <label>选项编号<input name="q${i}.o${j}.id" value="${o.id}" pattern="[a-z0-9_]+"></label>${locInputs(`q${i}.o${j}.label`, o.label)}</div>`)}
        <div><button class="btn sm" data-act="addOpt" data-i="${i}">+ 加一个选项</button></div>
      </div>`)}
      <div class="row"><button class="btn" data-act="addQ">+ 加一道题</button><button class="btn primary" type="submit">保存问卷</button></div>
    </form>`
}
function readQuestions(f) {
  const fd = new FormData(f)
  return qs.map((q, i) => ({
    id: fd.get(`q${i}.id`), type: fd.get(`q${i}.type`),
    title: Object.fromEntries(Q_LANGS.map(([l]) => [l, fd.get(`q${i}.title.${l}`) || ''])),
    options: q.options.map((_, j) => ({ id: fd.get(`q${i}.o${j}.id`), label: Object.fromEntries(Q_LANGS.map(([l]) => [l, fd.get(`q${i}.o${j}.label.${l}`) || ''])) })),
  }))
}
const qForm = () => document.querySelector('[data-form=questions]')
async function showQs() { main.innerHTML = fmt(await pages.questions(qs)) }
actions.addQ = () => { qs = readQuestions(qForm()); qs.push({ id: `q${qs.length + 1}`, type: 'single', title: { en: '' }, options: [{ id: 'a', label: { en: '' } }, { id: 'b', label: { en: '' } }] }); return showQs() }
actions.addOpt = el => { qs = readQuestions(qForm()); qs[+el.dataset.i].options.push({ id: `o${qs[+el.dataset.i].options.length + 1}`, label: { en: '' } }); return showQs() }
actions.delQ = el => { qs = readQuestions(qForm()); qs.splice(+el.dataset.i, 1); return showQs() }
actions.moveQ = el => { qs = readQuestions(qForm()); const i = +el.dataset.i; [qs[i - 1], qs[i]] = [qs[i], qs[i - 1]]; return showQs() }
forms.questions = async f => {
  const questions = readQuestions(f).map(q => ({ ...q, options: q.options.filter(o => o.id && o.label.en) }))
  const r = await api('PUT', '/questions', { questions })
  qs = r.questions
  toast('问卷已保存')
  render()
}

// ---------- 设置 ----------
pages.settings = async () => {
  const { settings: s, status } = await api('GET', '/settings')
  const chk = (name, on) => html`<input type="checkbox" name="${name}" ${on ? raw('checked') : ''}>`
  const ok = v => (v ? html`<span class="tag good">已配置</span>` : html`<span class="tag warn">未配置</span>`)
  return html`
    <div class="head"><div><h1>设置</h1><div class="muted">保存后立即生效：落地页和 App 每次打开都会读取</div></div></div>
    <form class="card form" data-form="settings">
      <h2>落地页与预售</h2>
      <div class="form cols">
        <label>Stripe 预售链接（Payment Link）<input name="checkoutUrl" value="${s.checkoutUrl}" placeholder="https://buy.stripe.com/..."></label>
        <label>联系邮箱<input name="contactEmail" value="${s.contactEmail}"></label>
        <label>App Store 链接（上架后填）<input name="appStoreUrl" value="${s.appStoreUrl}" placeholder="https://apps.apple.com/app/..."></label>
        <label>预售目标（止损线 G0）<input name="presaleTarget" type="number" min="1" value="${s.presaleTarget}"></label>
      </div>
      <p class="small muted">链接留空时，落地页按钮变成「加入等候名单」，只收邮箱、不收钱。</p>

      <h2 style="margin-top:12px">付费墙</h2>
      <label class="inline">${chk('paywallEnabled', s.paywallEnabled)} 开启付费墙（免费版有下面的限制，超出要订阅）</label>
      <div class="callout warn small">App Store 版本里的订阅（RevenueCat）配好、测试通过之前不要打开。打开后网页版用户会看到「去 iPhone App 订阅」。</div>
      <div class="form cols">
        <label>免费版每月可查产品数<input name="free.scansPerMonth" type="number" min="0" value="${s.free.scansPerMonth}"></label>
        <label>免费版最多家庭成员<input name="free.members" type="number" min="1" max="6" value="${s.free.members}"></label>
      </div>
      <label class="inline">${chk('free.showReasons', s.free.showReasons)} 免费版也能看结论原因和来源</label>
      <label class="inline">${chk('free.routine', s.free.routine)} 免费版也能用流程体检</label>

      <h2 style="margin-top:12px">拍照识别</h2>
      <div class="form cols">
        <label>每天最多成功识别次数<input name="ocrDailyCap" type="number" min="0" value="${s.ocrDailyCap}"></label>
        <label>输入价格（美元 / 百万 token）<input name="priceInputPerM" type="number" step="0.001" value="${s.priceInputPerM}"></label>
        <label>输出价格（美元 / 百万 token）<input name="priceOutputPerM" type="number" step="0.001" value="${s.priceOutputPerM}"></label>
      </div>
      <p class="small muted">价格只用来估算花费，按 DeepSeek 官网 deepseek-flash 的高峰价填写，实际账单以 DeepSeek 后台为准。</p>
      <div><button class="btn primary" type="submit">保存设置</button></div>
    </form>

    <div class="card"><h2>密钥（只存在服务器上，这里只显示有没有配）</h2>
      <table>
        <tr><td>后台密码</td><td>${ok(status.password)}</td><td class="small">改密码：<code>ssh -t -i ~/.ssh/resume.pem root@8.218.190.208 pearlkin-admin-password</code></td></tr>
        <tr><td>DeepSeek key</td><td>${ok(status.deepseekKey)}</td><td class="small">换 key：<code>ssh -t -i ~/.ssh/resume.pem root@8.218.190.208 pearlkin-set-key</code></td></tr>
        <tr><td>发信（Resend）</td><td>${ok(status.email)}</td><td class="small">
          ① 在 resend.com 注册，Domains 里添加 pearlwren.com，把它给的几条 DNS 记录加到阿里云解析<br>
          ② API Keys 里新建一个 key，运行 <code>ssh -t -i ~/.ssh/resume.pem root@8.218.190.208 pearlkin-set-secret RESEND_API_KEY</code> 粘贴进去<br>
          没配之前，登录验证码显示在「用户」页顶部</td></tr>
        <tr><td>RevenueCat</td><td>${ok(status.revenueCat)}</td><td class="small">App 上架、配好订阅后：RevenueCat → Project settings → API keys → Secret key（sk_ 开头），运行 <code>ssh -t -i ~/.ssh/resume.pem root@8.218.190.208 pearlkin-set-secret REVENUECAT_SECRET_KEY</code></td></tr>
        <tr><td>App 令牌</td><td>${ok(status.appToken)}</td><td class="small">部署时自动生成，不用管</td></tr>
        <tr><td>Stripe Webhook</td><td>${ok(status.stripeWebhook)}</td><td class="small">
          ① Stripe 后台 → Developers → Webhooks → Add endpoint，地址填 <code>https://pearlkin.pearlwren.com/api/stripe/webhook</code>，事件选 <code>checkout.session.completed</code> 和 <code>charge.refunded</code><br>
          ② 复制 Signing secret（whsec_ 开头），运行 <code>ssh -t -i ~/.ssh/resume.pem root@8.218.190.208 pearlkin-set-secret STRIPE_WEBHOOK_SECRET</code> 粘贴进去</td></tr>
      </table>
    </div>`
}
forms.settings = async f => {
  const fd = new FormData(f)
  const n = k => Number(fd.get(k))
  await api('PUT', '/settings', {
    checkoutUrl: fd.get('checkoutUrl'), contactEmail: fd.get('contactEmail'), appStoreUrl: fd.get('appStoreUrl'), presaleTarget: n('presaleTarget'),
    paywallEnabled: fd.has('paywallEnabled'),
    free: { scansPerMonth: n('free.scansPerMonth'), members: n('free.members'), showReasons: fd.has('free.showReasons'), routine: fd.has('free.routine') },
    ocrDailyCap: n('ocrDailyCap'), priceInputPerM: n('priceInputPerM'), priceOutputPerM: n('priceOutputPerM'),
  })
  toast('设置已保存')
  render()
}

// ---------- boot ----------
fetch('/admin/api/me', { credentials: 'same-origin' }).then(r => {
  if (r.ok) { $('#shell').hidden = false; render(); refreshBadges() } else showLogin()
}, showLogin)
