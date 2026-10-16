# CloudSpend

Personal expense tracker with accounts, monthly savings goals and a savings wallet.

**Stack:** Node.js + Express, SQLite (`better-sqlite3`), vanilla JS frontend, Chart.js.

## Run it

```bash
npm install
npm start            # http://localhost:3000
npm test             # API, auth, data isolation, savings/goal/breakdown maths, dashboard flows
```

Open http://localhost:3000, create an account, and you land on the dashboard. In development a temporary
`JWT_SECRET` is generated, so sessions reset when the server restarts. Set one in `.env` to keep them
(see `.env.example`).

## Layout

```
server/   index.js (startup)  app.js (routes, auth)  db.js (schema, migrations)  env.js
          savings.js  goals.js  breakdown.js (calculations)  validate.js
views/    index.html (dashboard, login required)  login.html  register.html
public/   app.js  auth.js  style.css  auth.css      (public static assets)
test/     api.test.js  goals.test.js  frontend.test.js
```

## How savings work

- **Monthly savings** = income in the month − expenses in the month. Calculated by the server.
- **Goal status:** met, missed (past month under goal), in progress (current month), upcoming, no goal set.
- **Savings wallet** = sum of transfers you move into it. Transfers are *not* expenses and never change
  monthly savings, so nothing is counted twice.
- **Available to transfer** = all income − all expenses − all transfers. Transfers above this are rejected.
- Amounts are stored as integer paise, so totals never drift.

## Savings goals

- Create any number of goals, each with a target, a deadline and an optional planned monthly contribution.
- **Progress** is the money allocated to the goal. Allocation draws only from the *unallocated* part of
  your savings wallet: `unallocated = wallet balance - sum of goal allocations`. It never changes monthly
  savings or your spending balance, and it can never exceed the wallet.
- **Priority** is the order of the list (move up/down). "Distribute by priority" fills the first goal
  completely, then the next, until the unallocated money runs out.
- **Status:** completed, on track (planned contribution x months left covers the remainder), behind plan,
  overdue, or no plan. One contribution per month is assumed, starting next month.
- Guards: a transfer cannot be removed if goals depend on it, and a goal's target cannot be set below what is
  already allocated to it. Deleting a goal returns its allocation to the pool. Up to 50 goals per user.

## Spending breakdown

- Month by month: expenses by category with share of spending, the previous month, and the change.
  A category is flagged when spending rose or is new compared with the previous month.
- Income is grouped by description (for example Salary). Subscriptions is now an expense category.
- **Discretionary savings estimate:** pick which categories you could cut (defaults: Entertainment,
  Shopping, Subscriptions) and a percentage. `monthly saving = discretionary spend x percentage`, shown per
  month, per year, and as the savings you would have had that month. It is an estimate from the selected
  month only, not a forecast.

## Security

- Passwords hashed with bcrypt (cost 12). Session is a signed JWT in an `HttpOnly`, `SameSite=Lax` cookie
  (`Secure` in production), 7-day expiry.
- Every data query is filtered by the logged-in user's id; tests confirm one user cannot read or delete another's data.
- Dashboard HTML is only served to logged-in users; the API returns 401 otherwise.
- State-changing requests require an `X-Requested-With` header (CSRF defence on top of SameSite).
- Login/registration are rate limited; helmet sets a strict Content-Security-Policy; login errors don't reveal whether an email exists.

## Preparing for AWS (nothing is created for you)

- Configuration is entirely environment variables (`.env.example`); `JWT_SECRET` is mandatory in production.
- `GET /health` for load balancer / container health checks. `Dockerfile` included (not built or tested here).
- The server trusts one proxy hop (`trust proxy`) for HTTPS ALB / CloudFront setups, and logs to stdout.
- Chart.js is served from `node_modules`, so there is no CDN dependency.

**Before running more than one instance:** SQLite is a single file on one disk. For ECS/EC2 with several
tasks, move to a managed database (e.g. RDS PostgreSQL). Database access lives in `server/app.js` and
`server/savings.js` using plain SQL, so that port is contained but not zero work. A single container with
the `/data` volume on EFS/EBS works in the meantime. Sessions are stateless JWTs, so they already work
across instances.
