# Jira plugin for Zana

Jira dashboards and read-only issue lookup for [Zana](https://github.com/albertRrushi/zana), driven by your own [`acli`](https://developer.atlassian.com/cloud/acli/) auth — the plugin never sees credentials.

## Widgets

- **Issue list** — tickets with JQL filters, configurable columns and sorting
- **Count** — single number from a JQL query
- **Breakdown chart** — group any JQL query (bar/pie, incl. resolution and components)
- **Sprint** — active sprint progress for a board
- **Issue spotlight** — one ticket with details and recent comments
- **Trend** — created vs resolved per day
- **Projects** — projects with live open counts

Plus 7 read-only commands (`my-issues`, `view-issue`, `search`, `dashboard-get`, `widget-catalog`, `widget-preview`, `dashboard-save` for boards) and a `dashboard-builder` agent skill.

## Install

In Zana: Marketplace → **Install from Git** with this repo's URL. Or unpack anywhere and validate:

```bash
node /path/to/zana/scripts/validate-plugin.js ./jira-plugin
```

## Develop

Layout follows the Zana plugin contract (`plugin.json` + `zana/plugin.zana.json`, Agent Skills format for `skills/`). See Zana's `PLUGIN_DEV.md`.
