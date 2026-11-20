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
- No AI tool names anywhere git or GitHub records them. Branch names never contain "claude" (use `feature/`, `fix/`, `chore/` and the like; rename a branch before pushing if it has one). Commit messages, pull request titles and descriptions never mention Claude, Anthropic, AI agents or subagents, and the only author is the repository owner's own git identity.
- Hand every test run (lint, typecheck, Vitest, Playwright) to the `test` subagent in `.claude/agents`, so long logs stay out of the main context. Hand broad searches that span several modules or areas to the `search` subagent. Read single files and run one-off greps directly; the `grep` subagent is optional. Run the `audit` subagent on the committed diff before opening a pull request.
- Before any other work, confirm the `test`, `search` and `audit` subagents are available in this session. If one is missing, stop and say so.
- Every final report states which subagent ran each broad search and each test run, and names any that was done without one. Pull request descriptions list the checks that ran (lint, typecheck, unit, integration, e2e, audit) and their results, without naming the agent or tool that ran them.
- Never merge your own pull request. Push the branch, open the pull request and stop: it is reviewed before it reaches `main`.
