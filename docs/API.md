# PayNexa API Documentation

Base URL: `http://localhost:5000` (or configured production domain)

---

## Authentication Endpoints

All authenticated endpoints require an HTTP `Authorization` header:
```http
Authorization: Bearer <jwt_token>
```

### 1. Register User
- **Method:** `POST`
- **Path:** `/api/auth/register`
- **Auth Required:** No
- **Rate Limit:** 10 registrations / hour / IP
- **Request Body:**
  ```json
  {
    "name": "Yuvraj Sharma",
    "email": "user@example.com",
    "password": "StrongPassword123!",
    "businessName": "Nexa Technologies"
  }
  ```
- **Response (201 Created):**
  ```json
  {
    "success": true,
    "message": "Account created successfully!",
    "token": "eyJhbGciOi...",
    "user": {
      "id": "6724...",
      "name": "Yuvraj Sharma",
      "email": "user@example.com",
      "businessName": "Nexa Technologies"
    }
  }
  ```

---

### 2. Login User
- **Method:** `POST`
- **Path:** `/api/auth/login`
- **Auth Required:** No
- **Rate Limit:** 5 attempts / minute / IP
- **Request Body:**
  ```json
  {
    "email": "user@example.com",
    "password": "StrongPassword123!"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Login successful!",
    "token": "eyJhbGciOi...",
    "user": {
      "id": "6724...",
      "name": "Yuvraj Sharma",
      "email": "user@example.com",
      "businessName": "Nexa Technologies"
    }
  }
  ```

---

### 3. Get Current User Profile
- **Method:** `GET`
- **Path:** `/api/auth/me`
- **Auth Required:** Yes
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "user": {
      "id": "6724...",
      "name": "Yuvraj Sharma",
      "email": "user@example.com",
      "businessName": "Nexa Technologies",
      "createdAt": "2026-10-31T12:00:00.000Z"
    }
  }
  ```

---

## AI Invoicing Endpoints

### 4. AI Parse & Preview
- **Method:** `POST`
- **Path:** `/api/parse`
- **Auth Required:** Yes
- **Rate Limit:** 20 requests / minute / IP
- **Request Body:**
  ```json
  {
    "prompt": "Invoice Rahul for 2 landing pages at 150 USD each, due in 10 days"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "invoice": {
      "clientName": "Rahul",
      "clientEmail": "",
      "items": [
        {
          "name": "Landing page design",
          "quantity": 2,
          "unitPrice": 150
        }
      ],
      "currency": "USD",
      "dueDate": "2026-11-10"
    }
  }
  ```

---

### 5. Create & Send Invoice
- **Method:** `POST`
- **Path:** `/api/invoices`
- **Auth Required:** Yes
- **Rate Limit:** 10 requests / minute / IP
- **Request Body (Direct AI Generation):**
  ```json
  {
    "prompt": "Invoice Rahul for 2 web designs at $150 each, due in 7 days",
    "clientEmail": "buyer@sandbox.paypal.com",
    "requestId": "550e8400-e29b-41d4-a716-446655440000"
  }
  ```
- **Request Body (With Custom/Edited Preview):**
  ```json
  {
    "prompt": "Invoice for Rahul",
    "clientEmail": "buyer@sandbox.paypal.com",
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "parsedInvoice": {
      "clientName": "Rahul Sharma",
      "items": [
        { "name": "Landing page design", "quantity": 2, "unitPrice": 150 }
      ],
      "currency": "USD",
      "dueDate": "2026-11-07"
    }
  }
  ```
- **Response (201 Created):**
  ```json
  {
    "success": true,
    "message": "Invoice created, sent, and saved successfully!",
    "invoiceId": "INV2-ABCD-EFGH-1234",
    "status": "SENT",
    "invoice": {
      "clientName": "Rahul Sharma",
      "clientEmail": "buyer@sandbox.paypal.com",
      "items": [...],
      "currency": "USD",
      "dueDate": "2026-11-07",
      "totalAmount": 300
    }
  }
  ```

---

### 6. List Invoices with Pagination & Filtering
- **Method:** `GET`
- **Path:** `/api/invoices?page=1&limit=10&status=SENT&search=Rahul`
- **Auth Required:** Yes
- **Query Parameters:**
  - `page`: Page number (default: `1`)
  - `limit`: Items per page (default: `10`, max: `100`)
  - `status`: Optional filter (`ALL`, `SENT`, `PAID`, `DRAFT`, `CANCELLED`, `FAILED`)
  - `search`: Search term matching customer name, email, or PayPal ID
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "count": 1,
    "invoices": [...],
    "pagination": {
      "currentPage": 1,
      "limit": 10,
      "totalInvoices": 1,
      "totalPages": 1,
      "hasNextPage": false,
      "hasPreviousPage": false
    }
  }
  ```

---

### 7. Get Single Invoice
- **Method:** `GET`
- **Path:** `/api/invoices/:id`
- **Auth Required:** Yes
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "invoice": {
      "_id": "6724...",
      "paypalInvoiceId": "INV2-ABCD-1234",
      "clientName": "Rahul Sharma",
      "clientEmail": "buyer@sandbox.paypal.com",
      "items": [...],
      "currency": "USD",
      "dueDate": "2026-11-07T00:00:00.000Z",
      "status": "SENT",
      "totalAmount": 300
    }
  }
  ```

---

### 8. Synchronize Invoices with PayPal
- **Method:** `POST`
- **Path:** `/api/invoices/sync`
- **Auth Required:** Yes
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "total": 5,
    "updated": 5,
    "failed": 0,
    "results": [
      {
        "invoiceId": "INV2-ABCD-1234",
        "status": "PAID",
        "success": true
      }
    ]
  }
  ```

---

### 9. Export Invoices as CSV
- **Method:** `GET`
- **Path:** `/api/invoices/export/csv`
- **Auth Required:** Yes
- **Response (200 OK):**
  - Content-Type: `text/csv; charset=utf-8`
  - Content-Disposition: `attachment; filename="invoices.csv"`

---

### 10. Dashboard Analytics
- **Method:** `GET`
- **Path:** `/api/analytics`
- **Auth Required:** Yes
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "totalInvoices": 12,
    "totalInvoiced": 4500,
    "totalPaid": 3200,
    "outstandingAmount": 1300,
    "statusCounts": {
      "SENT": 4,
      "PAID": 8
    },
    "byCurrency": {
      "USD": {
        "count": 10,
        "totalInvoiced": 4000,
        "totalPaid": 3000,
        "outstandingAmount": 1000
      },
      "EUR": {
        "count": 2,
        "totalInvoiced": 500,
        "totalPaid": 200,
        "outstandingAmount": 300
      }
    }
  }
  ```

---

## Webhook Endpoints

### 11. PayPal Webhook Receiver
- **Method:** `POST`
- **Path:** `/api/webhooks/paypal`
- **Auth Required:** No (Direct from PayPal with signature verification)
- **Supported Event Types:**
  - `INVOICING.INVOICE.PAID`
  - `INVOICING.INVOICE.MARKED_AS_PAID`
  - `INVOICING.INVOICE.CANCELLED`
  - `INVOICING.INVOICE.REFUNDED`
  - `INVOICING.INVOICE.UPDATED`
- **Idempotency:** Duplicate events automatically acknowledged with `200 OK`.
