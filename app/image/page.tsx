"use client";

import { useState, useRef, useCallback, useEffect } from "react";

// ── Types ────────────────────────────────────────────────────────────────────
type StreamStep = "idle" | "reading" | "classifying" | "analyzing" | "done";

type Classification = {
  type: string;
  label: string;
  icon: string;
  reasoning: string;
};

type ToolEvent = {
  tool: string;
  label: string;
  status: "running" | "done";
  result?: Record<string, unknown>;
};

type Field = {
  key: string;
  heading: string;
  icon: string;
  isList: boolean;
  value: string | string[];
};

// ── Constants ────────────────────────────────────────────────────────────────
const MAX_IMAGE_SIZE = 4 * 1024 * 1024;
const MAX_DIMENSION  = 2048;

const TOOL_META: Record<string, { color: string }> = {
  classify_image:   { color: "#4FC3F7" },
  analyze_adaptive: { color: "#A5D6A7" },
};

const STEP_LABELS: Record<string, string> = {
  reading:     "Reading image…",
  classifying: "Agent classifying image type…",
  analyzing:   "Adaptive analysis running…",
  done:        "Complete.",
};

const TYPE_COLORS: Record<string, string> = {
  whiteboard: "#F7A84F",
  diagram:    "#CE93D8",
  screenshot: "#4FC3F7",
  document:   "#80CBC4",
  chart:      "#A5D6A7",
  photo:      "#F48FB1",
};

