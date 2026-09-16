'use strict'

const ISSUE_KEY_RE = /^[A-Z][A-Z0-9]*-\d+$/
const DEFAULT_JQL = 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC'
const TEAM_JQL = 'statusCategory != Done ORDER BY updated DESC'

const WIDGET_TYPES = ['issues-list', 'count', 'breakdown', 'sprint', 'issue', 'trend', 'projects']
const GROUP_BY_FIELDS = ['status', 'assignee', 'priority', 'issuetype', 'project', 'resolution', 'components']
const BREAKDOWN_CHARTS = ['bar', 'pie']
const ISSUE_COLUMNS = ['key', 'summary', 'status', 'assignee', 'priority', 'type', 'updated']
const ISSUE_SORT_FIELDS = ['updated', 'created', 'priority', 'status']
const ISSUE_SORT_DIRS = ['asc', 'desc']
const TREND_DAYS = [7, 14, 30]
const MAX_DASHBOARDS = 10
const MAX_WIDGETS = 24
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/

const WIDGET_CATALOG = [
  {
    type: 'issues-list', title: 'Issue list', description: 'Tickets with JQL filters',
    fields: [
      { key: 'jql', label: 'JQL', type: 'jql', required: true, default: DEFAULT_JQL },
      { key: 'limit', label: 'Max rows', type: 'number', default: 10, min: 1, max: 50 },
      { key: 'columns', label: 'Columns', type: 'multiselect', options: ISSUE_COLUMNS, default: ['key', 'summary', 'status'] },
      { key: 'sortField', label: 'Sort by', type: 'select', options: ['', ...ISSUE_SORT_FIELDS], default: '' },
      { key: 'sortDir', label: 'Direction', type: 'select', options: ISSUE_SORT_DIRS, default: 'desc' },
    ],
  },
  {
    type: 'count', title: 'Count', description: 'Single number from a JQL query',
    fields: [
      { key: 'jql', label: 'JQL', type: 'jql', required: true, default: DEFAULT_JQL },
      { key: 'label', label: 'Label', type: 'text', default: 'Open issues' },
    ],
  },
  {
    type: 'breakdown', title: 'Breakdown chart', description: 'Group any JQL query by status, assignee, priority, type, project, resolution or components',
    fields: [
      { key: 'jql', label: 'JQL', type: 'jql', required: true, default: DEFAULT_JQL },
      { key: 'groupBy', label: 'Group by', type: 'select', options: GROUP_BY_FIELDS, default: 'status' },
      { key: 'chart', label: 'Chart', type: 'select', options: BREAKDOWN_CHARTS, default: 'bar' },
      { key: 'top', label: 'Top groups', type: 'number', default: 8, min: 2, max: 20 },
    ],
  },
  {
    type: 'sprint', title: 'Sprint', description: 'Active sprint progress for a board',
    fields: [
      { key: 'boardId', label: 'Board ID', type: 'number', required: true, min: 1 },
    ],
  },
  {
    type: 'issue', title: 'Issue spotlight', description: 'One ticket with details and recent comments',
    fields: [
      { key: 'key', label: 'Issue key', type: 'text', required: true, default: '' },
      { key: 'comments', label: 'Comments shown', type: 'number', default: 3, min: 0, max: 10 },
    ],
  },
  {
    type: 'trend', title: 'Trend', description: 'Created vs resolved per day',
    fields: [
      { key: 'jql', label: 'JQL filter', type: 'jql', required: true, default: DEFAULT_JQL },
      { key: 'days', label: 'Days', type: 'select', options: ['7', '14', '30'], default: '14' },
    ],
  },
  {
    type: 'projects', title: 'Projects', description: 'Projects with live open counts',
    fields: [
      { key: 'limit', label: 'Max projects', type: 'number', default: 6, min: 1, max: 8 },
    ],
  },
]

