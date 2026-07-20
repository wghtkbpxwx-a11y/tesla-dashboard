# Pederson Finances web app

This directory is a public, installable app shell. It must never contain a
financial snapshot, account balance, transaction export, statement, receipt,
credential, or generated finance bundle.

The app accepts three private browser imports:

- `pederson.finance_webapp_bundle.v1` (preferred);
- `homebase.finance_glance.v1`;
- a validated `2.0.0-alpha.1` Pederson finance snapshot.

The full bundle is stored under `pederson_finance_webapp_bundle_v1` and the
minimized Homebase card under `homebase_finance_glance_v1`. Because `/finance/`
and `/ai/` share one origin on GitHub Pages, storage events and
`homebase-sync-v1` keep both surfaces current without uploading financial data.

Wave 1 gives the public shell a HOT-ROD instrument-cluster treatment matching
Homebase: Syne display type, Plus Jakarta Sans UI, JetBrains Mono labels, mint
signals on a near-black cockpit, horizontal meters, dense rows, and sharp
segmented controls, with all private-data and browser-local sync boundaries unchanged.
Wave 2 tightens touch targets (48px+ controls), import/sync toasts, and an
aria-live status region without changing storage keys or the sync channel.
