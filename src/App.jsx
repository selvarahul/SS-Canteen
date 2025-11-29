import { useEffect, useMemo, useRef, useState } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { products } from './data/products';
import './App.css';

const STORAGE_KEY = 'daily-orders-state';

// Simple SVG placeholder encoded at runtime (no external file required)
const PLACEHOLDER_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300' viewBox='0 0 400 300'>
  <rect width='100%' height='100%' fill='%23eeeeee'/>
  <text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='%23999' font-size='20'>No image</text>
</svg>`;
const PLACEHOLDER_DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(PLACEHOLDER_SVG)}`;

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

  // theme: night-vision toggle (persisted)
  const [darkMode, setDarkMode] = useState(() => {
    try {
      return localStorage.getItem('darkMode') === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('darkMode', darkMode ? 'true' : 'false');
    } catch {}
  }, [darkMode]);

  // modal + search
  const [showSummary, setShowSummary] = useState(false);
  const [query, setQuery] = useState('');

  const updateCounts = (updater) => {
    setState((prev) => {
      const nextCounts =
        typeof updater === 'function' ? updater(prev.counts) : updater;
      return { ...prev, counts: { ...defaultCounts, ...nextCounts } };
    });
  };

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ counts, lastReset }));
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

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, query]);

  const totalItems = useMemo(() => rows.reduce((sum, row) => sum + row.quantity, 0), [rows]);
  const totalAmount = useMemo(() => rows.reduce((sum, row) => sum + row.total, 0), [rows]);

  const handleIncrement = (id) => updateCounts((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
  const handleDecrement = (id) => updateCounts((prev) => ({ ...prev, [id]: Math.max((prev[id] ?? 0) - 1, 0) }));
  const handleResetProduct = (id) => updateCounts((prev) => ({ ...prev, [id]: 0 }));

  const handleResetDay = () => {
    const confirmed = window.confirm('Reset the entire day? This will clear all counts.');
    if (!confirmed) return;
    setState({ counts: { ...defaultCounts }, lastReset: new Date().toISOString() });
  };

  // Robust export function: uses visible summaryRef if mounted, otherwise creates an off-DOM copy
  const handleExportPdf = async () => {
    setIsExporting(true);
    let targetEl = summaryRef.current;
    let createdTemp = false;
    let tempContainer = null;

    try {
      if (!targetEl) {
        // create offscreen element to render the summary table
        createdTemp = true;
        tempContainer = document.createElement('div');

        // Offscreen but renderable
        tempContainer.style.position = 'fixed';
        tempContainer.style.left = '-9999px';
        tempContainer.style.top = '0';
        tempContainer.style.padding = '16px';
        tempContainer.style.background = '#ffffff';
        tempContainer.style.color = '#000';
        tempContainer.style.width = '900px';
        tempContainer.style.boxSizing = 'border-box';
        tempContainer.style.fontFamily = getComputedStyle(document.body).fontFamily || 'sans-serif';

        // Build HTML similar to your modal table
        let html = `<div style="font-size:16px;font-weight:700;margin-bottom:8px">Daily Order Summary</div>`;
        html += `<div style="overflow-x:auto;border:1px solid #e6eefc;border-radius:6px;background:#fff;padding:8px">`;
        html += `<table style="width:100%;border-collapse:collapse;font-size:13px">`;
        html += `<thead><tr style="text-align:left;color:#334155;font-size:12px"><th style="padding:8px;border-bottom:1px solid #eef2ff">Item</th><th style="padding:8px;border-bottom:1px solid #eef2ff">Qty</th><th style="padding:8px;border-bottom:1px solid #eef2ff">Rate</th><th style="padding:8px;border-bottom:1px solid #eef2ff">Total</th></tr></thead>`;
        html += `<tbody>`;
        for (const row of rows) {
          html += `<tr><td style="padding:8px;border-bottom:1px solid #f1f5f9">${row.name}</td><td style="padding:8px;border-bottom:1px solid #f1f5f9">${row.quantity}</td><td style="padding:8px;border-bottom:1px solid #f1f5f9">${formatCurrency(row.price)}</td><td style="padding:8px;border-bottom:1px solid #f1f5f9">${formatCurrency(row.total)}</td></tr>`;
        }
        html += `</tbody>`;
        html += `<tfoot><tr><td style="padding:8px;font-weight:600">Total</td><td style="padding:8px;font-weight:600">${totalItems}</td><td style="padding:8px">—</td><td style="padding:8px;font-weight:600">${formatCurrency(totalAmount)}</td></tr></tfoot>`;
        html += `</table></div>`;

        tempContainer.innerHTML = html;
        document.body.appendChild(tempContainer);
        targetEl = tempContainer;
      }

      // allow browser to paint
      await new Promise((res) => setTimeout(res, 60));

      const canvas = await html2canvas(targetEl, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth - 20;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      pdf.setFontSize(16);
      pdf.text('Daily Order Summary', 10, 15);

      const availableHeight = pageHeight - 30;
      const renderedHeight = Math.min(imgHeight, availableHeight);
      pdf.addImage(imgData, 'PNG', 10, 28, imgWidth, renderedHeight);
      pdf.save(`daily-orders-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (error) {
      console.error('Failed to export PDF', error);
      alert('Something went wrong while creating the PDF.');
    } finally {
      if (createdTemp && tempContainer && tempContainer.parentNode) {
        tempContainer.parentNode.removeChild(tempContainer);
      }
      setIsExporting(false);
    }
  };

  // NEW: wrapper that asks for confirmation before exporting
  const handleExportPdfWithConfirm = async () => {
    const confirmed = window.confirm('Do you want to download the daily orders PDF now?');
    if (!confirmed) return;
    await handleExportPdf();
  };

  // small helper to toggle theme
  const toggleDark = () => setDarkMode((v) => !v);

  return (
    <div className="app-shell" data-theme={darkMode ? 'dark' : 'light'}>
      <header className="app-header">
        <div>
          <h1>Daily Orders</h1>
          <p className="subheading">
            Tap items as customers order and close the day with one click.
          </p>
        </div>
        <div className="header-actions" role="toolbar" aria-label="Actions">
          {/* NIGHT VISION / THEME TOGGLE */}
          <button
            type="button"
            className="theme-toggle"
            onClick={toggleDark}
            aria-pressed={darkMode}
            title={darkMode ? 'Switch to light mode' : 'Switch to night vision'}
          >
            <span className="toggle-track" aria-hidden>
              <span className="toggle-thumb" />
            </span>
            <span className="toggle-label">{darkMode ? 'Night' : 'Day'}</span>
          </button>

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
            onClick={handleExportPdfWithConfirm}
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
                border: '1px solid var(--control-border)',
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
                    {/* ADDED IMAGE (public/images/...) with safe data-URI fallback */}
                    <img
                      src={item.image}
                      alt={item.name}
                      style={{
                        width: 70,
                        height: 70,
                        objectFit: 'cover',
                        borderRadius: 8,
                        marginRight: 12,
                        display: 'inline-block',
                        verticalAlign: 'middle'
                      }}
                      onError={(e) => {
                        // avoid infinite loop if placeholder somehow fails
                        e.currentTarget.onerror = null;
                        e.currentTarget.src = PLACEHOLDER_DATA_URI;
                        console.warn('Image failed, using inline placeholder for', item.image);
                      }}
                    />
                    <div style={{ display: 'inline-block', verticalAlign: 'middle' }}>
                      <h3 style={{ margin: 0 }}>{item.name}</h3>
                      <p className="price" style={{ margin: '4px 0 0' }}>{formatCurrency(item.price)}</p>
                    </div>
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
                </article>
              ))
            )}
          </div>
        </section>
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
            className="summary-modal slide-down"
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
                        <td style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, borderBottom: '1px solid #f1f5f9' }}>
                          {/* ADDED IMAGE (public/images/...) with safe data-URI fallback */}
                          <img
                            src={row.image}
                            alt={row.name}
                            style={{
                              width: 36,
                              height: 36,
                              objectFit: 'cover',
                              borderRadius: 6,
                              flexShrink: 0,
                            }}
                            onError={(e) => {
                              e.currentTarget.onerror = null;
                              e.currentTarget.src = PLACEHOLDER_DATA_URI;
                              console.warn('Summary image failed, using inline placeholder for', row.image);
                            }}
                          />
                          <span>{row.name}</span>
                        </td>
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
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setShowSummary(false);
                  setTimeout(() => handleExportPdfWithConfirm(), 200);
                }}
              >
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
