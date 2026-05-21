"use client";

import { useState, useRef } from "react";

type Result = {
  transcript: string;
  keyPoints: string[];
  actionItems: string[];
  followUpQuestions: string[];
};

export default function AudioPage() {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    const allowed = ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/m4a", "audio/x-m4a"];
    if (!allowed.includes(f.type) && !f.name.match(/\.(mp3|wav|m4a)$/i)) {
      setError("Format tidak didukung. Gunakan MP3, WAV, atau M4A.");
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
      const res = await fetch("/api/audio", { method: "POST", body: form });
      if (!res.ok) throw new Error((await res.json()).error || "Gagal memproses audio.");
      const data = await res.json();
      setResult(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan.");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => { setFile(null); setResult(null); setError(null); };

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
          width: 460px; height: 460px; background: #00C9A722; top: -120px; right: -80px; }

        .wrapper { position: relative; z-index: 1; max-width: 760px; margin: 0 auto; padding: 52px 24px 80px; }

        .back { display: inline-flex; align-items: center; gap: 8px; color: #4B5470;
          font-size: 13px; font-weight: 500; text-decoration: none; margin-bottom: 36px;
          transition: color 0.2s; letter-spacing: 0.02em; }
        .back:hover { color: #00C9A7; }

        .header { margin-bottom: 40px; }
        .tag { display: inline-flex; align-items: center; gap: 6px; font-size: 11px;
          font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase;
          color: #00C9A7; margin-bottom: 14px; }
        .tag-dot { width: 6px; height: 6px; border-radius: 50%; background: #00C9A7;
          box-shadow: 0 0 8px #00C9A7; animation: pulse 2s ease-in-out infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }

        h1 { font-family: 'Syne', sans-serif; font-size: clamp(28px, 5vw, 42px);
          font-weight: 800; letter-spacing: -0.03em; color: #F0F2F8; line-height: 1.1; }

        .subtitle { margin-top: 10px; font-size: 15px; font-weight: 300; color: #6B7285; line-height: 1.65; }

        /* Dropzone */
        .dropzone { border: 1.5px dashed #1E2230; border-radius: 18px; padding: 48px 32px;
          text-align: center; cursor: pointer; transition: border-color 0.2s, background 0.2s;
          background: #0D0F14; position: relative; }
        .dropzone.drag { border-color: #00C9A7; background: #00C9A708; }
        .dropzone.has-file { border-style: solid; border-color: #00C9A755; }

        .dz-icon { font-size: 40px; margin-bottom: 14px; display: block;
          filter: drop-shadow(0 0 14px #00C9A766); }
        .dz-label { font-family: 'Syne', sans-serif; font-size: 16px; font-weight: 600;
          color: #C8CCE0; margin-bottom: 6px; }
        .dz-sub { font-size: 13px; color: #4B5470; }
        .dz-sub span { color: #00C9A7; font-weight: 500; }

        .file-chip { display: inline-flex; align-items: center; gap: 10px;
          background: #111420; border: 1px solid #00C9A733; border-radius: 100px;
          padding: 8px 16px; font-size: 13px; color: #A8B0CC; margin-top: 16px; }
        .file-chip button { background: none; border: none; cursor: pointer;
          color: #4B5470; font-size: 16px; line-height: 1; padding: 0;
          transition: color 0.2s; }
        .file-chip button:hover { color: #FF6B6B; }

        .btn-primary { width: 100%; margin-top: 20px; padding: 16px;
          background: #00C9A7; color: #07080A; border: none; border-radius: 12px;
          font-family: 'Syne', sans-serif; font-size: 15px; font-weight: 700;
          letter-spacing: 0.02em; cursor: pointer; transition: opacity 0.2s, transform 0.2s; }
        .btn-primary:hover:not(:disabled) { opacity: 0.88; transform: translateY(-1px); }
        .btn-primary:disabled { opacity: 0.35; cursor: not-allowed; }

        /* Loading */
        .loading { text-align: center; padding: 48px 0; }
        .wave { display: flex; gap: 6px; justify-content: center; margin-bottom: 20px; }
        .wave span { width: 4px; border-radius: 4px; background: #00C9A7;
          animation: wave 1.2s ease-in-out infinite; }
        .wave span:nth-child(1){height:24px;animation-delay:0s}
        .wave span:nth-child(2){height:36px;animation-delay:0.1s}
        .wave span:nth-child(3){height:28px;animation-delay:0.2s}
        .wave span:nth-child(4){height:40px;animation-delay:0.3s}
        .wave span:nth-child(5){height:24px;animation-delay:0.4s}
        @keyframes wave { 0%,100%{transform:scaleY(0.4)} 50%{transform:scaleY(1)} }
        .loading-text { font-size: 14px; color: #4B5470; }

        /* Error */
        .error { background: #1A0E0E; border: 1px solid #FF6B6B33; border-radius: 12px;
          padding: 14px 18px; font-size: 13px; color: #FF8080; margin-top: 16px; }

        /* Results */
        .results { margin-top: 40px; display: flex; flex-direction: column; gap: 20px; }

        .section { background: #0D0F14; border: 1px solid #1E2230; border-radius: 16px; overflow: hidden; }
        .section-header { padding: 16px 24px; border-bottom: 1px solid #1A1D28;
          display: flex; align-items: center; gap: 10px; }
        .section-icon { font-size: 18px; }
        .section-title { font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 700;
          letter-spacing: 0.04em; text-transform: uppercase; color: #8891A8; }
        .section-body { padding: 20px 24px; }

        .transcript { font-size: 14px; line-height: 1.8; color: #8891A8;
          font-weight: 300; font-style: italic; white-space: pre-wrap; }

        .list { list-style: none; display: flex; flex-direction: column; gap: 10px; }
        .list li { display: flex; gap: 12px; font-size: 14px; line-height: 1.6; color: #A8B0CC; }
        .list li::before { content: ''; width: 6px; height: 6px; border-radius: 50%;
          background: #00C9A7; flex-shrink: 0; margin-top: 7px; }

        .btn-reset { margin-top: 28px; width: 100%; padding: 13px;
          background: transparent; border: 1px solid #1E2230; border-radius: 12px;
          font-family: 'DM Sans', sans-serif; font-size: 14px; color: #4B5470;
          cursor: pointer; transition: border-color 0.2s, color 0.2s; }
        .btn-reset:hover { border-color: #00C9A7; color: #00C9A7; }

        @media (max-width: 600px) { .wrapper { padding: 32px 16px 60px; } }
      `}</style>

      <div className="noise" />
      <div className="orb" />

      <div className="wrapper">
        <a href="/" className="back">← Back to Agents</a>

        <div className="header">
          <div className="tag"><span className="tag-dot" />Audio Analyzer</div>
          <h1>Meeting Analyzer</h1>
          <p className="subtitle">
            Upload a voice recording and get a full transcript, key points, action items, and follow-up questions — powered by Gemma 4.
          </p>
        </div>

        {!result && (
          <>
            <div
              className={`dropzone${dragging ? " drag" : ""}${file ? " has-file" : ""}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              <span className="dz-icon">🎙️</span>
              <div className="dz-label">{file ? "File selected" : "Drop your recording here"}</div>
              <div className="dz-sub">or <span>browse</span> · MP3, WAV, M4A</div>
              {file && (
                <div className="file-chip" onClick={(e) => e.stopPropagation()}>
                  🎵 {file.name}
                  <button onClick={reset}>×</button>
                </div>
              )}
              <input ref={inputRef} type="file" accept=".mp3,.wav,.m4a,audio/*"
                style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
            </div>

            {error && <div className="error">⚠️ {error}</div>}

            <button className="btn-primary" disabled={!file || loading} onClick={handleSubmit}>
              {loading ? "Processing…" : "Analyze Recording →"}
            </button>
          </>
        )}

        {loading && (
          <div className="loading">
            <div className="wave">
              {[...Array(5)].map((_, i) => <span key={i} />)}
            </div>
            <div className="loading-text">Gemma 4 is transcribing your audio…</div>
          </div>
        )}

        {result && (
          <div className="results">
            <div className="section">
              <div className="section-header">
                <span className="section-icon">📝</span>
                <span className="section-title">Transcript</span>
              </div>
              <div className="section-body">
                <p className="transcript">{result.transcript}</p>
              </div>
            </div>

            <div className="section">
              <div className="section-header">
                <span className="section-icon">💡</span>
                <span className="section-title">Key Discussion Points</span>
              </div>
              <div className="section-body">
                <ul className="list">
                  {result.keyPoints.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </div>
            </div>

            <div className="section">
              <div className="section-header">
                <span className="section-icon">✅</span>
                <span className="section-title">Action Items</span>
              </div>
              <div className="section-body">
                <ul className="list">
                  {result.actionItems.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              </div>
            </div>

            <div className="section">
              <div className="section-header">
                <span className="section-icon">❓</span>
                <span className="section-title">Follow-up Questions</span>
              </div>
              <div className="section-body">
                <ul className="list">
                  {result.followUpQuestions.map((q, i) => <li key={i}>{q}</li>)}
                </ul>
              </div>
            </div>

            <button className="btn-reset" onClick={reset}>← Analyze another recording</button>
          </div>
        )}
      </div>
    </>
  );
}