// ── Image compression (unchanged from original) ──────────────────────────────
async function compressImage(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = async () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
        width  = Math.round(width  * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
      let quality = 0.92, blob: Blob | null = null;
      while (quality >= 0.5) {
        blob = await new Promise<Blob | null>(res => canvas.toBlob(res, "image/jpeg", quality));
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

// ── Component ────────────────────────────────────────────────────────────────
export default function ImagePage() {
  // Input state
  const [file, setFile]               = useState<File | null>(null);
  const [preview, setPreview]         = useState<string | null>(null);
  const [dragging, setDragging]       = useState(false);
  const [inputMode, setInputMode]     = useState<"upload" | "camera">("upload");
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [cameraActive, setCameraActive]   = useState(false);
  const [cameraError, setCameraError]     = useState<string | null>(null);
  const [facingMode, setFacingMode]       = useState<"environment" | "user">("environment");
  const inputRef  = useRef<HTMLInputElement>(null);
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Agent state
  const [loading, setLoading]               = useState(false);
  const [step, setStep]                     = useState<StreamStep>("idle");
  const [stepLabel, setStepLabel]           = useState("");
  const [compressing, setCompressing]       = useState(false);
  const [classification, setClassification] = useState<Classification | null>(null);
  const [toolEvents, setToolEvents]         = useState<ToolEvent[]>([]);
  const [fields, setFields]                 = useState<Field[]>([]);
  const [error, setError]                   = useState<string | null>(null);

  const hasResult = fields.length > 0 || classification !== null;
  const accentColor = classification ? (TYPE_COLORS[classification.type] || "#4F8EF7") : "#4F8EF7";

  // ── Camera helpers (unchanged) ────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCameraActive(false);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const startCamera = useCallback(async (facing: "environment" | "user") => {
    setCameraError(null);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setCameraActive(true);
    } catch {
      setCameraError("Cannot access camera. Please allow camera permission.");
      setCameraActive(false);
    }
  }, []);

  const openCamera     = async () => { setCapturedImage(null); setError(null); await startCamera(facingMode); };
  const flipCamera     = async () => { const n = facingMode === "environment" ? "user" : "environment"; setFacingMode(n); await startCamera(n); };
  const capturePhoto   = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const v = videoRef.current, c = canvasRef.current;
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    setCapturedImage(c.toDataURL("image/jpeg", 0.92));
    stopCamera();
  };
  const discardCapture = async () => { setCapturedImage(null); setFile(null); setPreview(null); await openCamera(); };

  // ── Upload helpers ────────────────────────────────────────────────────────
  const handleFile = (f: File) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) {
      setError("Unsupported format. Use JPG, PNG, or WEBP."); return;
    }
    setError(null); setFields([]); setClassification(null); setToolEvents([]);
    setFile(f);
    const reader = new FileReader();
    reader.onload = e => setPreview(e.target?.result as string);
    reader.readAsDataURL(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    const fromCamera = inputMode === "camera" && capturedImage;
    const fromUpload = inputMode === "upload" && file;
    if (!fromCamera && !fromUpload) return;

    setLoading(true); setStep("idle"); setError(null);
    setFields([]); setClassification(null); setToolEvents([]);

    try {
      let uploadFile: File;
      if (fromCamera && capturedImage) {
        const blob = await (await fetch(capturedImage)).blob();
        uploadFile = new File([blob], "capture.jpg", { type: "image/jpeg" });
      } else {
        uploadFile = file!;
      }

      if (uploadFile.size > MAX_IMAGE_SIZE) {
        setCompressing(true);
        try { uploadFile = await compressImage(uploadFile); }
        catch { throw new Error("Failed to compress image."); }
        finally { setCompressing(false); }
        if (uploadFile.size > MAX_IMAGE_SIZE) throw new Error("Image still too large after compression.");
      }

      const form = new FormData();
      form.append("file", uploadFile);

      const res = await fetch("/api/image", { method: "POST", body: form });
      if (!res.ok || !res.body) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error || "Failed to process image.");
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const raw of events) {
          if (!raw.trim()) continue;
          const em = raw.match(/^event: (\w+)/m);
          const dm = raw.match(/^data: (.+)/m);
          if (!em || !dm) continue;
          const eventName = em[1];
          let payload: Record<string, unknown>;
          try { payload = JSON.parse(dm[1]); } catch { continue; }

          switch (eventName) {
            case "status":
              setStep(payload.step as StreamStep);
              setStepLabel((payload.label as string) || STEP_LABELS[payload.step as string] || "");
              break;

            case "tool_call":
              setToolEvents(prev => [...prev, {
                tool: payload.tool as string,
                label: payload.label as string,
                status: "running",
              }]);
              break;

            case "tool_result":
              setToolEvents(prev => prev.map((t, i) =>
                i === prev.length - 1
                  ? { ...t, result: payload.result as Record<string, unknown>, status: "done" }
                  : t
              ));
              break;

            case "classification":
              setClassification({
                type:      payload.type as string,
                label:     payload.label as string,
                icon:      payload.icon as string,
                reasoning: payload.reasoning as string,
              });
              break;

            case "field":
              setFields(prev => [...prev, {
                key:     payload.key as string,
                heading: payload.heading as string,
                icon:    payload.icon as string,
                isList:  payload.isList as boolean,
                value:   payload.value as string | string[],
              }]);
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
      setError(err instanceof Error ? err.message : "An error occurred.");
    } finally {
      setLoading(false);
      setCompressing(false);
    }
  };

  const reset = () => {
    stopCamera(); setCapturedImage(null);
    setFile(null); setPreview(null);
    setFields([]); setClassification(null); setToolEvents([]);
    setError(null); setStep("idle");
  };

  const canSubmit = !loading && (
    (inputMode === "upload" && !!file) ||
    (inputMode === "camera" && !!capturedImage)
  );
  const fileSizeMB = file ? (file.size / 1024 / 1024).toFixed(1) : null;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;1,9..40,300&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #07080A; color: #E8EAF0; font-family: 'DM Sans', sans-serif; min-height: 100vh; }

        .bg-orb { position: fixed; border-radius: 50%; filter: blur(140px);
          pointer-events: none; z-index: 0; }
        .bg-orb-1 { width: 500px; height: 500px; background: #4F8EF710;
          top: -100px; left: -80px; }
        .bg-orb-2 { width: 360px; height: 360px; background: #A5D6A708;
          bottom: -60px; right: -40px; }
        .noise { position: fixed; inset: 0; z-index: 0; pointer-events: none; opacity: 0.025;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }

        .layout { position: relative; z-index: 1; display: grid;
          grid-template-columns: 1fr 340px; min-height: 100vh;
          max-width: 1140px; margin: 0 auto; }

        /* LEFT */
        .left { padding: 48px 40px 80px; border-right: 1px solid #111520; }

        .back { display: inline-flex; align-items: center; gap: 8px; color: #3B4155;
          font-size: 13px; text-decoration: none; margin-bottom: 40px; transition: color 0.2s; }
        .back:hover { color: var(--accent, #4F8EF7); }

        .agent-badge { display: inline-flex; align-items: center; gap: 8px;
          background: #4F8EF70C; border: 1px solid #4F8EF720;
          border-radius: 100px; padding: 5px 12px; margin-bottom: 16px;
          transition: background 0.3s, border-color 0.3s; }
        .agent-badge-dot { width: 6px; height: 6px; border-radius: 50%;
          background: var(--accent, #4F8EF7); box-shadow: 0 0 8px var(--accent, #4F8EF7);
          animation: pulse 2s ease-in-out infinite; }
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.8)} }
        .agent-badge-text { font-size: 11px; font-weight: 600; letter-spacing: 0.1em;
          text-transform: uppercase; color: var(--accent, #4F8EF7); }

        h1 { font-family: 'Syne', sans-serif; font-size: clamp(26px, 4vw, 38px);
          font-weight: 800; letter-spacing: -0.03em; color: #F0F2F8; line-height: 1.1; margin-bottom: 10px; }
        .subtitle { font-size: 14px; font-weight: 300; color: #5A6175; line-height: 1.7;
          max-width: 460px; margin-bottom: 32px; }

        /* Mode tabs */
        .mode-tabs { display: flex; gap: 4px; background: #0C0E13; border: 1px solid #181C28;
          border-radius: 12px; padding: 4px; margin-bottom: 18px; }
        .mode-tab { flex: 1; padding: 9px 14px; border: none; border-radius: 9px;
          font-family: 'Syne', sans-serif; font-size: 12px; font-weight: 700;
          cursor: pointer; transition: background 0.2s, color 0.2s;
          background: transparent; color: #3B4155; letter-spacing: 0.02em; }
        .mode-tab.active { background: var(--accent, #4F8EF7); color: #07080A; }
        .mode-tab:not(.active):hover { color: #A8B0CC; }

        /* Upload dropzone */
        .dropzone { border: 1.5px dashed #181C28; border-radius: 16px; padding: 44px 28px;
          text-align: center; cursor: pointer; transition: border-color 0.2s, background 0.2s;
          background: #0C0E13; }
        .dropzone.drag { border-color: var(--accent, #4F8EF7); background: #4F8EF706; }
        .dropzone.has-file { border-style: solid; border-color: var(--accent, #4F8EF7); padding: 18px; }
        .dz-icon { font-size: 34px; margin-bottom: 12px; display: block;
          filter: drop-shadow(0 0 12px #4F8EF755); }
        .dz-title { font-family: 'Syne', sans-serif; font-size: 15px; font-weight: 600;
          color: #C0C8E0; margin-bottom: 5px; }
        .dz-sub { font-size: 12px; color: #3B4155; }
        .dz-sub span { color: var(--accent, #4F8EF7); }

        .preview-wrap { position: relative; }
        .preview-img { width: 100%; max-height: 300px; object-fit: contain;
          border-radius: 10px; display: block; }
        .preview-badge { position: absolute; top: 8px; right: 8px;
          background: #07080Acc; border: 1px solid #ffffff22; border-radius: 100px;
          padding: 4px 10px; font-size: 11px; color: #ccc; }
        .preview-actions { display: flex; gap: 8px; justify-content: center;
          margin-top: 10px; flex-wrap: wrap; }
        .preview-link { font-size: 12px; color: #3B4155; cursor: pointer; transition: color 0.2s; }
        .preview-link:hover { color: var(--accent, #4F8EF7); }
        .size-chip { background: #0C0E13; border: 1px solid #181C28; border-radius: 100px;
          padding: 4px 10px; font-size: 11px; color: #4A5270; }

        /* Camera */
        .camera-panel { background: #0C0E13; border: 1.5px solid #181C28; border-radius: 16px; overflow: hidden; }
        .camera-panel.live { border-color: #4F8EF755; }
        .camera-panel.captured { border-color: var(--accent, #4F8EF7); }
        .cam-viewport { position: relative; min-height: 220px; background: #000;
          display: flex; align-items: center; justify-content: center; }
        .cam-video { width: 100%; max-height: 380px; object-fit: cover; display: block; }
        .cam-captured { width: 100%; max-height: 380px; object-fit: contain; display: block; }
        .cam-idle { text-align: center; padding: 48px 24px; }
        .cam-idle-icon { font-size: 40px; margin-bottom: 12px; display: block; filter: drop-shadow(0 0 14px #4F8EF766); }
        .cam-idle-title { font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 700; color: #C0C8E0; margin-bottom: 4px; }
        .cam-idle-sub { font-size: 12px; color: #3B4155; }
        .cam-overlay { position: absolute; bottom: 10px; left: 0; right: 0;
          display: flex; align-items: center; justify-content: center; gap: 12px; }
        .cam-flip { width: 36px; height: 36px; border-radius: 50%; border: 1.5px solid #fff4;
          background: #000a; color: #fff; font-size: 16px; cursor: pointer;
          display: flex; align-items: center; justify-content: center; }
        .cam-shutter { width: 58px; height: 58px; border-radius: 50%; border: 3px solid #fff;
          background: transparent; cursor: pointer; display: flex; align-items: center;
          justify-content: center; transition: transform 0.15s; }
        .cam-shutter:hover { transform: scale(1.05); }
        .cam-shutter-inner { width: 42px; height: 42px; border-radius: 50%; background: #fff; }
        .cam-shutter:active .cam-shutter-inner { background: var(--accent, #4F8EF7); }
        .cam-label { position: absolute; top: 8px; left: 8px; background: #000a;
          border: 1px solid #fff2; border-radius: 100px; padding: 3px 10px;
          font-size: 10px; color: #ccc; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
        .cam-footer { padding: 12px 18px; border-top: 1px solid #131620;
          display: flex; align-items: center; justify-content: center; gap: 8px; }
        .cam-btn { padding: 8px 16px; border-radius: 8px; border: 1px solid #181C28;
          background: #111420; color: #9098B0; font-size: 12px; font-weight: 500;
          cursor: pointer; transition: all 0.2s; }
        .cam-btn:hover { border-color: var(--accent, #4F8EF7); color: var(--accent, #4F8EF7); }
        .cam-btn.danger:hover { border-color: #FF6B6B; color: #FF6B6B; }
        .cam-btn.primary { background: var(--accent, #4F8EF7); color: #07080A; border-color: transparent; font-weight: 700; }
        .cam-btn.primary:hover { opacity: 0.85; }

        /* CTA */
        .btn-primary { width: 100%; margin-top: 18px; padding: 15px;
          background: var(--accent, #4F8EF7); color: #07080A; border: none;
          border-radius: 12px; font-family: 'Syne', sans-serif; font-size: 14px;
          font-weight: 800; letter-spacing: 0.03em; cursor: pointer;
          transition: opacity 0.2s, transform 0.15s;
          box-shadow: 0 4px 20px color-mix(in srgb, var(--accent, #4F8EF7) 25%, transparent); }
        .btn-primary:hover:not(:disabled) { opacity: 0.88; transform: translateY(-1px); }
        .btn-primary:disabled { opacity: 0.25; cursor: not-allowed; box-shadow: none; }

        /* Status */
        .status-bar { display: flex; align-items: center; gap: 10px; padding: 10px 14px;
          background: #0C0E13; border: 1px solid #181C28; border-radius: 10px;
          margin-top: 16px; font-size: 12px; color: #5A6175; }
        .spinner { width: 13px; height: 13px; border-radius: 50%;
          border: 2px solid #181C28; border-top-color: var(--accent, #4F8EF7);
          animation: spin 0.75s linear infinite; flex-shrink: 0; }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* Classification reveal */
        .class-reveal { margin-top: 28px; padding: 16px 20px;
          background: #0C0E13; border: 1px solid #181C28; border-radius: 14px;
          animation: fadeUp 0.4s ease both; }
        .class-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
        .class-icon { font-size: 22px; }
        .class-type { font-family: 'Syne', sans-serif; font-size: 16px; font-weight: 800;
          color: var(--accent, #4F8EF7); }
        .class-reasoning { font-size: 12px; color: #4A5270; font-style: italic; line-height: 1.5; }
        .class-badge { display: inline-flex; align-items: center; gap: 5px;
          background: color-mix(in srgb, var(--accent, #4F8EF7) 10%, transparent);
          border: 1px solid color-mix(in srgb, var(--accent, #4F8EF7) 25%, transparent);
          border-radius: 100px; padding: 3px 10px; font-size: 10px; font-weight: 700;
          color: var(--accent, #4F8EF7); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 10px; }

        /* Results */
        .results { margin-top: 28px; display: flex; flex-direction: column; gap: 14px; }
        .field-card { background: #0C0E13; border: 1px solid #181C28; border-radius: 14px;
          overflow: hidden; animation: fadeUp 0.35s ease both; }
        @keyframes fadeUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        .field-head { padding: 13px 20px; border-bottom: 1px solid #131620;
          display: flex; align-items: center; gap: 8px; }
        .field-head-icon { font-size: 16px; }
        .field-head-title { font-family: 'Syne', sans-serif; font-size: 11px; font-weight: 700;
          letter-spacing: 0.07em; text-transform: uppercase; color: #6B7285; }
        .field-body { padding: 16px 20px; }
        .field-text { font-size: 13px; line-height: 1.85; color: #9098B0; font-weight: 300; white-space: pre-wrap; }
        .field-list { list-style: none; display: flex; flex-direction: column; gap: 9px; }
        .field-list li { display: flex; gap: 10px; font-size: 13px; line-height: 1.6; color: #A8B0CC; }
        .field-list li::before { content: ''; width: 5px; height: 5px; border-radius: 50%;
          background: var(--accent, #4F8EF7); flex-shrink: 0; margin-top: 7px; }

        /* Skeleton */
        .skel { background: linear-gradient(90deg, #181C28 25%, #1E2438 50%, #181C28 75%);
          background-size: 200% 100%; animation: shimmer 1.5s ease-in-out infinite; border-radius: 5px; }
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }

        .btn-reset { margin-top: 8px; width: 100%; padding: 12px; background: transparent;
          border: 1px solid #181C28; border-radius: 12px; font-size: 13px; color: #3B4155;
          cursor: pointer; transition: border-color 0.2s, color 0.2s; }
        .btn-reset:hover { border-color: var(--accent, #4F8EF7); color: var(--accent, #4F8EF7); }

        .error-box { background: #180D0D; border: 1px solid #FF6B6B22; border-radius: 11px;
          padding: 12px 16px; font-size: 13px; color: #FF8080; margin-top: 14px; }

        /* RIGHT PANEL */
        .right { padding: 48px 24px 80px; position: sticky; top: 0;
          height: 100vh; overflow: hidden; display: flex; flex-direction: column; }
        .panel-title { font-family: 'Syne', sans-serif; font-size: 10px; font-weight: 700;
          letter-spacing: 0.12em; text-transform: uppercase; color: #2A2F45;
          margin-bottom: 18px; display: flex; align-items: center; gap: 7px; }
        .panel-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--accent, #4F8EF7); opacity: 0.5; }

        .idle-right { flex: 1; display: flex; flex-direction: column; align-items: center;
          justify-content: center; text-align: center; padding: 32px 16px; }
        .idle-right-icon { font-size: 36px; margin-bottom: 14px; opacity: 0.2; }
        .idle-right-text { font-size: 12px; color: #2A2F45; line-height: 1.7; max-width: 220px; }

        /* Tool timeline */
        .tl-wrap { flex: 1; overflow-y: auto; padding-right: 4px; }
        .tl-wrap::-webkit-scrollbar { width: 3px; }
        .tl-wrap::-webkit-scrollbar-thumb { background: #181C28; border-radius: 4px; }

        .tl-item { display: flex; gap: 10px; margin-bottom: 16px; animation: fadeUp 0.3s ease both; }
        .tl-col { display: flex; flex-direction: column; align-items: center; }
        .tl-dot { width: 26px; height: 26px; border-radius: 50%; border: 1.5px solid #181C28;
          display: flex; align-items: center; justify-content: center; font-size: 12px;
          flex-shrink: 0; background: #0C0E13; }
        .tl-dot.running { border-color: var(--accent, #4F8EF7); animation: ring 1.5s ease-in-out infinite; }
        .tl-dot.done { border-color: color-mix(in srgb, var(--tool-color, #4FC3F7) 40%, transparent); }
        @keyframes ring { 0%,100%{box-shadow:0 0 0 0 var(--accent,#4F8EF7)44} 50%{box-shadow:0 0 0 5px transparent} }
        .tl-line { width: 1px; background: #181C28; flex: 1; min-height: 14px; margin-top: 4px; }

        .tl-body { flex: 1; padding-bottom: 4px; }
        .tl-name { font-family: 'Syne', sans-serif; font-size: 11px; font-weight: 700;
          letter-spacing: 0.04em; margin-bottom: 4px; color: var(--tool-color, #4FC3F7); }
        .tl-result { font-size: 11px; color: #2E3350; line-height: 1.5; }
        .tl-result b { color: var(--tool-color, #4FC3F7); font-weight: 600; }

        /* Classification card in right panel */
        .class-card { padding: 14px; background: #0C0E13; border-radius: 12px;
          border: 1px solid color-mix(in srgb, var(--accent, #4F8EF7) 20%, transparent);
          margin-bottom: 16px; animation: fadeUp 0.4s ease both; }
        .class-card-type { font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 800;
          color: var(--accent, #4F8EF7); margin-bottom: 4px; }
        .class-card-reason { font-size: 11px; color: #3B4155; font-style: italic; line-height: 1.5; }

        /* Stats */
        .stats { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 14px; }
        .stat { padding: 5px 9px; background: #0C0E13; border: 1px solid #181C28;
          border-radius: 100px; font-size: 10px; color: #2E3350; white-space: nowrap; }
        .stat b { color: var(--accent, #4F8EF7); font-weight: 700; }
        .stat.done { border-color: #4CAF5022; color: #4CAF50; }

        @media (max-width: 860px) {
          .layout { grid-template-columns: 1fr; }
          .right { position: relative; height: auto; border-top: 1px solid #111520;
            padding: 32px 20px 48px; }
          .tl-wrap { max-height: 320px; }
        }
        @media (max-width: 560px) {
          .left { padding: 32px 18px 60px; }
        }
      `}</style>

      {/* Inject CSS variable for accent color */}
      <style>{`:root { --accent: ${accentColor}; }`}</style>

      <div className="bg-orb bg-orb-1" />
      <div className="bg-orb bg-orb-2" />
      <div className="noise" />
      <canvas ref={canvasRef} style={{ display: "none" }} />

      <div className="layout">
        {/* ── LEFT PANEL ── */}
        <div className="left">
          <a href="/" className="back">← Back to Agents</a>

          <div className="agent-badge">
            <div className="agent-badge-dot" />
            <span className="agent-badge-text">Image Agent · Adaptive Analysis</span>
          </div>

          <h1>Image<br />Analysis Agent</h1>
          <p className="subtitle">
            The agent first classifies your image type, then runs an adaptive analysis tailored specifically to that type — whiteboard, diagram, screenshot, chart, document, or photo.
          </p>

          {!hasResult && (
            <>
              <div className="mode-tabs">
                <button
                  className={`mode-tab${inputMode === "camera" ? " active" : ""}`}
                  onClick={() => { setInputMode("camera"); setFile(null); setPreview(null); setError(null); }}
                >
                  📷 Use Camera
                </button>
                <button
                  className={`mode-tab${inputMode === "upload" ? " active" : ""}`}
                  onClick={() => { setInputMode("upload"); stopCamera(); setCapturedImage(null); setError(null); }}
                >
                  📁 Upload Image
                </button>
              </div>

              {/* Camera mode */}
              {inputMode === "camera" && (
                <div className={`camera-panel${cameraActive ? " live" : capturedImage ? " captured" : ""}`}>
                  <div className="cam-viewport">
                    {!cameraActive && !capturedImage && (
                      <div className="cam-idle">
                        <span className="cam-idle-icon">📷</span>
                        <div className="cam-idle-title">Camera not active</div>
                        <div className="cam-idle-sub">Press the button below to start</div>
                      </div>
                    )}
                    {cameraActive && (
                      <>
                        <video ref={videoRef} className="cam-video" muted playsInline />
                        <div className="cam-label">{facingMode === "environment" ? "📸 Back" : "🤳 Front"}</div>
                        <div className="cam-overlay">
                          <button className="cam-flip" onClick={flipCamera}>🔄</button>
                          <button className="cam-shutter" onClick={capturePhoto}>
                            <div className="cam-shutter-inner" />
                          </button>
                          <div style={{ width: 36 }} />
                        </div>
                      </>
                    )}
                    {capturedImage && !cameraActive && (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={capturedImage} alt="Captured" className="cam-captured" />
                        <div className="cam-label" style={{ borderColor: "#4CAF5044", color: "#4CAF50" }}>✓ Captured</div>
                      </>
                    )}
                  </div>
                  <div className="cam-footer">
                    {!cameraActive && !capturedImage && <button className="cam-btn primary" onClick={openCamera}>📷 Open Camera</button>}
                    {cameraActive && <button className="cam-btn danger" onClick={stopCamera}>✕ Close</button>}
                    {capturedImage && !cameraActive && <button className="cam-btn danger" onClick={discardCapture}>🔄 Retake</button>}
                  </div>
                </div>
              )}

              {/* Upload mode */}
              {inputMode === "upload" && (
                <>
                  <div
                    className={`dropzone${dragging ? " drag" : ""}${file ? " has-file" : ""}`}
                    onClick={() => !file && inputRef.current?.click()}
                    onDragOver={e => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={handleDrop}
                  >
                    {!file ? (
                      <>
                        <span className="dz-icon">🖼️</span>
                        <div className="dz-title">Drop your image here</div>
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
                      style={{ display: "none" }}
                      onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
                  </div>
                  {file && (
                    <div className="preview-actions">
                      <span className="size-chip">📁 {fileSizeMB} MB</span>
                      <span className="preview-link" onClick={reset}>Remove</span>
                    </div>
                  )}
                </>
              )}

              {(cameraError || error) && <div className="error-box">⚠️ {cameraError || error}</div>}

              <button className="btn-primary" disabled={!canSubmit} onClick={handleSubmit}>
                {loading ? "Agent running…" : inputMode === "camera" && capturedImage ? "Run Agent on Photo →" : "Run Agent on Image →"}
              </button>
            </>
          )}

          {/* Status bar */}
          {(compressing || (loading && step !== "idle")) && (
            <div className="status-bar">
              <div className="spinner" />
              {compressing ? "Compressing image…" : stepLabel || STEP_LABELS[step] || "Processing…"}
            </div>
          )}

          {/* Classification reveal */}
          {classification && (
            <div className="class-reveal">
              <div className="class-badge">{classification.icon} {classification.type}</div>
              <div className="class-header">
                <div className="class-type">{classification.label}</div>
              </div>
              <div className="class-reasoning">"{classification.reasoning}"</div>
            </div>
          )}

          {/* Results */}
          {fields.length > 0 && (
            <div className="results">
              {fields.map((f, i) => (
                <div className="field-card" key={f.key} style={{ animationDelay: `${i * 40}ms` }}>
                  <div className="field-head">
                    <span className="field-head-icon">{f.icon}</span>
                    <span className="field-head-title">{f.heading}</span>
                  </div>
                  <div className="field-body">
                    {f.isList && Array.isArray(f.value) ? (
                      <ul className="field-list">
                        {f.value.map((item, j) => <li key={j}>{item}</li>)}
                      </ul>
                    ) : (
                      <p className="field-text">{f.value as string}</p>
                    )}
                  </div>
                </div>
              ))}

              {/* Loading skeletons for remaining fields */}
              {loading && classification && Array.from({ length: Math.max(0, 4 - fields.length) }).map((_, i) => (
                <div key={`sk-${i}`} style={{ background: "#0C0E13", border: "1px solid #181C28", borderRadius: 14, padding: "14px 20px" }}>
                  <div className="skel" style={{ height: 11, width: "30%", marginBottom: 14 }} />
                  <div className="skel" style={{ height: 11, width: "95%", marginBottom: 8 }} />
                  <div className="skel" style={{ height: 11, width: "75%" }} />
                </div>
              ))}

              {step === "done" && !loading && (
                <button className="btn-reset" onClick={reset}>← Analyze another image</button>
              )}
            </div>
          )}

          {error && <div className="error-box">⚠️ {error}</div>}
        </div>

        {/* ── RIGHT PANEL ── */}
        <div className="right">
          <div className="panel-title">
            <div className="panel-dot" />
            Agent Activity
          </div>

          {!loading && toolEvents.length === 0 && (
            <div className="idle-right">
              <div className="idle-right-icon">🤖</div>
              <div className="idle-right-text">
                The agent will classify your image first, then run an adaptive analysis matched to its type.
              </div>
            </div>
          )}

          {(loading || toolEvents.length > 0) && (
            <>
              {/* Classification card */}
              {classification && (
                <div className="class-card">
                  <div className="class-card-type">{classification.icon} {classification.label}</div>
                  <div className="class-card-reason">{classification.reasoning}</div>
                </div>
              )}

              {/* Tool timeline */}
              <div className="tl-wrap">
                {toolEvents.map((te, i) => {
                  const color = TOOL_META[te.tool]?.color || "#888";
                  const isLast = i === toolEvents.length - 1;
                  return (
                    <div className="tl-item" key={i} style={{ "--tool-color": color } as React.CSSProperties}>
                      <div className="tl-col">
                        <div className={`tl-dot ${te.status}`}>
                          {te.status === "running"
                            ? <div className="spinner" style={{ width: 10, height: 10 }} />
                            : te.tool === "classify_image" ? "🔍" : "🧠"}
                        </div>
                        {!isLast && <div className="tl-line" />}
                      </div>
                      <div className="tl-body">
                        <div className="tl-name">{te.label}</div>
                        {te.result && (
                          <div className="tl-result">
                            {te.tool === "classify_image" && (
                              <><b>{te.result.label as string}</b> · {Math.round((te.result.confidence as number) * 100)}% confidence</>
                            )}
                            {te.tool === "analyze_adaptive" && (
                              <><b>{te.result.fields_populated as number}</b> / {te.result.total_fields as number} fields populated</>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {loading && toolEvents.length === 0 && (
                  <div className="tl-item">
                    <div className="tl-col">
                      <div className="tl-dot running"><div className="spinner" style={{ width: 10, height: 10 }} /></div>
                    </div>
                    <div className="tl-body">
                      <div className="tl-name" style={{ color: accentColor }}>Initializing agent…</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Stats */}
              {step === "done" && !loading && (
                <div className="stats">
                  <div className="stat"><b>{toolEvents.length}</b> tools</div>
                  <div className="stat"><b>{fields.length}</b> fields</div>
                  {classification && <div className="stat"><b>{classification.icon}</b> {classification.type}</div>}
                  <div className="stat done">✓ Complete</div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
