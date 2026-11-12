import { useCallback, useEffect, useState, useRef } from "react";
import AuthPage from "./components/AuthPage.jsx";
import InvoiceDetailModal from "./components/InvoiceDetailModal.jsx";
import ConfirmDialog from "./components/ConfirmDialog.jsx";
import "./App.css";

const RAW_API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
const API_URL = RAW_API_URL.replace(/\/+$/, "");

function App() {
  // Authentication states (Phase 3)
  const [token, setToken] = useState(() => localStorage.getItem("paynexa_token") || "");
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem("paynexa_user");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  // Mobile menu toggle (Task 6.5)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Form input states
  const [prompt, setPrompt] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [invoice, setInvoice] = useState(null);
  const [invoices, setInvoices] = useState([]);

  // Detail modal state (Task 6.2)
  const [selectedInvoice, setSelectedInvoice] = useState(null);

  // Confirmation dialog state (Task 6.4)
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    title: "",
    message: "",
    confirmLabel: "Confirm",
    isDestructive: false,
    onConfirm: () => {},
  });

  // Preview & edit state (Tasks 1.6 & 1.7)
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Analytics state (Task 1.1 & 1.2)
  const [analytics, setAnalytics] = useState({
    totalInvoices: 0,
    totalInvoiced: 0,
    totalPaid: 0,
    outstandingAmount: 0,
    statusCounts: {},
    byCurrency: {},
  });
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  // Sync & Export states (Task 1.3 & 1.4)
  const [isSyncing, setIsSyncing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Pagination states (Task 1.5)
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [pagination, setPagination] = useState({
    currentPage: 1,
    limit: 10,
    totalInvoices: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  });

  // Loading & error states (Task 1.8)
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  // Toast notification state
  const [toast, setToast] = useState(null);
  const toastTimeoutRef = useRef(null);

  const showToast = useCallback((message, type = "info") => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToast({ message, type });
    toastTimeoutRef.current = setTimeout(() => {
      setToast(null);
    }, 5000);
  }, []);

  // Auth management
  const handleLogin = (newToken, newUser) => {
    localStorage.setItem("paynexa_token", newToken);
    localStorage.setItem("paynexa_user", JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
    showToast(`Welcome back, ${newUser.name}!`, "success");
  };

  const handleLogout = useCallback(() => {
    localStorage.removeItem("paynexa_token");
    localStorage.removeItem("paynexa_user");
    setToken("");
    setUser(null);
    setSelectedInvoice(null);
  }, []);

  // Request ID for deduplication
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  // Fetch Analytics from backend with Auth header (Task 1.1 & 3.6)
  const fetchAnalytics = useCallback(async () => {
    if (!token) return;
    setAnalyticsLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/analytics`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.status === 401) {
        handleLogout();
        return;
      }

      const data = await response.json();

      if (response.ok && data.success) {
        setAnalytics({
          totalInvoices: data.totalInvoices || 0,
          totalInvoiced: data.totalInvoiced || 0,
          totalPaid: data.totalPaid || 0,
          outstandingAmount: data.outstandingAmount || 0,
          statusCounts: data.statusCounts || {},
          byCurrency: data.byCurrency || {},
        });
      }
    } catch (err) {
      console.error("Failed to load analytics:", err);
    } finally {
      setAnalyticsLoading(false);
    }
  }, [token, handleLogout]);

  // Fetch saved invoices from MongoDB with Auth header & pagination (Task 1.5 & 3.6)
  const fetchInvoices = useCallback(
    async (targetPage = 1, currentSearch = "", currentStatus = "ALL") => {
      if (!token) return;
      setHistoryLoading(true);
      setHistoryError("");

      try {
        const queryParams = new URLSearchParams({
          page: targetPage.toString(),
          limit: limit.toString(),
        });

        if (currentStatus && currentStatus !== "ALL") {
          queryParams.set("status", currentStatus);
        }
        if (currentSearch && currentSearch.trim()) {
          queryParams.set("search", currentSearch.trim());
        }

        const response = await fetch(`${API_URL}/api/invoices?${queryParams.toString()}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.status === 401) {
          handleLogout();
          return;
        }

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Could not load invoice history.");
        }

        setInvoices(data.invoices || []);
        if (data.pagination) {
          setPagination(data.pagination);
          setPage(data.pagination.currentPage);
        }
      } catch (err) {
        setHistoryError(
          err.message === "Failed to fetch"
            ? "Unable to connect to the backend server. Please verify your connection or wait a moment while the server wakes up."
            : err.message
        );
      } finally {
        setHistoryLoading(false);
      }
    },
    [token, limit, handleLogout]
  );

  const isInitialInvoicesMount = useRef(true);

  // Validate session / fetch initial analytics on mount
  useEffect(() => {
    if (!token) return;
    const timer = setTimeout(() => {
      fetchAnalytics();
    }, 0);
    return () => clearTimeout(timer);
  }, [token, fetchAnalytics]);

  // Handle search or filter change with debounce (immediate on mount)
  useEffect(() => {
    if (!token) return;

    if (isInitialInvoicesMount.current) {
      isInitialInvoicesMount.current = false;
      const initialTimer = setTimeout(() => {
        fetchInvoices(1, search, statusFilter);
      }, 0);
      return () => clearTimeout(initialTimer);
    }

    const timer = setTimeout(() => {
      setPage(1);
      fetchInvoices(1, search, statusFilter);
    }, 300);

    return () => clearTimeout(timer);
  }, [token, search, statusFilter, fetchInvoices]);

  // Pagination navigation handler
  const handlePageChange = (newPage) => {
    if (newPage < 1 || (pagination.totalPages && newPage > pagination.totalPages)) return;
    setPage(newPage);
    fetchInvoices(newPage, search, statusFilter);
  };

  // Synchronize with PayPal (Task 1.3 & 6.4)
  const executeSync = async () => {
    if (!token) return;
    setIsSyncing(true);
    try {
      const response = await fetch(`${API_URL}/api/invoices/sync`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.status === 401) {
        handleLogout();
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "PayPal sync failed.");
      }

      showToast(
        `PayPal sync complete! ${data.updated} updated, ${data.failed} failed out of ${data.total} invoices.`,
        data.failed > 0 ? "info" : "success"
      );

      // Refresh data
      await Promise.all([fetchInvoices(page, search, statusFilter), fetchAnalytics()]);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSyncWithPayPal = () => {
    setConfirmDialog({
      isOpen: true,
      title: "Synchronize with PayPal Sandbox",
      message:
        "This will query PayPal for real-time payment updates across all invoices in your workspace. Continue?",
      confirmLabel: "Sync Now",
      isDestructive: false,
      onConfirm: () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        executeSync();
      },
    });
  };

  // CSV Export functionality (Task 1.4)
  const exportCSV = async () => {
    if (!token) return;
    setIsExporting(true);
    try {
      const response = await fetch(`${API_URL}/api/invoices/export/csv`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.status === 401) {
        handleLogout();
        return;
      }

      if (!response.ok) {
        throw new Error("Failed to export invoices CSV.");
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.setAttribute(
        "download",
        `paynexa-invoices-${new Date().toISOString().slice(0, 10)}.csv`
      );
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);

      showToast("Invoice spreadsheet downloaded successfully!", "success");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setIsExporting(false);
    }
  };

  // AI Parse & Preview (Task 1.6)
  const handleParseAndPreview = async (e) => {
    if (e) e.preventDefault();
    if (!token) return;
    if (!prompt.trim()) {
      setError("Please describe the invoice you want to generate.");
      return;
    }

    setPreviewLoading(true);
    setError("");

    try {
      const response = await fetch(`${API_URL}/api/parse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ prompt }),
      });

      if (response.status === 401) {
        handleLogout();
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "AI could not parse your description.");
      }

      setPreviewData({
        ...data.invoice,
        clientEmail: clientEmail.trim() || data.invoice.clientEmail || "",
      });

      showToast("✦ AI parsed your invoice! Review and edit details below before sending.", "info");
    } catch (err) {
      setError(
        err.message === "Failed to fetch"
          ? "Unable to connect to the backend server. Please verify your connection or wait a moment while the server wakes up."
          : err.message
      );
    } finally {
      setPreviewLoading(false);
    }
  };

  // Create and send invoice (Direct or Confirmed from Preview - Task 1.7)
  async function executeCreateInvoice(customParsedData = null) {
    if (!token) return;

    setLoading(true);
    setError("");
    setSuccess("");
    setInvoice(null);

    const targetEmail = customParsedData?.clientEmail || clientEmail;
    const bodyPayload = {
      prompt: prompt || `Invoice for ${customParsedData?.clientName || "Client"}`,
      clientEmail: targetEmail,
      requestId,
    };

    if (customParsedData) {
      bodyPayload.parsedInvoice = {
        clientName: customParsedData.clientName,
        items: customParsedData.items,
        currency: customParsedData.currency,
        dueDate: customParsedData.dueDate,
      };
    }

    try {
      const response = await fetch(`${API_URL}/api/invoices`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(bodyPayload),
      });

      if (response.status === 401) {
        handleLogout();
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        const details =
          Array.isArray(data.details) && data.details.length
            ? "\n" + data.details.join("\n")
            : "";
        throw new Error((data.error || "Invoice creation failed.") + details);
      }

      setInvoice(data);
      const successMsg = data.message || "Invoice created and sent via PayPal Sandbox!";
      setSuccess(successMsg);
      showToast(successMsg, "success");

      // Reset form and preview
      setPrompt("");
      setClientEmail("");
      setPreviewData(null);
      setRequestId(crypto.randomUUID());

      // Refresh records & analytics
      await Promise.all([fetchInvoices(1, search, statusFilter), fetchAnalytics()]);
    } catch (err) {
      setError(
        err.message === "Failed to fetch"
          ? "Unable to connect to the backend server. Please verify your connection or wait a moment while the server wakes up."
          : err.message
      );
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }

  const promptCreateInvoice = (e, customParsedData = null) => {
    if (e) e.preventDefault();
    const targetEmail = customParsedData?.clientEmail || clientEmail;

    if (!targetEmail || !targetEmail.trim()) {
      setError("Please provide a valid customer email.");
      return;
    }

    setConfirmDialog({
      isOpen: true,
      title: customParsedData ? "Send Customized Invoice" : "Send Invoice via PayPal",
      message: `Are you ready to create and dispatch this invoice to ${targetEmail} via PayPal Sandbox?`,
      confirmLabel: "Send Invoice",
      isDestructive: false,
      onConfirm: () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        executeCreateInvoice(customParsedData);
      },
    });
  };

  // Preview data item manipulations (Task 1.7)
  const updatePreviewItem = (index, field, value) => {
    if (!previewData) return;
    const updatedItems = [...previewData.items];
    updatedItems[index] = {
      ...updatedItems[index],
      [field]: field === "quantity" || field === "unitPrice" ? Number(value) : value,
    };
    setPreviewData({ ...previewData, items: updatedItems });
  };

  const removePreviewItem = (index) => {
    if (!previewData || previewData.items.length <= 1) return;
    const updatedItems = previewData.items.filter((_, i) => i !== index);
    setPreviewData({ ...previewData, items: updatedItems });
  };

  const addPreviewItem = () => {
    if (!previewData) return;
    setPreviewData({
      ...previewData,
      items: [
        ...previewData.items,
        { name: "New service/item", quantity: 1, unitPrice: 50 },
      ],
    });
  };

  // Format currency amount
  function formatAmount(amount, currencyCode = "USD") {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: currencyCode,
      }).format(amount || 0);
    } catch {
      return `${currencyCode} ${(amount || 0).toFixed(2)}`;
    }
  }

  function calculateInvoiceTotal(item) {
    return (item.items || []).reduce(
      (sum, line) => sum + Number(line.quantity || 0) * Number(line.unitPrice || 0),
      0
    );
  }

  function formatDate(date) {
    if (!date) return "—";
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) return "—";
    return parsed.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  }

  function statusClass(status) {
    return (status || "UNKNOWN").toLowerCase().replace(/\s+/g, "-");
  }

  // Improved status badges with micro-icons (Task 6.3)
  function renderStatusBadge(status) {
    const s = (status || "UNKNOWN").toUpperCase();
    let icon = "●";

    if (s === "PAID" || s === "MARKED_AS_PAID") icon = "✓";
    else if (s === "SENT") icon = "↗";
    else if (s === "DRAFT") icon = "○";
    else if (s === "CANCELLED" || s === "VOID") icon = "✕";
    else if (s === "FAILED") icon = "!";
    else if (s === "CREATING") icon = "◐";
    else if (s === "PARTIALLY_PAID") icon = "◑";

    return (
      <span className={`sent-badge ${statusClass(status)}`}>
        <span className="status-badge-icon">{icon}</span>
        <span>{s}</span>
      </span>
    );
  }

  // Primary currency for overview
  const primaryCurrency = Object.keys(analytics.byCurrency)[0] || "USD";

  // If not authenticated, display the login & registration portal
  if (!token) {
    return <AuthPage onAuthSuccess={handleLogin} API_URL={API_URL} />;
  }

  return (
    <div className="app-shell">
      {/* Floating Toast Notification (Task 1.8) */}
      {toast && (
        <div className={`floating-toast toast-${toast.type}`} role="status">
          <div className="toast-icon">
            {toast.type === "success" && "✓"}
            {toast.type === "error" && "✕"}
            {toast.type === "info" && "ℹ"}
          </div>
          <span className="toast-message">{toast.message}</span>
          <button
            className="toast-close"
            onClick={() => setToast(null)}
            aria-label="Close notification"
          >
            ✕
          </button>
        </div>
      )}

      {/* Confirmation Dialog (Task 6.4) */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmLabel={confirmDialog.confirmLabel}
        isDestructive={confirmDialog.isDestructive}
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog((prev) => ({ ...prev, isOpen: false }))}
      />

      {/* Invoice Detail Modal (Task 6.2) */}
      {selectedInvoice && (
        <InvoiceDetailModal
          invoice={selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
          formatAmount={formatAmount}
          formatDate={formatDate}
          statusClass={statusClass}
        />
      )}

      {/* Mobile Sidebar Overlay */}
      {mobileMenuOpen && (
        <div
          className="mobile-backdrop"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside className={`sidebar ${mobileMenuOpen ? "mobile-open" : ""}`}>
        <div className="sidebar-top">
          <a href="#dashboard" className="brand" onClick={() => setMobileMenuOpen(false)}>
            <span className="brand-icon">P</span>
            <span>PayNexa</span>
          </a>
          <button
            className="sidebar-close-btn"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>

        <p className="nav-heading">WORKSPACE</p>

        <nav className="navigation">
          <a
            href="#dashboard"
            className="nav-link active"
            onClick={() => setMobileMenuOpen(false)}
          >
            ▦ Dashboard
          </a>

          <a
            href="#create-invoice"
            className="nav-link"
            onClick={() => setMobileMenuOpen(false)}
          >
            ✦ AI Invoice Generator
          </a>

          <a
            href="#invoice-history"
            className="nav-link"
            onClick={() => setMobileMenuOpen(false)}
          >
            ▤ Invoice History
          </a>
        </nav>

        <div className="sidebar-bottom">
          <div className="user-profile-badge">
            <div className="user-avatar">
              {(user?.name?.[0] || "U").toUpperCase()}
            </div>
            <div className="user-meta">
              <strong>{user?.name || "Workspace"}</strong>
              <small>{user?.businessName || user?.email}</small>
            </div>
            <button
              className="logout-icon-btn"
              onClick={handleLogout}
              title="Sign out of workspace"
            >
              ⎋
            </button>
          </div>

          <div className="ai-badge">
            <span className="status-dot"></span>
            AI-powered invoicing
            <small>Gemini + PayPal Sandbox + MongoDB</small>
          </div>

          <p className="sidebar-footer">PAYNEXA © 2026</p>
        </div>
      </aside>

      <main className="main-content" id="dashboard">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="hamburger-btn"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Toggle navigation menu"
            >
              ☰
            </button>
            <div>
              <p className="eyebrow">WORKSPACE / OVERVIEW</p>
              <h1>Dashboard</h1>
            </div>
          </div>

          <div className="profile">
            <div className="avatar">{(user?.name?.[0] || "U").toUpperCase()}</div>
            <div className="profile-text">
              <strong>{user?.businessName || user?.name || "Workspace"}</strong>
              <small>{user?.email}</small>
            </div>
            <button
              className="signout-button"
              onClick={handleLogout}
              title="Log out"
            >
              Sign out
            </button>
          </div>
        </header>

        <section className="welcome-banner">
          <div className="banner-content">
            <span className="banner-label">✦ YOUR AI FINANCE ASSISTANT</span>

            <h2>Invoices, made effortless.</h2>

            <p>
              Describe what you need in plain words. Let AI structure your line items, preview &amp;
              edit details, and let PayPal handle payment delivery.
            </p>

            <a href="#create-invoice" className="primary-button">
              + Create an invoice
            </a>
          </div>

          <div className="banner-art">
            <div className="floating-card">
              <span className="floating-check">✓</span>
              <div className="fake-line long"></div>
              <div className="fake-line short"></div>
              <div className="fake-divider"></div>
              <div className="fake-amount">$200.00</div>
              <span className="fake-status">Ready to send</span>
            </div>
          </div>
        </section>

        {/* Dashboard statistics — Live from /api/analytics (Tasks 1.1 & 1.2) */}
        <section className="stats-grid">
          <article className="stat-card">
            <div className="stat-top">
              <span>Total invoices</span>
              <span className="stat-icon purple">▤</span>
            </div>
            <h3>
              {analyticsLoading ? (
                <span className="skeleton-loader">...</span>
              ) : (
                analytics.totalInvoices
              )}
            </h3>
            <p>Recorded in your workspace</p>
          </article>

          <article className="stat-card">
            <div className="stat-top">
              <span>Total invoiced</span>
              <span className="stat-icon blue">↗</span>
            </div>
            <h3>
              {analyticsLoading ? (
                <span className="skeleton-loader">...</span>
              ) : (
                formatAmount(analytics.totalInvoiced, primaryCurrency)
              )}
            </h3>
            <p>Gross invoiced amount</p>
          </article>

          <article className="stat-card">
            <div className="stat-top">
              <span>Total paid</span>
              <span className="stat-icon green">✓</span>
            </div>
            <h3>
              {analyticsLoading ? (
                <span className="skeleton-loader">...</span>
              ) : (
                formatAmount(analytics.totalPaid, primaryCurrency)
              )}
            </h3>
            <p>Completed payments</p>
          </article>

          <article className={`stat-card ${analytics.outstandingAmount > 0 ? "highlight-stat" : ""}`}>
            <div className="stat-top">
              <span>Outstanding</span>
              <span className="stat-icon amber">⏳</span>
            </div>
            <h3>
              {analyticsLoading ? (
                <span className="skeleton-loader">...</span>
              ) : (
                formatAmount(analytics.outstandingAmount, primaryCurrency)
              )}
            </h3>
            <p>Awaiting client payment</p>
          </article>
        </section>

        {/* Multi-currency breakdown chips if multiple currencies exist */}
        {Object.keys(analytics.byCurrency).length > 1 && (
          <div className="currency-breakdown-bar">
            <span className="breakdown-title">Currency breakdown:</span>
            {Object.entries(analytics.byCurrency).map(([curr, currData]) => (
              <span key={curr} className="currency-chip">
                <strong>{curr}:</strong> Invoiced {formatAmount(currData.totalInvoiced, curr)} · Paid{" "}
                {formatAmount(currData.totalPaid, curr)} · Outstanding{" "}
                {formatAmount(currData.outstandingAmount, curr)}
              </span>
            ))}
          </div>
        )}

        {/* Invoice generator & AI preview workspace */}
        <section className="workspace-grid">
          <article className="panel generator-panel" id="create-invoice">
            <div className="panel-heading">
              <div>
                <span className="section-kicker">SMART AUTOMATION</span>
                <h2>Create with AI</h2>
                <p>Turn a natural description into a validated invoice.</p>
              </div>

              <span className="heading-sparkle">✦</span>
            </div>

            <form onSubmit={handleParseAndPreview}>
              <label htmlFor="prompt">Invoice description</label>
              <textarea
                id="prompt"
                rows="4"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Example: Create an invoice for Rahul for 2 website design pages at 150 USD each and 5 hours of consultation at 40 USD/hr, due in 10 days."
                required
              />
              <p className="input-hint">
                ✦ Mention customer name, items, quantities, prices, and due date.
              </p>

              <label htmlFor="clientEmail">Customer email</label>
              <input
                id="clientEmail"
                type="email"
                value={clientEmail}
                onChange={(event) => setClientEmail(event.target.value)}
                placeholder="PayPal Sandbox buyer email"
                required
              />
              <p className="input-hint">Use a PayPal Sandbox buyer email for test payments.</p>

              {error && (
                <div
                  className="message error-message"
                  role="alert"
                  style={{ whiteSpace: "pre-line" }}
                >
                  {error}
                </div>
              )}

              {success && (
                <div className="message success-message" role="status">
                  {success}
                </div>
              )}

              <div className="form-action-row">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleParseAndPreview}
                  disabled={previewLoading || loading}
                >
                  {previewLoading ? (
                    <span className="button-spinner-wrap">
                      <span className="spinner"></span> Parsing with AI...
                    </span>
                  ) : (
                    "✦ Preview & Edit details"
                  )}
                </button>

                <button
                  type="button"
                  className="submit-button direct-send-button"
                  onClick={(e) => promptCreateInvoice(e)}
                  disabled={loading || previewLoading}
                >
                  {loading ? (
                    <span className="button-spinner-wrap">
                      <span className="spinner"></span> Generating &amp; sending...
                    </span>
                  ) : (
                    "Instant Send →"
                  )}
                </button>
              </div>

              <p className="form-disclaimer">
                Preview lets you review and tweak line items. Instant send creates and dispatches
                immediately.
              </p>
            </form>

            {/* AI Preview & Edit Card (Task 1.6 & 1.7) */}
            {previewData && (
              <div className="preview-edit-card">
                <div className="preview-card-header">
                  <div>
                    <span className="preview-kicker">✦ AI INVOICE PREVIEW</span>
                    <h3>Review &amp; Edit Before Sending</h3>
                    <p>Adjust customer details, prices, and line items as needed.</p>
                  </div>
                  <button
                    type="button"
                    className="discard-preview-btn"
                    onClick={() => setPreviewData(null)}
                    title="Discard preview"
                  >
                    ✕ Discard
                  </button>
                </div>

                <div className="preview-form-grid">
                  <div className="preview-field">
                    <label>Client Name</label>
                    <input
                      type="text"
                      value={previewData.clientName || ""}
                      onChange={(e) =>
                        setPreviewData({ ...previewData, clientName: e.target.value })
                      }
                      placeholder="Client Name"
                    />
                  </div>

                  <div className="preview-field">
                    <label>Client Email</label>
                    <input
                      type="email"
                      value={previewData.clientEmail || ""}
                      onChange={(e) =>
                        setPreviewData({ ...previewData, clientEmail: e.target.value })
                      }
                      placeholder="client@example.com"
                    />
                  </div>

                  <div className="preview-field">
                    <label>Currency</label>
                    <select
                      value={previewData.currency || "USD"}
                      onChange={(e) =>
                        setPreviewData({ ...previewData, currency: e.target.value })
                      }
                    >
                      <option value="USD">USD ($)</option>
                      <option value="EUR">EUR (€)</option>
                      <option value="GBP">GBP (£)</option>
                      <option value="INR">INR (₹)</option>
                    </select>
                  </div>

                  <div className="preview-field">
                    <label>Due Date</label>
                    <input
                      type="date"
                      value={previewData.dueDate ? previewData.dueDate.slice(0, 10) : ""}
                      onChange={(e) =>
                        setPreviewData({ ...previewData, dueDate: e.target.value })
                      }
                    />
                  </div>
                </div>

                <div className="preview-items-section">
                  <div className="preview-items-header">
                    <h4>Line Items</h4>
                    <button
                      type="button"
                      className="add-item-btn"
                      onClick={addPreviewItem}
                    >
                      + Add Item
                    </button>
                  </div>

                  <div className="preview-items-table">
                    <div className="items-table-head">
                      <span>Item Description</span>
                      <span>Qty</span>
                      <span>Unit Price</span>
                      <span>Total</span>
                      <span></span>
                    </div>

                    {previewData.items.map((item, index) => (
                      <div key={index} className="items-table-row">
                        <input
                          type="text"
                          className="item-name-input"
                          value={item.name}
                          onChange={(e) => updatePreviewItem(index, "name", e.target.value)}
                          placeholder="Item name"
                        />
                        <input
                          type="number"
                          min="1"
                          className="item-qty-input"
                          value={item.quantity}
                          onChange={(e) => updatePreviewItem(index, "quantity", e.target.value)}
                        />
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          className="item-price-input"
                          value={item.unitPrice}
                          onChange={(e) => updatePreviewItem(index, "unitPrice", e.target.value)}
                        />
                        <span className="item-line-total">
                          {formatAmount(
                            Number(item.quantity || 0) * Number(item.unitPrice || 0),
                            previewData.currency
                          )}
                        </span>
                        <button
                          type="button"
                          className="remove-item-btn"
                          onClick={() => removePreviewItem(index)}
                          disabled={previewData.items.length <= 1}
                          title="Remove item"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="preview-summary-footer">
                    <div className="preview-grand-total">
                      <span>Grand Total:</span>
                      <strong>
                        {formatAmount(
                          calculateInvoiceTotal(previewData),
                          previewData.currency
                        )}
                      </strong>
                    </div>

                    <div className="preview-actions">
                      <button
                        type="button"
                        className="cancel-preview-btn"
                        onClick={() => setPreviewData(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="confirm-send-btn"
                        onClick={(e) => promptCreateInvoice(e, previewData)}
                        disabled={loading}
                      >
                        {loading ? (
                          <span className="button-spinner-wrap">
                            <span className="spinner"></span> Sending to PayPal...
                          </span>
                        ) : (
                          "✓ Confirm & Send via PayPal"
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </article>

          <aside className="panel tips-panel">
            <span className="section-kicker">WORKFLOW GUIDE</span>
            <h2>From words to payment.</h2>
            <p className="tips-description">
              Intelligent automation reduces billing friction down to seconds.
            </p>

            <div className="workflow-step">
              <div className="step-number">01</div>
              <div>
                <h3>1. Describe or Preview</h3>
                <p>Type your request naturally. Preview to customize items, prices and dates.</p>
              </div>
            </div>

            <div className="workflow-step">
              <div className="step-number">02</div>
              <div>
                <h3>2. Structure &amp; Validate</h3>
                <p>Gemini AI extracts structured line items, validated with strict Zod schemas.</p>
              </div>
            </div>

            <div className="workflow-step">
              <div className="step-number">03</div>
              <div>
                <h3>3. Dispatch &amp; Synchronize</h3>
                <p>PayPal generates the payable invoice and MongoDB tracks status changes.</p>
              </div>
            </div>

            <div className="sandbox-notice">
              <span>ⓘ</span>
              <p>
                <strong>PayPal Sandbox Active</strong>
                <br />
                All invoices and notifications are safely processed in test mode.
              </p>
            </div>
          </aside>
        </section>

        {/* Latest created invoice confirmation card */}
        {invoice && (
          <section className="panel result-panel">
            <div className="panel-heading result-heading">
              <div>
                <span className="section-kicker">LATEST CREATED INVOICE</span>
                <h2>Invoice Created &amp; Sent</h2>
              </div>

              {renderStatusBadge(invoice.status)}
            </div>

            <div className="invoice-result">
              <div className="invoice-result-top">
                <div>
                  <span className="result-label">PAYPAL INVOICE ID</span>
                  <strong className="invoice-id">{invoice.invoiceId}</strong>
                </div>
                {invoice.invoice?.clientEmail && (
                  <div>
                    <span className="result-label">SENT TO</span>
                    <strong className="invoice-id">{invoice.invoice.clientEmail}</strong>
                  </div>
                )}
              </div>

              <div className="invoice-details">
                <div>
                  <span>Client</span>
                  <strong>{invoice.invoice?.clientName || "Customer"}</strong>
                </div>

                <div>
                  <span>Currency</span>
                  <strong>{invoice.invoice?.currency || "USD"}</strong>
                </div>

                <div>
                  <span>Due date</span>
                  <strong>{formatDate(invoice.invoice?.dueDate)}</strong>
                </div>

                <div>
                  <span>Invoice total</span>
                  <strong>
                    {formatAmount(
                      calculateInvoiceTotal(invoice.invoice || {}),
                      invoice.invoice?.currency || "USD"
                    )}
                  </strong>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Invoice History with Sync, Export & Pagination (Tasks 1.3, 1.4, 1.5) */}
        <section className="panel result-panel history-panel" id="invoice-history">
          <div className="panel-heading result-heading">
            <div>
              <span className="section-kicker">DATABASE RECORDS</span>
              <h2>Invoice History</h2>
              <p>Directly synchronized with MongoDB &amp; PayPal Sandbox. Click any row for details.</p>
            </div>

            <div className="history-action-buttons">
              {/* Task 1.3: PayPal Sync button */}
              <button
                type="button"
                className="action-button sync-button"
                onClick={handleSyncWithPayPal}
                disabled={isSyncing || historyLoading}
                title="Synchronize statuses with PayPal Sandbox"
              >
                {isSyncing ? (
                  <span className="button-spinner-wrap">
                    <span className="spinner"></span> Syncing...
                  </span>
                ) : (
                  "↻ Sync with PayPal"
                )}
              </button>

              {/* Task 1.4: Export CSV button */}
              <button
                type="button"
                className="action-button export-button"
                onClick={exportCSV}
                disabled={isExporting || invoices.length === 0}
                title="Export all invoices to CSV"
              >
                {isExporting ? (
                  <span className="button-spinner-wrap">
                    <span className="spinner"></span> Exporting...
                  </span>
                ) : (
                  "↓ Export CSV"
                )}
              </button>

              {/* Refresh button */}
              <button
                type="button"
                className="refresh-button"
                onClick={() => fetchInvoices(page, search, statusFilter)}
                disabled={historyLoading}
              >
                {historyLoading ? "..." : "↻ Refresh"}
              </button>
            </div>
          </div>

          {historyError && (
            <div className="message error-message" role="alert">
              {historyError}
            </div>
          )}

          <div className="history-controls">
            <input
              type="search"
              aria-label="Search invoices"
              placeholder="Search customer name, email or invoice ID..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />

            <select
              aria-label="Filter invoice status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="ALL">All statuses</option>
              <option value="SENT">Sent</option>
              <option value="PAID">Paid</option>
              <option value="DRAFT">Draft</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="FAILED">Failed</option>
              <option value="CREATING">Creating</option>
            </select>
          </div>

          {historyLoading ? (
            <div className="empty-state">
              <div className="spinner large-spinner"></div>
              <h3>Loading invoices...</h3>
              <p>Querying MongoDB records and calculating pagination.</p>
            </div>
          ) : invoices.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">▤</div>
              <h3>No matching invoices found</h3>
              <p>
                {search || statusFilter !== "ALL"
                  ? "Try adjusting your search criteria or status filter."
                  : "Generate your first invoice above to see it appear here."}
              </p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="invoice-table">
                <thead>
                  <tr>
                    <th>Invoice ID</th>
                    <th>Customer</th>
                    <th>Amount</th>
                    <th>Due date</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>

                <tbody>
                  {invoices.map((item) => (
                    <tr
                      key={item._id}
                      className="clickable-invoice-row"
                      onClick={() => setSelectedInvoice(item)}
                      title="Click to view full invoice specification"
                    >
                      <td>
                        <strong>{item.paypalInvoiceId || "(Draft/Pending)"}</strong>
                        <small>{formatDate(item.createdAt)}</small>
                      </td>

                      <td>
                        <strong>{item.clientName}</strong>
                        <small>{item.clientEmail}</small>
                      </td>

                      <td>
                        <strong>
                          {formatAmount(
                            calculateInvoiceTotal(item),
                            item.currency || "USD"
                          )}
                        </strong>
                      </td>

                      <td>{formatDate(item.dueDate)}</td>

                      <td>{renderStatusBadge(item.status)}</td>

                      <td className="row-arrow">
                        <span>→</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pagination Controls (Task 1.5) */}
              <div className="pagination-bar">
                <span className="pagination-info">
                  Showing Page {pagination.currentPage} of {pagination.totalPages || 1} (
                  {pagination.totalInvoices} total invoices)
                </span>

                <div className="pagination-buttons">
                  <button
                    type="button"
                    className="page-nav-button"
                    onClick={() => handlePageChange(pagination.currentPage - 1)}
                    disabled={!pagination.hasPreviousPage || historyLoading}
                  >
                    ← Previous
                  </button>

                  <span className="page-current-pill">
                    {pagination.currentPage} / {pagination.totalPages || 1}
                  </span>

                  <button
                    type="button"
                    className="page-nav-button"
                    onClick={() => handlePageChange(pagination.currentPage + 1)}
                    disabled={!pagination.hasNextPage || historyLoading}
                  >
                    Next →
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        <footer className="page-footer">
          <span>© 2026 PayNexa Systems</span>
          <span>Engineered with Gemini AI, PayPal Sandbox &amp; MongoDB</span>
        </footer>
      </main>
    </div>
  );
}

export default App;