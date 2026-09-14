'use strict'

const assert = require('node:assert/strict')
const plugin = require('../zana/main')

function stubZana({ procImpl, kvStore } = {}) {
  const kv = kvStore || new Map()
  const commands = new Map()
  return {
    commands: { register: (name, fn) => commands.set(name, fn) },
    kv: {
      get: async (k) => (kv.has(k) ? kv.get(k) : null),
      set: async (k, v) => { kv.set(k, JSON.parse(JSON.stringify(v))); return true },
    },
    settings: { getOwn: async () => null, setOwn: async () => true },
    proc: { exec: procImpl || (async () => { throw new Error('no proc in unit test') }) },
    notify: { toast: () => {} },
    _commands: commands,
    _kv: kv,
  }
}

const ISSUES_JSON = JSON.stringify([
  { key: 'T-1', summary: 'First', status: { name: 'Todo' }, assignee: { displayName: 'Ann' }, issuetype: { name: 'Task' }, priority: { name: 'High' }, components: [{ name: 'API' }], created: new Date().toISOString(), updated: new Date().toISOString() },
  { key: 'T-2', summary: 'Second', status: 'Done', assignee: 'bob@x.com', resolution: { name: 'Done' }, components: [], created: new Date(Date.now() - 86400000).toISOString(), resolutiondate: new Date().toISOString() },
])

