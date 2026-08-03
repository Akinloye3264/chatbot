# Chatbot

This workspace is split into two folders:

- `backend`: Express API that talks to Groq and streams chat responses
- `frontend`: React UI that sends messages to the backend

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

- `GROQ_API_KEY` required
- `GROQ_MODEL` optional, defaults to `groq/compound`
- `FRONTEND_ORIGIN` optional, defaults to `http://localhost:5173`
- `PORT` optional, defaults to `3001`

Frontend reads:

- `VITE_API_URL` optional, defaults to `http://localhost:3001`

## Uploads

The chat composer accepts:

- images such as PNG and JPEG, which are OCR-read on the backend
- PDFs
- DOCX files
- plain text, JSON, Markdown, and CSV files
