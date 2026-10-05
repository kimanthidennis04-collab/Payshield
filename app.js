const express = require('express');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Bulletproof helper: Dynamically finds or creates organization and client safely
async function getOrCreateDefaultClient() {
  let org = await prisma.organization.findFirst();
  if (!org) {
    org = await prisma.organization.create({
      data: { name: 'PayShield Enterprise', currency: 'USD' }
    });
  }

  let client = await prisma.client.findFirst({ 
    where: { organizationId: org.id } 
  });
  
  if (!client) {
    client = await prisma.client.create({
      data: {
        organizationId: org.id,
        name: 'Default Test Client',
        email: 'test@example.com',
        phone: '+254700000000'
      }
    });
  }
  return client;
}

// Startup initialization
async function initializeApp() {
  try {
    await getOrCreateDefaultClient();
    console.log('Database initialized successfully.');
  } catch (err) {
    console.error('Error initializing database:', err.message);
  }
}

// 1. Dashboard Route
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// 2. Health Check Route
app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'healthy' });
});

// 3. Metrics Route
app.get('/api/metrics', async (req, res) => {
  try {
    const defaultClient = await getOrCreateDefaultClient();
    const invoices = await prisma.invoice.findMany({ include: { payments: true } });
    const totalInvoices = invoices.length;
    const paidInvoices = invoices.filter(i => i.status === 'PAID' || i.status === 'Paid').length;
    const partiallyPaidInvoices = invoices.filter(i => i.status === 'PARTIAL').length;
    
    let outstandingAmount = 0;
    invoices.forEach(inv => {
      const paidSum = inv.payments.reduce((acc, p) => acc + p.amount, 0);
      if (inv.status !== 'PAID' && inv.status !== 'Paid') {
        outstandingAmount += (inv.amount - paidSum);
      }
    });

    const org = await prisma.organization.findUnique({ where: { id: defaultClient.organizationId } });

    res.json({
      success: true,
      metrics: { totalInvoices, paidInvoices, partiallyPaidInvoices, outstandingAmount },
      organization: { currency: org?.currency || 'USD' }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. Clients Routes
app.get('/api/clients', async (req, res) => {
  try {
    const clients = await prisma.client.findMany();
    res.json(clients);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch clients' });
  }
});

app.post('/api/clients', async (req, res) => {
  try {
    const { name, email } = req.body;
    let org = await prisma.organization.findFirst();
    if (!org) {
      org = await prisma.organization.create({ data: { name: 'Default Organization', currency: 'USD' } });
    }
    const newClient = await prisma.client.create({
      data: { name, email, organizationId: org.id }
    });
    res.json(newClient);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create client' });
  }
});

app.delete('/api/clients/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.client.delete({ where: { id: parseInt(id) } });
    res.json({ success: true, message: `Client ${id} deleted successfully` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/clear-clients', async (req, res) => {
  try {
    await prisma.client.deleteMany({});
    res.json({ success: true, message: 'All clients cleared successfully!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Invoices Routes (Combined & Fixed with Deliverable Support)
app.get('/api/invoices', async (req, res) => {
  try {
    const invoices = await prisma.invoice.findMany({
      include: { client: true, payments: true, deliverable: true }
    });
    res.json(invoices);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/invoices/:invoiceNumber', async (req, res) => {
  try {
    const { invoiceNumber } = req.params;
    let invoice = await prisma.invoice.findUnique({
      where: { invoiceNumber },
      include: { client: true, payments: true, deliverable: true }
    });

    if (!invoice) {
      const defaultClient = await getOrCreateDefaultClient();
      invoice = await prisma.invoice.create({
        data: {
          invoiceNumber,
          amount: 1700.00,
          status: 'PENDING',
          organizationId: defaultClient.organizationId,
          clientId: defaultClient.id
        },
        include: { client: true, payments: true, deliverable: true }
      });
    }

    res.json({ success: true, invoice });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/invoices', async (req, res) => {
  try {
    const { invoiceNumber, amount, tax, discount, clientId, organizationId, dueDate, deliverableTitle, lockedUrl } = req.body;
    const defaultClient = await getOrCreateDefaultClient();
    
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber,
        amount: parseFloat(amount),
        tax: tax ? parseFloat(tax) : 0.0,
        discount: discount ? parseFloat(discount) : 0.0,
        status: 'Sent',
        clientId: clientId ? parseInt(clientId) : defaultClient.id,
        organizationId: organizationId ? parseInt(organizationId) : defaultClient.organizationId,
        dueDate: dueDate ? new Date(dueDate) : null,
        deliverable: deliverableTitle ? {
          create: {
            title: deliverableTitle,
            lockedUrl: lockedUrl || '#',
            isUnlocked: false
          }
        } : undefined
      },
      include: { deliverable: true, client: true }
    });

    res.json({ success: true, invoice });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 6. Payments & Automatic Deliverable Unlocking Route
app.post('/api/payments', async (req, res) => {
  try {
    const { amount, status, reference, invoiceId } = req.body;
    const invId = parseInt(invoiceId);
    const paidAmount = parseFloat(amount);

    const payment = await prisma.payment.create({
      data: {
        amount: paidAmount,
        status: status || 'SUCCESS',
        reference: reference || 'DIRECT-PAY',
        invoiceId: invId
      }
    });

    const invoice = await prisma.invoice.findUnique({
      where: { id: invId },
      include: { payments: true, deliverable: true }
    });

    const totalPaid = invoice.payments.reduce((sum, p) => sum + p.amount, 0);

    if (totalPaid >= invoice.amount) {
      await prisma.invoice.update({
        where: { id: invId },
        data: { status: 'Paid' }
      });

      if (invoice.deliverable) {
        await prisma.deliverable.update({
          where: { invoiceId: invId },
          data: { isUnlocked: true }
        });
      }
    }

    res.json({ success: true, payment, invoiceFullyPaid: totalPaid >= invoice.amount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/payments', async (req, res) => {
  try {
    const payments = await prisma.payment.findMany({ include: { invoice: true } });
    res.json(payments);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 7. Webhook Payment Received Route
app.post('/api/webhook/payment-received', async (req, res) => {
  try {
    const { invoiceNumber, amountPaid } = req.body;
    let invoice = await prisma.invoice.findUnique({ 
      where: { invoiceNumber: invoiceNumber || 'INV-1001' },
      include: { payments: true, deliverable: true }
    });

    const defaultClient = await getOrCreateDefaultClient();

    if (!invoice) {
      invoice = await prisma.invoice.create({
        data: {
          invoiceNumber: invoiceNumber || 'INV-1001',
          amount: 1700.00,
          status: 'PENDING',
          organizationId: defaultClient.organizationId,
          clientId: defaultClient.id
        },
        include: { payments: true, deliverable: true }
      });
    }

    const payment = await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        amount: amountPaid ? parseFloat(amountPaid) : invoice.amount,
        status: 'SUCCESS'
      }
    });

    const updatedPayments = await prisma.payment.findMany({ where: { invoiceId: invoice.id } });
    const totalPaid = updatedPayments.reduce((acc, p) => acc + p.amount, 0);
    
    let newStatus = 'PENDING';
    if (totalPaid >= invoice.amount) {
      newStatus = 'Paid';
      if (invoice.deliverable) {
        await prisma.deliverable.update({
          where: { invoiceId: invoice.id },
          data: { isUnlocked: true }
        });
      }
    } else if (totalPaid > 0) {
      newStatus = 'PARTIAL';
    }

    const updatedInvoice = await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: newStatus },
      include: { client: true, payments: true, deliverable: true }
    });

    res.json({ success: true, message: 'Payment processed successfully', invoice: updatedInvoice, payment });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 8. Organizations & Quotes & Other Routes
app.get('/api/organizations', async (req, res) => {
  try {
    const orgs = await prisma.organization.findMany();
    res.json(orgs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/organizations', async (req, res) => {
  try {
    const { name, currency } = req.body;
    const org = await prisma.organization.create({ data: { name, currency } });
    res.json({ success: true, org });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/quotes', async (req, res) => {
  try {
    const quotes = await prisma.quote.findMany();
    res.json(quotes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/quotes', async (req, res) => {
  try {
    const { quoteNumber, clientName, amount, validUntil } = req.body;
    const quote = await prisma.quote.create({
      data: { quoteNumber, clientName, amount: parseFloat(amount), validUntil: validUntil ? new Date(validUntil) : null }
    });
    res.json({ success: true, quote });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/webhooklogs', async (req, res) => {
  try {
    const logs = await prisma.webhookLog.findMany();
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 9. Auth & AI Insights Routes
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, name } = req.body;
    const existingUser = await prisma.client.findFirst({ where: { email } });
    if (existingUser) return res.status(400).json({ error: 'User already exists' });
    
    let org = await prisma.organization.findFirst();
    if (!org) {
      org = await prisma.organization.create({ data: { name: 'Default Organization', currency: 'USD' } });
    }

    const client = await prisma.client.create({ 
      data: { name, email, organizationId: org.id } 
    });
    
    res.json({ success: true, message: 'Account created successfully', client });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await prisma.client.findFirst({ where: { email } });
    if (!user) return res.status(404).json({ error: 'User not found. Please sign up first.' });
    res.json({ success: true, message: 'Logged in successfully', user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/ai/cashflow-insights', async (req, res) => {
  try {
    const invoices = await prisma.invoice.findMany({ include: { payments: true, client: true } });
    const payments = await prisma.payment.findMany();

    let totalCollected = payments.reduce((sum, p) => sum + p.amount, 0);
    let totalOutstanding = 0;
    let highRiskClients = [];

    invoices.forEach(inv => {
      const paid = inv.payments.reduce((sum, p) => sum + p.amount, 0);
      const balance = inv.amount - paid;
      if (inv.status !== 'Paid' && balance > 0) {
        totalOutstanding += balance;
        if (inv.dueDate && new Date(inv.dueDate) < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) {
          highRiskClients.push({ client: inv.client?.name || 'Unknown', invoice: inv.invoiceNumber, amountDue: balance });
        }
      }
    });

    let prediction = totalOutstanding > totalCollected 
      ? "⚠️ Warning: Outstanding receivables exceed total cash collected." 
      : "✅ Healthy Cash Flow: Collection rate is stable.";

    res.json({
      success: true,
      aiInsights: {
        predictionSummary: prediction,
        totalCollected,
        totalOutstanding,
        highRiskInvoices: highRiskClients,
        recommendation: highRiskClients.length > 0 ? "Trigger automated reminders." : "No urgent action required."
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/ai/generate-reminder', async (req, res) => {
  try {
    const { clientName, invoiceNumber, amountDue, tone } = req.body; 
    let message = tone === 'firm' 
      ? `Hello ${clientName}, invoice ${invoiceNumber} for $${amountDue} is overdue. Kindly settle it.`
      : `Hi ${clientName}, friendly reminder that invoice ${invoiceNumber} for $${amountDue} is pending.`;
    res.json({ success: true, generatedMessage: message });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/dashboard/metrics', async (req, res) => {
  try {
    const invoices = await prisma.invoice.findMany({ include: { payments: true } });
    const payments = await prisma.payment.findMany();

    let totalCollected = payments.reduce((sum, p) => sum + p.amount, 0);
    let outstandingReceivables = 0;
    let overdueCount = 0;
    let paidCount = 0;

    invoices.forEach(inv => {
      const paid = inv.payments.reduce((sum, p) => sum + p.amount, 0);
      if (inv.status === 'Paid') {
        paidCount++;
      } else {
        outstandingReceivables += (inv.amount - paid);
        if (inv.dueDate && new Date(inv.dueDate) < new Date()) {
          overdueCount++;
        }
      }
    });

    res.json({
      totalCollected,
      outstandingReceivables,
      overdueInvoices: overdueCount,
      paidInvoices: paidCount,
      totalInvoicesCount: invoices.length,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start Server
initializeApp().then(() => {
  app.listen(PORT, () => {
    console.log(`PayShield Enterprise running on http://localhost:${PORT}`);
  });
});
