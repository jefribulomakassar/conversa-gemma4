"use client";

import { useState } from "react";

interface ThinkingIndicatorProps {
  thinking?: string;
  loading?: boolean;
  accent?: string;
}

export default function ThinkingIndicator({
  thinking,
  loading = false,
  accent = "#F7A84F",
}: ThinkingIndicatorProps) {
  const [expanded, setExpanded] = useState(false);

  if (!loading && !thinking) return null;

  return (
    <>
      <style>{`
        .ti-wrap {
          background: #0D0F14;
          border: 1px solid color-mix(in srgb, var(--ti-accent) 20%, transparent);
          border-radius: 14px;
          overflow: hidden;
        }

        /* ── Loading state ── */
        .ti-loading {
          padding: 16px 20px;
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .ti-dots {
          display: flex;
          gap: 5px;
          flex-shrink: 0;
        }
        .ti-dots span {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--ti-accent);
          animation: ti-bounce 1.2s ease-in-out infinite;
        }
        .ti-dots span:nth-child(1) { animation-delay: 0s; }
        .ti-dots span:nth-child(2) { animation-delay: 0.15s; }
        .ti-dots span:nth-child(3) { animation-delay: 0.3s; }
        @keyframes ti-bounce {
          0%, 100% { transform: translateY(0); opacity: 0.4; }
          50% { transform: translateY(-6px); opacity: 1; }
        }
        .ti-loading-text {
          font-family: 'Syne', sans-serif;
          font-size: 13px;
          font-weight: 700;
          color: var(--ti-accent);
          letter-spacing: 0.03em;
        }
        .ti-loading-sub {
          font-size: 12px;
          color: #4B5470;
          margin-top: 2px;
        }

        /* ── Reveal state ── */
        .ti-toggle {
          width: 100%;
          padding: 14px 20px;
          background: none;
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          transition: background 0.15s;
        }
        .ti-toggle:hover {
          background: color-mix(in srgb, var(--ti-accent) 4%, transparent);
        }
        .ti-toggle-left {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .ti-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: color-mix(in srgb, var(--ti-accent) 12%, transparent);
          border: 1px solid color-mix(in srgb, var(--ti-accent) 25%, transparent);
          border-radius: 100px;
          padding: 4px 10px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: var(--ti-accent);
        }
        .ti-badge-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: var(--ti-accent);
        }
        .ti-toggle-label {
          font-family: 'Syne', sans-serif;
          font-size: 13px;
          font-weight: 700;
          color: #8891A8;
          letter-spacing: 0.02em;
        }
        .ti-chevron {
          font-size: 11px;
          color: #4B5470;
          transition: transform 0.2s;
          flex-shrink: 0;
        }
        .ti-chevron.open { transform: rotate(180deg); }

        /* ── Content ── */
        .ti-content {
          border-top: 1px solid #1A1D28;
          padding: 16px 20px;
          max-height: 280px;
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: #1E2230 transparent;
        }
        .ti-content::-webkit-scrollbar { width: 4px; }
        .ti-content::-webkit-scrollbar-track { background: transparent; }
        .ti-content::-webkit-scrollbar-thumb { background: #1E2230; border-radius: 4px; }

        .ti-text {
          font-size: 13px;
          line-height: 1.8;
          color: #4B5470;
          font-style: italic;
          white-space: pre-wrap;
          font-weight: 300;
        }
      `}</style>

      <div
        className="ti-wrap"
        style={{ "--ti-accent": accent } as React.CSSProperties}
      >
        {loading ? (
          <div className="ti-loading">
            <div className="ti-dots">
              <span /><span /><span />
            </div>
            <div>
              <div className="ti-loading-text">🤔 Thinking Mode active</div>
              <div className="ti-loading-sub">Gemma 4 is reasoning through your document…</div>
            </div>
          </div>
        ) : (
          <>
            <button className="ti-toggle" onClick={() => setExpanded(!expanded)}>
              <div className="ti-toggle-left">
                <div className="ti-badge">
                  <span className="ti-badge-dot" />
                  Thinking Trace
                </div>
                <span className="ti-toggle-label">View Gemma 4 reasoning</span>
              </div>
              <span className={`ti-chevron${expanded ? " open" : ""}`}>▼</span>
            </button>

            {expanded && (
              <div className="ti-content">
                <p className="ti-text">{thinking}</p>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
