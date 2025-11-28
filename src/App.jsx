import { useEffect, useMemo, useRef, useState } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { products } from './data/products';
import './App.css';

const STORAGE_KEY = 'daily-orders-state';

const defaultCounts = products.reduce((acc, product) => {
  acc[product.id] = 0;
  return acc;
}, {});

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
  }).format(value);

const loadInitialState = () => {
  if (typeof window === 'undefined') {
    return { counts: { ...defaultCounts }, lastReset: new Date().toISOString() };
  }

  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (stored && stored.counts) {
      return {
        counts: { ...defaultCounts, ...stored.counts },
        lastReset: stored.lastReset ?? new Date().toISOString(),
      };
    }
  } catch (_error) {
    // ignore malformed data
  }

  return { counts: { ...defaultCounts }, lastReset: new Date().toISOString() };
};

function App() {
  const summaryRef = useRef(null);
  const [{ counts, lastReset }, setState] = useState(loadInitialState);
  const [isExporting, setIsExporting] = useState(false);

  // NEW: control modal visibility for summary
  const [showSummary, setShowSummary] = useState(false);

  // NEW: search query state for filtering menu items
  const [query, setQuery] = useState('');

  const updateCounts = (updater) => {
    setState((prev) => {
      const nextCounts =
        typeof updater === 'function' ? updater(prev.counts) : updater;
      return { ...prev, counts: { ...defaultCounts, ...nextCounts } };
    });
  };

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ counts, lastReset }),
    );
  }, [counts, lastReset]);

  const rows = useMemo(
    () =>
      products.map((product) => {
        const quantity = counts[product.id] ?? 0;
        return {
          ...product,
          quantity,
          total: quantity * product.price,
        };
      }),
    [counts],
  );

  // NEW: filteredRows derived from rows + query (case-insensitive)
  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, query]);

  const totalItems = useMemo(
    () => rows.reduce((sum, row) => sum + row.quantity, 0),
    [rows],
  );
  const totalAmount = useMemo(
    () => rows.reduce((sum, row) => sum + row.total, 0),
    [rows],
  );

  const handleIncrement = (id) => {
    updateCounts((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
  };

  const handleDecrement = (id) => {
    updateCounts((prev) => ({
      ...prev,
      [id]: Math.max((prev[id] ?? 0) - 1, 0),
    }));
  };

  const handleResetProduct = (id) => {
    updateCounts((prev) => ({ ...prev, [id]: 0 }));
  };

  const handleResetDay = () => {
    const confirmed = window.confirm(
      'Reset the entire day? This will clear all counts.',
    );
    if (!confirmed) return;

    setState({
      counts: { ...defaultCounts },
      lastReset: new Date().toISOString(),
    });
  };

  const handleExportPdf = async () => {
    if (!summaryRef.current) return;
    setIsExporting(true);
    try {
      const canvas = await html2canvas(summaryRef.current, {
        scale: 2,
        backgroundColor: '#ffffff',
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth - 20;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      pdf.setFontSize(16);
      pdf.text('Daily Order Summary', 10, 15);

      // NOTE: removed the "Last reset" line from PDF as requested

      const availableHeight = pageHeight - 30;
      const renderedHeight = Math.min(imgHeight, availableHeight);
      pdf.addImage(imgData, 'PNG', 10, 28, imgWidth, renderedHeight);
      pdf.save(
        `daily-orders-${new Date().toISOString().slice(0, 10)}.pdf`,
      );
    } catch (error) {
      console.error('Failed to export PDF', error);
      alert('Something went wrong while creating the PDF.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>Daily Orders</h1>
          <p className="subheading">
            Tap items as customers order and close the day with one click.
          </p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => setShowSummary(true)}
          >
            Summary
          </button>

          <button
            type="button"
            className="secondary"
            onClick={handleResetDay}
          >
            Close Day &amp; Reset
          </button>
          <button
            type="button"
            className="primary"
            onClick={handleExportPdf}
            disabled={isExporting}
          >
            {isExporting ? 'Preparing PDF…' : 'Export PDF'}
          </button>
        </div>
      </header>

      <main className="content">
        <section className="product-panel">
          <h2>Menu</h2>

          {/* SEARCH BAR - placed at top of the menu as requested */}
          <div className="menu-search" style={{ marginBottom: '12px' }}>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search menu items..."
              aria-label="Search menu items"
              style={{
                width: '100%',
                maxWidth: '480px',
                padding: '10px 12px',
                borderRadius: '10px',
                border: '1px solid #e6eefc',
                outline: 'none',
                fontSize: '14px',
              }}
            />
          </div>

          <div className="product-grid">
            {filteredRows.length === 0 ? (
              <div style={{ padding: 20, color: '#64748b' }}>No items found.</div>
            ) : (
              filteredRows.map((item) => (
                <article key={item.id} className="product-card">
                  <div className="product-info">
                    <h3>{item.name}</h3>
                    <p className="price">{formatCurrency(item.price)}</p>
                  </div>
                  <div className="product-controls">
                    <button
                      type="button"
                      aria-label={`Remove one ${item.name}`}
                      onClick={() => handleDecrement(item.id)}
                    >
                      −
                    </button>
                    <span>{item.quantity}</span>
                    <button
                      type="button"
                      aria-label={`Add one ${item.name}`}
                      onClick={() => handleIncrement(item.id)}
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    className="link reset"
                    onClick={() => handleResetProduct(item.id)}
                    disabled={!item.quantity}
                  >
                    Reset
                  </button>
                </article>
              ))
            )}
          </div>
        </section>

        {/* NOTE: original right-side summary section removed as requested */}
      </main>

      {/* Summary Modal (keeps the same table as the removed panel) */}
      {showSummary && (
        <div
          className="summary-modal-overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowSummary(false)}
        >
          <div
            className="summary-modal"
            onClick={(e) => e.stopPropagation()}
            aria-label="Summary details"
          >
            <header className="summary-modal-header">
              <h3>Today's Summary</h3>
              <button
                type="button"
                className="close"
                onClick={() => setShowSummary(false)}
                aria-label="Close summary"
              >
                ×
              </button>
            </header>

            <div className="summary-modal-body">
              {/* removed visible "Last reset" display here as requested */}
              <div className="totals modal-totals">
                <div>
                  <span className="label">Items</span>
                  <strong>{totalItems}</strong>
                </div>
                <div>
                  <span className="label">Amount</span>
                  <strong>{formatCurrency(totalAmount)}</strong>
                </div>
              </div>

              <div className="table-wrapper modal-table" ref={summaryRef}>
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Qty</th>
                      <th>Rate</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.name}</td>
                        <td>{row.quantity}</td>
                        <td>{formatCurrency(row.price)}</td>
                        <td>{formatCurrency(row.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td>{totalItems}</td>
                      <td>—</td>
                      <td>{formatCurrency(totalAmount)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <footer className="summary-modal-footer">
              <button type="button" onClick={() => setShowSummary(false)}>Close</button>
              <button type="button" className="primary" onClick={() => { setShowSummary(false); setTimeout(() => handleExportPdf(), 200); }}>
                Export PDF
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
