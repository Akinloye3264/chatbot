# Chatbot

This workspace is split into two folders:

- `backend`: Express API that talks to Groq and streams chat responses
- `frontend`: React UI that sends messages to the backend
- `mobile`: native Android/iOS app built with React Native and Expo. See [mobile setup and install links](mobile/README.md).

## Setup

Install dependencies from the repository root:

```bash
npm install
```

Make sure `backend/.env` contains your Groq API key as `GROQ_API_KEY`.

## Run

Start both apps together from the root:

```bash
npm run dev
```

Or run them separately:

```bash
npm run dev --workspace backend
npm run dev --workspace frontend
```

## Environment

Backend reads these variables from `backend/.env`:

- `GROQ_API_KEY` primary key (at least one key required)
- `GROQ_API_KEY2` optional second key; requests rotate across distinct configured keys and fall back on authentication, rate-limit, connection, or server errors before streaming starts. Keys in the same Groq organization share its limits.
- `GROQ_MODEL` optional, defaults to `groq/compound`
- `GROQ_VISION_MODEL` optional, defaults to `qwen/qwen3.6-27b`; set `off` for OCR-only images
- `FRONTEND_ORIGIN` optional, defaults to `http://localhost:5173`
- `PORT` optional, defaults to `3001`

Frontend reads:

- `VITE_API_URL` optional, defaults to `http://localhost:3001`

## Uploads

The chat composer accepts:

Select multiple files together or add more before sending: up to 10 files per message, 5 MB per file, and 20 MB total. Unsupported or unreadable files return an error. Images use OCR; scanned PDFs without a text layer are not supported.

- images such as PNG and JPEG, analyzed with Groq vision (or OCR when vision is disabled)
- PDFs
- DOCX files
- plain text, JSON, Markdown, and CSV files