function templateLayouts() {
  return [
    {
      id: 'my-work', title: 'My work', description: 'My tickets, counts and status mix',
      layout: [
        { id: 'w-list', type: 'issues-list', title: 'My open issues', x: 0, y: 0, w: 8, h: 5, config: { jql: DEFAULT_JQL, limit: 10 } },
        { id: 'w-open', type: 'count', title: 'Open', x: 8, y: 0, w: 4, h: 2, config: { jql: DEFAULT_JQL, label: 'My open issues' } },
        { id: 'w-pie', type: 'breakdown', title: 'By status', x: 8, y: 2, w: 4, h: 3, config: { jql: DEFAULT_JQL, groupBy: 'status', chart: 'pie', top: 8 } },
      ],
    },
    {
      id: 'team', title: 'Team overview', description: 'All open work, bars and recent tickets',
      layout: [
        { id: 'w-bar', type: 'breakdown', title: 'Open by assignee', x: 0, y: 0, w: 7, h: 4, config: { jql: TEAM_JQL, groupBy: 'assignee', chart: 'bar', top: 8 } },
        { id: 'w-total', type: 'count', title: 'Total open', x: 7, y: 0, w: 5, h: 2, config: { jql: TEAM_JQL, label: 'Open issues' } },
        { id: 'w-recent', type: 'issues-list', title: 'Recently updated', x: 0, y: 4, w: 12, h: 4, config: { jql: TEAM_JQL, limit: 10 } },
      ],
    },
    { id: 'blank', title: 'Blank', description: 'Start empty with the + button', layout: [] },
  ]
}

let zanaRef = null

function text(value) {
  if (typeof value === 'string') return value
  if (value == null) return ''
  if (typeof value === 'object') return value.name || value.displayName || value.emailAddress || value.key || ''
  return String(value)
}

function summarize(issue) {
  const key = issue.key || text(issue.key) || ''
  const components = issue.components || issue.fields?.components
  return {
    key,
    project: (/^([A-Z][A-Z0-9]*)-\d+$/.exec(key) || [])[1] || '',
    summary: issue.summary || text(issue.fields?.summary) || '',
    status: text(issue.status || issue.fields?.status),
    statusCategory: text(issue.statusCategory || issue.fields?.status?.statusCategory),
    statusCategoryKey: issue.statusCategory?.key || issue.fields?.status?.statusCategory?.key || '',
    assignee: text(issue.assignee || issue.fields?.assignee),
    type: text(issue.issuetype || issue.issueType || issue.fields?.issuetype),
    priority: text(issue.priority || issue.fields?.priority),
    resolution: text(issue.resolution || issue.fields?.resolution),
    components: Array.isArray(components) ? components.map(c => text(c)).filter(Boolean) : [],
    created: issue.created || text(issue.fields?.created),
    updated: issue.updated || text(issue.fields?.updated),
    resolvedOn: text(issue.resolutiondate || issue.fields?.resolutiondate),
  }
}

function asArray(parsed) {
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object') {
    for (const k of ['issues', 'workitems', 'workItems', 'results', 'values', 'comments']) {
      if (Array.isArray(parsed[k])) return parsed[k]
    }
  }
  return []
}

// Atlassian Document Format (rich text) to plain text. Strings pass through;
// anything else degrades to text() so widgets never blank on shapes.
function adfText(node) {
  if (node == null) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(adfText).join('')
  if (typeof node !== 'object') return text(node)
  switch (node.type) {
    case 'doc':
    case 'blockquote':
      return (node.content || []).map(adfText).join('\n\n')
    case 'paragraph':
    case 'heading':
      return (node.content || []).map(adfText).join('')
    case 'bulletList':
    case 'orderedList':
      return (node.content || []).map(adfText).join('\n')
    case 'listItem':
      return `• ${(node.content || []).map(adfText).join('')}`
    case 'codeBlock':
      return (node.content || []).map(adfText).join('')
    case 'rule':
      return '---'
    case 'hardBreak':
      return '\n'
    case 'text':
      return node.text || ''
    case 'mention':
      return (node.attrs && (node.attrs.text || node.attrs.displayName)) || '@someone'
    case 'emoji':
      return (node.attrs && (node.attrs.text || node.attrs.shortName)) || ''
    case 'date':
      return String((node.attrs && node.attrs.timestamp) || '')
    case 'media':
    case 'mediaSingle':
    case 'mediaGroup':
      return (node.content || []).map(adfText).join('') || '[attachment]'
    default:
      if (Array.isArray(node.content)) return node.content.map(adfText).join('')
      return text(node)
  }
}

