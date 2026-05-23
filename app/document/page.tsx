"use client";

import { useState, useRef } from "react";

const BRIEF_TYPES = [
  { id: "meeting", label: "Meeting Brief", icon: "🗓️", desc: "Agenda, discussion points, critical questions" },
  { id: "kickoff", label: "Project Kickoff", icon: "🚀", desc: "Goals, scope, roles, milestones" },
  { id: "proposal", label: "Client Proposal", icon: "💼", desc: "Executive summary, pricing overview" },
  { id: "interview", label: "Interview Prep", icon: "🎯", desc: "Questions, scorecard, red flags" },
  { id: "sop", label: "SOP Generator", icon: "📋", desc: "Step-by-step procedures and checkpoints" },
];

type Section = { heading: string; content: string };

type StreamStep = "idle" | "reading" | "analyzing" | "parsing" | "done";

export default function DocumentPage() {
  const [file, setFile] = useState<File | null>(null);
  const [briefType, setBriefType] = useState<string>("meeting");
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<StreamStep>("idle");

  // Result state — diisi bertahap saat stream masuk
  const [meta, setMeta] = useState<{ briefType: string; title: string } | null>(null);
  const [sections, setSections] = useState<Section[]>([]);

  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasAnyResult = meta !== null || sections.length > 0;

  const handleFile = (f: File) => {
    if (f.type !== "application/pdf" && !f.name.endsWith(".pdf")) {
      setError("Format not supported. Use PDF.");
      return;
    }
    if (f.size > 20 * 1024 * 1024) {
      setError("Maximum file size is 20MB.");
      return;
    }
    setError(null);
    setMeta(null);
    setSections([]);
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
    setStep("idle");
    setError(null);
    setMeta(null);
    setSections([]);

    try {
      const form = new FormData();
      form.append("file", file);
      form.append("briefType", briefType);

      const res = await fetch("/api/document", { method: "POST", body: form });

      if (!res.ok || !res.body) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error || "Failed to process document.");
      }

      // Baca SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const raw of events) {
          if (!raw.trim()) continue;

          const eventMatch = raw.match(/^event: (\w+)/m);
          const dataMatch = raw.match(/^data: (.+)/m);
          if (!eventMatch || !dataMatch) continue;

          const eventName = eventMatch[1];
          let payload: Record<string, unknown>;
          try {
            payload = JSON.parse(dataMatch[1]);
          } catch {
            continue;
          }

          switch (eventName) {
            case "status":
              setStep(payload.step as StreamStep);
              break;

            case "meta":
              setMeta({
                briefType: payload.briefType as string,
                title: payload.title as string,
              });
              break;

            case "section":
              setSections((prev) => [
                ...prev,
                { heading: payload.heading as string, content: payload.content as string },
              ]);
              break;

            case "done":
              setStep("done");
              break;

            case "error":
              throw new Error(payload.message as string);
          }
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "There is an error.");
    } finally {
      setLoading(false);
      setStep("done");
    }
  };

  const reset = () => {
    setFile(null);
    setMeta(null);
    setSections([]);
    setError(null);
    setStep("idle");
  };

  const stepLabel: Record<string, string> = {
    reading: "Read and convert PDF…",
    analyzing: "Gemma 4 analyzes documents with 256K context…",
    parsing: "Processing analysis results…",
    done: "Finished.",
  };

  const selectedBrief = BRIEF_TYPES.find((b) => b.id === briefType);

  // Jumlah total section yang diharapkan per brief type
  const EXPECTED_SECTIONS = 5;
  const pendingSections = loading && meta
    ? Math.max(0, EXPECTED_SECTIONS - sections.length)
    : 0;

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

        .step-label { font-family: 'Syne', sans-serif; font-size: 11px; font-weight: 700;
          letter-spacing: 0.1em; text-transform: uppercase; color: #3B4155;
          margin-bottom: 12px; margin-top: 32px; }

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

        .btn-primary { width: 100%; margin-top: 20px; padding: 16px;
          background: #F7A84F; color: #07080A; border: none; border-radius: 12px;
          font-family: 'Syne', sans-serif; font-size: 15px; font-weight: 700;
          letter-spacing: 0.02em; cursor: pointer; transition: opacity 0.2s, transform 0.2s; }
        .btn-primary:hover:not(:disabled) { opacity: 0.88; transform: translateY(-1px); }
        .btn-primary:disabled { opacity: 0.35; cursor: not-allowed; }

        /* Status bar */
        .status-bar { display: flex; align-items: center; gap: 10px;
          padding: 12px 16px; background: #0D0F14; border: 1px solid #1E2230;
          border-radius: 10px; margin-top: 20px; font-size: 13px; color: #6B7285; }
        .status-spinner { width: 14px; height: 14px; border-radius: 50%;
          border: 2px solid #1E2230; border-top-color: #F7A84F;
          animation: spin 0.8s linear infinite; flex-shrink: 0; }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* Loading anim (sebelum result pertama) */
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
        .result-header { margin-bottom: 24px; animation: fadeSlideIn 0.4s ease both; }
        .result-type { display: inline-flex; align-items: center; gap: 8px;
          background: #F7A84F15; border: 1px solid #F7A84F33; border-radius: 100px;
          padding: 6px 14px; font-size: 12px; font-weight: 600;
          color: #F7A84F; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 10px; }
        .result-title { font-family: 'Syne', sans-serif; font-size: 22px; font-weight: 800;
          color: #F0F2F8; letter-spacing: -0.02em; }

        /* Skeleton title saat meta belum datang */
        .skeleton { background: linear-gradient(90deg, #1E2230 25%, #262B3D 50%, #1E2230 75%);
          background-size: 200% 100%; animation: shimmer 1.4s ease-in-out infinite; border-radius: 6px; }
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        .skeleton-title { height: 28px; width: 60%; margin-bottom: 8px; }
        .skeleton-badge { height: 20px; width: 120px; border-radius: 100px; margin-bottom: 12px; }
        .skeleton-line { height: 14px; margin-bottom: 10px; }
        .skeleton-line:last-child { width: 55%; margin-bottom: 0; }

        .sections { display: flex; flex-direction: column; gap: 16px; }

        .section { background: #0D0F14; border: 1px solid #1E2230; border-radius: 16px;
          overflow: hidden; animation: fadeSlideIn 0.4s ease both; }
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .section-skeleton { background: #0D0F14; border: 1px solid #1E2230;
          border-radius: 16px; overflow: hidden; padding: 14px 22px 18px; }

        .section-header { padding: 14px 22px; border-bottom: 1px solid #1A1D28; }
        .section-title { font-family: 'Syne', sans-serif; font-size: 13px; font-weight: 700;
          letter-spacing: 0.05em; text-transform: uppercase; color: #F7A84F; }
        .section-body { padding: 18px 22px; font-size: 14px; line-height: 1.8;
          color: #A8B0CC; font-weight: 300; white-space: pre-wrap; }

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

        {/* Upload form — sembunyikan begitu result mulai masuk */}
        {!hasAnyResult && (
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

            {error && <div className="error">⚠️ {error}</div>}

            <button className="btn-primary" disabled={!file || loading} onClick={handleSubmit}>
              {loading ? "Processing…" : `Generate ${selectedBrief?.label} →`}
            </button>
          </>
        )}

        {/* Status bar */}
        {loading && step !== "idle" && (
          <div className="status-bar">
            <div className="status-spinner" />
            {stepLabel[step] ?? "Processing…"}
          </div>
        )}

        {/* Wave — hanya saat belum ada result sama sekali */}
        {loading && !hasAnyResult && (
          <div className="loading">
            <div className="thinking-anim">
              <span /><span /><span />
            </div>
            <div className="loading-label">Generating brief…</div>
            <div className="loading-text">Gemma 4 is processing a document with 256K contexts.</div>
          </div>
        )}

        {/* Results — muncul bertahap */}
        {hasAnyResult && (
          <div className="results">

            {/* Header meta */}
            {meta ? (
              <div className="result-header">
                <div className="result-type">
                  {selectedBrief?.icon} {meta.briefType}
                </div>
                <div className="result-title">{meta.title}</div>
              </div>
            ) : loading ? (
              <div className="result-header">
                <div className="skeleton skeleton-badge" />
                <div className="skeleton skeleton-title" />
              </div>
            ) : null}

            <div className="sections">
              {/* Section yang sudah datang */}
              {sections.map((s, i) => (
                <div className="section" key={i} style={{ animationDelay: `${i * 40}ms` }}>
                  <div className="section-header">
                    <div className="section-title">{s.heading}</div>
                  </div>
                  <div className="section-body">{s.content}</div>
                </div>
              ))}

              {/* Skeleton untuk section yang masih loading */}
              {Array.from({ length: pendingSections }).map((_, i) => (
                <div className="section-skeleton" key={`sk-${i}`}>
                  <div className="skeleton skeleton-line" style={{ width: "40%", marginBottom: "14px" }} />
                  <div className="skeleton skeleton-line" style={{ width: "95%" }} />
                  <div className="skeleton skeleton-line" style={{ width: "85%" }} />
                  <div className="skeleton skeleton-line" />
                </div>
              ))}
            </div>

            {step === "done" && !loading && (
              <button className="btn-reset" onClick={reset}>← Generate another brief</button>
            )}
          </div>
        )}

        {/* Error di luar form juga (misal error di tengah stream) */}
        {error && hasAnyResult && (
          <div className="error" style={{ marginTop: 16 }}>⚠️ {error}</div>
        )}
      </div>
    </>
  );
}
