import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error(error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="page">
          <div className="card">
            <strong>Something went wrong.</strong>
            <p style={{ color: '#999', marginTop: 8 }}>
              The page hit an unexpected error. Reloading usually fixes it.
            </p>
            <button style={{ marginTop: 12 }} onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