async function main() {
  // Unauthed -> dashboards report authed:false, no proc needed beyond failure.
  let zana = stubZana()
  await plugin.activate(zana)
  let dash = await plugin.getDashboards()
  assert.equal(dash.authed, false)
  assert.equal(dash.dashboards, undefined)

  // Authed stub.
  const kvStore = new Map()
  zana = stubZana({
    kvStore,
    procImpl: async (bin, argv) => {
      assert.equal(bin, 'acli')
      if (argv[0] === 'auth') return 'ok'
      if (argv.includes('--count')) return 'Total: 7'
      if (argv[0] === 'jira' && argv[1] === 'board') {
        if (argv[2] === 'view') return JSON.stringify({ id: 6, name: 'B', type: 'scrum' })
        return JSON.stringify([{ id: 6, name: 'B', state: 'active' }])
      }
      if (argv[0] === 'jira' && argv[1] === 'sprint') return ISSUES_JSON
      if (argv[0] === 'jira' && argv[1] === 'project') return JSON.stringify([{ key: 'T', name: 'Test' }])
      if (argv[0] === 'jira' && argv[1] === 'workitem' && argv[2] === 'view') {
        return JSON.stringify([{
          key: 'T-1', summary: 'First', status: { name: 'Todo' },
          description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world', marks: [{ type: 'strong' }] }] }] },
          fields: { comment: { comments: [{ author: 'Ann', body: 'note', created: '2026-01-01' }] } },
        }])
      }
      return ISSUES_JSON
    },
  })
  await plugin.activate(zana)
  dash = await plugin.getDashboards()
  assert.equal(dash.authed, true)
  assert.equal(dash.dashboards, null)
  assert.equal(dash.catalog.length, 7)
  assert.equal(dash.templates.length, 3)

  // widgetData normalization across shapes.
  const list = await plugin.widgetData({ type: 'issues-list', config: { jql: 'x', limit: 5 } })
  assert.equal(list.issues.length, 2)
  assert.equal(list.issues[0].status, 'Todo')
  assert.equal(list.issues[1].assignee, 'bob@x.com')
  const count = await plugin.widgetData({ type: 'count', config: { jql: 'x', label: 'L' } })
  assert.deepEqual(count, { value: 7, exact: true, label: 'L' })
  const pie = await plugin.widgetData({ type: 'breakdown', config: { jql: 'x', groupBy: 'status', chart: 'pie', top: 8 } })
  assert.deepEqual(pie.items, [{ name: 'Todo', value: 1 }, { name: 'Done', value: 1 }])
  assert.equal(pie.truncated, false)
  assert.equal(pie.chart, 'pie')
  const byAssignee = await plugin.widgetData({ type: 'breakdown', config: { jql: 'x', groupBy: 'assignee', chart: 'bar' } })
  assert.deepEqual(byAssignee.items, [{ name: 'Ann', value: 1 }, { name: 'bob@x.com', value: 1 }])
  const byResolution = await plugin.widgetData({ type: 'breakdown', config: { jql: 'x', groupBy: 'resolution', chart: 'bar' } })
  assert.deepEqual(byResolution.items, [{ name: '—', value: 1 }, { name: 'Done', value: 1 }])
  const byComponents = await plugin.widgetData({ type: 'breakdown', config: { jql: 'x', groupBy: 'components', chart: 'bar' } })
  assert.deepEqual(byComponents.items, [{ name: 'API', value: 1 }, { name: '—', value: 1 }])
  await assert.rejects(() => plugin.widgetData({ type: 'breakdown', config: { jql: 'x', groupBy: 'nope' } }), /groupBy must be one of/)
  await assert.rejects(() => plugin.widgetData({ type: 'nope', config: {} }), /Unknown widget type/)
  await assert.rejects(() => plugin.widgetData({ type: 'count', config: { jql: '' } }), /jql is required/)

  // New widget types against the stubbed CLI.
  const sprint = await plugin.widgetData({ type: 'sprint', config: { boardId: 6 } })
  assert.equal(sprint.boardId, 6)
  assert.ok(typeof sprint.total === 'number' && typeof sprint.done === 'number')
  const sprintBlank = await plugin.widgetData({ type: 'sprint', config: {} })
  assert.equal(sprintBlank.needsConfig, true)
  const spotlight = await plugin.widgetData({ type: 'issue', config: { key: 't-1', comments: 2 } })
  assert.equal(spotlight.key, 'T-1')
  assert.equal(spotlight.description, 'Hello world')
  assert.equal(spotlight.comments.length, 1)
  assert.equal(spotlight.comments[0].author, 'Ann')
  const spotlightBlank = await plugin.widgetData({ type: 'issue', config: { key: 'nope' } })
  assert.equal(spotlightBlank.needsConfig, true)
  const trend = await plugin.widgetData({ type: 'trend', config: { jql: 'x', days: 7 } })
  assert.equal(trend.days, 7)
  assert.equal(trend.buckets.length, 7)
  assert.ok(trend.buckets.every(b => b.created === 7 && b.resolved === 7))
  const projects = await plugin.widgetData({ type: 'projects', config: { limit: 3 } })
  assert.deepEqual(projects.projects, [{ key: 'T', name: 'Test', open: 7 }])
  const sorted = await plugin.widgetData({ type: 'issues-list', config: { jql: 'x ORDER BY created ASC', limit: 5 } })
  assert.equal(sorted.issues.length, 2)

  // saveDashboards: drops unknown widget types, clamps geometry, keeps valid.
  const res = await plugin.saveDashboards({
    activeId: 'd1',
    dashboards: [{
      id: 'd1',
      name: 'Test dashboard with a very long name that must be truncated at forty chars!!',
      layout: [
        { id: 'a', type: 'issues-list', title: 'List', x: 0, y: 0, w: 8, h: 5, config: { jql: 'x', limit: 99 } },
        { id: 'b', type: 'future-widget', title: 'Nope', x: 0, y: 0, w: 4, h: 2, config: {} },
        { id: 'c', type: 'count', title: 'C', x: 20, y: -3, w: 99, h: 0, config: { jql: 'x' } },
        { id: 'd', type: 'status-pie', title: 'Legacy', x: 0, y: 5, w: 4, h: 3, config: { jql: 'x' } },
        { id: 'e', type: 'status-bar', title: 'Legacy bad jql', x: 0, y: 8, w: 4, h: 3, config: { jql: '' } },
      ],
    }],
  })
  assert.equal(res.ok, true)
  assert.deepEqual(res.dropped, ['b', 'e'])
  const stored = kvStore.get('dashboards.v1')
  assert.equal(stored.dashboards[0].name.length <= 40, true)
  assert.equal(stored.dashboards[0].layout.length, 3)
  assert.deepEqual(stored.dashboards[0].layout[0].config, { jql: 'x', limit: 50, columns: ['key', 'summary', 'status'], sortField: '', sortDir: 'desc' })
  const clamped = stored.dashboards[0].layout.find(w => w.id === 'c')
  assert.ok(clamped.x + clamped.w <= 12 && clamped.h >= 1)
  // Legacy status-pie migrated forward, not dropped.
  const migrated = stored.dashboards[0].layout.find(w => w.id === 'd')
  assert.deepEqual(migrated, { id: 'd', type: 'breakdown', title: 'Legacy', x: 0, y: 5, w: 4, h: 3, config: { jql: 'x', groupBy: 'status', chart: 'pie', top: 8 } })

  // New widget configs sanitize strictly; bad ones drop, sloppy ones default.
  const resNew = await plugin.saveDashboards({
    activeId: 'd2',
    dashboards: [{
      id: 'd2',
      name: 'New types',
      layout: [
        { id: 's1', type: 'sprint', title: 'S', x: 0, y: 0, w: 6, h: 3, config: { boardId: 6 } },
        { id: 's2', type: 'sprint', title: 'Bad', x: 0, y: 3, w: 6, h: 3, config: {} },
        { id: 'i1', type: 'issue', title: 'I', x: 6, y: 0, w: 6, h: 4, config: { key: 't-1', comments: 99 } },
        { id: 'i2', type: 'issue', title: 'Bad', x: 6, y: 4, w: 6, h: 2, config: { key: 'nope' } },
        { id: 't1', type: 'trend', title: 'T', x: 0, y: 6, w: 12, h: 4, config: { jql: 'x', days: 99 } },
        { id: 'p1', type: 'projects', title: 'P', x: 0, y: 10, w: 12, h: 3, config: { limit: 99 } },
        { id: 'l1', type: 'issues-list', title: 'L', x: 0, y: 13, w: 12, h: 4, config: { jql: 'x', columns: ['key', 'bogus', 'status', 'key'], sortField: 'updated', sortDir: 'sideways' } },
      ],
    }],
  })
  assert.equal(resNew.ok, true)
  assert.deepEqual(resNew.dropped, [])
  const kept = kvStore.get('dashboards.v1').dashboards[0].layout
  assert.equal(kept.length, 7)
  assert.equal(kept.find(w => w.id === 's2').config.boardId, null)
  assert.equal(kept.find(w => w.id === 'i2').config.key, '')
  assert.equal(kept.find(w => w.id === 't1').config.days, 14)
  assert.equal(kept.find(w => w.id === 'p1').config.limit, 8)
  assert.equal(kept.find(w => w.id === 'i1').config.key, 'T-1')
  assert.equal(kept.find(w => w.id === 'i1').config.comments, 10)
  assert.deepEqual(kept.find(w => w.id === 'l1').config.columns, ['key', 'status'])
  assert.equal(kept.find(w => w.id === 'l1').config.sortDir, 'desc')

  // activeId falls back to first dashboard.
  const res2 = await plugin.saveDashboards({ activeId: 'missing', dashboards: [{ id: 'd1', name: 'A', layout: [] }] })
  assert.equal(res2.activeId, 'd1')
  await assert.rejects(() => plugin.saveDashboards({ dashboards: [{ id: 'bad id!', name: 'A', layout: [] }] }), /needs an id/)

  // Deleting the last dashboard resets to first-run (empty, not an error).
  const reset = await plugin.saveDashboards({ dashboards: [], activeId: null })
  assert.equal(reset.ok, true)
  assert.equal(reset.reset, true)

  // applyTemplate: known ok, unknown rejected.
  const tpl = await plugin.applyTemplate({ templateId: 'team' })
  assert.equal(tpl.layout.length, 3)
  await assert.rejects(() => plugin.applyTemplate({ templateId: 'nope' }), /Unknown template/)

  // Agent command surface: all commands registered, wrappers delegate.
  const registered = [...zana._commands.keys()].sort()
  assert.deepEqual(registered, [
    'jira.dashboard-get', 'jira.dashboard-save', 'jira.my-issues',
    'jira.search', 'jira.view-issue', 'jira.widget-catalog', 'jira.widget-preview',
  ])
  const cat = await zana._commands.get('jira.widget-catalog')()
  assert.equal(cat.widgets.length, 7)
  assert.equal(cat.templates.length, 3)
  assert.deepEqual(cat.grid, { columns: 12, widget: '{ id, type, title, x, y, w, h, config }', caps: { dashboards: 10, widgetsPerDashboard: 24 } })
  const preview = await zana._commands.get('jira.widget-preview')({ type: 'count', config: { jql: 'x', label: 'L' } })
  assert.deepEqual(preview, { value: 7, exact: true, label: 'L' })
  await zana._commands.get('jira.dashboard-save')({
    activeId: 'd9',
    dashboards: [{ id: 'd9', name: 'Agent board', layout: [{ id: 'w1', type: 'count', title: 'C', x: 0, y: 0, w: 4, h: 2, config: { jql: 'x', label: 'L' } }] }],
  })
  const one = await zana._commands.get('jira.dashboard-get')({ id: 'd9' })
  assert.equal(one.dashboards.length, 1)
  assert.equal(one.dashboards[0].layout.length, 1)
  await assert.rejects(() => zana._commands.get('jira.dashboard-get')({ id: 'missing' }), /not found/)

  console.log('dashboard unit: all assertions passed.')
}

main().catch((e) => { console.error('DASHBOARD UNIT FAILED:', e); process.exit(1) })
