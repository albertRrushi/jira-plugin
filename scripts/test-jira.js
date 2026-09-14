'use strict'

// Isolated: all plugin kv/secrets go to a temp dir, never ~/.zana.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
process.env.ZANA_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-test-'))

const assert = require('node:assert/strict')

const ZANA_REPO = process.env.ZANA_REPO_ROOT
if (!ZANA_REPO) {
  console.log('SKIP live jira e2e: set ZANA_REPO_ROOT to a Zana checkout (needs its plugin loader).')
  process.exit(0)
}
const loader = require(path.join(ZANA_REPO, 'main/plugins/loader'))

const settings = new Map()
const db = {
  getSetting: (k) => (settings.has(k) ? settings.get(k) : null),
  setSetting: (k, v) => { settings.set(k, v) },
  listTasks: () => [],
  getTask: () => null,
  createTask: () => { throw new Error('no mutations in read-only test') },
  searchProjectMemories: () => [],
  createProjectMemory: () => { throw new Error('no mutations in read-only test') },
}

async function main() {
  loader.resetForTests()
  const found = loader.init({ db, orchestrator: {}, actions: {}, appRoot: path.join(__dirname, '..') })
  assert.ok(found.loaded.includes('jira'), `jira not loaded: ${JSON.stringify(found.errors)}`)

  const data = await loader.invoke('jira', 'jiraData', {})
  assert.equal(data.title, 'Jira')
  assert.equal(data.kind, 'dashboard')
  console.log('view: dashboard kind')

  const dash = await loader.invoke('jira', 'getDashboards', {})
  assert.equal(dash.authed, true)
  assert.equal(dash.catalog.length, 7)
  assert.equal(dash.templates.length, 3)
  console.log(`dashboards: ${dash.dashboards ? dash.dashboards.length : 'none yet (first run)'}`)

  const applied = await loader.invoke('jira', 'applyTemplate', { templateId: 'my-work' })
  assert.equal(applied.layout.length, 3)
  const saved = await loader.invoke('jira', 'saveDashboards', {
    dashboards: [{ id: 'd1', name: 'Test', layout: applied.layout }],
    activeId: 'd1',
  })
  assert.equal(saved.ok, true)
  assert.deepEqual(saved.dropped, [])
  const reloaded = await loader.invoke('jira', 'getDashboards', {})
  assert.equal(reloaded.dashboards.length, 1)
  assert.equal(reloaded.dashboards[0].layout.length, 3)
  assert.equal(reloaded.activeId, 'd1')
  console.log('dashboard save/load round-trip ok')

  const widgets = await loader.invoke('jira', 'widgetData', { type: 'count', config: { jql: 'assignee = currentUser()', label: 'Mine' } })
  assert.ok(typeof widgets.value === 'number')
  console.log(`widget count: ${widgets.value}${widgets.exact === false ? '+' : ''}`)
  const groups = await loader.invoke('jira', 'widgetData', { type: 'breakdown', config: { jql: 'assignee = currentUser() ORDER BY updated DESC', groupBy: 'status', chart: 'pie', top: 12 } })
  assert.ok(Array.isArray(groups.items))
  console.log(`widget status groups: ${groups.items.map(i => `${i.name}=${i.value}`).join(', ') || 'none'}`)

  await assert.rejects(() => loader.invoke('jira', 'widgetData', { type: 'nope', config: {} }), /Unknown widget type/)
  const reset = await loader.invoke('jira', 'saveDashboards', { dashboards: [], activeId: null })
  assert.equal(reset.reset, true)

  // Agent command path (what MCP/API agents call): catalog -> preview -> save -> get.
  const catalog = await loader.runCommand('jira.widget-catalog', {})
  assert.equal(catalog.widgets.length, 7)
  assert.ok(catalog.widgets.every(w => w.type && w.fields))
  const preview = await loader.runCommand('jira.widget-preview', { type: 'count', config: { jql: 'assignee = currentUser()', label: 'Mine' } })
  assert.ok(typeof preview.value === 'number')
  const agentSave = await loader.runCommand('jira.dashboard-save', {
    activeId: 'd_agent',
    dashboards: [{ id: 'd_agent', name: 'Agent board', layout: [{ id: 'w1', type: 'count', title: 'Mine', x: 0, y: 0, w: 4, h: 2, config: { jql: 'assignee = currentUser()', label: 'Mine' } }] }],
  })
  assert.equal(agentSave.ok, true)
  const agentGet = await loader.runCommand('jira.dashboard-get', { id: 'd_agent' })
  assert.equal(agentGet.dashboards[0].layout.length, 1)
  console.log('agent command path ok (catalog/preview/save/get)')

  const mine = await loader.runCommand('jira.my-issues', {})
  assert.ok(Array.isArray(mine))
  console.log(`my-issues: ${mine.length} issue(s)`)
  if (mine.length > 0) {
    console.log(`first: ${mine[0].key} — ${(mine[0].summary || '').slice(0, 80)} [${mine[0].status}]`)
    const detail = await loader.runCommand('jira.view-issue', { key: mine[0].key })
    assert.equal(detail.key, mine[0].key)
    console.log(`view-issue ${detail.key}: status=${detail.status} assignee=${detail.assignee}`)
  }

  const scoped = await loader.runCommand('jira.search', { jql: 'assignee = currentUser() ORDER BY updated DESC', limit: 3 })
  assert.ok(Array.isArray(scoped) && scoped.length <= 3)
  console.log(`search: ${scoped.length} issue(s)`)

  const trend = await loader.invoke('jira', 'widgetData', { type: 'trend', config: { jql: 'assignee = currentUser()', days: 7 } })
  assert.equal(trend.buckets.length, 7)
  console.log(`trend: ${trend.buckets.map(b => `${b.label}:${b.created}/${b.resolved}`).join(' ')}`)
  const projects = await loader.invoke('jira', 'widgetData', { type: 'projects', config: { limit: 3 } })
  assert.ok(Array.isArray(projects.projects) && projects.projects.length <= 3)
  console.log(`projects: ${projects.projects.map(p => `${p.key}=${p.open}`).join(', ') || 'none'}`)
  try {
    const { execFileSync } = require('node:child_process')
    const boards = JSON.parse(execFileSync('acli', ['jira', 'board', 'search', '--json', '--limit', '3'], { encoding: 'utf8' }))
    const list = Array.isArray(boards) ? boards : (boards.values || boards.boards || [])
    if (list.length && list[0].id != null) {
      const sprint = await loader.invoke('jira', 'widgetData', { type: 'sprint', config: { boardId: list[0].id } })
      assert.ok(sprint.empty === true || typeof sprint.total === 'number')
      console.log(`sprint on board ${list[0].id}: ${sprint.empty ? 'no active sprint' : `${sprint.done}/${sprint.total} done`}`)
    } else {
      console.log('sprint: no boards found, skipped')
    }
  } catch (err) {
    console.log(`sprint: skipped (${err.message})`)
  }
  if (mine.length > 0) {
    const spotlight = await loader.invoke('jira', 'widgetData', { type: 'issue', config: { key: mine[0].key, comments: 2 } })
    assert.equal(spotlight.key, mine[0].key)
    console.log(`spotlight: ${spotlight.key} + ${spotlight.comments.length} comment(s)`)
  }

  await assert.rejects(() => loader.runCommand('jira.view-issue', { key: 'nope' }), /Bad issue key/)
  console.log('live acli e2e: all assertions passed.')
}

main().catch((e) => { console.error('JIRA E2E FAILED:', e.message); process.exit(1) })
