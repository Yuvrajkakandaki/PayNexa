import "dotenv/config";
import {
  createDraftInvoice,
  sendInvoice,
  getInvoice,
} from "./paypal.js";

async function main() {
  try {
    const dueDate = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000
    )
      .toISOString()
      .slice(0, 10);

    const invoiceId = await createDraftInvoice({
      clientName: "Acme Corp",
      clientEmail: "yuvrajkakandaki0017@gmail.com",
      items: [
        {
          name: "Logo Design",
          quantity: 1,
          unitPrice: 500,
        },
      ],
      currency: "USD",
      dueDate,
    });

    console.log("Draft created:", invoiceId);

    await sendInvoice(invoiceId);
    console.log("Invoice sent successfully!");

    const invoice = await getInvoice(invoiceId);
    console.log("Invoice status:", invoice.status);
  } catch (error) {
    console.error("Test failed:", error.message);
    process.exitCode = 1;
  }
}

main();