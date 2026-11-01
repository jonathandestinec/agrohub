# AgroHub: working rules

Read before any task: `docs/superpowers/specs/2026-10-31-agrohub-design.md`, `docs/architecture.md`, and the plan you were given in `docs/superpowers/plans/`.

- Money is integer kobo; percentages are integer basis points. No floats. All arithmetic and formatting live in `src/lib/money.ts`.
- Business logic lives only in `src/modules/*/service.ts`. Components and route handlers call services.
- Every service function takes an `Actor` and checks `can(actor, action, resource)` first. Cooperative data is always scoped by `cooperativeId`.
- Private fields (floor price, phone numbers, bank data) leave the server only through the mapper functions in `views.ts`.
- Test first: write the failing test, watch it fail, implement, watch it pass, commit. Commit after every task.
- Before each commit run `npm run lint`, `npm run typecheck`, `npm test`.
- Tests and staging use Paystack test keys only. Never log secrets or full webhook bodies.
- User-facing copy never calls the held-payment feature "escrow". Say "payment held until delivery is confirmed".
- No new dependency without adding a line to `docs/architecture.md`.
- When the plan or spec is silent, choose the simpler option, record the choice in the task's commit message, and flag it in the pull request description.
- Never add Co-Authored-By trailers or “Generated with Claude Code” lines to commits or pull requests.
