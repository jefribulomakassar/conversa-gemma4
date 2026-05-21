"use client";

import { useRouter } from "next/navigation";

const agents = [
  {
    id: "audio",
    icon: "🎙️",
    title: "Audio Meeting Analyzer",
    description:
      "Upload a voice recording. Get full transcript, key points, action items, and follow-up questions.",
    accepts: "MP3 · WAV · M4A",
    href: "/audio",
    accent: "#00C9A7",
  },
  {
    id: "image",
    icon: "🖼️",
    title: "Whiteboard Intelligence",
    description:
      "Upload a whiteboard photo or handwritten notes. Get extracted text, structured summary, and next steps.",
    accepts: "JPG · PNG · WEBP",
    href: "/image",
    accent: "#4F8EF7",
  },
  {
    id: "document",
    icon: "📄",
    title: "Document Brief Generator",
    description:
      "Upload a PDF. Get a meeting brief, project kickoff, proposal draft, interview prep, or SOP — your choice.",
    accepts: "PDF",
    href: "/document",
    accent: "#F7A84F",
  },
];

export default function Home() {
  const router = useRouter();

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,300&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          background: #07080A;
          color: #E8EAF0;
          font-family: 'DM Sans', sans-serif;
          min-height: 100vh;
        }

        .noise {
          position: fixed; inset: 0; z-index: 0; pointer-events: none;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E");
          opacity: 0.5;
        }

        .glow-orb {
          position: fixed; border-radius: 50%; filter: blur(120px); pointer-events: none; z-index: 0;
        }
        .orb-1 { width: 500px; height: 500px; background: #00C9A733; top: -150px; left: -100px; }
        .orb-2 { width: 400px; height: 400px; background: #4F8EF722; bottom: -100px; right: -80px; }

        .wrapper {
          position: relative; z-index: 1;
          max-width: 1100px; margin: 0 auto;
          padding: 60px 24px 80px;
        }

        .badge {
          display: inline-flex; align-items: center; gap: 8px;
          border: 1px solid #ffffff18; border-radius: 100px;
          padding: 6px 14px; font-size: 12px; font-weight: 500;
          color: #ffffff66; letter-spacing: 0.06em;
          text-transform: uppercase; margin-bottom: 28px;
          background: #ffffff06;
        }
        .badge-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: #00C9A7;
          box-shadow: 0 0 8px #00C9A7;
          animation: pulse 2s ease-in-out infinite;
        }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }

        h1 {
          font-family: 'Syne', sans-serif;
          font-size: clamp(36px, 6vw, 68px);
          font-weight: 800;
          line-height: 1.05;
          letter-spacing: -0.03em;
          color: #F0F2F8;
          margin-bottom: 20px;
        }
        h1 span {
          background: linear-gradient(135deg, #00C9A7, #4F8EF7);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        }

        .subtitle {
          font-size: 17px; font-weight: 300;
          color: #8891A8; max-width: 520px;
          line-height: 1.7; margin-bottom: 56px;
        }

        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 20px;
        }

        .card {
          background: #0D0F14;
          border: 1px solid #1E2230;
          border-radius: 20px;
          padding: 32px;
          cursor: pointer;
          position: relative;
          overflow: hidden;
          transition: border-color 0.25s, transform 0.25s, box-shadow 0.25s;
          text-align: left;
        }
        .card::before {
          content: '';
          position: absolute; inset: 0;
          background: var(--accent-color);
          opacity: 0;
          transition: opacity 0.25s;
          border-radius: inherit;
        }
        .card:hover {
          border-color: var(--accent-color);
          transform: translateY(-4px);
          box-shadow: 0 16px 48px -8px var(--accent-glow);
        }
        .card:hover::before { opacity: 0.04; }

        .card-icon {
          font-size: 36px; margin-bottom: 20px;
          display: block;
          filter: drop-shadow(0 0 12px var(--accent-color));
        }

        .card-title {
          font-family: 'Syne', sans-serif;
          font-size: 20px; font-weight: 700;
          color: #EEF0F8; margin-bottom: 10px;
          letter-spacing: -0.02em;
        }

        .card-desc {
          font-size: 14px; font-weight: 300;
          color: #6B7285; line-height: 1.65;
          margin-bottom: 24px;
        }

        .card-footer {
          display: flex; align-items: center; justify-content: space-between;
        }

        .accepts {
          font-size: 11px; font-weight: 500;
          letter-spacing: 0.08em; text-transform: uppercase;
          color: var(--accent-color); opacity: 0.8;
        }

        .arrow {
          width: 36px; height: 36px; border-radius: 50%;
          border: 1px solid #1E2230;
          display: flex; align-items: center; justify-content: center;
          color: #8891A8; font-size: 16px;
          transition: background 0.2s, border-color 0.2s, color 0.2s, transform 0.2s;
        }
        .card:hover .arrow {
          background: var(--accent-color);
          border-color: var(--accent-color);
          color: #07080A;
          transform: translateX(3px);
        }

        .powered {
          margin-top: 56px;
          text-align: center;
          font-size: 12px; font-weight: 400;
          color: #3B4155; letter-spacing: 0.05em;
        }
        .powered strong { color: #5C6480; font-weight: 500; }

        @media (max-width: 600px) {
          .wrapper { padding: 40px 16px 60px; }
          .grid { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="noise" />
      <div className="glow-orb orb-1" />
      <div className="glow-orb orb-2" />

      <div className="wrapper">
        <div className="badge">
          <span className="badge-dot" />
          Powered by Gemma 4 · Enterprise Intelligence
        </div>

        <h1>
          Meeting intelligence,<br />
          <span>zero friction.</span>
        </h1>

        <p className="subtitle">
          Drop a recording, a whiteboard photo, or a document.
          Conversa extracts what matters — transcripts, briefs, action items — in seconds.
        </p>

        <div className="grid">
          {agents.map((agent) => (
            <button
              key={agent.id}
              className="card"
              style={
                {
                  "--accent-color": agent.accent,
                  "--accent-glow": agent.accent + "44",
                } as React.CSSProperties
              }
              onClick={() => router.push(agent.href)}
            >
              <span className="card-icon">{agent.icon}</span>
              <div className="card-title">{agent.title}</div>
              <div className="card-desc">{agent.description}</div>
              <div className="card-footer">
                <span className="accepts">{agent.accepts}</span>
                <span className="arrow">→</span>
              </div>
            </button>
          ))}
        </div>

        <p className="powered">
          Built on <strong>Conversa AI Platform</strong> · Model: <strong>gemma-4-26b-a4b-it</strong> via Google AI Studio
        </p>
      </div>
    </>
  );
}
