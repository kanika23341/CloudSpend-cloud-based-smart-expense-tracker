"use strict";

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const V = require("./validate");
const { loadSavings, availablePaise } = require("./savings");
const G = require("./goals");
const { loadBreakdown, loadDiscretionary } = require("./breakdown");

const COOKIE = "cs_session";
const SESSION_DAYS = 7;
const ROOT = path.join(__dirname, "..");

function createApp({ db, jwtSecret, secureCookies = false, rateLimiting = true }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // behind a load balancer (ALB / CloudFront) in production

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          // Only upgrade requests when served over HTTPS; it breaks plain-http local development.
          upgradeInsecureRequests: secureCookies ? [] : null
        }
      }
    })
  );
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  // ---- helpers -----------------------------------------------------------

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const uuid = () => crypto.randomUUID();
  const dummyHash = bcrypt.hashSync("not-a-real-password-1", 12);

  function issueSession(res, user) {
    const token = jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: `${SESSION_DAYS}d` });
    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookies,
      maxAge: SESSION_DAYS * 86400 * 1000,
      path: "/"
    });
  }

  function userFromRequest(req) {
    const token = req.cookies?.[COOKIE];
    if (!token) return null;
    try {
      const { sub } = jwt.verify(token, jwtSecret);
      return db.prepare("SELECT id, email FROM users WHERE id = ?").get(sub) || null;
    } catch {
      return null;
    }
  }

  function requireAuth(req, res, next) {
    const user = userFromRequest(req);
    if (!user) return res.status(401).json({ error: "Please log in to continue." });
    req.user = user;
    next();
  }

  // CSRF defence in depth (on top of SameSite=Lax): browsers cannot add a custom
  // header cross-site without a CORS preflight, which this server never allows.
  function requireCustomHeader(req, res, next) {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    if (req.get("x-requested-with") !== "cloudspend") {
      return res.status(403).json({ error: "Request rejected." });
    }
    next();
  }

  const authLimiter = rateLimiting
    ? rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 30,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: "Too many attempts. Please try again in a few minutes." }
      })
    : (_req, _res, next) => next();

  // ---- pages -------------------------------------------------------------

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  // Use the `root` option: without it, Express rejects any absolute path that contains a
  // dot-folder (for example C:\\Users\\you\\.vscode\\...) as a hidden file and returns 404.
  const page = (name) => (_req, res, next) =>
    res.sendFile(name, { root: path.join(ROOT, "views") }, (err) => err && next(err));

  app.get("/", (req, res) => {
    if (!userFromRequest(req)) return res.redirect("/login");
    res.set("Cache-Control", "no-store");
    page("index.html")(req, res);
  });
  for (const name of ["login", "register"]) {
    app.get(`/${name}`, (req, res) => {
      if (userFromRequest(req)) return res.redirect("/");
      res.set("Cache-Control", "no-store");
      page(`${name}.html`)(req, res);
    });
  }

  app.use("/vendor", express.static(path.join(ROOT, "node_modules", "chart.js", "dist"), { index: false }));
  app.use(express.static(path.join(ROOT, "public"), { index: false }));

  // ---- auth API ----------------------------------------------------------

  const api = express.Router();
  api.use(requireCustomHeader);

  api.post("/auth/register", authLimiter, wrap(async (req, res) => {
    const email = V.validateEmail(req.body?.email);
    const password = V.validatePassword(req.body?.password);

    if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) {
      return res.status(409).json({ error: "An account with this email already exists.", field: "email" });
    }

    const hash = await bcrypt.hash(password, 12);
    const info = db.prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)").run(email, hash);
    const user = { id: Number(info.lastInsertRowid), email };
    issueSession(res, user);
    res.status(201).json({ user: { email } });
  }));

  api.post("/auth/login", authLimiter, wrap(async (req, res) => {
    const email = V.validateEmail(req.body?.email);
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    const row = db.prepare("SELECT id, email, password_hash FROM users WHERE email = ?").get(email);
    // Always run bcrypt so response time does not reveal whether the email exists.
    const ok = await bcrypt.compare(password, row ? row.password_hash : dummyHash);
    if (!row || !ok) return res.status(401).json({ error: "Incorrect email or password." });

    issueSession(res, row);
    res.json({ user: { email: row.email } });
  }));

  api.post("/auth/logout", (_req, res) => {
    res.clearCookie(COOKIE, { httpOnly: true, sameSite: "lax", secure: secureCookies, path: "/" });
    res.json({ ok: true });
  });

  api.get("/auth/me", requireAuth, (req, res) => res.json({ user: { email: req.user.email } }));

  // Everything below requires a session and is scoped to req.user.id.
  api.use(requireAuth);

  // ---- data API ----------------------------------------------------------

  const expenseOut = (r) => ({
    id: r.id, description: r.description, amount: V.fromPaise(r.amount_paise), date: r.date,
    category: r.category, payment: r.payment, source: r.source || undefined, pleasureId: r.pleasure_id || undefined
  });
  const incomeOut = (r) => ({
    id: r.id, description: r.description, amount: V.fromPaise(r.amount_paise), date: r.date, createdAt: r.created_at
  });

  api.get("/bootstrap", (req, res) => {
    const uid = req.user.id;
    const settings = db.prepare("SELECT monthly_income_default_paise AS m, pleasures_json AS p FROM user_settings WHERE user_id = ?").get(uid);
    res.json({
      user: { email: req.user.email },
      transfersTotal: V.fromPaise(db.prepare("SELECT COALESCE(SUM(amount_paise), 0) AS t FROM savings_transfers WHERE user_id = ?").get(uid).t),
      expenses: db.prepare("SELECT * FROM expenses WHERE user_id = ? ORDER BY date, rowid").all(uid).map(expenseOut),
      incomes: db.prepare("SELECT * FROM incomes WHERE user_id = ? ORDER BY date, rowid").all(uid).map(incomeOut),
      settings: {
        monthlyIncomeDefault: settings?.m ? V.fromPaise(settings.m) : 0,
        pleasures: settings?.p ? JSON.parse(settings.p) : null
      }
    });
  });

  api.post("/expenses", (req, res) => {
    const b = req.body || {};
    const category = V.CATEGORIES.includes(b.category) ? b.category : "Other";
    const payment = V.PAYMENTS.includes(b.payment) ? b.payment : "Other";
    const row = {
      id: uuid(),
      description: V.requireText(b.description, "description", 120),
      amount_paise: V.toPaise(b.amount),
      date: V.requireDate(b.date),
      category, payment,
      source: b.source === "pleasure" ? "pleasure" : null,
      pleasure_id: b.source === "pleasure" && typeof b.pleasureId === "string" ? b.pleasureId.slice(0, 64) : null
    };
    db.prepare(`INSERT INTO expenses (id, user_id, description, amount_paise, date, category, payment, source, pleasure_id)
                VALUES (@id, @uid, @description, @amount_paise, @date, @category, @payment, @source, @pleasure_id)`)
      .run({ ...row, uid: req.user.id });
    res.status(201).json({ expense: expenseOut(row) });
  });

  api.delete("/expenses/:id", (req, res) => {
    const info = db.prepare("DELETE FROM expenses WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
    if (!info.changes) return res.status(404).json({ error: "Expense not found." });
    res.json({ ok: true });
  });

  api.post("/incomes", (req, res) => {
    const b = req.body || {};
    const row = {
      id: uuid(),
      description: V.requireText(b.description, "description", 120),
      amount_paise: V.toPaise(b.amount),
      date: V.requireDate(b.date)
    };
    db.prepare("INSERT INTO incomes (id, user_id, description, amount_paise, date) VALUES (@id, @uid, @description, @amount_paise, @date)")
      .run({ ...row, uid: req.user.id });
    const saved = db.prepare("SELECT * FROM incomes WHERE id = ?").get(row.id);
    res.status(201).json({ income: incomeOut(saved) });
  });

  api.put("/settings", (req, res) => {
    const paise = V.toPaise(req.body?.monthlyIncomeDefault, "monthlyIncomeDefault");
    db.prepare(`INSERT INTO user_settings (user_id, monthly_income_default_paise) VALUES (?, ?)
                ON CONFLICT(user_id) DO UPDATE SET monthly_income_default_paise = excluded.monthly_income_default_paise`)
      .run(req.user.id, paise);
    res.json({ monthlyIncomeDefault: V.fromPaise(paise) });
  });

  api.put("/pleasures", (req, res) => {
    const list = req.body?.pleasures;
    if (!Array.isArray(list) || list.length > 50) throw new V.ValidationError("Invalid list.", "pleasures");
    const clean = list.map((p) => ({
      id: V.requireText(p?.id, "id", 64),
      name: V.requireText(p?.name, "name", 40),
      emoji: V.requireText(p?.emoji, "emoji", 8),
      amount: V.fromPaise(V.toPaise(p?.amount)),
      category: V.CATEGORIES.includes(p?.category) ? p.category : "Other",
      payment: V.PAYMENTS.includes(p?.payment) ? p.payment : "Other"
    }));
    db.prepare(`INSERT INTO user_settings (user_id, pleasures_json) VALUES (?, ?)
                ON CONFLICT(user_id) DO UPDATE SET pleasures_json = excluded.pleasures_json`)
      .run(req.user.id, JSON.stringify(clean));
    res.json({ pleasures: clean });
  });

  // ---- savings API -------------------------------------------------------

  api.get("/savings", (req, res) => {
    const today = V.isRealDate(req.query.today) ? req.query.today : new Date().toISOString().slice(0, 10);
    res.json(loadSavings(db, req.user.id, today.slice(0, 7)));
  });

  api.put("/savings/targets/:month", (req, res) => {
    const month = V.requireMonth(req.params.month);
    const paise = V.toPaise(req.body?.target, "target");
    db.prepare(`INSERT INTO savings_targets (user_id, month, target_paise) VALUES (?, ?, ?)
                ON CONFLICT(user_id, month) DO UPDATE SET target_paise = excluded.target_paise, updated_at = datetime('now')`)
      .run(req.user.id, month, paise);
    res.json({ month, target: V.fromPaise(paise) });
  });

  api.delete("/savings/targets/:month", (req, res) => {
    const month = V.requireMonth(req.params.month);
    const info = db.prepare("DELETE FROM savings_targets WHERE user_id = ? AND month = ?").run(req.user.id, month);
    if (!info.changes) return res.status(404).json({ error: "No target is set for that month." });
    res.json({ ok: true });
  });

  api.post("/savings/transfers", (req, res) => {
    const b = req.body || {};
    const paise = V.toPaise(b.amount);
    const date = V.requireDate(b.date);
    const note = V.optionalText(b.note, "note", 80);

    if (date > V.latestAllowedDate()) throw new V.ValidationError("Choose a date that is not in the future.", "date");

    const run = db.transaction(() => {
      const available = availablePaise(db, req.user.id);
      if (paise > available) {
        throw Object.assign(
          new V.ValidationError(`You can move up to ${V.formatRupees(available)} from your available balance.`, "amount"),
          { status: 422 }
        );
      }
      const id = uuid();
      db.prepare("INSERT INTO savings_transfers (id, user_id, amount_paise, date, note) VALUES (?, ?, ?, ?, ?)")
        .run(id, req.user.id, paise, date, note);
      return id;
    });

    const id = run();
    res.status(201).json({ transfer: { id, amount: V.fromPaise(paise), date, note } });
  });

  api.delete("/savings/transfers/:id", (req, res) => {
    const remove = db.transaction(() => {
      const row = db.prepare("SELECT amount_paise FROM savings_transfers WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
      if (!row) return null;

      // Money already earmarked for goals must stay covered by the savings wallet.
      const wallet = G.walletPaise(db, req.user.id);
      const allocated = G.allocatedPaise(db, req.user.id);
      if (wallet - row.amount_paise < allocated) {
        throw Object.assign(
          new V.ValidationError(`${V.formatRupees(allocated - (wallet - row.amount_paise))} of this transfer is allocated to goals. Release it from your goals first.`),
          { status: 422 }
        );
      }

      db.prepare("DELETE FROM savings_transfers WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
      return true;
    });

    if (!remove()) return res.status(404).json({ error: "Transfer not found." });
    res.json({ ok: true });
  });


  // ---- savings goals API -------------------------------------------------

  const todayOf = (req) => (V.isRealDate(req.query.today) ? req.query.today : new Date().toISOString().slice(0, 10));
  const MAX_GOALS = 50;

  function parseGoal(body, { keepDeadline } = {}) {
    const b = body || {};
    const deadline = V.requireDate(b.deadline, "deadline");
    if (deadline.slice(0, 4) > "2100") throw new V.ValidationError("Choose a deadline before the year 2100.", "deadline");
    if (deadline !== keepDeadline && deadline < V.earliestAllowedDate()) {
      throw new V.ValidationError("Choose a deadline that is not in the past.", "deadline");
    }

    const hasMonthly = b.monthlyContribution !== undefined && b.monthlyContribution !== null && b.monthlyContribution !== "";
    return {
      name: V.requireText(b.name, "name", 60),
      target: V.toPaise(b.target, "target"),
      deadline,
      monthly: hasMonthly ? V.toPaise(b.monthlyContribution, "monthlyContribution") : null
    };
  }

  const goalPayload = (req) => G.loadGoals(db, req.user.id, todayOf(req));

  function findGoal(req) {
    return db.prepare("SELECT * FROM goals WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  }

  api.get("/goals", (req, res) => res.json(goalPayload(req)));

  api.post("/goals", (req, res) => {
    const g = parseGoal(req.body);
    const uid = req.user.id;

    const { count, next } = db.prepare("SELECT COUNT(*) AS count, COALESCE(MAX(position), 0) + 1 AS next FROM goals WHERE user_id = ?").get(uid);
    if (count >= MAX_GOALS) throw Object.assign(new V.ValidationError(`You can keep up to ${MAX_GOALS} goals.`), { status: 422 });

    db.prepare(`INSERT INTO goals (id, user_id, name, target_paise, deadline, monthly_contribution_paise, position)
                VALUES (?, ?, ?, ?, ?, ?, ?)`).run(uuid(), uid, g.name, g.target, g.deadline, g.monthly, next);
    res.status(201).json(goalPayload(req));
  });

  // Fixed paths are declared before "/goals/:id" routes.
  api.post("/goals/reorder", (req, res) => {
    const ids = req.body?.ids;
    const owned = db.prepare("SELECT id FROM goals WHERE user_id = ?").all(req.user.id).map((r) => r.id);

    if (!Array.isArray(ids) || ids.length !== owned.length || new Set(ids).size !== ids.length || !ids.every((id) => owned.includes(id))) {
      throw new V.ValidationError("The priority list is out of date. Refresh and try again.", "ids");
    }

    db.transaction(() => {
      ids.forEach((id, i) => db.prepare("UPDATE goals SET position = ? WHERE id = ? AND user_id = ?").run(i + 1, id, req.user.id));
    })();
    res.json(goalPayload(req));
  });

  api.post("/goals/auto-allocate", (req, res) => {
    const given = db.transaction(() => G.autoAllocate(db, req.user.id))();
    res.json({
      ...goalPayload(req),
      distributed: V.fromPaise(given.reduce((a, g) => a + g.amountPaise, 0)),
      allocations: given.map((g) => ({ goalId: g.goalId, name: g.name, amount: V.fromPaise(g.amountPaise) }))
    });
  });

  api.put("/goals/:id", (req, res) => {
    const row = findGoal(req);
    if (!row) return res.status(404).json({ error: "Goal not found." });

    const g = parseGoal(req.body, { keepDeadline: row.deadline });
    if (g.target < row.allocated_paise) {
      throw Object.assign(
        new V.ValidationError(`The target cannot be below the ${V.formatRupees(row.allocated_paise)} already allocated. Release some money first.`, "target"),
        { status: 422 }
      );
    }

    db.prepare("UPDATE goals SET name = ?, target_paise = ?, deadline = ?, monthly_contribution_paise = ? WHERE id = ? AND user_id = ?")
      .run(g.name, g.target, g.deadline, g.monthly, row.id, req.user.id);
    res.json(goalPayload(req));
  });

  api.delete("/goals/:id", (req, res) => {
    const info = db.prepare("DELETE FROM goals WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
    if (!info.changes) return res.status(404).json({ error: "Goal not found." });
    res.json(goalPayload(req)); // its allocation returns to the savings wallet
  });

  api.post("/goals/:id/allocate", (req, res) => {
    const paise = V.toPaise(req.body?.amount);

    const result = db.transaction(() => {
      const row = findGoal(req);
      if (!row) return { status: 404, error: "Goal not found." };

      const need = row.target_paise - row.allocated_paise;
      const pool = G.unallocatedPaise(db, req.user.id);

      if (need <= 0) return { status: 422, error: "This goal is already fully funded.", field: "amount" };
      if (paise > pool) {
        return { status: 422, field: "amount", error: pool > 0
          ? `Your savings wallet only has ${V.formatRupees(pool)} left.`
          : "Your savings wallet is empty. Move money into it first." };
      }
      if (paise > need) return { status: 422, error: `This goal only needs ${V.formatRupees(need)} more.`, field: "amount" };

      db.prepare("UPDATE goals SET allocated_paise = allocated_paise + ? WHERE id = ? AND user_id = ?").run(paise, row.id, req.user.id);
      return { status: 200 };
    })();

    if (result.status !== 200) return res.status(result.status).json({ error: result.error, field: result.field });
    res.json(goalPayload(req));
  });

  api.post("/goals/:id/release", (req, res) => {
    const paise = V.toPaise(req.body?.amount);
    const row = findGoal(req);
    if (!row) return res.status(404).json({ error: "Goal not found." });
    if (paise > row.allocated_paise) {
      return res.status(422).json({ error: `Only ${V.formatRupees(row.allocated_paise)} is allocated to this goal.`, field: "amount" });
    }

    db.prepare("UPDATE goals SET allocated_paise = allocated_paise - ? WHERE id = ? AND user_id = ?").run(paise, row.id, req.user.id);
    res.json(goalPayload(req));
  });

  // ---- spending breakdown API --------------------------------------------

  api.get("/breakdown", (req, res) => {
    const month = V.requireMonth(req.query.month);
    const reduce = req.query.reduce === undefined ? 20 : Number(req.query.reduce);
    if (!Number.isInteger(reduce) || reduce < 1 || reduce > 90) {
      throw new V.ValidationError("Choose a reduction between 1% and 90%.", "reduce");
    }
    res.json(loadBreakdown(db, req.user.id, month, reduce));
  });

  api.put("/settings/discretionary", (req, res) => {
    const list = req.body?.categories;
    if (!Array.isArray(list) || !list.every((c) => V.CATEGORIES.includes(c))) {
      throw new V.ValidationError("Choose from the available categories.", "categories");
    }
    const clean = [...new Set(list)];
    db.prepare(`INSERT INTO user_settings (user_id, discretionary_json) VALUES (?, ?)
                ON CONFLICT(user_id) DO UPDATE SET discretionary_json = excluded.discretionary_json`)
      .run(req.user.id, JSON.stringify(clean));
    res.json({ categories: loadDiscretionary(db, req.user.id) });
  });

  api.use((_req, res) => res.status(404).json({ error: "Not found." }));
  app.use("/api", api);

  // ---- errors ------------------------------------------------------------

  app.use((err, _req, res, _next) => {
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid request body." });
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message, field: err.field });
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  });

  return app;
}

module.exports = { createApp };
