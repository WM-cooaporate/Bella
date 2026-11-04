# Bella architecture and deployment guide

## Behavior carried forward

- Product catalog and inventory use PostgreSQL records; the database remains authoritative for prices and stock.
- Checkout reserves stock under a row lock for 30 minutes and stores an order item price/name snapshot. A payment receipt pauses the reservation timeout pending manual review. Approval moves an order into processing; rejection releases its inventory and closes the order so the customer can place a fresh order.
- Only an authenticated administrator can view receipts, review payments, list orders, or add products. Admin mutations require a session CSRF token.
- Receipt files and product photos live in a private Supabase Storage bucket; only random generated object paths are stored in PostgreSQL. Receipts accept JPEG, PNG, and PDF up to 3 MB; product photos accept JPEG, PNG, and WebP up to 4 MB. The product photo limit is 4 MB to leave room for multipart framing under Vercel Functions' 4.5 MB total request payload ceiling. The backend streams catalog photos and only serves receipt files after admin authentication.
- The existing `PROCESSING`/`COMPLETED`/`CANCELLED` status values are preserved. Tracking is by order number plus customer phone.

## Run locally

Use Node.js 20+, npm, and PostgreSQL (Supabase works). Apply `bella-postgresql-schema.sql` once to the intended empty database. Copy `.env.example` to `.env` and fill in the local values, then run `npm install`, `npm run admin:create`, `npm run dev:api`, and `npm run dev`. Set `BELLA_ADMIN_USERNAME` and a unique `BELLA_ADMIN_PASSWORD` of at least 12 characters before the one-time `npm run admin:create`; an existing username is never overwritten. The API runs on port 3000 and Vite proxies `/api` to it. During Vite development, the storefront uses clearly marked sample products and a simulated order/receipt flow so the customer journey can be previewed without a database or money transfer. These sample products and simulated orders are not included in production builds. The public `SUPABASE_ANON_KEY` is not used by the API; never put the service role key in a `VITE_` variable or the browser. `api/server.js` loads local `.env` variables for development.

Vercel builds the React app into `dist` and runs `api/index.js` as a Node.js Function. Connect the Vercel project to the GitHub repository and add `DATABASE_URL`, `SESSION_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`, and `CRON_SECRET` in Vercel project settings. Set at least one public payment destination, `VITE_INSTAPAY_HANDLE` or `VITE_ORANGE_CASH_NUMBER`, in the same Vercel environments; these values are intentionally displayed to customers and are not secrets. Copy `DATABASE_URL` from the Supabase **Transaction pooler** connection settings (port 6543) for serverless use; the function keeps a one-connection client pool. Use long random values for both secrets. Create a **private** Supabase Storage bucket named `bella-private` (or set `SUPABASE_STORAGE_BUCKET`); the service key stays server-side. The same-origin `/api/*` rewrite avoids cross-site session-cookie setup. Expired reservations are cleaned during checkout and by a secured daily Vercel Cron. On Hobby, Vercel cron runs once per day and scheduling may be delayed by up to 59 minutes; opportunistic cleanup on checkout keeps stock accurate when new orders arrive. Pro supports per-minute cron schedules if desired. Local build commands do not deploy the project.

## Existing data

`bella.sql` is the source MySQL schema and `bella-postgresql-schema.sql` is the target PostgreSQL schema. No database rows are copied by this source migration. Back up the source and target, migrate data with an explicit mapping (including enum/check values, identity sequences, and timestamps), copy existing uploads to private Supabase Storage, verify counts and references, then switch traffic only after a separate reviewed cutover. Do not point migration scripts at production without a verified backup and cutover plan.

The rebuild removes tracked PHP/Spring source, obsolete deployment files, and generated test artifacts. SQL schemas remain available. Existing untracked uploads under `backend/uploads/` are kept out of Git and Vercel; migrate them to the private storage bucket separately if they are still needed.

## Known follow-up work

- End-to-end database lifecycle checks need a disposable PostgreSQL database; API unit tests do not modify configured databases.
- Apply the schema, add real product rows, configure the private storage bucket, create the admin, and provide verified InstaPay/Orange Cash destinations before enabling production checkout.
- Payments use manual transfer plus receipt review; there is no card processor integration. Product totals do not include a delivery fee. Decide and implement the delivery charge/collection policy before taking production orders.
- Configure Vercel environment variables and connect the production Supabase project before trying live checkout or admin workflows.
- Product admin editing/deactivation and login rate limiting remain follow-up work.
