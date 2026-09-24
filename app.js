const express = require('express');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Helper: Ensure Organization and default client exist safely
async function getOrCreateDefaultClient() {
  const org = await prisma.organization.upsert({
    where: { id: 1 },
    update: {},
    create: { 
      name: 'PayShield Enterprise', 
      currency: 'USD' 
    }
  });

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
    await getOrCreateDefaultClient();
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

    const org = await prisma.organization.findUnique({ where: { id: 1 } });

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
      where: { invoiceNumber },
      include: { payments: true }
    });

    if (!invoice) {
      const defaultClient = await getOrCreateDefaultClient();
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
        amount: amountPaid || invoice.amount,
        status: 'SUCCESS'
      }
    });

    const allPayments = [...invoice.payments, payment];
    const totalPaid = allPayments.reduce((acc, p) => acc + p.amount, 0);
    let newStatus = 'PENDING';
    if (totalPaid >= invoice.amount) {
      newStatus = 'PAID';
    } else if (totalPaid > 0) {
      newStatus = 'PARTIAL';
    }

    const updatedInvoice = await prisma.invoice.update({
      where: { invoiceNumber },
      data: { status: newStatus },
      include: { client: true, payments: true }
    });

    res.json({ success: true, message: 'Payment processed successfully', invoice: updatedInvoice, payment });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

initializeApp().then(() => {
  app.listen(PORT, () => {
    console.log(`PayShield Enterprise running on http://localhost:${PORT}`);
  });
});
