require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const sanitizeHtml = require('sanitize-html');
const validator = require('validator');
const { Resend } = require('resend');

const app = express();
const PORT = process.env.PORT || 5000;

// ==========================================
// SECURITY & GLOBAL MIDDLEWARE
// ==========================================
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests from this IP, please try again later.' }
});
app.use(globalLimiter);

const resend = new Resend(process.env.RESEND_API_KEY);

// ==========================================
// MOCK DATABASE & SUBSCRIPTION TIERS HIERARCHY
// ==========================================
const TIER_HIERARCHY = { free: 0, starter: 1, pro: 2, business: 3 };

// Mock user profile (Change plan to 'starter', 'pro', or 'business' to test restrictions)
const mockUserStore = {
  id: "user_2026_demo",
  email: "kimanthidennis04@gmail.com",
  plan: "pro", 
  subscriptionStatus: "active"
};

// ==========================================
// SUBSCRIPTION & TIER GATING MIDDLEWARE
// ==========================================
function requireTier(minimumPlan) {
  return (req, res, next) => {
    try {
      const user = mockUserStore; 
      const userTierValue = TIER_HIERARCHY[user.plan] || 0;
      const requiredTierValue = TIER_HIERARCHY[minimumPlan] || 0;

      if (user.subscriptionStatus !== 'active' && minimumPlan !== 'free') {
        return res.status(403).send(`
          <html><body style="background:#0f172a;color:#f8fafc;font-family:monospace;padding:40px;">
          <h2 style="color:#f87171;">⛔ Access Denied</h2>
          <p>An active subscription is required to execute this workflow.</p>
          <a href="/" style="color:#38bdf8;">← Return to Dashboard</a>
          </body></html>
        `);
      }

      if (userTierValue >= requiredTierValue) {
        req.user = user;
        return next();
      } else {
        return res.status(403).send(`
          <html><body style="background:#0f172a;color:#f8fafc;font-family:monospace;padding:40px;">
          <h2 style="color:#f87171;">🔒 Tier Upgrade Required</h2>
          <p>This advanced feature requires the <strong>${minimumPlan.toUpperCase()}</strong> plan or higher. You are currently on the <em>${user.plan.toUpperCase()}</em> tier.</p>
          <a href="/" style="color:#38bdf8;">← Return to Dashboard</a>
          </body></html>
        `);
      }
    } catch (err) {
      res.status(500).send({ error: "Internal authorization processing error." });
    }
  };
}

// ==========================================
// ROUTES & CONTROLLERS
// ==========================================

