import { useEffect, useState } from "react";

export default function InvoiceDetailModal({ invoice, onClose, formatAmount, formatDate, statusClass }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!invoice) return null;

  const copyId = async () => {
    if (!invoice.paypalInvoiceId) return;
    try {
      await navigator.clipboard.writeText(invoice.paypalInvoiceId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy invoice ID:", err);
    }
  };

  const calculateSubtotal = () => {
    return (invoice.items || []).reduce(
      (sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0),
      0
    );
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="modal-kicker">INVOICE SPECIFICATION</span>
            <h2>Invoice Details</h2>
            <div className="modal-id-row">
              <span className="modal-id-label">PayPal ID:</span>
              <code className="modal-id-code">{invoice.paypalInvoiceId || "Draft / Pending"}</code>
              {invoice.paypalInvoiceId && (
                <button
                  type="button"
                  className="copy-btn"
                  onClick={copyId}
                  title="Copy PayPal Invoice ID"
                >
                  {copied ? "✓ Copied" : "Copy"}
                </button>
              )}
            </div>
          </div>

          <div className="modal-header-right">
            <span className={`sent-badge ${statusClass(invoice.status)}`}>
              ● {invoice.status || "UNKNOWN"}
            </span>
            <button
              type="button"
              className="modal-close-btn"
              onClick={onClose}
              aria-label="Close modal"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="modal-body">
          <div className="detail-meta-grid">
            <div className="meta-card">
              <span className="meta-label">Customer Name</span>
              <strong>{invoice.clientName || "—"}</strong>
            </div>

            <div className="meta-card">
              <span className="meta-label">Customer Email</span>
              <strong>{invoice.clientEmail || "—"}</strong>
            </div>

            <div className="meta-card">
              <span className="meta-label">Issue Date</span>
              <strong>{formatDate(invoice.createdAt)}</strong>
            </div>

            <div className="meta-card">
              <span className="meta-label">Payment Due Date</span>
              <strong>{formatDate(invoice.dueDate)}</strong>
            </div>
          </div>

          <div className="modal-items-section">
            <h3>Line Items &amp; Charges</h3>
            <div className="modal-items-table">
              <div className="modal-table-header">
                <span>Description</span>
                <span>Qty</span>
                <span>Unit Price</span>
                <span className="text-right">Line Total</span>
              </div>

              {(invoice.items || []).map((item, idx) => (
                <div key={idx} className="modal-table-row">
                  <div>
                    <strong>{item.name}</strong>
                  </div>
                  <span>{item.quantity}</span>
                  <span>{formatAmount(item.unitPrice, invoice.currency)}</span>
                  <span className="text-right font-bold">
                    {formatAmount(
                      Number(item.quantity || 0) * Number(item.unitPrice || 0),
                      invoice.currency
                    )}
                  </span>
                </div>
              ))}
            </div>

            <div className="modal-total-summary">
              <div className="summary-row grand-total">
                <span>Total Amount:</span>
                <strong>{formatAmount(calculateSubtotal(), invoice.currency || "USD")}</strong>
              </div>
            </div>
          </div>

          <div className="modal-environment-note">
            <span>ⓘ</span>
            <p>
              This invoice was generated through <strong>Gemini AI</strong>, signed and processed
              via <strong>PayPal Sandbox</strong>, and indexed with multi-tenant data isolation in{" "}
              <strong>MongoDB</strong>.
            </p>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
