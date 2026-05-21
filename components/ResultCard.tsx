"use client";

interface ResultCardProps {
  icon: string;
  title: string;
  accent?: string;
  children: React.ReactNode;
}

export default function ResultCard({
  icon,
  title,
  accent = "#00C9A7",
  children,
}: ResultCardProps) {
  return (
    <>
      <style>{`
        .rc-card {
          background: #0D0F14;
          border: 1px solid #1E2230;
          border-radius: 16px;
          overflow: hidden;
          transition: border-color 0.2s;
        }
        .rc-card:hover {
          border-color: color-mix(in srgb, var(--rc-accent) 30%, transparent);
        }
        .rc-header {
          padding: 14px 22px;
          border-bottom: 1px solid #1A1D28;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .rc-icon {
          font-size: 17px;
          line-height: 1;
        }
        .rc-title {
          font-family: 'Syne', sans-serif;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: var(--rc-accent);
        }
        .rc-body {
          padding: 18px 22px;
        }

        /* Prose content */
        .rc-body p,
        .rc-body .rc-prose {
          font-size: 14px;
          line-height: 1.8;
          color: #A8B0CC;
          font-weight: 300;
          white-space: pre-wrap;
        }

        /* List content */
        .rc-body ul.rc-list {
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 0;
          margin: 0;
        }
        .rc-body ul.rc-list li {
          display: flex;
          gap: 12px;
          font-size: 14px;
          line-height: 1.65;
          color: #A8B0CC;
          font-weight: 300;
        }
        .rc-body ul.rc-list li::before {
          content: '';
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--rc-accent);
          flex-shrink: 0;
          margin-top: 7px;
        }
      `}</style>

      <div
        className="rc-card"
        style={{ "--rc-accent": accent } as React.CSSProperties}
      >
        <div className="rc-header">
          <span className="rc-icon">{icon}</span>
          <span className="rc-title">{title}</span>
        </div>
        <div className="rc-body">{children}</div>
      </div>
    </>
  );
}

/* ── Convenience sub-components ── */

export function ResultList({ items, accent }: { items: string[]; accent?: string }) {
  return (
    <ul
      className="rc-list"
      style={{ "--rc-accent": accent || "#00C9A7" } as React.CSSProperties}
    >
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export function ResultProse({ text }: { text: string }) {
  return <p className="rc-prose">{text}</p>;
}
