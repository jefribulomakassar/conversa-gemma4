"use client";

import { useState, useRef } from "react";

type StreamStep = "idle" | "reading" | "analyzing" | "parsing" | "done";

type Result = {
  extractedText?: string;
  diagramDescription?: string;
  structuredSummary?: string;
  nextSteps?: string[];
};

const MAX_IMAGE_SIZE = 4 * 1024 * 1024; // 10MB — sesuai batas route.ts
const MAX_DIMENSION = 2048; // px sisi terpanjang

// ── Kompres gambar via Canvas API (tanpa library) ────────────────────────────
async function compressImage(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = async () => {
      URL.revokeObjectURL(url);

      // Hitung dimensi baru dengan mempertahankan aspect ratio
      let { width, height } = img;
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);

      // Turunkan quality secara iteratif sampai di bawah MAX_IMAGE_SIZE
      let quality = 0.92;
      let blob: Blob | null = null;

      while (quality >= 0.5) {
        blob = await new Promise<Blob | null>((res) =>
          canvas.toBlob(res, "image/jpeg", quality)
        );
        if (!blob || blob.size <= MAX_IMAGE_SIZE) break;
        quality -= 0.1;
      }

      if (!blob) {
        reject(new Error("Failed to compress image."));
        return;
      }

      resolve(
        new File([blob], file.name.replace(/\.[^.]+$/, "_compressed.jpg"), {
          type: "image/jpeg",
        })
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image for compression."));
    };

    img.src = url;
  });
}

