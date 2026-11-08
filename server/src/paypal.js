 
let cachedToken = null;
let tokenExpiresAt = 0;

// Get PayPal access token
async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedToken;
  }

  const {
    PAYPAL_CLIENT_ID,
    PAYPAL_CLIENT_SECRET,
    PAYPAL_BASE_URL,
  } = process.env;

  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET || !PAYPAL_BASE_URL) {
    throw new Error("Missing PayPal environment variables in .env");
  }

  const auth = Buffer.from(
    `${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`
  ).toString("base64");

  const response = await fetch(
    `${PAYPAL_BASE_URL}/v1/oauth2/token`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `PayPal authentication failed (${response.status}): ${
        data.error_description || data.error || "Unknown error"
      }`
    );
  }

  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;

  return cachedToken;
}

// Make authenticated PayPal API requests with retry and token-refresh support
async function paypalRequest(path, options = {}, isRetry = false) {
  const token = await getAccessToken();

  let response;
  try {
    response = await fetch(`${process.env.PAYPAL_BASE_URL}${path}`, {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
      body:
        options.body !== undefined
          ? JSON.stringify(options.body)
          : undefined,
    });
  } catch (networkError) {
    // Retry once for transient network failures
    if (!isRetry) {
      console.warn(
        `[PayPal API] Network failure on ${path} (${networkError.message}). Retrying in 500ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      return paypalRequest(path, options, true);
    }
    throw networkError;
  }

  // If token expired (401), clear cached token and retry once with fresh credentials
  if (response.status === 401 && !isRetry) {
    console.warn(`[PayPal API] Received 401 on ${path}. Refreshing access token and retrying...`);
    cachedToken = null;
    tokenExpiresAt = 0;
    return paypalRequest(path, options, true);
  }

  // If transient PayPal server error (5xx), back off 1s and retry once
  if (response.status >= 500 && !isRetry) {
    console.warn(
      `[PayPal API] Transient server error (${response.status}) on ${path}. Retrying in 1000ms...`
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return paypalRequest(path, options, true);
  }

  const text = await response.text();
  let data = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!response.ok) {
    throw new Error(
      `PayPal API error (${response.status}): ${JSON.stringify(data)}`
    );
  }

  return data;
}

// Create a draft invoice
export async function createDraftInvoice({
  clientName,
  clientEmail,
  items,
  currency = "USD",
  dueDate,
}) {
  if (!clientName || !clientEmail) {
    throw new Error("Client name and email are required.");
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Invoice must contain at least one item.");
  }

  if (!dueDate) {
    throw new Error("Invoice due date is required.");
  }

  const { invoice_number } = await paypalRequest(
    "/v2/invoicing/generate-next-invoice-number",
    {
      method: "POST",
    }
  );

  const invoice = {
    detail: {
      invoice_number,
      invoice_date: new Date().toISOString().slice(0, 10),
      currency_code: currency,
      payment_term: {
        term_type: "DUE_ON_DATE_SPECIFIED",
        due_date: dueDate,
      },
    },

    primary_recipients: [
      {
        billing_info: {
          business_name: clientName,
          email_address: clientEmail,
        },
      },
    ],

    items: items.map((item) => {
      const quantity = Number(item.quantity);
      const unitPrice = Number(item.unitPrice);

      if (
        !item.name ||
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        !Number.isFinite(unitPrice) ||
        unitPrice < 0
      ) {
        throw new Error("Invalid invoice item details.");
      }

      return {
        name: item.name,
        quantity: String(quantity),
        unit_amount: {
          currency_code: currency,
          value: unitPrice.toFixed(2),
        },
      };
    }),
  };

  const result = await paypalRequest(
    "/v2/invoicing/invoices",
    {
      method: "POST",
      body: invoice,
    }
  );

  const invoiceUrl =
    result.href ||
    result.links?.find((link) => link.rel === "self")?.href;

  const invoiceId =
    result.id ||
    (invoiceUrl
      ? invoiceUrl.split("?")[0].split("/").pop()
      : null);

  if (!invoiceId) {
    throw new Error(
      "PayPal returned a successful response without an invoice ID."
    );
  }

  console.log("PayPal draft invoice created:", invoiceId);

  return invoiceId;
}

// Send invoice to customer
export async function sendInvoice(invoiceId) {
  if (!invoiceId) {
    throw new Error("Invoice ID is required.");
  }

  return paypalRequest(
    `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/send`,
    {
      method: "POST",
      body: {
        send_to_recipient: true,
        send_to_invoicer: false,
      },
    }
  );
}

// Retrieve invoice details from PayPal
export async function getInvoice(invoiceId) {
  if (!invoiceId) {
    throw new Error("Invoice ID is required.");
  }

  return paypalRequest(
    `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`
  );
}

// Retrieve the latest invoice status from PayPal
export async function syncInvoiceStatus(invoiceId) {
  const paypalInvoice = await getInvoice(invoiceId);

  if (!paypalInvoice.status) {
    throw new Error(
      `PayPal did not return a status for invoice ${invoiceId}.`
    );
  }

  return {
    invoiceId,
    status: paypalInvoice.status,
  };
}

// Verify incoming PayPal webhook signature
export async function verifyWebhookSignature({
  headers,
  rawBody,
  body,
  webhookId = process.env.PAYPAL_WEBHOOK_ID,
}) {
  // If webhook ID is not configured (e.g. during dev/sandbox without registered webhook), log warning and bypass
  if (!webhookId && process.env.NODE_ENV === "production") {
    console.error(
      "[PayPal Webhook] PAYPAL_WEBHOOK_ID is not configured; rejecting webhook in production."
    );
    return false;
  }

  if (!webhookId) {
    console.warn(
      "[PayPal Webhook] PAYPAL_WEBHOOK_ID is not configured in .env; skipping cryptographic verification."
    );
    return true;
  }

  const transmissionId =
    headers["paypal-transmission-id"] || headers["PAYPAL-TRANSMISSION-ID"];
  const transmissionTime =
    headers["paypal-transmission-time"] || headers["PAYPAL-TRANSMISSION-TIME"];
  const certUrl =
    headers["paypal-cert-url"] || headers["PAYPAL-CERT-URL"];
  const authAlgo =
    headers["paypal-auth-algo"] || headers["PAYPAL-AUTH-ALGO"];
  const transmissionSig =
    headers["paypal-transmission-sig"] || headers["PAYPAL-TRANSMISSION-SIG"];

  if (
    !transmissionId ||
    !transmissionTime ||
    !certUrl ||
    !authAlgo ||
    !transmissionSig
  ) {
    console.warn(
      "[PayPal Webhook] Missing one or more required signature verification headers."
    );
    return false;
  }

  try {
    const payload = {
      transmission_id: transmissionId,
      transmission_time: transmissionTime,
      cert_url: certUrl,
      auth_algo: authAlgo,
      transmission_sig: transmissionSig,
      webhook_id: webhookId,
      webhook_event: body,
    };

    const result = await paypalRequest(
      "/v1/notifications/verify-webhook-signature",
      {
        method: "POST",
        body: payload,
      }
    );

    return result.verification_status === "SUCCESS";
  } catch (error) {
    console.error(
      "[PayPal Webhook] Signature verification failed:",
      error.message
    );
    return false;
  }
}


