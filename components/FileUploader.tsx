"use client";

import { useRef, useState } from "react";

type AcceptType = "audio" | "image" | "pdf";

interface FileUploaderProps {
  accept: AcceptType;
  onFile: (file: File) => void;
  onError: (msg: string) => void;
  file: File | null;
  onReset: () => void;
  preview?: string | null;
  accent?: string;
}

const CONFIG: Record<AcceptType, { mime: string[]; ext: string; label: string; icon: string; hint: string }> = {
  audio: {
    mime: ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/m4a", "audio/x-m4a"],
    ext: ".mp3,.wav,.m4a,audio/*",
    label: "Drop your recording here",
    icon: "🎙️",
    hint: "MP3 · WAV · M4A",
  },
  image: {
    mime: ["image/jpeg", "image/png", "image/webp"],
    ext: ".jpg,.jpeg,.png,.webp,image/*",
    label: "Drop your image here",
    icon: "🖼️",
    hint: "JPG · PNG · WEBP",
  },
  pdf: {
    mime: ["application/pdf"],
    ext: ".pdf,application/pdf",
    label: "Drop your PDF here",
    icon: "📄",
    hint: "PDF only · max 20MB",
  },
};

const MAX_SIZE: Record<AcceptType, number> = {
  audio: 20 * 1024 * 1024,
  image: 10 * 1024 * 1024,
  pdf: 20 * 1024 * 1024,
};

export default function FileUploader({
  accept,
  onFile,
  onError,
  file,
  onReset,
  preview,
  accent = "#00C9A7",
}: FileUploaderProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cfg = CONFIG[accept];

  const validate = (f: File): boolean => {
    const extMatch = f.name.match(/\.(mp3|wav|m4a|jpg|jpeg|png|webp|pdf)$/i);
    if (!cfg.mime.includes(f.type) && !extMatch) {
      onError(`Format tidak didukung. Gunakan ${cfg.hint}.`);
      return false;
    }
    if (f.size > MAX_SIZE[accept]) {
      onError(`File terlalu besar. Maksimal ${MAX_SIZE[accept] / 1024 / 1024}MB.`);
      return false;
    }
    return true;
  };

  const handle = (f: File) => {
    if (validate(f)) onFile(f);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files[0]) handle(e.dataTransfer.files[0]);
  };

  return (
    <>
      <style>{`
        .fu-zone {
          border: 1.5px dashed #1E2230;
          border-radius: 18px;
          padding: 44px 32px;
          text-align: center;
          cursor: pointer;
          background: #0D0F14;
          transition: border-color 0.2s, background 0.2s;
          position: relative;
        }
        .fu-zone.fu-drag {
          border-color: var(--fu-accent);
          background: color-mix(in srgb, var(--fu-accent) 5%, transparent);
        }
        .fu-zone.fu-has {
          border-style: solid;
          border-color: color-mix(in srgb, var(--fu-accent) 40%, transparent);
        }
        .fu-icon {
          font-size: 38px;
          display: block;
          margin-bottom: 14px;
          filter: drop-shadow(0 0 14px color-mix(in srgb, var(--fu-accent) 60%, transparent));
        }
        .fu-label {
          font-family: 'Syne', sans-serif;
          font-size: 16px;
          font-weight: 600;
          color: #C8CCE0;
          margin-bottom: 6px;
        }
        .fu-hint {
          font-size: 13px;
          color: #4B5470;
        }
        .fu-hint span {
          color: var(--fu-accent);
          font-weight: 500;
        }
        .fu-chip {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          background: #111420;
          border: 1px solid color-mix(in srgb, var(--fu-accent) 25%, transparent);
          border-radius: 100px;
          padding: 8px 16px;
          font-size: 13px;
          color: #A8B0CC;
          margin-top: 16px;
        }
        .fu-chip-remove {
          background: none;
          border: none;
          cursor: pointer;
          color: #4B5470;
          font-size: 16px;
          line-height: 1;
          padding: 0;
          transition: color 0.2s;
        }
        .fu-chip-remove:hover { color: #FF6B6B; }
        .fu-preview {
          position: relative;
        }
        .fu-preview-img {
          width: 100%;
          max-height: 280px;
          object-fit: contain;
          border-radius: 10px;
          display: block;
        }
        .fu-preview-badge {
          position: absolute;
          top: 10px; right: 10px;
          background: #07080Acc;
          border: 1px solid color-mix(in srgb, var(--fu-accent) 25%, transparent);
          border-radius: 100px;
          padding: 5px 12px;
          font-size: 12px;
          color: var(--fu-accent);
          font-weight: 500;
          backdrop-filter: blur(8px);
        }
        .fu-reset {
          display: block;
          margin-top: 10px;
          font-size: 12px;
          color: #4B5470;
          text-align: center;
          background: none;
          border: none;
          cursor: pointer;
          padding: 0;
          transition: color 0.2s;
          width: 100%;
        }
        .fu-reset:hover { color: var(--fu-accent); }
      `}</style>

      <div
        className={`fu-zone${dragging ? " fu-drag" : ""}${file ? " fu-has" : ""}`}
        style={{ "--fu-accent": accent } as React.CSSProperties}
        onClick={() => !preview && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {!file ? (
          <>
            <span className="fu-icon">{cfg.icon}</span>
            <div className="fu-label">{cfg.label}</div>
            <div className="fu-hint">or <span>browse</span> · {cfg.hint}</div>
          </>
        ) : preview ? (
          <div className="fu-preview" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Preview" className="fu-preview-img" />
            <div className="fu-preview-badge">✓ Ready</div>
          </div>
        ) : (
          <div className="fu-chip" onClick={(e) => e.stopPropagation()}>
            {cfg.icon} {file.name}
            <button className="fu-chip-remove" onClick={onReset}>×</button>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={cfg.ext}
          style={{ display: "none" }}
          onChange={(e) => e.target.files?.[0] && handle(e.target.files[0])}
        />
      </div>

      {file && preview && (
        <button className="fu-reset" style={{ "--fu-accent": accent } as React.CSSProperties} onClick={onReset}>
          Remove and re-upload
        </button>
      )}
    </>
  );
}
