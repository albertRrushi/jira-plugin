---
name: dashboard-builder
description: Build and edit the user's Jira dashboards in Zana. Use when the user asks for a board, widgets, charts, or changes to their Jira dashboard (e.g. "put my Code Review tickets next to a pie of my open work").
license: MIT
---

# Jira dashboard builder

You drive the Jira dashboard through four plugin commands (MCP `zana_run_plugin_command`, API `POST /plugins/jira/commands/<cmd>`, or palette). Same store the UI uses, so anything you build appears in the sidebar and the user can rearrange it by hand afterwards.

## Recipe

1. **Catalog first**: `jira.widget-catalog` → widget types, their config fields, templates, grid rules (12 columns; widget `{ id, type, title, x, y, w, h, config }`; max 10 dashboards, 24 widgets each).
2. **Read current**: `jira.dashboard-get` (or `{ id }` for one) → existing dashboards, active tab, layouts.
3. **Preview before placing**: `jira.widget-preview { type, config }` → confirms the widget returns data. Never place an unverified widget.
4. **Save whole**: `jira.dashboard-save { dashboards, activeId }` → full replacement of the dashboard list. Always base edits on a fresh `dashboard-get`; never invent ids (new ids: short readable slugs like `d_review`). To rename a dashboard, keep its `id` and `layout` and change only `name`.

## Widget types

- `issues-list` `{ jql, limit 1-50, columns subset of key|summary|status|assignee|priority|type|updated, sortField: updated|created|priority|status, sortDir: asc|desc }` → `{ issues: [...] }`. Sort is appended only when the JQL has no ORDER BY.
- `count` `{ jql, label }` → `{ value, exact, label }`. `exact: false` means capped at 100 — say "100+".
- `breakdown` `{ jql, groupBy: status|assignee|priority|issuetype|project|resolution|components, chart: bar|pie, top 2-20 }` → `{ groupBy, chart, items: [{ name, value }], truncated }`.
- `sprint` `{ boardId }` → active sprint `{ sprint, total, done, open }`, or `{ empty: true }` when the board has no active sprint (kanban boards report why instead of erroring).
- `issue` `{ key, comments 0-10 }` → one ticket with details plus recent comments.
- `trend` `{ jql (no ORDER BY — it is stripped), days: 7|14|30 }` → `{ buckets: [{ label, created, resolved }] }`.
- `projects` `{ limit 1-8 }` → `{ projects: [{ key, name, open }] }`.

Geometry: integers, `x + w <= 12`, `w,h >= 1`. Overlaps resolve by pushing down — prefer tidy rows.

## JQL guidance

Default scope is the user's site via their own `acli` auth. Useful patterns:

- Mine, open: `assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC`
- Everything open: `statusCategory != Done ORDER BY updated DESC`
- By status word: `status = "Code Review"`, `status = "In Progress"`

Keep queries under 1000 chars. Charts aggregate at most 100 issues — say so when `truncated` is true.

## Boundaries (read-only v1)

There are no mutation commands for Jira issues — only dashboard CRUD, which writes to the user's own board store. You can promise: building a board never touches Jira data. Creating issues/transitions does not exist yet; don't claim otherwise.

## Worked example

User: "Put my Code Review tickets next to a pie of my open work."

1. `widget-catalog` → note `issues-list`, `breakdown` fields.
2. `dashboard-get` → one dashboard `d1` "My dashboard", active.
3. `widget-preview { type: 'issues-list', config: { jql: 'assignee = currentUser() AND status = "Code Review" ORDER BY updated DESC', limit: 10 } }` → 3 issues back.
4. `widget-preview { type: 'breakdown', config: { jql: 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC', groupBy: 'status', chart: 'pie', top: 8 } }` → 4 groups back.
5. `dashboard-save` with a new dashboard `{ id: 'd_review', name: 'Review', activeId: 'd_review', layout: [list x0 y0 w8 h5, pie x8 y0 w4 h5] }` preserving the existing dashboard untouched.
6. Reply: what was built, where (new "Review" tab), and that they can drag/resize freely.