// 1. Main Dashboard (Command Center)
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>PayShield Pro - Freelancer SaaS Hub</title>
      <style>
        :root { background: #0f172a; color: #f8fafc; font-family: monospace; }
        body { padding: 30px; display: flex; justify-content: center; }
        .container { width: 100%; max-width: 650px; }
        .card { background: #1e293b; padding: 25px; border-radius: 10px; border: 1px solid #334155; margin-bottom: 20px; }
        .badge { display: inline-block; padding: 4px 8px; font-size: 11px; background: #38bdf8; color: #0f172a; border-radius: 4px; font-weight: bold; margin-bottom: 10px;}
        label { display: block; margin-top: 12px; font-size: 12px; color: #94a3b8; }
        input, select, button { width: 100%; padding: 10px; margin-top: 4px; border-radius: 6px; border: 1px solid #475569; box-sizing: border-box; }
        input, select { background: #0f172a; color: #fff; }
        button { background: #38bdf8; color: #0f172a; font-weight: bold; cursor: pointer; border: none; margin-top: 15px; transition: background 0.2s; }
        button:hover { background: #7dd3fc; }
        h3 { margin-top: 0; color: #38bdf8; font-size: 16px; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="card">
          <span class="badge">ACTIVE PLAN: ${mockUserStore.plan.toUpperCase()}</span>
          <h2>PayShield Freelance Suite</h2>
          <p style="color:#94a3b8; font-size:12px;">Lean infrastructure for independent professionals.</p>
        </div>

        <!-- FEATURE 1: Dunning & Recovery (Starter Tier) -->
        <div class="card">
          <h3>⚡ Automated Dunning Dispatch</h3>
          <form action="/api/v1/dispatch-dunning" method="POST">
            <label>Client Name & Email:</label>
            <div class="grid">
              <input type="text" name="name" required placeholder="John Doe"/>
              <input type="email" name="email" required placeholder="john@example.com"/>
            </div>
            <label>Amount Due ($) & Payment URL:</label>
            <div class="grid">
              <input type="number" name="amount" required placeholder="500"/>
              <input type="text" name="payUrl" required placeholder="https://pay.stripe.com/..."/>
            </div>
            <button type="submit">Dispatch Overdue Notice</button>
          </form>
        </div>

        <!-- FEATURE 2: Time Tracker to Invoice (Pro Tier) -->
        <div class="card">
          <h3>⏱️ Time Tracker to Invoice Converter (Pro)</h3>
          <form action="/api/v1/convert-time" method="POST">
            <label>Task Description:</label>
            <input type="text" name="task" required placeholder="API Backend Integration"/>
            <label>Hours Tracked & Hourly Rate ($):</label>
            <div class="grid">
              <input type="number" step="0.5" name="hours" required placeholder="12.5"/>
              <input type="number" name="rate" required placeholder="45"/>
            </div>
            <button type="submit" style="background:#4ade80; color:#0f172a;">Generate Instant Invoice</button>
          </form>
        </div>

        <!-- FEATURE 3: Smart Tax & Earnings Estimator (Pro Tier) -->
        <div class="card">
          <h3>📊 Smart Tax & Earnings Estimator (Pro)</h3>
          <form action="/api/v1/estimate-tax" method="POST">
            <label>Total Monthly Gross Income ($):</label>
            <input type="number" name="grossIncome" required placeholder="4200"/>
            <label>Estimated Local Tax Bracket (%):</label>
            <input type="number" name="taxRate" required placeholder="15"/>
            <button type="submit" style="background:#c084fc; color:#0f172a;">Calculate Net Earnings & Safe Tax Pool</button>
          </form>
        </div>

        <!-- FEATURE 4: Client Portal Link Generator (Business Tier) -->
        <div class="card">
          <h3>⚙️ Secure Client Portal Link (Business)</h3>
          <form action="/api/v1/client-portal" method="POST">
            <label>Project Workspace ID / Client Code:</label>
            <input type="text" name="projectCode" required placeholder="project_alpha_99"/>
            <button type="submit" style="background:#fbbf24; color:#0f172a;">Generate White-Label Portal Link</button>
          </form>
        </div>

      </div>
    </body>
    </html>
  `);
});

// ==========================================
// API WORKFLOW ENDPOINTS (TIER GATED)
// ==========================================

// 1. Dunning Route (Starter Tier)
app.post('/api/v1/dispatch-dunning', requireTier('starter'), async (req, res) => {
  const name = sanitizeHtml(req.body.name);
  const email = validator.normalizeEmail(req.body.email);
  const amount = sanitizeHtml(req.body.amount);
  const payUrl = sanitizeHtml(req.body.payUrl);

  let statusMsg = 'Pending';
  try {
    if (process.env.RESEND_API_KEY) {
     await resend.emails.send({
        from: 'PayShield <onboarding@resend.dev>',
        to: email,
        subject: `Overdue Invoice Notice: ${amount}`,
        html: `<p>Hi ${name},</p><p>Your invoice for <strong>${amount}</strong> is due. Pay here: <a href="${payUrl}">${payUrl}</a></p>`,
      });
      
      statusMsg = 'Email successfully sent via Resend API.';
    } else {
      statusMsg = 'Simulated dispatch (RESEND_API_KEY not configured).';
    }
  } catch (err) {
    statusMsg = `Error: ${err.message}`;
  }

  res.send(`
    <html><body style="background:#0f172a;color:#f8fafc;font-family:monospace;padding:40px;">
    <h3 style="color:#4ade80;">✔️ Dunning Sequence Executed</h3>
    <p><strong>Status:</strong> ${statusMsg}</p>
    <p>Notice for $${amount} routed to ${email}</p>
    <a href="/" style="color:#38bdf8;">← Return to Dashboard</a>
    </body></html>
  `);
});

// 2. Time Tracker to Invoice Route (Pro Tier)
app.post('/api/v1/convert-time', requireTier('pro'), (req, res) => {
  const task = sanitizeHtml(req.body.task);
  const hours = parseFloat(sanitizeHtml(req.body.hours));
  const rate = parseFloat(sanitizeHtml(req.body.rate));
  
  if (isNaN(hours) || isNaN(rate)) {
    return res.status(400).send("Invalid calculation parameters.");
  }

  const totalBill = hours * rate;

  res.send(`
    <html><body style="background:#0f172a;color:#f8fafc;font-family:monospace;padding:40px;">
    <h3 style="color:#4ade80;">⏱️ Billable Hours Converted Successfully</h3>
    <p><strong>Task:</strong> ${task}</p>
    <p><strong>Time Logged:</strong> ${hours} hours @ $${rate}/hr</p>
    <p style="font-size: 18px; color:#38bdf8;"><strong>Total Invoice Amount:</strong> $${totalBill.toFixed(2)}</p>
    <a href="/" style="color:#38bdf8;">← Return to Dashboard</a>
    </body></html>
  `);
});

// 3. Smart Tax & Earnings Estimator (Pro Tier)
app.post('/api/v1/estimate-tax', requireTier('pro'), (req, res) => {
  const grossIncome = parseFloat(sanitizeHtml(req.body.grossIncome));
  const taxRate = parseFloat(sanitizeHtml(req.body.taxRate));

  if (isNaN(grossIncome) || isNaN(taxRate)) {
    return res.status(400).send("Invalid numbers provided.");
  }

  const estimatedTax = grossIncome * (taxRate / 100);
  const netEarnings = grossIncome - estimatedTax;

  res.send(`
    <html><body style="background:#0f172a;color:#f8fafc;font-family:monospace;padding:40px;">
    <h3 style="color:#c084fc;">📊 Financial & Tax Breakdown Computed</h3>
    <p><strong>Gross Monthly Revenue:</strong> $${grossIncome.toFixed(2)}</p>
    <p><strong>Recommended Tax Pool Reserve (${taxRate}%):</strong> <span style="color:#f87171;">$${estimatedTax.toFixed(2)}</span></p>
    <p style="font-size: 18px; color:#4ade80;"><strong>Safe Net Take-Home Earnings:</strong> $${netEarnings.toFixed(2)}</p>
    <a href="/" style="color:#38bdf8;">← Return to Dashboard</a>
    </body></html>
  `);
});

// 4. Secure Client Portal Link Generator (Business Tier)
app.post('/api/v1/client-portal', requireTier('business'), (req, res) => {
  const projectCode = sanitizeHtml(req.body.projectCode);
  const securePortalUrl = `https://portal.payshield.app/client/${projectCode}-${Date.now().toString(36)}`;

  res.send(`
    <html><body style="background:#0f172a;color:#f8fafc;font-family:monospace;padding:40px;">
    <h3 style="color:#fbbf24;">⚙️ White-Label Client Portal Active</h3>
    <p>Secure isolated portal generated for workspace identifier: <strong>${projectCode}</strong></p>
    <p><strong>Shareable Client Link:</strong> <a href="#" style="color:#38bdf8;">${securePortalUrl}</a></p>
    <a href="/" style="color:#38bdf8;">← Return to Dashboard</a>
    </body></html>
  `);
});

// ==========================================
// SERVER LISTENER
// ==========================================
app.listen(PORT, () => {
  console.log('=================================');
  console.log('PayShield SaaS Suite Running');
  console.log(`Open Browser: http://localhost:${PORT}`);
  console.log('=================================');
});