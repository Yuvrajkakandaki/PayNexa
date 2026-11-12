import { useState } from "react";

export default function AuthPage({ onAuthSuccess, API_URL }) {
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const endpoint = isRegister ? "/api/auth/register" : "/api/auth/login";
    const payload = isRegister
      ? { name, email, password, businessName }
      : { email, password };

    try {
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Authentication failed.");
      }

      onAuthSuccess(data.token, data.user);
    } catch (err) {
      setError(
        err.message === "Failed to fetch"
          ? "Unable to connect to the backend server. Please verify your connection or wait a moment while the server wakes up."
          : err.message
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <div className="brand-logo">
            <span className="brand-icon">P</span>
            <span className="brand-name">PayNexa</span>
          </div>
          <h2>{isRegister ? "Create your workspace" : "Welcome back"}</h2>
          <p>
            {isRegister
              ? "Start generating and managing AI invoices in seconds"
              : "Sign in to access your dashboard and invoices"}
          </p>
        </div>

        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab ${!isRegister ? "active" : ""}`}
            onClick={() => {
              setIsRegister(false);
              setError("");
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`auth-tab ${isRegister ? "active" : ""}`}
            onClick={() => {
              setIsRegister(true);
              setError("");
            }}
          >
            Create Account
          </button>
        </div>

        {error && (
          <div className="message error-message auth-error" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          {isRegister && (
            <>
              <div className="form-group">
                <label htmlFor="name">Full Name</label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Yuvraj Sharma"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="businessName">Business / Company Name (Optional)</label>
                <input
                  id="businessName"
                  type="text"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="e.g. Nexa Digital Labs"
                />
              </div>
            </>
          )}

          <div className="form-group">
            <label htmlFor="auth-email">Email Address</label>
            <input
              id="auth-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="auth-password">
              Password {isRegister && <small>(min. 8 characters)</small>}
            </label>
            <input
              id="auth-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              minLength={8}
              required
            />
          </div>

          <button type="submit" className="submit-button auth-submit" disabled={loading}>
            {loading ? (
              <span className="button-spinner-wrap">
                <span className="spinner"></span>{" "}
                {isRegister ? "Creating account..." : "Signing in..."}
              </span>
            ) : isRegister ? (
              "✦ Create Account & Get Started"
            ) : (
              "Sign In →"
            )}
          </button>
        </form>

        <div className="auth-footer">
          <span>Protected with bcrypt password hashing &amp; signed JWT tokens</span>
        </div>
      </div>
    </div>
  );
}
