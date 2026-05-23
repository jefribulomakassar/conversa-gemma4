"use client";

import { useState, useRef } from "react";

type Result = {
  transcript: string;
  keyPoints: string[];
  actionItems: string[];
  followUpQuestions: string[];
};

type StreamStep = "idle" | "transcribing" | "analyzing" | "done";

export default function AudioPage() {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<StreamStep>("idle");
  const [result, setResult] = useState<Partial<Result> | null>(null);
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
    setStep("idle");
    setError(null);
    setResult(null);

    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch("/api/audio", { method: "POST", body: form });

      if (!res.ok || !res.body) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error || "Gagal memproses audio.");
      }

      // Baca stream SSE
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Proses semua event yang sudah lengkap di buffer
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? ""; // Sisakan event yang belum lengkap

        for (const raw of events) {
          if (!raw.trim()) continue;

          // Parse event name dan data
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

          // Dispatch tiap event ke state
          switch (eventName) {
            case "status":
              setStep(payload.step as StreamStep);
              break;

            case "transcript":
              setResult((prev) => ({ ...prev, transcript: payload.text as string }));
              break;

            case "keyPoints":
              setResult((prev) => ({ ...prev, keyPoints: payload.items as string[] }));
              break;

            case "actionItems":
              setResult((prev) => ({ ...prev, actionItems: payload.items as string[] }));
              break;

            case "followUpQuestions":
              setResult((prev) => ({ ...prev, followUpQuestions: payload.items as string[] }));
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
      setError(err instanceof Error ? err.message : "Terjadi kesalahan.");
    } finally {
      setLoading(false);
      setStep("done");
    }
  };

  const reset = () => {
    setFile(null);
    setResult(null);
    setError(null);
    setStep("idle");
  };

  const stepLabel: Record<string, string> = {
    transcribing: "Mentranskripsi audio via Groq Whisper…",
    analyzing: "Gemma 4 sedang menganalisis transkrip…",
    done: "Selesai.",
  };

  const hasAnyResult = result && (
    result.transcript ||
    result.keyPoints?.length ||
    result.actionItems?.length ||
    result.followUpQuestions?.length
  );

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

        /* Status bar */
        .status-bar { display: flex; align-items: center; gap: 10px;
          padding: 12px 16px; background: #0D0F14; border: 1px solid #1E2230;
          border-radius: 10px; margin-top: 20px; font-size: 13px; color: #6B7285; }
        .status-spinner { width: 14px; height: 14px; border-radius: 50%;
          border: 2px solid #1E2230; border-top-color: #00C9A7;
          animation: spin 0.8s linear infinite; flex-shrink: 0; }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* Wave (saat transcribing, sebelum result ada) */
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

        .section { background: #0D0F14; border: 1px solid #1E2230; border-radius: 16px; overflow: hidden;
          animation: fadeSlideIn 0.4s ease both; }
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .section-header { padding: 16px 24px; border-bottom: 1px solid #1A1D28;
          display: flex; align-items: center; gap: 10px; }
        .section-icon { font-size: 18px; }
        .section-title { font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 700;
          letter-spacing: 0.04em; text-transform: uppercase; color: #8891A8; }

        /* Skeleton shimmer saat section masih loading */
        .skeleton { border-radius: 6px; background: linear-gradient(90deg, #1E2230 25%, #262B3D 50%, #1E2230 75%);
          background-size: 200% 100%; animation: shimmer 1.4s ease-in-out infinite; }
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        .skeleton-line { height: 14px; margin-bottom: 10px; border-radius: 4px; }
        .skeleton-line:last-child { width: 60%; margin-bottom: 0; }

        .section-body { padding: 20px 24px; }

        .transcript { font-size: 14px; line-height: 1.8; color: #8891A8;
          font-weight: 300; font-style: italic; white-space: pre-wrap; }

        .list { list-style: none; display: flex; flex-direction: column; gap: 10px; }
        .list li { display: flex; gap: 12px; font-size: 14px; line-height: 1.6; color: #A8B0CC;
          animation: fadeIn 0.3s ease both; }
        @keyframes fadeIn { from{opacity:0;transform:translateX(-4px)} to{opacity:1;transform:none} }
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

        {/* Upload form — sembunyikan saat ada result */}
        {!hasAnyResult && (
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

        {/* Status bar — tampil saat loading */}
        {loading && step !== "idle" && (
          <div className="status-bar">
            <div className="status-spinner" />
            {stepLabel[step] ?? "Memproses…"}
          </div>
        )}

        {/* Wave — hanya saat belum ada result sama sekali */}
        {loading && !hasAnyResult && (
          <div className="loading">
            <div className="wave">
              {[...Array(5)].map((_, i) => <span key={i} />)}
            </div>
            <div className="loading-text">Menunggu transkripsi…</div>
          </div>
        )}

        {/* Results — muncul bertahap seiring stream */}
        {hasAnyResult && (
          <div className="results">

            {/* Transcript */}
            {result?.transcript ? (
              <div className="section">
                <div className="section-header">
                  <span className="section-icon">📝</span>
                  <span className="section-title">Transcript</span>
                </div>
                <div className="section-body">
                  <p className="transcript">{result.transcript}</p>
                </div>
              </div>
            ) : loading ? (
              <div className="section">
                <div className="section-header">
                  <span className="section-icon">📝</span>
                  <span className="section-title">Transcript</span>
                </div>
                <div className="section-body">
                  <div className="skeleton skeleton-line" style={{ width: "90%" }} />
                  <div className="skeleton skeleton-line" style={{ width: "75%" }} />
                  <div className="skeleton skeleton-line" />
                </div>
              </div>
            ) : null}

            {/* Key Points */}
            {result?.keyPoints?.length ? (
              <div className="section">
                <div className="section-header">
                  <span className="section-icon">💡</span>
                  <span className="section-title">Key Discussion Points</span>
                </div>
                <div className="section-body">
                  <ul className="list">
                    {result.keyPoints.map((p, i) => (
                      <li key={i} style={{ animationDelay: `${i * 60}ms` }}>{p}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : loading ? (
              <div className="section">
                <div className="section-header">
                  <span className="section-icon">💡</span>
                  <span className="section-title">Key Discussion Points</span>
                </div>
                <div className="section-body">
                  <div className="skeleton skeleton-line" style={{ width: "80%" }} />
                  <div className="skeleton skeleton-line" style={{ width: "65%" }} />
                </div>
              </div>
            ) : null}

            {/* Action Items */}
            {result?.actionItems?.length ? (
              <div className="section">
                <div className="section-header">
                  <span className="section-icon">✅</span>
                  <span className="section-title">Action Items</span>
                </div>
                <div className="section-body">
                  <ul className="list">
                    {result.actionItems.map((a, i) => (
                      <li key={i} style={{ animationDelay: `${i * 60}ms` }}>{a}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : loading ? (
              <div className="section">
                <div className="section-header">
                  <span className="section-icon">✅</span>
                  <span className="section-title">Action Items</span>
                </div>
                <div className="section-body">
                  <div className="skeleton skeleton-line" style={{ width: "70%" }} />
                  <div className="skeleton skeleton-line" style={{ width: "55%" }} />
                </div>
              </div>
            ) : null}

            {/* Follow-up Questions */}
            {result?.followUpQuestions?.length ? (
              <div className="section">
                <div className="section-header">
                  <span className="section-icon">❓</span>
                  <span className="section-title">Follow-up Questions</span>
                </div>
                <div className="section-body">
                  <ul className="list">
                    {result.followUpQuestions.map((q, i) => (
                      <li key={i} style={{ animationDelay: `${i * 60}ms` }}>{q}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : loading ? (
              <div className="section">
                <div className="section-header">
                  <span className="section-icon">❓</span>
                  <span className="section-title">Follow-up Questions</span>
                </div>
                <div className="section-body">
                  <div className="skeleton skeleton-line" style={{ width: "75%" }} />
                  <div className="skeleton skeleton-line" style={{ width: "60%" }} />
                </div>
              </div>
            ) : null}

            {step === "done" && !loading && (
              <button className="btn-reset" onClick={reset}>← Analyze another recording</button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
