require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const authRoutes = require('./routes/authRoutes');
const clientRoutes = require('./routes/clientRoutes');
const serviceRoutes = require('./routes/serviceRoutes');
const quoteRoutes = require('./routes/quoteRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const expenseRoutes = require('./routes/expenseRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const reportRoutes = require('./routes/reportRoutes');
const insightsRoutes = require('./routes/insightsRoutes');
const webhookRoutes = require('./routes/webhookRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({
  contentSecurityPolicy: false,
}));

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
});

app.use(limiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/pages/index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/pages/login.html'));
});

app.get('/signup', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/pages/signup.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/pages/dashboard.html'));
});

app.get('/clients', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/pages/clients.html'));
});

app.get('/services', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/pages/services.html'));
});

app.get('/quotes', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/pages/quotes.html'));
});

app.get('/invoices', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/pages/invoices.html'));
});

app.get('/payments', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/pages/payments.html'));
});

app.get('/expenses', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/pages/expenses.html'));
});

app.get('/cashflow', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/pages/cashflow.html'));
});

app.get('/reports', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/pages/reports.html'));
});

app.get('/insights', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/pages/insights.html'));
});

app.get('/settings', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/pages/settings.html'));
});

app.use('/api/auth', authRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/quotes', quoteRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/insights', insightsRoutes);
app.use('/api/webhooks', webhookRoutes);

app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'healthy', timestamp: new Date().toISOString() });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`PayShield server running on http://localhost:${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

module.exports = app;