function plainDescription(obj) {
  const raw = (obj && obj.description !== undefined ? obj.description : obj?.fields?.description)
  if (typeof raw === 'string') return raw.slice(0, 2000)
  const converted = adfText(raw).replace(/\n{3,}/g, '\n\n').trim()
  if (converted) return converted.slice(0, 2000)
  return text(obj?.fields?.description).slice(0, 2000)
}

async function acliJson(argv) {
  const stdout = await zanaRef.proc.exec('acli', argv)
  try {
    return JSON.parse(stdout)
  } catch {
    throw new Error(`acli returned non-JSON output: ${stdout.slice(0, 200)}`)
  }
}

async function isAuthed() {
  try {
    await zanaRef.proc.exec('acli', ['auth', 'status'])
    return true
  } catch {
    return false
  }
}

async function getJql() {
  const raw = await zanaRef.settings.getOwn('jira.my-issues-jql')
  const s = String(raw || '').trim()
  return s || DEFAULT_JQL
}

async function getLimit() {
  const n = Number(await zanaRef.settings.getOwn('jira.max-results'))
  if (!Number.isFinite(n)) return 25
  return Math.min(100, Math.max(1, Math.floor(n)))
}

async function searchIssues(jql, limit) {
  const q = String(jql || '').trim()
  if (!q) throw new Error('jql is required.')
  if (q.length > 1000) throw new Error('jql exceeds 1000 chars.')
  const n = Math.min(100, Math.max(1, Number(limit) || 25))
  const parsed = await acliJson(['jira', 'workitem', 'search', '--jql', q, '--json', '--limit', String(n)])
  return asArray(parsed).map(summarize).filter(i => i.key)
}

async function myIssues(args) {
  const limit = args && args.limit != null ? args.limit : await getLimit()
  return searchIssues(await getJql(), limit)
}

async function issueDetail(key, commentLimit) {
  const k = String(key || '').trim().toUpperCase()
  if (!ISSUE_KEY_RE.test(k)) throw new Error(`Bad issue key '${key || ''}'. Use like TEAM-123.`)
  const parsed = await acliJson(['jira', 'workitem', 'view', k, '--json', '--fields', 'key,issuetype,summary,status,assignee,priority,description,created,updated,resolution,components,comment'])
  const obj = Array.isArray(parsed) ? parsed[0] : (parsed.issue || parsed.workitem || parsed)
  if (!obj) throw new Error(`Issue '${k}' not found.`)
  const base = summarize(obj)
  const n = Math.min(10, Math.max(0, Number(commentLimit ?? 3) || 0))
  // Comments ride along in the view response (newest last); a separate
  // `comment list` call trips the sandbox's mutating-verb guard on the word
  // `comment`, so it is deliberately not used here.
  const thread = asArray((obj.fields && obj.fields.comment) || obj.comment)
  const comments = thread.slice(-n).reverse().map(c => ({
    author: text(c.author || c.updateAuthor),
    created: text(c.created || c.updated),
    body: adfText(c.body).slice(0, 500),
  }))
  return {
    ...base,
    description: plainDescription(obj),
    comments: n > 0 ? comments : [],
  }
}

async function viewIssue(args) {
  // The List widget's Open button drives this command and renders the result
  // through the issue spotlight, so this must stay shape-compatible with
  // issueData(): full detail plus recent comments.
  return issueDetail(args && args.key, 3)
}

async function search(args) {
  return searchIssues(args.jql, args.limit != null ? args.limit : await getLimit())
}

