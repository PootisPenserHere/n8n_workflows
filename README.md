# n8n_workflows

My collection of n8n workflows.

## Repository layout

- `workflows/` — exported n8n workflow JSON and workflow-specific setup, operation, and checkpoint notes.
- `database/` — database schemas/tables/views used by workflows.
- `AI_CONTEXT.md` — repository-wide AI context, technical contracts, compatibility notes, and architectural decisions.

## Workflow documentation

Workflow directories with setup/operation notes include:

- `workflows/brave-search/README.md`
- `workflows/calendar-notifications/README.md`
- `workflows/jina-reader/README.md`
- `workflows/weather-notifications/README.md`

When workflow behavior or contracts change, update the local workflow README and the relevant repository-wide section in `AI_CONTEXT.md`.
