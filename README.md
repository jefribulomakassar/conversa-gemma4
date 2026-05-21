# Conversa Gemma4

**Enterprise Meeting Intelligence** — powered by Gemma 4

> Submission for the [Gemma 4 Challenge](https://dev.to/challenges/google-gemma-2026-05-06) on DEV.to  
> Built with Next.js · TypeScript · Gemma 4 via Google AI Studio

---

## What I Built

Conversa Gemma4 is an enterprise-grade AI agent that transforms how teams capture and process meeting intelligence. Users can upload a **voice recording**, a **whiteboard photo**, or a **PDF document** — individually or all at once — and the agent produces a structured, professional output in seconds.

Gemma 4 is the core engine powering all three input modes natively, without separate specialized models for each modality.

---

## Demo

> Live demo: [conversa-gemma4.vercel.app](https://conversa-gemma4.vercel.app)

---

## Features

### 🎙️ Audio Meeting Analyzer
Upload a voice recording (MP3/WAV/M4A) of a meeting or discussion. Gemma 4 transcribes and analyzes the audio, then generates:
- Full transcript
- Key discussion points
- Action items with owners
- Follow-up questions

### 🖼️ Whiteboard / Image Intelligence
Upload a photo of a whiteboard, handwritten notes, or any document image (JPG/PNG/WEBP). Gemma 4 reads and interprets the visual content, then generates:
- Extracted text and diagrams description
- Structured summary
- Suggested next steps

### 📄 Document Brief Generator
Upload a PDF (contract, report, proposal). Gemma 4 processes the full document using its 256K context window and generates one of:
- **Meeting Brief** — agenda, discussion points, critical questions
- **Project Kickoff Brief** — goals, scope, roles, milestones
- **Client Proposal Draft** — executive summary, pricing overview
- **Interview Prep Sheet** — questions, scorecard, red flags
- **SOP Generator** — step-by-step procedures and checkpoints

### 🤔 Thinking Mode
For complex documents or ambiguous inputs, the agent activates Gemma 4's reasoning mode (`thinkingLevel: HIGH`) to deliver more accurate and thorough analysis.

---

## How I Used Gemma 4

| Capability | Used For |
|-----------|----------|
| **Audio understanding** | Transcribe and analyze meeting recordings |
| **Image understanding** | Read whiteboard photos and document scans |
| **256K context window** | Process full-length PDFs without chunking |
| **Thinking mode** | Handle complex or ambiguous enterprise documents |
| **Native multimodal** | Accept mixed inputs (audio + image + PDF) in one session |

**Model chosen:** `gemma-4-26b-a4b-it` via Gemini API (Google AI Studio)

---

## Tech Stack

- **Framework:** Next.js 14 / TypeScript
- **AI Model:** Gemma 4 (`gemma-4-26b-a4b-it`) via Google AI Studio Gemini API
- **Deployment:** Vercel
- **Styling:** Tailwind CSS (inline CSS via `<style>` tags for zero-config portability)

---

## Project Structure

```
conversa-gemma4/
├── app/
│   ├── layout.tsx                # Root layout (App Router)
│   ├── page.tsx                  # Landing / agent selector
│   ├── audio/page.tsx            # Audio Meeting Analyzer
│   ├── image/page.tsx            # Whiteboard / Image Intelligence
│   ├── document/page.tsx         # Document Brief Generator
│   └── api/
│       ├── audio/route.ts        # Gemma 4 audio processing
│       ├── image/route.ts        # Gemma 4 image processing
│       └── document/route.ts     # Gemma 4 document + thinking mode
├── components/
│   ├── FileUploader.tsx          # Reusable drag-and-drop file uploader
│   ├── ResultCard.tsx            # Reusable result display card
│   └── ThinkingIndicator.tsx     # Thinking mode loading + trace reveal
├── lib/
│   └── gemma.ts                  # Gemma 4 client wrapper + helpers
├── package.json
├── next.config.mjs
├── tsconfig.json
├── vercel.json
└── .gitignore
```

---

## Getting Started

### Prerequisites
- Node.js 18+
- Google AI Studio API key ([get one here](https://aistudio.google.com/apikey))

### Installation

```bash
git clone https://github.com/jefribulomakassar/conversa-gemma4
cd conversa-gemma4
npm install
```

### Environment Variables

Create a `.env.local` file:

```env
GEMINI_API_KEY=your_google_ai_studio_api_key
```

> ⚠️ Never commit `.env.local` to your repository.

### Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Deploy to Vercel

1. Push repo to GitHub
2. Import project at [vercel.com/new](https://vercel.com/new)
3. Add `GEMINI_API_KEY` under **Settings → Environment Variables**
4. Deploy

---

## Prior Work Credit

This project builds upon concepts and UI patterns from previous hackathon demos:
- [conversa-ocr-docs](https://conversa-ocr-docs.vercel.app) — OCR document intelligence (IBM BoB Hackathon / lablab.ai)
- [briefai](https://briefai-self.vercel.app) — Enterprise brief generator (Milan AI Week 2026 / lablab.ai)
- [conversa-bob](https://conversa-bob.vercel.app) — MCP Server agent tools (IBM BoB Hackathon / lablab.ai)

All prior work is open source under MIT License.

---

## License

MIT — see [LICENSE](./LICENSE)

---

*Built for the [Gemma 4 Challenge](https://dev.to/challenges/google-gemma-2026-05-06) · DEV.to × Google · May 2026*  
*Part of the [Conversa AI Platform](https://conversa2026.vercel.app) ecosystem*