function cleanJql(q) {
  const s = String(q || '').trim()
  if (!s) throw new Error('jql is required.')
  if (s.length > 1000) throw new Error('jql exceeds 1000 chars.')
  return s
}

async function countIssues(jql) {
  const q = cleanJql(jql)
  try {
    const stdout = await zanaRef.proc.exec('acli', ['jira', 'workitem', 'search', '--jql', q, '--count'])
    const m = /(\d[\d,]*)/.exec(stdout)
    if (m) return { value: Number(m[1].replace(/,/g, '')), exact: true }
  } catch {}
  const issues = await searchIssues(q, 100)
  return { value: issues.length, exact: issues.length < 100 }
}

const GROUP_BY_LABEL = { status: 'status', assignee: 'assignee', priority: 'priority', issuetype: 'type', project: 'project', resolution: 'resolution', components: 'components' }
const GROUP_BY_EXPLODE = new Set(['components'])

async function breakdown(jql, groupBy, top) {
  if (!GROUP_BY_FIELDS.includes(groupBy)) throw new Error(`groupBy must be one of: ${GROUP_BY_FIELDS.join(', ')}.`)
  const field = GROUP_BY_LABEL[groupBy]
  const issues = await searchIssues(cleanJql(jql), 100)
  const map = new Map()
  const add = (name) => {
    const key = (name || '—').trim() || '—'
    map.set(key, (map.get(key) || 0) + 1)
  }
  for (const i of issues) {
    const value = i[field]
    if (GROUP_BY_EXPLODE.has(groupBy) && Array.isArray(value)) {
      if (value.length === 0) add(null)
      else for (const v of value) add(v)
    } else {
      add(value)
    }
  }
  const n = Math.min(20, Math.max(2, Number(top) || 8))
  return {
    groupBy,
    items: [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, n),
    truncated: issues.length >= 100,
  }
}

async function widgetData(args) {
  const type = args && args.type
  const config = (args && args.config) || {}
  if (!WIDGET_TYPES.includes(type)) throw new Error(`Unknown widget type '${type}'.`)
  if (type === 'issues-list') {
    let jql = cleanJql(config.jql)
    if (config.sortField && ISSUE_SORT_FIELDS.includes(config.sortField) && !/order\s+by/i.test(jql)) {
      jql += ` ORDER BY ${config.sortField} ${config.sortDir === 'asc' ? 'ASC' : 'DESC'}`
    }
    return { issues: await searchIssues(jql, Math.min(50, Math.max(1, Number(config.limit) || 10))) }
  }
  if (type === 'count') {
    const c = await countIssues(config.jql)
    return { value: c.value, exact: c.exact, label: String(config.label || 'Count') }
  }
  if (type === 'sprint') return sprintData(config.boardId)
  if (type === 'issue') return issueData(config.key, config.comments)
  if (type === 'trend') return trendData(config.jql, config.days)
  if (type === 'projects') return projectsData(config.limit)
  const groups = await breakdown(config.jql, config.groupBy || 'status', config.top)
  return { ...groups, chart: BREAKDOWN_CHARTS.includes(config.chart) ? config.chart : 'bar' }
}

function isDoneIssue(i) {
  if (i.statusCategoryKey === 'done') return true
  return /done|closed|resolved/i.test(`${i.statusCategory || ''} ${i.status || ''}`)
}

