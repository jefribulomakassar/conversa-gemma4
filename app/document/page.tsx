"use client";

import { useState, useRef, useEffect } from "react";

// ── Types ────────────────────────────────────────────────────────────────────
type Section = { heading: string; content: string };
type StreamStep =
  | "idle"
  | "reading"
  | "planning"
  | "extracting"
  | "analyzing"
  | "generating"
  | "reviewing"
  | "finalizing"
  | "done";

type ToolEvent = {
  tool: string;
  iteration: number;
  thinking?: string;
  result?: Record<string, unknown>;
  status: "running" | "done" | "error";
};

type AgentMeta = {
  briefType: string;
  title: string;
  agent_iterations?: number;
  agent_summary?: string;
};

// ── Constants ─────────────────────────────────────────────────────────────────
const BRIEF_TYPES = [
  { id: "meeting",   label: "Meeting Brief",     icon: "🗓️",  desc: "Agenda, discussion points, critical questions" },
  { id: "kickoff",   label: "Project Kickoff",   icon: "🚀",  desc: "Goals, scope, roles, milestones" },
  { id: "proposal",  label: "Client Proposal",   icon: "💼",  desc: "Executive summary, pricing overview" },
  { id: "interview", label: "Interview Prep",    icon: "🎯",  desc: "Questions, scorecard, red flags" },
  { id: "sop",       label: "SOP Generator",     icon: "📋",  desc: "Step-by-step procedures and checkpoints" },
];

const TOOL_META: Record<string, { label: string; icon: string; color: string }> = {
  extract_document_structure: { label: "Extract Structure",    icon: "🔍", color: "#4FC3F7" },
  analyze_content_deep:       { label: "Deep Content Analysis", icon: "🧠", color: "#CE93D8" },
  generate_brief_sections:    { label: "Generate Sections",    icon: "✍️", color: "#A5D6A7" },
  self_review_and_refine:     { label: "Self-Review & Refine", icon: "🔄", color: "#FFB74D" },
  finalize_brief:             { label: "Finalize Brief",       icon: "✅", color: "#80CBC4" },
};

const STEP_LABELS: Record<string, string> = {
  reading:    "Reading document…",
  planning:   "Agent planning strategy…",
  extracting: "Extracting document structure…",
  analyzing:  "Deep content analysis…",
  generating: "Generating brief sections…",
  reviewing:  "Self-reviewing quality…",
  finalizing: "Finalizing brief…",
  done:       "Complete.",
};

const MAX_PDF_SIZE = 20 * 1024 * 1024;

// ── PDF/DOCX helpers (same as original) ──────────────────────────────────────
async function compressPDF(file: File): Promise<File> {
  const pdfjsLib = (window as any).pdfjsLib;
  const { jsPDF } = (window as any).jspdf;
  if (!pdfjsLib || !jsPDF) throw new Error("PDF libraries not loaded.");
  const arrayBuffer = await file.arrayBuffer();
  const typedArray = new Uint8Array(arrayBuffer);
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const pdfDoc = await pdfjsLib.getDocument({ data: typedArray }).promise;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    if (i > 1) doc.addPage();
    const page = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale: 1.2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
    doc.addImage(canvas.toDataURL("image/jpeg", 0.7), "JPEG", 0, 0, 210, 297);
  }
  const blob = doc.output("blob");
  return new File([blob], file.name.replace(/\.[^.]+$/, "_compressed.pdf"), { type: "application/pdf" });
}

