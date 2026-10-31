import { useEffect } from "react";

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  isDestructive = false,
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop confirm-backdrop" onClick={onCancel} role="dialog" aria-modal="true">
      <div className="confirm-card" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-icon-wrap">
          <span className="confirm-icon">{isDestructive ? "⚠️" : "✦"}</span>
        </div>

        <h3>{title}</h3>
        <p>{message}</p>

        <div className="confirm-actions">
          <button type="button" className="confirm-cancel-btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`confirm-primary-btn ${isDestructive ? "destructive" : ""}`}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
