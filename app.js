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
  res.send(`
    <html>
      <head><title>PayShield Enterprise Dashboard</title></head>
      <body style="font-family: Arial; padding: 40px; background: #f4f6f8;">
        <h2>PayShield Enterprise Financial Platform ($31+ Tier)</h2>
        <p>Platform status: <strong>Active & Scalable</strong></p>
        <button onclick="checkInvoice()" style="padding: 10px 20px; background: #007bff; color: white; border: none; cursor: pointer;">Check Invoice & Client</button>
        <button onclick="simulatePayment()" style="padding: 10px 20px; background: #28a745; color: white; border: none; cursor: pointer; margin-left: 10px;">Simulate Payment & Webhook</button>
        <div id="output" style="margin-top: 20px; background: white; padding: 15px; border: 1px solid #ccc; font-family: monospace;"></div>
        <script>
          async function checkInvoice() {
            try {
              const res = await fetch('/api/invoices/INV-1001');
              const data = await res.json();
              document.getElementById('output').innerText = JSON.stringify(data, null, 2);
            } catch(e) { document.getElementById('output').innerText = e.message; }
          }
          async function simulatePayment() {
            try {
              const res = await fetch('/api/webhook/simulate', { 
                method: 'POST', 
                headers: {'Content-Type': 'application/json'}, 
                body: JSON.stringify({invoiceNumber: 'INV-1001', amount: 1700}) 
              });
              const data = await res.json();
              document.getElementById('output').innerText = JSON.stringify(data, null, 2);
            } catch(e) { document.getElementById('output').innerText = e.message; }
          }
        </script>
      </body>
    </html>
  `);
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
