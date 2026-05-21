"use client";

import { useState, useRef } from "react";

const BRIEF_TYPES = [
  { id: "meeting", label: "Meeting Brief", icon: "🗓️", desc: "Agenda, discussion points, critical questions" },
  { id: "kickoff", label: "Project Kickoff", icon: "🚀", desc: "Goals, scope, roles, milestones" },
  { id: "proposal", label: "Client Proposal", icon: "💼", desc: "Executive summary, pricing overview" },
  { id: "interview", label: "Interview Prep", icon: "🎯", desc: "Questions, scorecard, red flags" },
  { id: "sop", label: "SOP Generator", icon: "📋", desc: "Step-by-step procedures and checkpoints" },
];

type Result = {
  briefType: string;
  title: string;
  sections: { heading: string; content: string }[];
  thinking?: string;
};

export default function DocumentPage() {
  const [file, setFile] = useState<File | null>(null);
  const [briefType, setBriefType] = useState<string>("meeting");
  const [useThinking, setUseThinking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showThinking, setShowThinking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    if (f.type !== "application/pdf" && !f.name.endsWith(".pdf")) {
      setError("Format tidak didukung. Gunakan PDF.");
      return;
    }
    if (f.size > 20 * 1024 * 1024) {
      setError("Ukuran file maksimal 20MB.");
      return;
    }
    setError(null);
    setResult(null);
    setFile(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  };

  const handleSubmit = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("briefType", briefType);
      form.append("thinking", String(useThinking));
      const res = await fetch("/api/document", { method: "POST", body: form });
      if (!res.ok) throw new Error((await res.json()).error || "Gagal memproses dokumen.");
      const data = await res.json();
      setResult(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan.");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => { setFile(null); setResult(null); setError(null); setShowThinking(false); };

  const selectedBrief = BRIEF_TYPES.find((b) => b.id === briefType);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,300&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #07080A; color: #E8EAF0; font-family: 'DM Sans', sans-serif; min-height: 100vh; }

        .noise { position: fixed; inset: 0; z-index: 0; pointer-events: none;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E");
          opacity: 0.5; }
        .orb { position: fixed; border-radius: 50%; filter: blur(130px); pointer-events: none; z-index: 0;
          width: 460px; height: 460px; background: #F7A84F1A; bottom: -100px; right: -80px; }

        .wrapper { position: relative; z-index: 1; max-width: 760px; margin: 0 auto; padding: 52px 24px 80px; }

        .back { display: inline-flex; align-items: center; gap: 8px; color: #4B5470;
          font-size: 13px; font-weight: 500; text-decoration: none; margin-bottom: 36px;
          transition: color 0.2s; letter-spacing: 0.02em; }
        .back:hover { color: #F7A84F; }

        .header { margin-bottom: 40px; }
        .tag { display: inline-flex; align-items: center; gap: 6px; font-size: 11px;
          font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase;
          color: #F7A84F; margin-bottom: 14px; }
        .tag-dot { width: 6px; height: 6px; border-radius: 50%; background: #F7A84F;
          box-shadow: 0 0 8px #F7A84F; animation: pulse 2s ease-in-out infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }

        h1 { font-family: 'Syne', sans-serif; font-size: clamp(28px, 5vw, 42px);
          font-weight: 800; letter-spacing: -0.03em; color: #F0F2F8; line-height: 1.1; }
        .subtitle { margin-top: 10px; font-size: 15px; font-weight: 300; color: #6B7285; line-height: 1.65; }

        /* Step labels */
        .step-label { font-family: 'Syne', sans-serif; font-size: 11px; font-weight: 700;
          letter-spacing: 0.1em; text-transform: uppercase; color: #3B4155;
          margin-bottom: 12px; margin-top: 32px; }

        /* Brief type selector */
        .brief-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
        .brief-card { background: #0D0F14; border: 1px solid #1E2230; border-radius: 12px;
          padding: 14px; cursor: pointer; transition: border-color 0.2s, background 0.2s; text-align: left; }
        .brief-card.active { border-color: #F7A84F; background: #F7A84F08; }
        .brief-card:hover:not(.active) { border-color: #2E3245; }
        .brief-card-icon { font-size: 22px; margin-bottom: 8px; display: block; }
        .brief-card-label { font-family: 'Syne', sans-serif; font-size: 13px; font-weight: 700;
          color: #C8CCE0; margin-bottom: 4px; }
        .brief-card-desc { font-size: 11px; color: #4B5470; line-height: 1.5; }
        .brief-card.active .brief-card-label { color: #F7A84F; }

        /* Dropzone */
        .dropzone { border: 1.5px dashed #1E2230; border-radius: 18px; padding: 40px 32px;
          text-align: center; cursor: pointer; transition: border-color 0.2s, background 0.2s;
          background: #0D0F14; }
        .dropzone.drag { border-color: #F7A84F; background: #F7A84F08; }
        .dropzone.has-file { border-style: solid; border-color: #F7A84F55; }
        .dz-icon { font-size: 36px; margin-bottom: 14px; display: block;
          filter: drop-shadow(0 0 14px #F7A84F66); }
        .dz-label { font-family: 'Syne', sans-serif; font-size: 16px; font-weight: 600;
          color: #C8CCE0; margin-bottom: 6px; }
        .dz-sub { font-size: 13px; color: #4B5470; }
        .dz-sub span { color: #F7A84F; font-weight: 500; }

        .file-chip { display: inline-flex; align-items: center; gap: 10px;
          background: #111420; border: 1px solid #F7A84F33; border-radius: 100px;
          padding: 8px 16px; font-size: 13px; color: #A8B0CC; margin-top: 16px; }
        .file-chip button { background: none; border: none; cursor: pointer;
          color: #4B5470; font-size: 16px; line-height: 1; padding: 0; transition: color 0.2s; }
        .file-chip button:hover { color: #FF6B6B; }

        /* Thinking toggle */
        .thinking-row { display: flex; align-items: center; gap: 14px;
          background: #0D0F14; border: 1px solid #1E2230; border-radius: 12px;
          padding: 14px 18px; cursor: pointer; transition: border-color 0.2s; }
        .thinking-row.on { border-color: #F7A84F55; }
        .thinking-row:hover { border-color: #2E3245; }
        .thinking-row.on:hover { border-color: #F7A84F88; }
        .toggle { width: 38px; height: 22px; border-radius: 100px; background: #1A1D28;
          position: relative; transition: background 0.2s; flex-shrink: 0; }
        .toggle.on { background: #F7A84F; }
        .toggle-knob { width: 16px; height: 16px; border-radius: 50%; background: #fff;
          position: absolute; top: 3px; left: 3px; transition: left 0.2s; }
        .toggle.on .toggle-knob { left: 19px; }
        .thinking-info { flex: 1; }
        .thinking-title { font-family: 'Syne', sans-serif; font-size: 13px; font-weight: 700;
          color: #C8CCE0; margin-bottom: 2px; }
        .thinking-desc { font-size: 12px; color: #4B5470; line-height: 1.5; }

        .btn-primary { width: 100%; margin-top: 20px; padding: 16px;
          background: #F7A84F; color: #07080A; border: none; border-radius: 12px;
          font-family: 'Syne', sans-serif; font-size: 15px; font-weight: 700;
          letter-spacing: 0.02em; cursor: pointer; transition: opacity 0.2s, transform 0.2s; }
        .btn-primary:hover:not(:disabled) { opacity: 0.88; transform: translateY(-1px); }
        .btn-primary:disabled { opacity: 0.35; cursor: not-allowed; }

        /* Loading */
        .loading { text-align: center; padding: 48px 0; }
        .thinking-anim { display: flex; gap: 4px; justify-content: center; margin-bottom: 20px; }
        .thinking-anim span { width: 8px; height: 8px; border-radius: 50%; background: #F7A84F;
          animation: bounce 1.2s ease-in-out infinite; }
        .thinking-anim span:nth-child(1){animation-delay:0s}
        .thinking-anim span:nth-child(2){animation-delay:0.15s}
        .thinking-anim span:nth-child(3){animation-delay:0.3s}
        @keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-12px)} }
        .loading-label { font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 700;
          color: #F7A84F; margin-bottom: 6px; }
        .loading-text { font-size: 13px; color: #4B5470; }

        .error { background: #1A0E0E; border: 1px solid #FF6B6B33; border-radius: 12px;
          padding: 14px 18px; font-size: 13px; color: #FF8080; margin-top: 16px; }

        /* Results */
        .results { margin-top: 40px; }
        .result-header { margin-bottom: 24px; }
        .result-type { display: inline-flex; align-items: center; gap: 8px;
          background: #F7A84F15; border: 1px solid #F7A84F33; border-radius: 100px;
          padding: 6px 14px; font-size: 12px; font-weight: 600;
          color: #F7A84F; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 10px; }
        .result-title { font-family: 'Syne', sans-serif; font-size: 22px; font-weight: 800;
          color: #F0F2F8; letter-spacing: -0.02em; }

        .sections { display: flex; flex-direction: column; gap: 16px; }
        .section { background: #0D0F14; border: 1px solid #1E2230; border-radius: 16px; overflow: hidden; }
        .section-header { padding: 14px 22px; border-bottom: 1px solid #1A1D28; }
        .section-title { font-family: 'Syne', sans-serif; font-size: 13px; font-weight: 700;
          letter-spacing: 0.05em; text-transform: uppercase; color: #F7A84F; }
        .section-body { padding: 18px 22px; font-size: 14px; line-height: 1.8;
          color: #A8B0CC; font-weight: 300; white-space: pre-wrap; }

        /* Thinking reveal */
        .thinking-block { background: #0D0F14; border: 1px solid #F7A84F22;
          border-radius: 16px; overflow: hidden; margin-top: 16px; }
        .thinking-toggle { width: 100%; padding: 14px 22px; background: none; border: none;
          cursor: pointer; display: flex; align-items: center; justify-content: space-between;
          font-family: 'Syne', sans-serif; font-size: 13px; font-weight: 700;
          color: #F7A84F88; letter-spacing: 0.05em; text-transform: uppercase;
          transition: color 0.2s; }
        .thinking-toggle:hover { color: #F7A84F; }
        .thinking-content { padding: 0 22px 18px; font-size: 13px; line-height: 1.8;
          color: #4B5470; font-style: italic; white-space: pre-wrap; }

        .btn-reset { margin-top: 28px; width: 100%; padding: 13px;
          background: transparent; border: 1px solid #1E2230; border-radius: 12px;
          font-family: 'DM Sans', sans-serif; font-size: 14px; color: #4B5470;
          cursor: pointer; transition: border-color 0.2s, color 0.2s; }
        .btn-reset:hover { border-color: #F7A84F; color: #F7A84F; }

        @media (max-width: 600px) {
          .wrapper { padding: 32px 16px 60px; }
          .brief-grid { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>

      <div className="noise" />
      <div className="orb" />

      <div className="wrapper">
        <a href="/" className="back">← Back to Agents</a>

        <div className="header">
          <div className="tag"><span className="tag-dot" />Document Intelligence</div>
          <h1>Brief Generator</h1>
          <p className="subtitle">
            Upload a PDF and choose your output type. Gemma 4 processes the full document using its 256K context window — no chunking, no loss.
          </p>
        </div>

        {!result && (
          <>
            <div className="step-label">01 — Choose brief type</div>
            <div className="brief-grid">
              {BRIEF_TYPES.map((b) => (
                <button
                  key={b.id}
                  className={`brief-card${briefType === b.id ? " active" : ""}`}
                  onClick={() => setBriefType(b.id)}
                >
                  <span className="brief-card-icon">{b.icon}</span>
                  <div className="brief-card-label">{b.label}</div>
                  <div className="brief-card-desc">{b.desc}</div>
                </button>
              ))}
            </div>

            <div className="step-label">02 — Upload PDF</div>
            <div
              className={`dropzone${dragging ? " drag" : ""}${file ? " has-file" : ""}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              <span className="dz-icon">📄</span>
              <div className="dz-label">{file ? "File selected" : "Drop your PDF here"}</div>
              <div className="dz-sub">or <span>browse</span> · PDF only · max 20MB</div>
              {file && (
                <div className="file-chip" onClick={(e) => e.stopPropagation()}>
                  📄 {file.name}
                  <button onClick={(e) => { e.stopPropagation(); reset(); }}>×</button>
                </div>
              )}
              <input ref={inputRef} type="file" accept=".pdf,application/pdf"
                style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
            </div>

            <div className="step-label">03 — Options</div>
            <div
              className={`thinking-row${useThinking ? " on" : ""}`}
              onClick={() => setUseThinking(!useThinking)}
            >
              <div className={`toggle${useThinking ? " on" : ""}`}>
                <div className="toggle-knob" />
              </div>
              <div className="thinking-info">
                <div className="thinking-title">🤔 Thinking Mode</div>
                <div className="thinking-desc">
                  Activates Gemma 4 deep reasoning (thinkingLevel: HIGH) for complex or ambiguous documents.
                </div>
              </div>
            </div>

            {error && <div className="error">⚠️ {error}</div>}

            <button className="btn-primary" disabled={!file || loading} onClick={handleSubmit}>
              {loading ? "Processing…" : `Generate ${selectedBrief?.label} →`}
            </button>
          </>
        )}

        {loading && (
          <div className="loading">
            <div className="thinking-anim">
              <span /><span /><span />
            </div>
            <div className="loading-label">
              {useThinking ? "Thinking Mode active…" : "Generating brief…"}
            </div>
            <div className="loading-text">
              {useThinking
                ? "Gemma 4 is reasoning through your document deeply."
                : "Gemma 4 is processing your document with 256K context."}
            </div>
          </div>
        )}

        {result && (
          <div className="results">
            <div className="result-header">
              <div className="result-type">
                {selectedBrief?.icon} {result.briefType}
              </div>
              <div className="result-title">{result.title}</div>
            </div>

            <div className="sections">
              {result.sections.map((s, i) => (
                <div className="section" key={i}>
                  <div className="section-header">
                    <div className="section-title">{s.heading}</div>
                  </div>
                  <div className="section-body">{s.content}</div>
                </div>
              ))}
            </div>

            {result.thinking && (
              <div className="thinking-block">
                <button className="thinking-toggle" onClick={() => setShowThinking(!showThinking)}>
                  🤔 Thinking trace {showThinking ? "▲" : "▼"}
                </button>
                {showThinking && (
                  <div className="thinking-content">{result.thinking}</div>
                )}
              </div>
            )}

            <button className="btn-reset" onClick={reset}>← Generate another brief</button>
          </div>
        )}
      </div>
    </>
  );
}
