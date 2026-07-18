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