async function sprintData(boardId) {
  const bid = Number(boardId)
  if (!Number.isInteger(bid) || bid <= 0) return { needsConfig: true }
  let sprints = []
  try {
    const board = await acliJson(['jira', 'board', 'view', '--id', String(bid), '--json'])
    const boardObj = Array.isArray(board) ? board[0] : board
    if (String(boardObj?.type || '').toLowerCase() !== 'scrum') {
      return { empty: true, boardId: bid, reason: 'Board has no sprints.' }
    }
    sprints = asArray(await acliJson(['jira', 'board', 'list-sprints', '--id', String(bid), '--state', 'active', '--json']))
  } catch (err) {
    if (/does not support sprints/i.test(err?.message || '')) {
      return { empty: true, boardId: bid, reason: 'Board has no sprints.' }
    }
    throw err
  }
  const active = sprints[0]
  if (!active || active.id == null) return { empty: true, boardId: bid }
  const items = asArray(await acliJson(['jira', 'sprint', 'list-workitems', '--board', String(bid), '--sprint', String(active.id), '--json', '--limit', '100']))
    .map(summarize).filter(i => i.key)
  const done = items.filter(isDoneIssue).length
  return {
    boardId: bid,
    sprint: { id: active.id, name: active.name || `Sprint ${active.id}`, state: active.state || 'active', startDate: active.startDate || null, endDate: active.endDate || null, goal: active.goal || '' },
    total: items.length,
    done,
    open: items.length - done,
  }
}

async function issueData(key, commentLimit) {
  const k = String(key || '').trim().toUpperCase()
  if (!ISSUE_KEY_RE.test(k)) return { needsConfig: true, key: '' }
  return issueDetail(k, commentLimit)
}

