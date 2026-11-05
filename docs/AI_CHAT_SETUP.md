# Shared travel assistant

NESAM Cabs, People Taxi and One Way Car Rentals share `functions/src/groqChat.ts`
and `user/web/src/components/AiChatWidget.tsx`.

Set `GROQ_API_KEY` in `functions/.env` for local development. Do not put it in
`VITE_*` or `EXPO_PUBLIC_*` variables: those are browser/mobile bundle variables.
The local Vite servers run the shared chat handler and keep the key on the server.
After server changes, run `npm --prefix functions run build` and restart Vite.

Models:

- Main: `openai/gpt-oss-120b` (override using server `GROQ_MODEL`).
- Backup: `openai/gpt-oss-20b`.

Both are listed under Groq Free plan limits. Keep the Groq account on the Free
plan for free usage; model selection cannot control the account's billing plan.
When limits are reached, the assistant shows basic travel answers and explicitly
indicates that AI is unavailable. It does not upgrade the account or service tier.

For hosted websites, configure the same key on the shared API server:

- Firebase: configure `GROQ_API_KEY` in the functions deployment environment and
  deploy `chatWithBot` using `firebase deploy --only functions:chatWithBot`.
- Vercel: configure `GROQ_API_KEY` and optionally `GROQ_MODEL` on the API project,
  then redeploy the API. The website projects do not need the private key.

Deploy the website changes too so the status and history fixes reach customers.

Checks: `npm --prefix functions run build`, followed by
`node --test functions/test/groqChat.test.js`.

Groq's current limits: https://console.groq.com/docs/rate-limits
