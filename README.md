# tesla-dashboard

<!-- Test comment: Verifying GitHub Pages deployment pipeline -->

This repository hosts three connected GitHub Pages apps:

- Tesla Dashboard at `/tesla-dashboard/`;
- Homebase AI at `/tesla-dashboard/ai/`;
- the data-free Pederson Finances shell at `/tesla-dashboard/finance/`.

The finance shell stores imported private data only in the user's browser and
shares a minimized local glance with Homebase. Financial bundles, balances,
transactions, statements, receipts, and credentials must never be committed.

Homebase AI automatically routes simple work to local models where available
and selects the lowest-cost configured cloud model that meets each harder
task's capability/quality requirements. Paid API estimates share a hard $50
trailing-30-day application budget with an embedded browser-local tracker.
Complex requests can fan out to task-shaped specialist teams in parallel; each
role gets a narrow tool set and the lowest-cost adequate model, and a lead agent
integrates the result. Explicit dashboard source requests can be turned into
confirm-guarded GitHub branches and draft pull requests through repository
read/search/edit tools configured in Homebase Settings → Development. The agent
never writes directly to `main` and never stores API keys in the repository.
