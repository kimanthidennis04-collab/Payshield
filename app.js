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
  // 1. Find the first organization, or create one if none exist
  let org = await prisma.organization.findFirst();
  if (!org) {
    org = await prisma.organization.create({
      data: { 
        name: 'PayShield Enterprise', 
        currency: 'USD' 
      }
    });
  }

  // 2. Find or create a default client linked to this organization
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
    const paidInvoices = invoices.filter(i => i.status === 'PAID').length;
    const partiallyPaidInvoices = invoices.filter(i => i.status === 'PARTIAL').length;
    
    let outstandingAmount = 0;
    invoices.forEach(inv => {
      const paidSum = inv.payments.reduce((acc, p) => acc + p.amount, 0);
      if (inv.status !== 'PAID') {
        outstandingAmount += (inv.amount - paidSum);
      }
    });

    const org = await prisma.organization.findUnique({ where: { id: defaultClient.organizationId } });

    res.json({
      success: true,
      metrics: {
        totalInvoices,
        paidInvoices,
        partiallyPaidInvoices,
        outstandingAmount
      },
      organization: {
        currency: org?.currency || 'USD'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. Get or Auto-Create Invoice with Client Relation
app.get('/api/invoices/:invoiceNumber', async (req, res) => {
  try {
    const { invoiceNumber } = req.params;
    let invoice = await prisma.invoice.findUnique({
      where: { invoiceNumber },
      include: { client: true, payments: true }
    });

    if (!invoice) {
      const defaultClient = await getOrCreateDefaultClient();
      
      invoice = await prisma.invoice.create({
        data: {
          invoiceNumber: invoiceNumber,
          amount: 1700.00,
          status: 'PENDING',
          organizationId: defaultClient.organizationId,
          clientId: defaultClient.id
        },
        include: { client: true, payments: true }
      });
    }

    res.json({ success: true, invoice });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 5. Invoice Payments Endpoint
app.get('/api/invoices/:invoiceNumber/payments', async (req, res) => {
  try {
    const { invoiceNumber } = req.params;
    const invoice = await prisma.invoice.findUnique({
      where: { invoiceNumber },
      include: { payments: true }
    });

    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Invoice not found' });
    }

    res.json({ success: true, payments: invoice.payments });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 6. Webhook Payment Received Route
app.post('/api/webhook/payment-received', async (req, res) => {
  try {
    const { invoiceNumber, amountPaid } = req.body;
    let invoice = await prisma.invoice.findUnique({ 
      where: { invoiceNumber: invoiceNumber || 'INV-1001' },
      include: { payments: true }
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
        include: { payments: true }
      });
    }

    const payment = await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        amount: amountPaid ? parseFloat(amountPaid) : invoice.amount,
        status: 'SUCCESS'
      }
    });

    // Re-fetch all payments for accurate calculation
    const updatedPayments = await prisma.payment.findMany({ where: { invoiceId: invoice.id } });
    const totalPaid = updatedPayments.reduce((acc, p) => acc + p.amount, 0);
    
    let newStatus = 'PENDING';
    if (totalPaid >= invoice.amount) {
      newStatus = 'PAID';
    } else if (totalPaid > 0) {
      newStatus = 'PARTIAL';
    }

    const updatedInvoice = await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: newStatus },
      include: { client: true, payments: true }
    });

    res.json({ success: true, message: 'Payment processed successfully', invoice: updatedInvoice, payment });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
// 4. Clients Route
app.get('/api/clients', async (req, res) => {
  try {
    const clients = await prisma.client.findMany();
    res.json(clients);
  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({ error: 'Failed to fetch clients' });
  }
});
// Additional Prisma Model Routes for Dashboard Tabs
app.get('/api/invoices', async (req, res) => {
  try {
    const invoices = await prisma.invoice.findMany({ include: { client: true, payments: true } });
    res.json(invoices);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/organizations', async (req, res) => {
  try {
    const orgs = await prisma.organization.findMany();
    res.json(orgs);
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

app.get('/api/webhooklogs', async (req, res) => {
  try {
    const logs = await prisma.webhookLog.findMany();
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- User Authentication Route ---
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, name } = req.body;
    const existingUser = await prisma.client.findFirst({ where: { email } });
    if (existingUser) return res.status(400).json({ error: 'User already exists' });
    
    // Find or create a default organization so Prisma doesn't throw an error
    let org = await prisma.organization.findFirst();
    if (!org) {
      org = await prisma.organization.create({ data: { name: 'Default Organization', currency: 'USD' } });
    }

    const client = await prisma.client.create({ 
      data: { 
        name, 
        email,
        organization: { connect: { id: org.id } }
      } 
    });
    
    res.json({ success: true, message: 'Account created successfully', client });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// --- AI Cash-Flow Insights & Forecasting ---
app.get('/api/ai/cashflow-insights', async (req, res) => {
  try {
    const invoices = await prisma.invoice.findMany({ include: { payments: true, client: true } });
    const payments = await prisma.payment.findMany();

    const totalCollected = payments.reduce((sum, p) => sum + p.amount, 0);
    let totalOutstanding = 0;
    let highRiskClients = [];

    invoices.forEach(inv => {
      const paid = inv.payments.reduce((sum, p) => sum + p.amount, 0);
      const balance = inv.amount - paid;
      if (inv.status !== 'Paid' && balance > 0) {
        totalOutstanding += balance;
        if (inv.dueDate && new Date(inv.dueDate) < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) {
          highRiskClients.push({ client: inv.client.name, invoice: inv.invoiceNumber, amountDue: balance });
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

// --- AI Dunning & Reminder Message Generator ---
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
// --- Enhanced Invoice Creation with Deliverable Shield ---
app.post('/api/invoices', async (req, res) => {
  try {
    const { invoiceNumber, amount, tax, discount, clientId, organizationId, dueDate, deliverableTitle, lockedUrl } = req.body;
    
    // Create the invoice and automatically create a locked deliverable if provided
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber,
        amount: parseFloat(amount),
        tax: tax ? parseFloat(tax) : 0.0,
        discount: discount ? parseFloat(discount) : 0.0,
        status: 'Sent',
        clientId: parseInt(clientId),
        organizationId: parseInt(organizationId || 1),
        dueDate: dueDate ? new Date(dueDate) : null,
        deliverable: deliverableTitle ? {
          create: {
            title: deliverableTitle,
            lockedUrl: lockedUrl || '#',
            isUnlocked: false
          }
        } : undefined
      },
      include: { deliverable: true }
    });

    res.json({ success: true, invoice });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Get All Invoices ---
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

// --- Payment Tracking & Automatic Deliverable Unlocking ---
app.post('/api/payments', async (req, res) => {
  try {
    const { amount, status, reference, invoiceId } = req.body;
    const invId = parseInt(invoiceId);
    const paidAmount = parseFloat(amount);

    // Record the payment
    const payment = await prisma.payment.create({
      data: {
        amount: paidAmount,
        status: status || 'SUCCESS',
        reference: reference || 'DIRECT-PAY',
        invoiceId: invId
      }
    });

    // Check total payments made for this invoice
    const invoice = await prisma.invoice.findUnique({
      where: { id: invId },
      include: { payments: true, deliverable: true }
    });

    const totalPaid = invoice.payments.reduce((sum, p) => sum + p.amount, 0);

    // If total payments cover or exceed invoice amount, mark as Paid and UNLOCK Deliverable!
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

// --- Financial Dashboard Metrics Route ---
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

// --- Full Model POST Routes ---
app.post('/api/invoices', async (req, res) => {
  try {
    const { invoiceNumber, amount, clientId } = req.body;
    const invoice = await prisma.invoice.create({
      data: { invoiceNumber, amount: parseFloat(amount), clientId: parseInt(clientId) }
    });
    res.json({ success: true, invoice });
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

app.post('/api/payments', async (req, res) => {
  try {
    const { amount, status, invoiceId } = req.body;
    const payment = await prisma.payment.create({
      data: { amount: parseFloat(amount), status, invoiceId: parseInt(invoiceId) }
    });
    res.json({ success: true, payment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
initializeApp().then(() => {
  app.listen(PORT, () => {
    console.log(`PayShield Enterprise running on http://localhost:${PORT}`);
  });
});
