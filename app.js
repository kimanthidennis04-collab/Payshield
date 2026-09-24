const express = require('express');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Startup check: Ensure default Organization and a default Client exist
async function ensureDefaultData() {
  try {
    let org = await prisma.organization.findUnique({ where: { id: 1 } });
    if (!org) {
      org = await prisma.organization.create({
        data: { id: 1, name: 'PayShield Enterprise' }
      });
      console.log('Default organization created (ID: 1)');
    }

    let client = await prisma.client.findFirst({ where: { organizationId: 1 } });
    if (!client) {
      await prisma.client.create({
        data: {
          organizationId: 1,
          name: 'Default Test Client',
          email: 'test@example.com',
          phone: '+254700000000'
        }
      });
      console.log('Default client created');
    }
  } catch (err) {
    console.error('Error seeding default data:', err.message);
  }
}

// 1. Dashboard Route
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});
         

// 2. Get or Auto-Create Invoice with Client Relation
app.get('/api/invoices/:invoiceNumber', async (req, res) => {
  try {
    const { invoiceNumber } = req.params;
    let invoice = await prisma.invoice.findUnique({
      where: { invoiceNumber },
      include: { client: true, payments: true }
    });

    if (!invoice) {
      const defaultClient = await prisma.client.findFirst({ where: { organizationId: 1 } });
      
      invoice = await prisma.invoice.create({
        data: {
          invoiceNumber: invoiceNumber,
          amount: 1700.00,
          status: 'PENDING',
          organizationId: 1,
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

// 3. Simulate Payment Webhook Route
app.post('/api/webhook/simulate', async (req, res) => {
  try {
    const { invoiceNumber, amount } = req.body;
    let invoice = await prisma.invoice.findUnique({ where: { invoiceNumber } });

    if (!invoice) {
      const defaultClient = await prisma.client.findFirst({ where: { organizationId: 1 } });
      invoice = await prisma.invoice.create({
        data: {
          invoiceNumber: invoiceNumber || 'INV-1001',
          amount: amount || 1700.00,
          status: 'PAID',
          organizationId: 1,
          clientId: defaultClient.id
        }
      });
    } else {
      invoice = await prisma.invoice.update({
        where: { invoiceNumber },
        data: { status: 'PAID' }
      });
    }

    const payment = await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        amount: amount || invoice.amount,
        status: 'SUCCESS'
      }
    });

    // Log the webhook event
    await prisma.webhookLog.create({
      data: {
        event: 'PAYMENT_SUCCESS',
        payload: JSON.stringify({ invoiceNumber: invoice.invoiceNumber, amount: payment.amount })
      }
    });

    res.json({ success: true, message: 'Payment processed, client matched, & webhook logged', invoice, payment });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

ensureDefaultData().then(() => {
  app.listen(PORT, () => {
    console.log(`PayShield Enterprise running on http://localhost:${PORT}`);
  });
});
