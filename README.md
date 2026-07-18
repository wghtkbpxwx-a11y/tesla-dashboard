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
