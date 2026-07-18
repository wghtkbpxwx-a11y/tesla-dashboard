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
and selects the lowest-cost configured direct cloud model that meets each
harder task's capability/quality requirements. Direct Anthropic, OpenAI,
Gemini, Groq, Perplexity, Kimi, DeepInfra, Mistral, DeepSeek, and xAI access
ranks ahead of OpenRouter; OpenRouter remains a manual/free/long-tail/failover
option. Paid API estimates share a hard $50
trailing-30-day application budget. Homebase can merge that ledger, provider
credentials, memory, tasks, and AI preferences between phone and desktop using
a passphrase-encrypted Google Drive vault; plaintext secrets, the passphrase,
and OAuth access tokens are never committed or stored in the remote vault.
Complex requests can fan out to task-shaped specialist teams in parallel; each
role gets a narrow tool set and the lowest-cost adequate model, and a lead agent
integrates the result. Explicit dashboard source requests can be turned into
confirm-guarded GitHub branches and draft pull requests through repository
read/search/edit tools configured in Homebase Settings → Development. The agent
never writes directly to `main` and never stores API keys in the repository.
Browser speech stays free by default; optional OpenAI and ElevenLabs speech
usage flows through the same rolling budget.
The preferred local runtime is LM Studio with the tested `homebase-local`
Qwen 3.5 9B 4-bit model. Its structured function calls can use Homebase tools;
an optional scoped LM Studio token can also expose the installed Brave-search
MCP, whose estimated per-search charge is included in the rolling ledger.
The verified setup requires a dedicated restricted token, denies arbitrary
remote MCP servers, permits only installed `mcp.json` connectors, and is bound
to localhost with CORS and just-in-time model loading enabled. One live Brave
search succeeded through local Qwen and recorded a $0.005 rolling estimate
without using a paid cloud language model. For responsiveness, installed Qwen
3.5 4B handles short no-tool prompts; Qwen 3.5 9B remains the capable local/tool
option, while balanced or tool-heavy work considers the cheapest adequate cloud
route first unless local/offline use is requested.
