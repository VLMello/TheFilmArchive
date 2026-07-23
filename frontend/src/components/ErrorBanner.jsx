import React from 'react';

export default function ErrorBanner({ message, onRetry, onDismiss }) {
  return (
    <div className="card">
      <span className="error-text">{message}</span>
      {(onRetry || onDismiss) && (
        <div className="error-banner-actions">
          {onRetry && <button onClick={onRetry}>Retry</button>}
          {onDismiss && (
            <button style={{ background: '#333', color: '#eee' }} onClick={onDismiss}>
              Dismiss
            </button>
          )}
        </div>
      )}
    </div>
  );
}