export default function ImagePage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<StreamStep>("idle");
  const [result, setResult] = useState<Result>({});
  const [error, setError] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasAnyResult = Object.keys(result).length > 0;

  const handleFile = (f: File) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) {
      setError("Unsupported format. Use JPG, PNG, or WEBP.");
      return;
    }
    setError(null);
    setResult({});
    setFile(f);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(f);
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
    setResult({});

    try {
      // Kompres jika > 10MB
      let uploadFile = file;
      if (file.size > MAX_IMAGE_SIZE) {
        setCompressing(true);
        try {
          uploadFile = await compressImage(file);
        } catch {
          throw new Error("Failed to compress image. Try a smaller file.");
        } finally {
          setCompressing(false);
        }

        if (uploadFile.size > MAX_IMAGE_SIZE) {
          throw new Error("Image still too large after compression. Please use a smaller image.");
        }
      }

      const form = new FormData();
      form.append("file", uploadFile);

      const res = await fetch("/api/image", { method: "POST", body: form });
      if (!res.ok || !res.body) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error || "Failed to process image.");
      }

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
          try { payload = JSON.parse(dataMatch[1]); } catch { continue; }

          switch (eventName) {
            case "status": setStep(payload.step as StreamStep); break;
            case "extractedText": setResult((p) => ({ ...p, extractedText: payload.text as string })); break;
            case "diagramDescription": setResult((p) => ({ ...p, diagramDescription: payload.text as string })); break;
            case "structuredSummary": setResult((p) => ({ ...p, structuredSummary: payload.text as string })); break;
            case "nextSteps": setResult((p) => ({ ...p, nextSteps: payload.items as string[] })); break;
            case "done": setStep("done"); break;
            case "error": throw new Error(payload.message as string);
          }
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "There is an error.");
    } finally {
      setLoading(false);
      setCompressing(false);
      setStep("done");
    }
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setResult({});
    setError(null);
    setStep("idle");
  };

  const stepLabel: Record<string, string> = {
    reading: "Reading and converting images…",
    analyzing: "Gemma 4 analyzes the image…",
    parsing: "Processing analysis results…",
  };

  const fileSizeMB = file ? (file.size / 1024 / 1024).toFixed(1) : null;
  const needsCompression = file && file.size > MAX_IMAGE_SIZE;

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
          width: 460px; height: 460px; background: #4F8EF722; top: -100px; left: -80px; }

        .wrapper { position: relative; z-index: 1; max-width: 760px; margin: 0 auto; padding: 52px 24px 80px; }

        .back { display: inline-flex; align-items: center; gap: 8px; color: #4B5470;
          font-size: 13px; font-weight: 500; text-decoration: none; margin-bottom: 36px;
          transition: color 0.2s; letter-spacing: 0.02em; }
        .back:hover { color: #4F8EF7; }

        .header { margin-bottom: 40px; }
        .tag { display: inline-flex; align-items: center; gap: 6px; font-size: 11px;
          font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase;
          color: #4F8EF7; margin-bottom: 14px; }
        .tag-dot { width: 6px; height: 6px; border-radius: 50%; background: #4F8EF7;
          box-shadow: 0 0 8px #4F8EF7; animation: pulse 2s ease-in-out infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }

        h1 { font-family: 'Syne', sans-serif; font-size: clamp(28px, 5vw, 42px);
          font-weight: 800; letter-spacing: -0.03em; color: #F0F2F8; line-height: 1.1; }
        .subtitle { margin-top: 10px; font-size: 15px; font-weight: 300; color: #6B7285; line-height: 1.65; }

        .dropzone { border: 1.5px dashed #1E2230; border-radius: 18px; padding: 48px 32px;
          text-align: center; cursor: pointer; transition: border-color 0.2s, background 0.2s;
          background: #0D0F14; position: relative; }
        .dropzone.drag { border-color: #4F8EF7; background: #4F8EF708; }
        .dropzone.has-file { border-style: solid; border-color: #4F8EF755; padding: 20px; }
        .dz-icon { font-size: 40px; margin-bottom: 14px; display: block;
          filter: drop-shadow(0 0 14px #4F8EF766); }
        .dz-label { font-family: 'Syne', sans-serif; font-size: 16px; font-weight: 600;
          color: #C8CCE0; margin-bottom: 6px; }
        .dz-sub { font-size: 13px; color: #4B5470; }
        .dz-sub span { color: #4F8EF7; font-weight: 500; }

        .preview-wrap { position: relative; }
        .preview-img { width: 100%; max-height: 320px; object-fit: contain;
          border-radius: 12px; display: block; }
        .preview-badge { position: absolute; top: 10px; right: 10px;
          background: #07080Acc; border: 1px solid #4F8EF733; border-radius: 100px;
          padding: 5px 12px; font-size: 12px; color: #4F8EF7; font-weight: 500; }
        .preview-change { margin-top: 12px; font-size: 12px; color: #4B5470; text-align: center; }
        .preview-change span { color: #4F8EF7; cursor: pointer; font-weight: 500; }
        .preview-change span:hover { text-decoration: underline; }

        .file-info { display: flex; align-items: center; justify-content: center;
          gap: 10px; margin-top: 10px; flex-wrap: wrap; }
        .size-badge { display: inline-flex; align-items: center; gap: 5px;
          background: #111420; border: 1px solid #4F8EF733; border-radius: 100px;
          padding: 4px 12px; font-size: 12px; color: #6B7285; }
        // .compress-badge { display: inline-flex; align-items: center; gap: 5px;
        //   background: #1A1400; border: 1px solid #EF9F2733; border-radius: 100px;
        //   padding: 4px 12px; font-size: 12px; color: #EF9F27; }

        .btn-primary { width: 100%; margin-top: 20px; padding: 16px;
          background: #4F8EF7; color: #07080A; border: none; border-radius: 12px;
          font-family: 'Syne', sans-serif; font-size: 15px; font-weight: 700;
          letter-spacing: 0.02em; cursor: pointer; transition: opacity 0.2s, transform 0.2s; }
        .btn-primary:hover:not(:disabled) { opacity: 0.88; transform: translateY(-1px); }
        .btn-primary:disabled { opacity: 0.35; cursor: not-allowed; }

        .status-bar { display: flex; align-items: center; gap: 10px;
          padding: 12px 16px; background: #0D0F14; border: 1px solid #1E2230;
          border-radius: 10px; margin-top: 20px; font-size: 13px; color: #6B7285; }
        .status-spinner { width: 14px; height: 14px; border-radius: 50%;
          border: 2px solid #1E2230; border-top-color: #4F8EF7;
          animation: spin 0.8s linear infinite; flex-shrink: 0; }
        @keyframes spin { to { transform: rotate(360deg); } }

        .loading { text-align: center; padding: 48px 0; }
        .scan { width: 56px; height: 56px; border-radius: 12px; background: #0D0F14;
          border: 1px solid #4F8EF733; margin: 0 auto 20px; position: relative; overflow: hidden; }
        .scan-line { position: absolute; left: 0; right: 0; height: 2px;
          background: linear-gradient(90deg, transparent, #4F8EF7, transparent);
          animation: scanMove 1.6s ease-in-out infinite; }
        @keyframes scanMove { 0%{top:0%} 100%{top:100%} }
        .scan-icon { position: absolute; inset: 0; display: flex; align-items: center;
          justify-content: center; font-size: 22px; }
        .loading-text { font-size: 14px; color: #4B5470; }

        .error { background: #1A0E0E; border: 1px solid #FF6B6B33; border-radius: 12px;
          padding: 14px 18px; font-size: 13px; color: #FF8080; margin-top: 16px; }

        .results { margin-top: 40px; display: flex; flex-direction: column; gap: 20px; }

        .section { background: #0D0F14; border: 1px solid #1E2230; border-radius: 16px;
          overflow: hidden; animation: fadeSlideIn 0.4s ease both; }
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .section-skeleton { background: #0D0F14; border: 1px solid #1E2230;
          border-radius: 16px; padding: 16px 24px 20px; }
        .skeleton { background: linear-gradient(90deg, #1E2230 25%, #262B3D 50%, #1E2230 75%);
          background-size: 200% 100%; animation: shimmer 1.4s ease-in-out infinite; border-radius: 4px; }
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        .skeleton-header { height: 13px; width: 30%; margin-bottom: 16px; }
        .skeleton-line { height: 13px; margin-bottom: 10px; }
        .skeleton-line:last-child { width: 60%; margin-bottom: 0; }

        .section-header { padding: 16px 24px; border-bottom: 1px solid #1A1D28;
          display: flex; align-items: center; gap: 10px; }
        .section-icon { font-size: 18px; }
        .section-title { font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 700;
          letter-spacing: 0.04em; text-transform: uppercase; color: #8891A8; }
        .section-body { padding: 20px 24px; }

        .text-block { font-size: 14px; line-height: 1.8; color: #8891A8;
          font-weight: 300; white-space: pre-wrap; }
        .summary-block { font-size: 14px; line-height: 1.8; color: #A8B0CC; font-weight: 300; }

        .list { list-style: none; display: flex; flex-direction: column; gap: 10px; }
        .list li { display: flex; gap: 12px; font-size: 14px; line-height: 1.6; color: #A8B0CC;
          animation: fadeSlideIn 0.3s ease both; }
        .list li::before { content: ''; width: 6px; height: 6px; border-radius: 50%;
          background: #4F8EF7; flex-shrink: 0; margin-top: 7px; }

        .btn-reset { margin-top: 8px; width: 100%; padding: 13px;
          background: transparent; border: 1px solid #1E2230; border-radius: 12px;
          font-family: 'DM Sans', sans-serif; font-size: 14px; color: #4B5470;
          cursor: pointer; transition: border-color 0.2s, color 0.2s; }
        .btn-reset:hover { border-color: #4F8EF7; color: #4F8EF7; }

        @media (max-width: 600px) { .wrapper { padding: 32px 16px 60px; } }
      `}</style>

      <div className="noise" />
      <div className="orb" />

      <div className="wrapper">
        <a href="/" className="back">← Back to Agents</a>

        <div className="header">
          <div className="tag"><span className="tag-dot" />Image Intelligence</div>
          <h1>Whiteboard Analyzer</h1>
          <p className="subtitle">
            Upload a whiteboard photo or handwritten notes. Gemma 4 reads and interprets the visual, then generates a structured summary and next steps.
          </p>
        </div>

        {!hasAnyResult && (
          <>
            <div
              className={`dropzone${dragging ? " drag" : ""}${file ? " has-file" : ""}`}
              onClick={() => !file && inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              {!file ? (
                <>
                  <span className="dz-icon">🖼️</span>
                  <div className="dz-label">Drop your image here</div>
                  <div className="dz-sub">or <span>browse</span> · JPG, PNG, WEBP</div>
                </>
              ) : (
                <div className="preview-wrap">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={preview!} alt="Preview" className="preview-img" />
                  <div className="preview-badge">✓ Ready</div>
                </div>
              )}
              <input ref={inputRef} type="file" accept=".jpg,.jpeg,.png,.webp,image/*"
                style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
            </div>

            {/* Info ukuran + badge kompresi */}
            {file && (
              <div className="file-info">
                <span className="size-badge">📁 {fileSizeMB} MB</span>
                {/*needsCompression && (
                  <span className="compress-badge">⚡ &gt;4MB — will be compressed automatically</span>
                )*/}
              </div>
            )}

            {file && (
              <p className="preview-change">
                Wrong file? <span onClick={reset}>Remove and re-upload</span>
              </p>
            )}

            {error && <div className="error">⚠️ {error}</div>}

            <button className="btn-primary" disabled={!file || loading} onClick={handleSubmit}>
              {loading ? "Processing…" : "Analyze Image →"}
            </button>
          </>
        )}

        {/* Status bar — termasuk saat compressing */}
        {compressing || (loading && step !== "idle") ? (
          <div className="status-bar">
            <div className="status-spinner" />
            {compressing
              ? "Compressing image to reduce file size…"
              : stepLabel[step] ?? "Processing…"}
          </div>
        ) : null}

        {/* Scan animation — hanya sebelum result pertama dan bukan saat compressing */}
        {loading && !hasAnyResult && !compressing && (
          <div className="loading">
            <div className="scan">
              <div className="scan-line" />
              <div className="scan-icon">🖼️</div>
            </div>
            <div className="loading-text">Gemma 4 is reading your image…</div>
          </div>
        )}

        {hasAnyResult && (
          <div className="results">

            {result.extractedText ? (
              <div className="section">
                <div className="section-header"><span className="section-icon">🔤</span><span className="section-title">Extracted Text</span></div>
                <div className="section-body"><p className="text-block">{result.extractedText}</p></div>
              </div>
            ) : loading ? (
              <div className="section-skeleton">
                <div className="skeleton skeleton-header" />
                <div className="skeleton skeleton-line" style={{ width: "95%" }} />
                <div className="skeleton skeleton-line" style={{ width: "80%" }} />
                <div className="skeleton skeleton-line" />
              </div>
            ) : null}

            {result.diagramDescription ? (
              <div className="section">
                <div className="section-header"><span className="section-icon">📐</span><span className="section-title">Diagrams & Visual Elements</span></div>
                <div className="section-body"><p className="text-block">{result.diagramDescription}</p></div>
              </div>
            ) : loading ? (
              <div className="section-skeleton">
                <div className="skeleton skeleton-header" />
                <div className="skeleton skeleton-line" style={{ width: "88%" }} />
                <div className="skeleton skeleton-line" />
              </div>
            ) : null}

            {result.structuredSummary ? (
              <div className="section">
                <div className="section-header"><span className="section-icon">📋</span><span className="section-title">Structured Summary</span></div>
                <div className="section-body"><p className="summary-block">{result.structuredSummary}</p></div>
              </div>
            ) : loading ? (
              <div className="section-skeleton">
                <div className="skeleton skeleton-header" />
                <div className="skeleton skeleton-line" style={{ width: "92%" }} />
                <div className="skeleton skeleton-line" style={{ width: "75%" }} />
                <div className="skeleton skeleton-line" />
              </div>
            ) : null}

            {result.nextSteps?.length ? (
              <div className="section">
                <div className="section-header"><span className="section-icon">🚀</span><span className="section-title">Suggested Next Steps</span></div>
                <div className="section-body">
                  <ul className="list">
                    {result.nextSteps.map((s, i) => (
                      <li key={i} style={{ animationDelay: `${i * 60}ms` }}>{s}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : loading ? (
              <div className="section-skeleton">
                <div className="skeleton skeleton-header" />
                <div className="skeleton skeleton-line" style={{ width: "70%" }} />
                <div className="skeleton skeleton-line" style={{ width: "55%" }} />
              </div>
            ) : null}

            {step === "done" && !loading && (
              <button className="btn-reset" onClick={reset}>← Analyze another image</button>
            )}

            {error && <div className="error">⚠️ {error}</div>}
          </div>
        )}
      </div>
    </>
  );
}
