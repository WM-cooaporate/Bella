# Bella architecture migration

## Behavior carried forward

- Product catalog and inventory use PostgreSQL records; the database remains authoritative for prices and stock.
- Checkout reserves stock under a row lock for 30 minutes and stores an order item price/name snapshot. A payment receipt pauses the reservation timeout pending manual review.
- Only an authenticated administrator can view receipts, review payments, list orders, or add products. Admin mutations require a session CSRF token.
- Receipt files are kept outside the web root under `BELLA_STORAGE_PATH`; only random generated paths are stored in the database. Receipts accept JPEG, PNG, and PDF up to 3 MB; product photos accept JPEG, PNG, and WebP up to 5 MB.
- The existing `PROCESSING`/`COMPLETED`/`CANCELLED` status values are preserved. Tracking is by order number plus customer phone.

## Run locally

Use Java 17+, Maven, Node.js, and PostgreSQL. Create the schema manually by running `bella-postgresql-schema.sql` against the empty Bella database before starting the API. Automatic Flyway migration is disabled by default (`FLYWAY_ENABLED=false`) to avoid conflicts with that manually-created schema. Set `DATABASE_URL` (JDBC URL), `DB_USER`, `DB_PASSWORD`, `BELLA_ADMIN_USERNAME`, `BELLA_ADMIN_PASSWORD`, and `BELLA_STORAGE_PATH`. Admin creation is opt-in at startup; no credentials are committed. Start the API with `mvn -f backend/pom.xml spring-boot:run`, and the frontend with `npm install`, `BELLA_API_ORIGIN=http://localhost:8080 npm run dev`.

Build the static Vercel site with `npm run build`. The Spring API and PostgreSQL do not run on Vercel's static frontend. Configure API CORS to the exact frontend origin, and configure the deployed frontend API URL or hosting rewrite to the actual Spring API origin. No guessed backend domain is included. Cross-site deployment requires `SameSite=None; Secure`, credentialed CORS, and compatible browser cookie handling.

## Existing data

`bella.sql` is the source MySQL schema; `backend/src/main/resources/db/migration/V1__initial_schema.sql` is the new PostgreSQL schema. No rows or uploaded files are copied. Back up the source and target, export/import records with an explicit mapping (including enum/check values, identity sequences, and timestamp timezone), copy uploads to private persistent storage, validate counts and relationships, then switch traffic only after a separate reviewed cutover. Do not point this migration at production without that process.

## Known follow-up work

- Replace local receipt/photo disk storage with a private durable object store before hosting the API on ephemeral infrastructure.
- Integration tests use disposable PostgreSQL through Testcontainers; Docker must be available to execute them.
- Configure production CORS and cookie settings for the actual Vercel/API domains before launch.
- Product admin editing/deactivation and login rate limiting remain follow-up work.