async function convertDocxToPDF(file: File): Promise<File> {
  const mammoth = (window as any).mammoth;
  const { jsPDF } = (window as any).jspdf;
  if (!mammoth || !jsPDF) throw new Error("Conversion libraries not loaded.");
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  const text: string = result.value || "";
  if (!text.trim()) throw new Error("No text could be extracted from the Word document.");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const margin = 15;
  let y = margin;
  doc.setFontSize(11);
  const lines = doc.splitTextToSize(text, 210 - margin * 2) as string[];
  for (const line of lines) {
    if (y + 6 > 297 - margin) { doc.addPage(); y = margin; }
    doc.text(line, margin, y);
    y += 6;
  }
  const blob = doc.output("blob");
  return new File([blob], file.name.replace(/\.[^.]+$/, "_converted.pdf"), { type: "application/pdf" });
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function DocumentPage() {
  const [file, setFile]               = useState<File | null>(null);
  const [briefType, setBriefType]     = useState("meeting");
  const [dragging, setDragging]       = useState(false);
  const [loading, setLoading]         = useState(false);
  const [step, setStep]               = useState<StreamStep>("idle");
  const [stepLabel, setStepLabel]     = useState("");
  const [meta, setMeta]               = useState<AgentMeta | null>(null);
  const [sections, setSections]       = useState<Section[]>([]);
  const [toolEvents, setToolEvents]   = useState<ToolEvent[]>([]);
  const [error, setError]             = useState<string | null>(null);
  const [processing, setProcessing]   = useState<"compressing" | "converting" | null>(null);
  const [iteration, setIteration]     = useState(0);
  const [agentThinking, setAgentThinking] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  const hasResult = meta !== null || sections.length > 0;
  const isDocx = (f: File) => /\.(docx|doc)$/i.test(f.name) ||
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword"].includes(f.type);
  const isPdf  = (f: File) => f.type === "application/pdf" || f.name.endsWith(".pdf");

  const handleFile = (f: File) => {
    if (!isPdf(f) && !isDocx(f)) { setError("Format tidak didukung. Gunakan PDF, DOCX, atau DOC."); return; }
    setError(null); setMeta(null); setSections([]); setToolEvents([]); setFile(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  };

  // Auto-scroll timeline
  useEffect(() => {
    if (timelineRef.current) {
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
    }
  }, [toolEvents, agentThinking]);

  const handleSubmit = async () => {
    if (!file) return;
    setLoading(true);
    setStep("idle");
    setError(null);
    setMeta(null);
    setSections([]);
    setToolEvents([]);
    setIteration(0);
    setAgentThinking("");

    try {
      let uploadFile = file;
      if (isDocx(file)) {
        setProcessing("converting");
        try { uploadFile = await convertDocxToPDF(file); }
        catch (e) { throw new Error(e instanceof Error ? e.message : "Gagal konversi Word."); }
        finally { setProcessing(null); }
      }
      if (uploadFile.size > MAX_PDF_SIZE) {
        setProcessing("compressing");
        try { uploadFile = await compressPDF(uploadFile); }
        catch { throw new Error("Gagal kompres PDF. Coba file lebih kecil."); }
        finally { setProcessing(null); }
        if (uploadFile.size > MAX_PDF_SIZE) throw new Error("File masih terlalu besar setelah kompresi.");
      }

      const form = new FormData();
      form.append("file", uploadFile);
      form.append("briefType", briefType);

      const res = await fetch("/api/document", { method: "POST", body: form });
      if (!res.ok || !res.body) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error || "Gagal memproses dokumen.");
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
          const eventMatch = raw.match(/^event: (\w+)/m);
          const dataMatch  = raw.match(/^data: (.+)/m);
          if (!eventMatch || !dataMatch) continue;

          const eventName = eventMatch[1];
          let payload: Record<string, unknown>;
          try { payload = JSON.parse(dataMatch[1]); } catch { continue; }

          switch (eventName) {
            case "status":
              setStep(payload.step as StreamStep);
              setStepLabel((payload.label as string) || STEP_LABELS[payload.step as string] || "");
              break;

            case "agent_thinking":
              setIteration(payload.iteration as number);
              setAgentThinking(payload.label as string);
              break;

            case "tool_call":
              setToolEvents(prev => [...prev, {
                tool: payload.tool as string,
                iteration: payload.iteration as number,
                thinking: payload.thinking as string,
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

            case "meta":
              setMeta({
                briefType: payload.briefType as string,
                title: payload.title as string,
                agent_iterations: payload.agent_iterations as number,
                agent_summary: payload.agent_summary as string,
              });
              break;

            case "section":
            case "section_draft":
              setSections(prev => {
                const idx = payload.index as number;
                const updated = [...prev];
                updated[idx] = { heading: payload.heading as string, content: payload.content as string };
                return updated;
              });
              break;

            case "done":
              setStep("done");
              setAgentThinking("");
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
      setProcessing(null);
    }
  };

  const reset = () => {
    setFile(null); setMeta(null); setSections([]); setToolEvents([]);
    setError(null); setStep("idle"); setIteration(0); setAgentThinking("");
  };

  const selectedBrief = BRIEF_TYPES.find(b => b.id === briefType);
  const fileSizeMB    = file ? (file.size / 1024 / 1024).toFixed(1) : null;

  return (
    <>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js" />
      <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js" />
      <script src="https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js" />

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;1,9..40,300&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html { scroll-behavior: smooth; }
        body { background: #07080A; color: #E8EAF0; font-family: 'DM Sans', sans-serif; min-height: 100vh; }

        /* Ambient bg */
        .bg-orb-1 { position: fixed; width: 600px; height: 600px; border-radius: 50%;
          filter: blur(160px); pointer-events: none; z-index: 0;
          background: #F7A84F12; bottom: -150px; right: -120px; }
        .bg-orb-2 { position: fixed; width: 400px; height: 400px; border-radius: 50%;
          filter: blur(120px); pointer-events: none; z-index: 0;
          background: #4FC3F708; top: -80px; left: -60px; }
        .noise-overlay { position: fixed; inset: 0; z-index: 0; pointer-events: none; opacity: 0.03;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }

        .layout { position: relative; z-index: 1; display: grid;
          grid-template-columns: 1fr 380px; min-height: 100vh;
          max-width: 1200px; margin: 0 auto; gap: 0; }

        /* LEFT PANEL */
        .left-panel { padding: 48px 40px 80px; border-right: 1px solid #131620; }

        .back-link { display: inline-flex; align-items: center; gap: 8px; color: #3B4155;
          font-size: 13px; text-decoration: none; margin-bottom: 40px;
          transition: color 0.2s; letter-spacing: 0.03em; }
        .back-link:hover { color: #F7A84F; }
        .back-link svg { width: 14px; height: 14px; }

        /* Header */
        .agent-badge { display: inline-flex; align-items: center; gap: 8px;
          background: #F7A84F0D; border: 1px solid #F7A84F22;
          border-radius: 100px; padding: 5px 12px; margin-bottom: 16px; }
        .agent-badge-dot { width: 6px; height: 6px; border-radius: 50%; background: #F7A84F;
          box-shadow: 0 0 8px #F7A84F; animation: pulse 2s ease-in-out infinite; }
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.8)} }
        .agent-badge-text { font-size: 11px; font-weight: 600; letter-spacing: 0.1em;
          text-transform: uppercase; color: #F7A84F; }

        h1 { font-family: 'Syne', sans-serif; font-size: clamp(26px, 4vw, 38px);
          font-weight: 800; letter-spacing: -0.03em; color: #F0F2F8; line-height: 1.1;
          margin-bottom: 10px; }
        .subtitle { font-size: 14px; font-weight: 300; color: #5A6175; line-height: 1.7;
          max-width: 480px; margin-bottom: 36px; }

        /* Section label */
        .s-label { font-family: 'Syne', sans-serif; font-size: 10px; font-weight: 700;
          letter-spacing: 0.12em; text-transform: uppercase; color: #2E3350;
          margin-bottom: 10px; margin-top: 28px; }

        /* Brief type grid */
        .brief-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; }
        .brief-card { background: #0C0E13; border: 1px solid #181C28;
          border-radius: 11px; padding: 13px; cursor: pointer;
          transition: border-color 0.2s, background 0.2s, transform 0.15s;
          text-align: left; }
        .brief-card:hover { border-color: #2A2F45; transform: translateY(-1px); }
        .brief-card.active { border-color: #F7A84F55; background: #F7A84F08; }
        .brief-card-icon  { font-size: 20px; margin-bottom: 8px; display: block; }
        .brief-card-label { font-family: 'Syne', sans-serif; font-size: 12px; font-weight: 700;
          color: #B0B8D0; margin-bottom: 3px; }
        .brief-card-desc  { font-size: 11px; color: #3B4155; line-height: 1.5; }
        .brief-card.active .brief-card-label { color: #F7A84F; }

        /* Dropzone */
        .dropzone { border: 1.5px dashed #181C28; border-radius: 16px; padding: 36px 28px;
          text-align: center; cursor: pointer; transition: border-color 0.2s, background 0.2s;
          background: #0C0E13; position: relative; }
        .dropzone.drag { border-color: #F7A84F; background: #F7A84F06; }
        .dropzone.has-file { border-style: solid; border-color: #F7A84F44; }
        .dz-icon  { font-size: 32px; margin-bottom: 12px; display: block;
          filter: drop-shadow(0 0 12px #F7A84F55); }
        .dz-title { font-family: 'Syne', sans-serif; font-size: 15px; font-weight: 600;
          color: #C0C8E0; margin-bottom: 5px; }
        .dz-sub   { font-size: 12px; color: #3B4155; }
        .dz-sub span { color: #F7A84F; }
        .file-chip { display: inline-flex; align-items: center; gap: 8px;
          background: #10131A; border: 1px solid #F7A84F2A; border-radius: 100px;
          padding: 6px 14px; font-size: 12px; color: #9098B0; margin-top: 14px; }
        .file-chip-remove { background: none; border: none; cursor: pointer;
          color: #3B4155; font-size: 15px; line-height: 1; padding: 0;
          transition: color 0.2s; }
        .file-chip-remove:hover { color: #FF6B6B; }

        .info-badge { display: inline-flex; align-items: center; gap: 6px;
          border-radius: 100px; padding: 5px 12px; font-size: 11px; margin-top: 8px; }
        .info-badge.compress { background: #1A1200; border: 1px solid #EF9F2722; color: #EF9F27; }
        .info-badge.convert  { background: #091420; border: 1px solid #378ADD22; color: #378ADD; }

        /* CTA button */
        .btn-primary { width: 100%; margin-top: 18px; padding: 15px;
          background: linear-gradient(135deg, #F7A84F, #E8952A);
          color: #07080A; border: none; border-radius: 12px;
          font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 800;
          letter-spacing: 0.03em; cursor: pointer;
          transition: opacity 0.2s, transform 0.15s, box-shadow 0.2s;
          box-shadow: 0 4px 20px #F7A84F22; }
        .btn-primary:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); box-shadow: 0 6px 28px #F7A84F33; }
        .btn-primary:disabled { opacity: 0.25; cursor: not-allowed; box-shadow: none; }

        .error-box { background: #180D0D; border: 1px solid #FF6B6B22; border-radius: 11px;
          padding: 12px 16px; font-size: 13px; color: #FF8080; margin-top: 14px; }

        /* Status bar */
        .status-bar { display: flex; align-items: center; gap: 10px; padding: 10px 14px;
          background: #0C0E13; border: 1px solid #181C28; border-radius: 10px;
          margin-top: 16px; font-size: 12px; color: #5A6175; }
        .spinner { width: 13px; height: 13px; border-radius: 50%;
          border: 2px solid #181C28; border-top-color: #F7A84F;
          animation: spin 0.7s linear infinite; flex-shrink: 0; }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* Results */
        .results { margin-top: 36px; }
        .result-header { margin-bottom: 20px; animation: fadeUp 0.35s ease both; }
        .result-type-badge { display: inline-flex; align-items: center; gap: 6px;
          background: #F7A84F0D; border: 1px solid #F7A84F22; border-radius: 100px;
          padding: 5px 12px; font-size: 11px; font-weight: 600; color: #F7A84F;
          letter-spacing: 0.07em; text-transform: uppercase; margin-bottom: 8px; }
        .result-title { font-family: 'Syne', sans-serif; font-size: 20px; font-weight: 800;
          color: #F0F2F8; letter-spacing: -0.02em; margin-bottom: 8px; }
        .agent-summary { font-size: 13px; color: #4A5270; font-style: italic; line-height: 1.6;
          padding: 10px 14px; background: #0C0E13; border-left: 2px solid #F7A84F33;
          border-radius: 0 8px 8px 0; margin-bottom: 16px; }

        .sections-list { display: flex; flex-direction: column; gap: 14px; }
        .section-card { background: #0C0E13; border: 1px solid #181C28; border-radius: 14px;
          overflow: hidden; animation: fadeUp 0.35s ease both; }
        @keyframes fadeUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        .section-card-head { padding: 13px 20px; border-bottom: 1px solid #131620; }
        .section-card-title { font-family: 'Syne', sans-serif; font-size: 11px; font-weight: 700;
          letter-spacing: 0.08em; text-transform: uppercase; color: #F7A84F; }
        .section-card-body  { padding: 16px 20px; font-size: 13px; line-height: 1.85;
          color: #9098B0; font-weight: 300; white-space: pre-wrap; }

        /* Skeleton */
        .skel { background: linear-gradient(90deg, #181C28 25%, #1F2436 50%, #181C28 75%);
          background-size: 200% 100%; animation: shimmer 1.5s ease-in-out infinite; border-radius: 6px; }
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }

        .btn-reset { margin-top: 24px; width: 100%; padding: 12px;
          background: transparent; border: 1px solid #181C28; border-radius: 12px;
          font-family: 'DM Sans', sans-serif; font-size: 13px; color: #3B4155;
          cursor: pointer; transition: border-color 0.2s, color 0.2s; }
        .btn-reset:hover { border-color: #F7A84F55; color: #F7A84F; }

        /* RIGHT PANEL — Agent Timeline */
        .right-panel { padding: 48px 28px 80px; position: sticky; top: 0;
          height: 100vh; overflow: hidden; display: flex; flex-direction: column; }

        .panel-title { font-family: 'Syne', sans-serif; font-size: 11px; font-weight: 700;
          letter-spacing: 0.12em; text-transform: uppercase; color: #2E3350;
          margin-bottom: 20px; display: flex; align-items: center; gap: 8px; }
        .panel-title-dot { width: 5px; height: 5px; border-radius: 50%; background: #F7A84F;
          opacity: 0.5; }

        /* Idle state for right panel */
        .idle-panel { flex: 1; display: flex; flex-direction: column;
          align-items: center; justify-content: center; text-align: center;
          padding: 32px 16px; }
        .idle-icon { font-size: 40px; margin-bottom: 16px; opacity: 0.3; }
        .idle-text { font-size: 13px; color: #2E3350; line-height: 1.7; max-width: 240px; }

        /* Iteration counter */
        .iter-counter { display: flex; align-items: center; gap: 10px;
          padding: 10px 14px; background: #0C0E13; border: 1px solid #181C28;
          border-radius: 10px; margin-bottom: 16px; }
        .iter-num { font-family: 'Syne', sans-serif; font-size: 22px; font-weight: 800;
          color: #F7A84F; min-width: 32px; }
        .iter-label { font-size: 12px; color: #3B4155; line-height: 1.4; }

        /* Agent thinking bubble */
        .thinking-bubble { padding: 10px 14px; background: #0C0E13;
          border: 1px solid #181C28; border-radius: 10px; margin-bottom: 14px;
          font-size: 12px; color: #4A5270; font-style: italic; line-height: 1.5;
          display: flex; align-items: flex-start; gap: 8px; }
        .thinking-dots { display: flex; gap: 3px; flex-shrink: 0; padding-top: 3px; }
        .thinking-dots span { width: 5px; height: 5px; border-radius: 50%; background: #F7A84F;
          animation: tdot 1.2s ease-in-out infinite; }
        .thinking-dots span:nth-child(2) { animation-delay: 0.15s; }
        .thinking-dots span:nth-child(3) { animation-delay: 0.3s; }
        @keyframes tdot { 0%,100%{opacity:0.2;transform:scale(0.8)} 50%{opacity:1;transform:scale(1.2)} }

        /* Tool timeline */
        .timeline { flex: 1; overflow-y: auto; padding-right: 4px; }
        .timeline::-webkit-scrollbar { width: 4px; }
        .timeline::-webkit-scrollbar-track { background: transparent; }
        .timeline::-webkit-scrollbar-thumb { background: #181C28; border-radius: 4px; }

        .tl-item { display: flex; gap: 12px; margin-bottom: 14px;
          animation: fadeUp 0.3s ease both; }
        .tl-line { display: flex; flex-direction: column; align-items: center; }
        .tl-dot { width: 28px; height: 28px; border-radius: 50%; border: 1.5px solid #181C28;
          display: flex; align-items: center; justify-content: center; font-size: 13px;
          flex-shrink: 0; background: #0C0E13; transition: border-color 0.3s; }
        .tl-dot.running { border-color: #F7A84F55; animation: ring 1.5s ease-in-out infinite; }
        .tl-dot.done { border-color: #4CAF5055; background: #4CAF5008; }
        @keyframes ring { 0%,100%{box-shadow:0 0 0 0 #F7A84F33} 50%{box-shadow:0 0 0 6px #F7A84F00} }
        .tl-connector { width: 1px; background: #181C28; flex: 1; min-height: 16px; margin-top: 4px; }

        .tl-content { flex: 1; padding-bottom: 4px; }
        .tl-tool-name { font-family: 'Syne', sans-serif; font-size: 11px; font-weight: 700;
          letter-spacing: 0.05em; margin-bottom: 4px; }
        .tl-thinking { font-size: 11px; color: #3B4155; line-height: 1.5;
          font-style: italic; margin-bottom: 4px; }
        .tl-result { font-size: 11px; color: #2E3350; line-height: 1.5; }
        .tl-result span { color: #4CAF50; font-weight: 500; }

        /* Stats chips at bottom */
        .stats-row { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
        .stat-chip { padding: 5px 10px; background: #0C0E13; border: 1px solid #181C28;
          border-radius: 100px; font-size: 11px; color: #3B4155; white-space: nowrap; }
        .stat-chip b { color: #F7A84F; font-weight: 600; }

        @media (max-width: 900px) {
          .layout { grid-template-columns: 1fr; }
          .right-panel { position: relative; height: auto; border-top: 1px solid #131620;
            padding: 32px 24px 48px; }
          .timeline { max-height: 400px; }
        }
        @media (max-width: 600px) {
          .left-panel { padding: 32px 20px 60px; }
          .brief-grid  { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>

      <div className="bg-orb-1" />
      <div className="bg-orb-2" />
      <div className="noise-overlay" />

      <div className="layout">
        {/* ── LEFT PANEL ── */}
        <div className="left-panel">
          <a href="/" className="back-link">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 3L5 8l5 5"/>
            </svg>
            Back to Agents
          </a>

          <div className="agent-badge">
            <div className="agent-badge-dot" />
            <span className="agent-badge-text">AI Agent · Multi-Step Reasoning</span>
          </div>

          <h1>Document<br />Analysis Agent</h1>
          <p className="subtitle">
            True agentic pipeline: the agent plans, uses tools, deep-analyzes your document, 
            self-reviews its output, then finalizes — all autonomously with Gemma 4's 256K context.
          </p>

          {!hasResult && (
            <>
              <div className="s-label">01 — Choose brief type</div>
              <div className="brief-grid">
                {BRIEF_TYPES.map(b => (
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

              <div className="s-label">02 — Upload document</div>
              <div
                className={`dropzone${dragging ? " drag" : ""}${file ? " has-file" : ""}`}
                onClick={() => inputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
              >
                <span className="dz-icon">📄</span>
                <div className="dz-title">{file ? "File selected" : "Drop your document here"}</div>
                <div className="dz-sub">or <span>browse</span> · PDF, DOCX, DOC · max 20MB</div>
                {file && (
                  <div className="file-chip" onClick={e => e.stopPropagation()}>
                    📄 {file.name} · {fileSizeMB} MB
                    <button className="file-chip-remove" onClick={e => { e.stopPropagation(); reset(); }}>×</button>
                  </div>
                )}
                {file && isPdf(file) && file.size > MAX_PDF_SIZE && (
                  <div className="info-badge compress" onClick={e => e.stopPropagation()}>
                    ⚡ PDF &gt;20MB — akan dikompres otomatis
                  </div>
                )}
                {file && isDocx(file) && (
                  <div className="info-badge convert" onClick={e => e.stopPropagation()}>
                    🔄 Word document — akan dikonversi ke PDF
                  </div>
                )}
                <input
                  ref={inputRef} type="file"
                  accept=".pdf,.docx,.doc"
                  style={{ display: "none" }}
                  onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
                />
              </div>

              {error && <div className="error-box">⚠️ {error}</div>}

              <button className="btn-primary" disabled={!file || loading} onClick={handleSubmit}>
                {loading
                  ? "Agent is working…"
                  : `Run Agent · ${selectedBrief?.label} →`}
              </button>
            </>
          )}

          {/* Processing / status */}
          {(processing || (loading && step !== "idle")) && (
            <div className="status-bar">
              <div className="spinner" />
              {processing === "converting" ? "Converting Word document to PDF…"
               : processing === "compressing" ? "Compressing PDF pages…"
               : stepLabel || STEP_LABELS[step] || "Processing…"}
            </div>
          )}

          {/* Results */}
          {hasResult && (
            <div className="results">
              {meta ? (
                <div className="result-header">
                  <div className="result-type-badge">
                    {selectedBrief?.icon} {meta.briefType}
                    {meta.agent_iterations && ` · ${meta.agent_iterations} iterations`}
                  </div>
                  <div className="result-title">{meta.title}</div>
                  {meta.agent_summary && (
                    <div className="agent-summary">🤖 {meta.agent_summary}</div>
                  )}
                </div>
              ) : loading ? (
                <div className="result-header">
                  <div className="skel" style={{ height: 20, width: 120, borderRadius: 100, marginBottom: 10 }} />
                  <div className="skel" style={{ height: 26, width: "65%", marginBottom: 8 }} />
                </div>
              ) : null}

              <div className="sections-list">
                {sections.filter(Boolean).map((s, i) => (
                  <div className="section-card" key={i} style={{ animationDelay: `${i * 35}ms` }}>
                    <div className="section-card-head">
                      <div className="section-card-title">{s.heading}</div>
                    </div>
                    <div className="section-card-body">{s.content}</div>
                  </div>
                ))}
                {loading && sections.length < 5 && Array.from({ length: 5 - sections.length }).map((_, i) => (
                  <div key={`sk-${i}`} style={{ background: "#0C0E13", border: "1px solid #181C28", borderRadius: 14, padding: "16px 20px" }}>
                    <div className="skel" style={{ height: 12, width: "35%", marginBottom: 14 }} />
                    <div className="skel" style={{ height: 11, marginBottom: 8 }} />
                    <div className="skel" style={{ height: 11, width: "88%", marginBottom: 8 }} />
                    <div className="skel" style={{ height: 11, width: "60%" }} />
                  </div>
                ))}
              </div>

              {step === "done" && !loading && (
                <button className="btn-reset" onClick={reset}>← Analyze another document</button>
              )}
            </div>
          )}

          {error && hasResult && (
            <div className="error-box" style={{ marginTop: 14 }}>⚠️ {error}</div>
          )}
        </div>

        {/* ── RIGHT PANEL — Agent Timeline ── */}
        <div className="right-panel">
          <div className="panel-title">
            <div className="panel-title-dot" />
            Agent Activity
          </div>

          {/* Idle state */}
          {!loading && toolEvents.length === 0 && (
            <div className="idle-panel">
              <div className="idle-icon">🤖</div>
              <div className="idle-text">
                The agent activity timeline will appear here once you run the analysis.
                <br /><br />
                You'll see each tool call, reasoning, and result in real time.
              </div>
            </div>
          )}

          {/* Iteration counter */}
          {(loading || toolEvents.length > 0) && (
            <>
              {loading && (
                <div className="iter-counter">
                  <div className="iter-num">{iteration}</div>
                  <div className="iter-label">
                    Agent iteration<br />
                    <span style={{ color: "#F7A84F" }}>max 5</span>
                  </div>
                  <div className="spinner" style={{ marginLeft: "auto" }} />
                </div>
              )}

              {/* Thinking bubble */}
              {loading && agentThinking && (
                <div className="thinking-bubble">
                  <div className="thinking-dots">
                    <span /><span /><span />
                  </div>
                  <span>{agentThinking}</span>
                </div>
              )}

              {/* Tool timeline */}
              <div className="timeline" ref={timelineRef}>
                {toolEvents.map((te, i) => {
                  const tm = TOOL_META[te.tool] || { label: te.tool, icon: "🔧", color: "#888" };
                  const isLast = i === toolEvents.length - 1;
                  return (
                    <div className="tl-item" key={i}>
                      <div className="tl-line">
                        <div className={`tl-dot ${te.status}`} style={{ borderColor: te.status === "done" ? tm.color + "55" : undefined }}>
                          {te.status === "running" ? <div className="spinner" style={{ width: 10, height: 10 }} /> : tm.icon}
                        </div>
                        {!isLast && <div className="tl-connector" />}
                      </div>
                      <div className="tl-content">
                        <div className="tl-tool-name" style={{ color: tm.color }}>{tm.label}</div>
                        {te.thinking && (
                          <div className="tl-thinking">"{te.thinking.slice(0, 120)}{te.thinking.length > 120 ? "…" : ""}"</div>
                        )}
                        {te.result && (
                          <div className="tl-result">
                            {te.tool === "extract_document_structure" && (te.result.document_type as string) && (
                              <><span>Type:</span> {te.result.document_type as string}</>
                            )}
                            {te.tool === "analyze_content_deep" && Array.isArray(te.result.key_findings) && (
                              <><span>{(te.result.key_findings as string[]).length}</span> findings extracted</>
                            )}
                            {te.tool === "generate_brief_sections" && (
                              <><span>{te.result.sections_count as number}</span> sections drafted</>
                            )}
                            {te.tool === "self_review_and_refine" && (
                              <><span>Quality:</span> {te.result.quality_score as number}/10 — {te.result.status as string}</>
                            )}
                            {te.tool === "finalize_brief" && (
                              <span>Brief finalized ✓</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Running placeholder */}
                {loading && toolEvents.length === 0 && (
                  <div className="tl-item">
                    <div className="tl-line">
                      <div className="tl-dot running">
                        <div className="spinner" style={{ width: 10, height: 10 }} />
                      </div>
                    </div>
                    <div className="tl-content">
                      <div className="tl-tool-name" style={{ color: "#F7A84F" }}>Initializing agent…</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Stats */}
              {step === "done" && !loading && (
                <div className="stats-row">
                  <div className="stat-chip"><b>{toolEvents.length}</b> tool calls</div>
                  <div className="stat-chip"><b>{iteration}</b> iterations</div>
                  <div className="stat-chip"><b>{sections.length}</b> sections</div>
                  <div className="stat-chip" style={{ color: "#4CAF50", borderColor: "#4CAF5022" }}>✓ Agent complete</div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
