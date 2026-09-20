# WhatsApp Business Automation SaaS

A multi-business WhatsApp commerce system where businesses can connect their WhatsApp number, manage products, receive orders, and track payments — all through WhatsApp chat.

---

## Tech Stack

- **Node.js** + **Express.js** — API server
- **MongoDB** + **Mongoose** — database
- **Baileys** — WhatsApp QR connection (MVP)
- **Meta WhatsApp Cloud API** — production upgrade path (Phase 9)

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env with your MongoDB URI, phone number, business name, and payment details
```

### 3. Start MongoDB
```bash
# Local MongoDB
mongod

# Or use MongoDB Atlas — paste your connection string in .env
```

### 4. Run the server
```bash
npm run dev
```

### 5. Scan QR code
A QR code will appear in your terminal. Scan it with WhatsApp (Linked Devices > Link a Device).

---

## Project Structure

```
whatsapp-saas/
├── server.js                        # Entry point
├── src/
│   ├── config/
│   │   └── database.js              # MongoDB connection
│   ├── models/
│   │   ├── Business.js              # Phase 8: multi-tenant
│   │   ├── Product.js               # Product catalog
│   │   ├── Order.js                 # Orders with full lifecycle
│   │   └── Session.js               # Customer conversation state
│   ├── services/
│   │   ├── sessionService.js        # Session CRUD + cart
│   │   ├── productService.js        # Product CRUD
│   │   ├── orderService.js          # Order CRUD + lifecycle
│   │   └── notificationService.js   # WhatsApp notifications
│   ├── whatsapp/
│   │   ├── client.js                # Baileys connection
│   │   ├── messageHandler.js        # Routes messages to admin/customer
│   │   └── flows/
│   │       ├── customerFlow.js      # Customer bot conversation
│   │       └── adminFlow.js         # Admin WhatsApp commands
│   ├── middleware/
│   │   └── upload.js                # Multer image upload config
│   └── routes/
│       ├── products.js              # REST API: product management
│       ├── orders.js                # REST API: order management
│       ├── businesses.js            # REST API: business registration
│       └── webhook.js               # Phase 9: Meta API webhook
├── sessions/                        # Baileys auth state (gitignored)
├── uploads/                         # Product images (gitignored)
├── .env.example
└── package.json
```

---

## Order Lifecycle

```
PENDING → APPROVED → PENDING_PAYMENT → PAID → DELIVERED
        ↘ REJECTED
```

---

## Customer Bot Flow

Customers interact via WhatsApp:

```
1. Send any message → Main Menu
2. Reply "1" → Browse products
3. Reply product number → View details + image
4. Enter quantity → Add to cart
5. Reply "1" (checkout) → Enter name → Order placed
6. Receive order number → Track with "TRACK ORD-xxx"
```

---

## Admin WhatsApp Commands

Send these from your admin WhatsApp number:

| Command | Description |
|---------|-------------|
| `ORDERS` | View all pending orders |
| `ORDERS APPROVED` | Filter by status |
| `TRACK ORD-20240101-0001` | View order details |
| `APPROVE ORD-xxx` | Approve an order |
| `REJECT ORD-xxx reason` | Reject with reason |
| `PAY ORD-xxx` | Send payment request to customer |
| `CONFIRM_PAYMENT ORD-xxx mpesa REF123` | Confirm payment |
| `DELIVER ORD-xxx note` | Mark as delivered |
| `PRODUCTS` | List all products |
| `HELP` | Show all commands |

---

## REST API

### Products
```
GET    /api/products           # List all products
GET    /api/products/:id       # Get one product
POST   /api/products           # Create product (multipart/form-data, field: image)
PUT    /api/products/:id       # Update product
DELETE /api/products/:id       # Soft-delete product
```

### Orders
```
GET    /api/orders                      # List orders (?status=PENDING&businessId=xxx)
GET    /api/orders/:id                  # Get one order
POST   /api/orders/:id/approve          # Approve order
POST   /api/orders/:id/reject           # Reject order { reason }
POST   /api/orders/:id/request-payment  # Request payment
POST   /api/orders/:id/confirm-payment  # Confirm payment { method, reference }
POST   /api/orders/:id/deliver          # Mark delivered { note }
```

### Businesses (Phase 8)
```
GET    /api/businesses          # List businesses
POST   /api/businesses          # Register business { businessId, name, phone }
PUT    /api/businesses/:id      # Update business
```

### Meta Webhook (Phase 9)
```
GET    /webhook                 # Verification challenge
POST   /webhook                 # Incoming messages
```

---

## Adding Products

### Via REST API (recommended)
```bash
curl -X POST http://localhost:3000/api/products \
  -F "name=iPhone Case" \
  -F "description=Premium leather case" \
  -F "price=15000" \
  -F "currency=TZS" \
  -F "stock=50" \
  -F "image=@/path/to/image.jpg"
```

### Via MongoDB directly
```js
db.products.insertOne({
  name: "T-Shirt",
  price: 20000,
  currency: "TZS",
  description: "Cotton, sizes S-XL",
  businessId: "default",
  active: true
})
```

---

## Payment Flow (Manual — MVP)

1. Admin approves order → customer receives payment details (M-Pesa/Tigo/Airtel numbers)
2. Customer pays and sends transaction reference via WhatsApp
3. Admin verifies and runs: `CONFIRM_PAYMENT ORD-xxx mpesa REF123`
4. Customer receives confirmation
5. Admin ships and runs: `DELIVER ORD-xxx`

---

## Phase 9: Migrating to Meta WhatsApp Cloud API

The business logic is fully decoupled from the transport layer. To switch:

1. Create a Meta Business account and WhatsApp Business App at [developers.facebook.com](https://developers.facebook.com)
2. Get your `META_API_TOKEN` and `META_PHONE_NUMBER_ID`
3. Set `META_WEBHOOK_VERIFY_TOKEN` to any random string
4. Deploy the server to a public URL (e.g. Railway, Render, VPS)
5. Register webhook URL: `https://yourdomain.com/webhook`
6. Update `.env` with Meta credentials
7. Replace `sendMessage` calls in `notificationService.js` with `metaSendText()` from `webhook.js`
8. Remove Baileys — `client.js` is no longer needed

The flow handlers (`customerFlow.js`, `adminFlow.js`) require **zero changes**.

---

## Multi-Business (Phase 8)

To run multiple businesses on one server:

1. Register each business via `POST /api/businesses`
2. Each business gets a unique `businessId`
3. Products and orders are scoped by `businessId`
4. Each business needs its own WhatsApp number (Baileys: multiple sessions; Meta API: multiple phone numbers)

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 3000) |
| `MONGODB_URI` | MongoDB connection string |
| `ADMIN_PHONE` | Admin WhatsApp number (digits only, e.g. `255712345678`) |
| `BUSINESS_NAME` | Your shop name (shown in bot messages) |
| `BUSINESS_ID` | Business identifier (default: `default`) |
| `MPESA_NUMBER` | M-Pesa payment number |
| `MPESA_NAME` | M-Pesa account name |
| `TIGO_NUMBER` | Tigo Pesa number |
| `AIRTEL_NUMBER` | Airtel Money number |
| `UPLOAD_DIR` | Image upload directory (default: `uploads`) |
| `META_API_TOKEN` | Meta API bearer token (Phase 9) |
| `META_PHONE_NUMBER_ID` | Meta phone number ID (Phase 9) |
| `META_WEBHOOK_VERIFY_TOKEN` | Webhook verification token (Phase 9) |