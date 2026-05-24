"use client";

import { useState, useRef, useEffect, useCallback } from "react";

type StreamStep = "idle" | "reading" | "analyzing" | "parsing" | "done";
type InputMode = "upload" | "camera";

type Result = {
  extractedText?: string;
  diagramDescription?: string;
  structuredSummary?: string;
  nextSteps?: string[];
};

const MAX_IMAGE_SIZE = 4 * 1024 * 1024;
const MAX_DIMENSION = 2048;

async function compressImage(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = async () => {
      URL.revokeObjectURL(url);
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

      let quality = 0.92;
      let blob: Blob | null = null;
      while (quality >= 0.5) {
        blob = await new Promise<Blob | null>((res) =>
          canvas.toBlob(res, "image/jpeg", quality)
        );
        if (!blob || blob.size <= MAX_IMAGE_SIZE) break;
        quality -= 0.1;
      }

      if (!blob) { reject(new Error("Failed to compress image.")); return; }
      resolve(new File([blob], file.name.replace(/\.[^.]+$/, "_compressed.jpg"), { type: "image/jpeg" }));
    };

    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to load image.")); };
    img.src = url;
  });
}

export default function ImagePage() {
  // Upload state
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Camera state
  const [inputMode, setInputMode] = useState<InputMode>("upload");
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null); // base64
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Process state
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<StreamStep>("idle");
  const [result, setResult] = useState<Result>({});
  const [error, setError] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);

  const hasAnyResult = Object.keys(result).length > 0;

  // ── Camera helpers ─────────────────────────────────────────────────────────

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraActive(false);
  }, []);

  useEffect(() => {
    return () => { stopCamera(); };
  }, [stopCamera]);

  // Restart stream when facingMode changes (while camera is active)
  const startCamera = useCallback(async (facing: "environment" | "user") => {
    setCameraError(null);
    // Stop existing stream first
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
    } catch {
      setCameraError("Tidak bisa mengakses kamera. Pastikan izin diberikan di browser.");
      setCameraActive(false);
    }
  }, []);

  const openCamera = async () => {
    setCapturedImage(null);
    setError(null);
    await startCamera(facingMode);
  };

  const flipCamera = async () => {
    const next = facingMode === "environment" ? "user" : "environment";
    setFacingMode(next);
    await startCamera(next);
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    setCapturedImage(dataUrl);
    stopCamera();
  };

  const discardCapture = async () => {
    setCapturedImage(null);
    setFile(null);
    setPreview(null);
    await openCamera();
  };

  // ── Upload helpers ──────────────────────────────────────────────────────────

  const handleFile = (f: File) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) {
      setError("Format tidak didukung. Gunakan JPG, PNG, atau WEBP.");
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

  // ── Submit ──────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    const sourceIsCamera = inputMode === "camera" && capturedImage;
    const sourceIsUpload = inputMode === "upload" && file;
    if (!sourceIsCamera && !sourceIsUpload) return;

    setLoading(true);
    setStep("idle");
    setError(null);
    setResult({});

    try {
      let uploadFile: File;

      if (sourceIsCamera && capturedImage) {
        // Convert base64 dataURL → File
        const res = await fetch(capturedImage);
        const blob = await res.blob();
        uploadFile = new File([blob], "capture.jpg", { type: "image/jpeg" });
      } else {
        uploadFile = file!;
      }

      // Compress if > 4MB
      if (uploadFile.size > MAX_IMAGE_SIZE) {
        setCompressing(true);
        try {
          uploadFile = await compressImage(uploadFile);
        } catch {
          throw new Error("Gagal mengompres gambar. Coba gambar yang lebih kecil.");
        } finally {
          setCompressing(false);
        }
        if (uploadFile.size > MAX_IMAGE_SIZE) {
          throw new Error("Gambar masih terlalu besar. Gunakan gambar yang lebih kecil.");
        }
      }

      const form = new FormData();
      form.append("file", uploadFile);

      const fetchRes = await fetch("/api/image", { method: "POST", body: form });
      if (!fetchRes.ok || !fetchRes.body) {
        const errData = await fetchRes.json().catch(() => ({}));
        throw new Error(errData?.error || "Gagal memproses gambar.");
      }

      const reader = fetchRes.body.getReader();
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
      setError(err instanceof Error ? err.message : "Terjadi error.");
    } finally {
      setLoading(false);
      setCompressing(false);
      setStep("done");
    }
  };

  const reset = () => {
    stopCamera();
    setCapturedImage(null);
    setFile(null);
    setPreview(null);
    setResult({});
    setError(null);
    setStep("idle");
  };

  const stepLabel: Record<string, string> = {
    reading: "Membaca dan mengonversi gambar…",
    analyzing: "Gemma 4 menganalisis gambar…",
    parsing: "Memproses hasil analisis…",
  };

  const fileSizeMB = file ? (file.size / 1024 / 1024).toFixed(1) : null;
  const canSubmit =
    !loading &&
    ((inputMode === "upload" && !!file) ||
      (inputMode === "camera" && !!capturedImage));

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

        /* Mode tabs */
        .mode-tabs { display: flex; gap: 4px; background: #0D0F14; border: 1px solid #1E2230;
          border-radius: 12px; padding: 4px; margin-bottom: 20px; }
        .mode-tab { flex: 1; padding: 10px 16px; border: none; border-radius: 9px;
          font-family: 'Syne', sans-serif; font-size: 13px; font-weight: 600;
          cursor: pointer; transition: background 0.2s, color 0.2s; background: transparent; color: #4B5470; }
        .mode-tab.active { background: #4F8EF7; color: #07080A; }
        .mode-tab:not(.active):hover { color: #A8B0CC; }

        /* Upload zone */
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

        /* Camera panel */
        .camera-panel { background: #0D0F14; border: 1.5px solid #1E2230;
          border-radius: 18px; overflow: hidden; }
        .camera-panel.active-cam { border-color: #4F8EF755; }
        .camera-panel.captured { border-color: #4F8EF7; }

        .camera-viewport { position: relative; width: 100%; background: #000;
          min-height: 240px; display: flex; align-items: center; justify-content: center; }
        .camera-video { width: 100%; max-height: 400px; object-fit: cover; display: block; border-radius: 0; }
        .camera-captured-img { width: 100%; max-height: 400px; object-fit: contain; display: block; }

        .camera-idle-placeholder { text-align: center; padding: 52px 24px; }
        .cam-icon { font-size: 48px; margin-bottom: 14px; display: block;
          filter: drop-shadow(0 0 16px #4F8EF766); }
        .cam-idle-label { font-family: 'Syne', sans-serif; font-size: 15px; font-weight: 700;
          color: #C8CCE0; margin-bottom: 6px; }
        .cam-idle-sub { font-size: 13px; color: #4B5470; }

        /* Camera overlay controls (on top of video) */
        .cam-overlay { position: absolute; bottom: 12px; left: 0; right: 0;
          display: flex; align-items: center; justify-content: center; gap: 14px; }
        .cam-flip-btn { width: 38px; height: 38px; border-radius: 50%; border: 1.5px solid #ffffff44;
          background: #000000aa; color: #fff; font-size: 18px; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: background 0.2s; }
        .cam-flip-btn:hover { background: #00000099; border-color: #fff8; }
        .cam-shutter { width: 62px; height: 62px; border-radius: 50%;
          border: 3px solid #fff; background: transparent; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: transform 0.15s; }
        .cam-shutter:hover { transform: scale(1.06); }
        .cam-shutter-inner { width: 46px; height: 46px; border-radius: 50%;
          background: #fff; transition: background 0.1s; }
        .cam-shutter:active .cam-shutter-inner { background: #4F8EF7; }

        /* Camera footer controls */
        .camera-footer { padding: 14px 20px; border-top: 1px solid #1A1D28;
          display: flex; align-items: center; justify-content: center; gap: 10px; }
        .cam-btn { padding: 9px 18px; border-radius: 8px; border: 1px solid #1E2230;
          background: #111420; color: #A8B0CC; font-family: 'DM Sans', sans-serif;
          font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
        .cam-btn:hover { border-color: #4F8EF7; color: #4F8EF7; }
        .cam-btn.danger:hover { border-color: #FF6B6B; color: #FF6B6B; }
        .cam-btn.primary { background: #4F8EF7; color: #07080A; border-color: #4F8EF7; font-weight: 700; }
        .cam-btn.primary:hover { opacity: 0.85; }

        .cam-badge { position: absolute; top: 10px; left: 10px;
          background: #07080Acc; border: 1px solid #4F8EF733; border-radius: 100px;
          padding: 4px 10px; font-size: 11px; color: #4F8EF7; font-weight: 600;
          letter-spacing: 0.06em; text-transform: uppercase; }

        /* Shared */
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
      {/* Hidden canvas for capture */}
      <canvas ref={canvasRef} style={{ display: "none" }} />

      <div className="wrapper">
        <a href="/" className="back">← Back to Agents</a>

        <div className="header">
          <div className="tag"><span className="tag-dot" />Image Intelligence</div>
          <h1>Whiteboard Analyzer</h1>
          <p className="subtitle">
            Upload foto atau ambil langsung dari kamera. Gemma 4 membaca dan menginterpretasi visual, lalu menghasilkan ringkasan terstruktur dan langkah selanjutnya.
          </p>
        </div>

        {!hasAnyResult && (
          <>
            {/* Mode Switcher */}
            <div className="mode-tabs">
              <button
                className={`mode-tab${inputMode === "camera" ? " active" : ""}`}
                onClick={() => {
                  setInputMode("camera");
                  setFile(null);
                  setPreview(null);
                  setError(null);
                }}
              >
                📷 Ambil dari Kamera
              </button>
              <button
                className={`mode-tab${inputMode === "upload" ? " active" : ""}`}
                onClick={() => {
                  setInputMode("upload");
                  stopCamera();
                  setCapturedImage(null);
                  setError(null);
                }}
              >
                📁 Upload Gambar
              </button>
            </div>

            {/* ── CAMERA MODE ─────────────────────────────────────── */}
            {inputMode === "camera" && (
              <div className={`camera-panel${cameraActive ? " active-cam" : capturedImage ? " captured" : ""}`}>
                <div className="camera-viewport">

                  {/* Idle state */}
                  {!cameraActive && !capturedImage && (
                    <div className="camera-idle-placeholder">
                      <span className="cam-icon">📷</span>
                      <div className="cam-idle-label">Kamera belum aktif</div>
                      <div className="cam-idle-sub">Tekan tombol di bawah untuk mulai</div>
                    </div>
                  )}

                  {/* Live viewfinder */}
                  {cameraActive && (
                    <>
                      <video ref={videoRef} className="camera-video" muted playsInline />
                      <div className="cam-badge">
                        {facingMode === "environment" ? "📸 Kamera Belakang" : "🤳 Kamera Depan"}
                      </div>
                      <div className="cam-overlay">
                        <button className="cam-flip-btn" onClick={flipCamera} title="Ganti kamera">🔄</button>
                        <button className="cam-shutter" onClick={capturePhoto} title="Ambil foto">
                          <div className="cam-shutter-inner" />
                        </button>
                        <div style={{ width: 38 }} /> {/* spacer */}
                      </div>
                    </>
                  )}

                  {/* Captured preview */}
                  {capturedImage && !cameraActive && (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={capturedImage} alt="Hasil foto" className="camera-captured-img" />
                      <div className="preview-badge">✓ Foto diambil</div>
                    </>
                  )}
                </div>

                {/* Footer controls */}
                <div className="camera-footer">
                  {!cameraActive && !capturedImage && (
                    <button className="cam-btn primary" onClick={openCamera}>
                      📷 Aktifkan Kamera
                    </button>
                  )}
                  {cameraActive && (
                    <button className="cam-btn danger" onClick={stopCamera}>
                      ✕ Tutup Kamera
                    </button>
                  )}
                  {capturedImage && !cameraActive && (
                    <>
                      <button className="cam-btn danger" onClick={discardCapture}>🔄 Foto Ulang</button>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ── UPLOAD MODE ─────────────────────────────────────── */}
            {inputMode === "upload" && (
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
                      <div className="dz-label">Letakkan gambar di sini</div>
                      <div className="dz-sub">atau <span>browse</span> · JPG, PNG, WEBP</div>
                    </>
                  ) : (
                    <div className="preview-wrap">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={preview!} alt="Preview" className="preview-img" />
                      <div className="preview-badge">✓ Siap</div>
                    </div>
                  )}
                  <input ref={inputRef} type="file" accept=".jpg,.jpeg,.png,.webp,image/*"
                    style={{ display: "none" }}
                    onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
                </div>

                {file && (
                  <div className="file-info">
                    <span className="size-badge">📁 {fileSizeMB} MB</span>
                  </div>
                )}
                {file && (
                  <p className="preview-change">
                    File salah? <span onClick={reset}>Hapus dan upload ulang</span>
                  </p>
                )}
              </>
            )}

            {(cameraError || error) && (
              <div className="error">⚠️ {cameraError || error}</div>
            )}

            <button className="btn-primary" disabled={!canSubmit} onClick={handleSubmit}>
              {loading
                ? "Memproses…"
                : inputMode === "camera" && capturedImage
                ? "Analisis Foto →"
                : "Analisis Gambar →"}
            </button>
          </>
        )}

        {/* Status bar */}
        {compressing || (loading && step !== "idle") ? (
          <div className="status-bar">
            <div className="status-spinner" />
            {compressing
              ? "Mengompres gambar…"
              : stepLabel[step] ?? "Memproses…"}
          </div>
        ) : null}

        {/* Scan animation */}
        {loading && !hasAnyResult && !compressing && (
          <div className="loading">
            <div className="scan">
              <div className="scan-line" />
              <div className="scan-icon">🖼️</div>
            </div>
            <div className="loading-text">Gemma 4 sedang membaca gambar…</div>
          </div>
        )}

        {/* Results */}
        {hasAnyResult && (
          <div className="results">
            {result.extractedText ? (
              <div className="section">
                <div className="section-header"><span className="section-icon">🔤</span><span className="section-title">Teks yang Diekstrak</span></div>
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
                <div className="section-header"><span className="section-icon">📐</span><span className="section-title">Diagram & Elemen Visual</span></div>
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
                <div className="section-header"><span className="section-icon">📋</span><span className="section-title">Ringkasan Terstruktur</span></div>
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
                <div className="section-header"><span className="section-icon">🚀</span><span className="section-title">Langkah Selanjutnya</span></div>
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
              <button className="btn-reset" onClick={reset}>← Analisis gambar lain</button>
            )}
            {error && <div className="error">⚠️ {error}</div>}
          </div>
        )}
      </div>
    </>
  );
}