function stripOrderBy(jql) {
  return cleanJql(jql).replace(/\s+order\s+by\s+[\w\s,().'"+-]+$/i, '').trim()
}

function dayLabel(day) {
  return `${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
}

function dayStamp(day) {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
}

async function trendData(jql, days) {
  const d = [7, 14, 30].includes(Number(days)) ? Number(days) : 14
  const base = stripOrderBy(jql)
  if (!base) throw new Error('Trend widget needs a filter JQL.')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const starts = []
  for (let back = d - 1; back >= 0; back--) starts.push(new Date(today.getTime() - back * 86400000))
  const jobs = []
  for (let i = 0; i < starts.length; i++) {
    const from = dayStamp(starts[i])
    const to = i + 1 < starts.length ? dayStamp(starts[i + 1]) : dayStamp(new Date(today.getTime() + 86400000))
    jobs.push(countIssues(`${base} AND created >= ${from} AND created < ${to}`))
    jobs.push(countIssues(`${base} AND resolutiondate >= ${from} AND resolutiondate < ${to}`))
  }
  const results = await Promise.all(jobs)
  const buckets = starts.map((day, i) => ({
    label: dayLabel(day),
    created: results[i * 2] ? results[i * 2].value : 0,
    resolved: results[i * 2 + 1] ? results[i * 2 + 1].value : 0,
  }))
  return { days: d, buckets }
}

async function projectsData(limit) {
  const n = Math.min(8, Math.max(1, Number(limit) || 6))
  const all = asArray(await acliJson(['jira', 'project', 'list', '--limit', String(n), '--json'])).slice(0, n)
  const projects = all
    .map(p => ({ key: p.key || text(p.projectKey), name: p.name || text(p.projectName) || (p.key || '') }))
    .filter(p => p.key)
  const counts = await Promise.all(projects.map(p =>
    countIssues(`project = ${p.key} AND statusCategory != Done`).catch(() => ({ value: null, exact: false }))
  ))
  return { projects: projects.map((p, i) => ({ ...p, open: counts[i] ? counts[i].value : null })) }
}

// Pre-generic widgets migrate forward instead of being dropped: the old
// status-bar/status-pie become breakdown widgets grouped by status.
function migrateLegacyWidget(w) {
  if (!w || typeof w !== 'object') return null
  if (w.type === 'status-bar' || w.type === 'status-pie') {
    return {
      ...w,
      type: 'breakdown',
      config: { jql: (w.config && w.config.jql) || '', groupBy: 'status', chart: w.type === 'status-pie' ? 'pie' : 'bar', top: 8 },
    }
  }
  return w
}

function sanitizeWidget(w) {
  const migrated = migrateLegacyWidget(w)
  w = migrated || w
  if (!w || typeof w !== 'object' || !WIDGET_TYPES.includes(w.type)) {
    return { dropped: true, id: w && typeof w.id === 'string' ? w.id : undefined }
  }
  const id = typeof w.id === 'string' && ID_RE.test(w.id)
    ? w.id
    : `w_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6)}`
  const num = (v, d) => (Number.isInteger(v) ? v : d)
  const x = Math.min(11, Math.max(0, num(w.x, 0)))
  const y = Math.min(99, Math.max(0, num(w.y, 0)))
  const ww = Math.min(12, Math.max(1, num(w.w, 4)))
  const hh = Math.min(12, Math.max(1, num(w.h, 3)))
  const title = typeof w.title === 'string' && w.title.trim() ? w.title.trim().slice(0, 60) : w.type
  const src = (w.config && typeof w.config === 'object') ? w.config : {}
  const config = {}
  if (w.type === 'issues-list') {
    try { config.jql = cleanJql(src.jql) } catch { return { dropped: true, id } }
    config.limit = Math.min(50, Math.max(1, Number(src.limit) || 10))
    const cols = Array.isArray(src.columns) ? src.columns.filter(c => ISSUE_COLUMNS.includes(c)) : []
    config.columns = cols.length ? [...new Set(cols)] : ['key', 'summary', 'status']
    config.sortField = ISSUE_SORT_FIELDS.includes(src.sortField) ? src.sortField : ''
    config.sortDir = src.sortDir === 'asc' ? 'asc' : 'desc'
  } else if (w.type === 'count') {
    try { config.jql = cleanJql(src.jql) } catch { return { dropped: true, id } }
    config.label = typeof src.label === 'string' ? src.label.slice(0, 60) : 'Count'
  } else if (w.type === 'sprint') {
    config.boardId = Number.isInteger(Number(src.boardId)) && Number(src.boardId) > 0 ? Number(src.boardId) : null
  } else if (w.type === 'issue') {
    config.key = typeof src.key === 'string' && ISSUE_KEY_RE.test(src.key.trim().toUpperCase()) ? src.key.trim().toUpperCase() : ''
    config.comments = Math.min(10, Math.max(0, Number(src.comments ?? 3) || 0))
  } else if (w.type === 'trend') {
    try { config.jql = cleanJql(src.jql) } catch { return { dropped: true, id } }
    config.days = [7, 14, 30].includes(Number(src.days)) ? Number(src.days) : 14
  } else if (w.type === 'projects') {
    config.limit = Math.min(8, Math.max(1, Number(src.limit) || 6))
  } else {
    try { config.jql = cleanJql(src.jql) } catch { return { dropped: true, id } }
    config.groupBy = GROUP_BY_FIELDS.includes(src.groupBy) ? src.groupBy : 'status'
    config.chart = BREAKDOWN_CHARTS.includes(src.chart) ? src.chart : 'bar'
    config.top = Math.min(20, Math.max(2, Number(src.top) || 8))
  }
  return { id, type: w.type, title, x, y, w: Math.min(ww, 12 - x), h: hh, config }
}

async function getDashboards() {
  if (!(await isAuthed())) return { authed: false }
  let stored = null
  try {
    const raw = await zanaRef.kv.get('dashboards.v1')
    stored = raw && typeof raw === 'object' ? raw : null
  } catch { stored = null }
  let dashboards = Array.isArray(stored?.dashboards) ? stored.dashboards : null
  if (dashboards) {
    const clean = []
    for (const d of dashboards.slice(0, MAX_DASHBOARDS)) {
      if (!d || typeof d !== 'object' || typeof d.id !== 'string' || !ID_RE.test(d.id)) continue
      const layout = []
      for (const w of Array.isArray(d.layout) ? d.layout.slice(0, MAX_WIDGETS) : []) {
        const s = sanitizeWidget(w)
        if (!s.dropped) layout.push(s)
      }
      clean.push({ id: d.id, name: String(d.name || 'Dashboard').slice(0, 40), layout })
    }
    dashboards = clean.length ? clean : null
  }
  return {
    authed: true,
    dashboards,
    activeId: typeof stored?.activeId === 'string' ? stored.activeId : null,
    catalog: WIDGET_CATALOG,
    templates: templateLayouts().map(t => ({ id: t.id, title: t.title, description: t.description })),
  }
}

function templateLayout(id) {
  const t = templateLayouts().find(t => t.id === id)
  return t ? t.layout.map(w => ({ ...w, config: { ...w.config } })) : null
}

async function saveDashboards(args) {
  const list = args && args.dashboards
  if (!Array.isArray(list) || list.length > MAX_DASHBOARDS) throw new Error(`dashboards must be an array of max ${MAX_DASHBOARDS}.`)
  const dashboards = []
  const dropped = []
  for (const d of list) {
    if (!d || typeof d !== 'object' || typeof d.id !== 'string' || !ID_RE.test(d.id)) throw new Error('Dashboard needs an id.')
    const layout = []
    for (const w of Array.isArray(d.layout) ? d.layout.slice(0, MAX_WIDGETS) : []) {
      const s = sanitizeWidget(w)
      if (s.dropped) { if (s.id) dropped.push(s.id); continue }
      layout.push(s)
    }
    dashboards.push({ id: d.id, name: String(d.name || 'Dashboard').slice(0, 40), layout, updatedAt: new Date().toISOString() })
  }
  if (!dashboards.length) {
    await zanaRef.kv.set('dashboards.v1', { dashboards: [], activeId: null })
    return { ok: true, activeId: null, dropped, reset: true }
  }
  let activeId = args && args.activeId
  if (!dashboards.some(d => d.id === activeId)) activeId = dashboards[0].id
  await zanaRef.kv.set('dashboards.v1', { dashboards, activeId })
  return { ok: true, activeId, dropped }
}

async function applyTemplate(args) {
  const layout = templateLayout(args && args.templateId)
  if (!layout) throw new Error(`Unknown template '${args && args.templateId}'.`)
  return { layout }
}

// Agent-facing command wrappers: the same dashboard operations the renderer
// uses, exposed as declared commands so MCP/API/palette can drive them.
async function dashboardGet(args) {
  const dash = await getDashboards()
  if (!dash.authed || !args || !args.id) return dash
  const d = (dash.dashboards || []).find(d => d.id === args.id)
  if (!d) throw new Error(`Dashboard '${args.id}' not found.`)
  return { ...dash, dashboards: [d], activeId: d.id }
}

async function widgetCatalog() {
  return {
    widgets: WIDGET_CATALOG,
    templates: templateLayouts().map(t => ({ id: t.id, title: t.title, description: t.description })),
    grid: { columns: 12, widget: '{ id, type, title, x, y, w, h, config }', caps: { dashboards: MAX_DASHBOARDS, widgetsPerDashboard: MAX_WIDGETS } },
  }
}

async function widgetPreview(args) {
  return widgetData(args || {})
}

async function dashboardSave(args) {
  return saveDashboards(args || {})
}

async function jiraData() {
  if (!(await isAuthed())) {
    return {
      title: 'Jira',
      kind: 'sections',
      sections: [{
        title: 'Not connected',
        rows: [
          { label: 'Setup', value: 'Run `acli auth login` in a terminal, then press Refresh.' },
          { label: 'Why', value: 'Zana shells your own acli; auth stays in your OS profile, never in Zana.' },
        ],
      }],
      actions: [],
    }
  }
  return { title: 'Jira', kind: 'dashboard' }
}

async function activate(zana) {
  zanaRef = zana
  zana.commands.register('jira.my-issues', myIssues)
  zana.commands.register('jira.view-issue', viewIssue)
  zana.commands.register('jira.search', search)
  zana.commands.register('jira.dashboard-get', dashboardGet)
  zana.commands.register('jira.widget-catalog', widgetCatalog)
  zana.commands.register('jira.widget-preview', widgetPreview)
  zana.commands.register('jira.dashboard-save', dashboardSave)
}

module.exports = { activate, jiraData, getDashboards, saveDashboards, applyTemplate, widgetData }
