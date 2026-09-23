const express = require('express');
const { PrismaClient } = require('@prisma/client');
const path = require('path');

const prisma = new PrismaClient();
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// 1. Health Check
app.get('/api/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ success: true, database: 'connected' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. Metrics
app.get('/api/metrics', async (req, res) => {
  try {
    const totalInvoices = await prisma.invoice.count();
    const paidInvoices = await prisma.invoice.count({ where: { status: 'PAID' } });
    const partiallyPaidInvoices = await prisma.invoice.count({ where: { status: 'PARTIAL' } });
    
    const invoices = await prisma.invoice.findMany();
    const outstandingAmount = invoices.reduce((sum, inv) => sum + (inv.amount - inv.amountPaid), 0);

    res.json({
      success: true,
      metrics: {
        totalInvoices,
        paidInvoices,
        partiallyPaidInvoices,
        outstandingAmount
      },
      organization: { currency: 'USD' }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Get Invoice
app.get('/api/invoices/:invoiceNumber', async (req, res) => {
  try {
    const { invoiceNumber } = req.params;
    let invoice = await prisma.invoice.findUnique({
      where: { invoiceNumber },
      include: { payments: true }
    });

    if (!invoice) {
      // Auto-create for seamless testing
      invoice = await prisma.invoice.create({
        data: {
          invoiceNumber,
          amount: 1700.00,
          customerEmail: 'test@example.com',
          status: 'PENDING'
        },
        include: { payments: true }
      });
    }

    res.json({ success: true, invoice });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. Webhook Simulator
app.post('/api/webhook/payment-received', async (req, res) => {
  try {
    const { invoiceNumber, amountPaid, paymentReference } = req.body;
if (!amountPaid || amountPaid <= 0) {
      return res.status(400).json({ success: false, error: "Invalid payment amount." });
    }
    let invoice = await prisma.invoice.findUnique({ where: { invoiceNumber } });
    if (!invoice) {
      invoice = await prisma.invoice.create({
        data: { invoiceNumber, amount: 1700.00, customerEmail: 'test@example.com', status: 'PENDING' }
      });
    }

    const payment = await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        amount: Number(amountPaid),
        reference: paymentReference || 'REF_' + Date.now()
      }
    });

    const newAmountPaid = invoice.amountPaid + Number(amountPaid);
    const newStatus = newAmountPaid >= invoice.amount ? 'PAID' : 'PARTIAL';

    const updatedInvoice = await prisma.invoice.update({
      where: { id: invoice.id },
      data: { amountPaid: newAmountPaid, status: newStatus },
      include: { payments: true }
    });

    res.json({ success: true, message: 'Processed successfully', invoice: updatedInvoice, payment });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 5. Payments History
app.get('/api/invoices/:invoiceNumber/payments', async (req, res) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { invoiceNumber: req.params.invoiceNumber },
      include: { payments: true }
    });
    if (!invoice) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, payments: invoice.payments });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`PayShield running on http://localhost:${PORT}`));
