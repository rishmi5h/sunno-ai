# सुनो (Sunno) — Voice-First AI Listener

A voice-first web app that just listens. Not a chatbot. Not a therapist. Think of it as the digital version of a friend who says "damn, that sucks" and lets you talk.

Inspired by the man on Mumbai beach who went viral charging ₹250-₹1000 just to listen to people's problems.

## How it works

1. Tap the orb and talk
2. Sunno listens, reflects back what you said in 1-2 sentences
3. That's it. No advice unless you explicitly ask.

Supports English, Hindi, and Hinglish naturally.

## Tech Stack

- **Backend**: FastAPI + WebSocket for real-time voice streaming
- **Speech-to-Text**: Deepgram (Nova-2, with language detection)
- **LLM**: Anthropic Claude (with a carefully crafted listener prompt)
- **Text-to-Speech**: ElevenLabs (Flash v2.5 for low latency)
- **Database**: SQLite (conversations auto-delete after 24h)
- **Frontend**: Vanilla HTML/CSS/JS with Canvas orb animation

## Setup

### 1. Clone and install

```bash
git clone https://github.com/rishmi5h/sunno-ai.git
cd sunno-ai
pip install -r backend/requirements.txt
```

### 2. Add API keys

Create a `.env` file in the project root:

```
DEEPGRAM_API_KEY=your_key
ANTHROPIC_API_KEY=your_key
ELEVENLABS_API_KEY=your_key
```

Get keys from:
- [Deepgram](https://console.deepgram.com) — free tier available
- [Anthropic](https://console.anthropic.com) — requires credits
- [ElevenLabs](https://elevenlabs.io) — free tier (10k chars/month)

### 3. Run

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --app-dir backend
```

Open `http://localhost:8000`

## Deploy to Railway

```bash
railway up
```

Set environment variables in Railway dashboard:
- `DEEPGRAM_API_KEY`
- `ANTHROPIC_API_KEY`
- `ELEVENLABS_API_KEY`

## Project Structure

```
sunno-ai/
├── backend/
│   ├── main.py              # FastAPI app, WebSocket endpoint
│   ├── voice_pipeline.py    # STT → LLM → TTS streaming pipeline
│   ├── listener_prompt.py   # The system prompt — THIS IS THE PRODUCT
│   ├── emotion_detector.py  # Keyword-based emotion detection
│   ├── safety.py            # Crisis detection, helpline surfacing
│   ├── database.py          # SQLite conversation storage
│   └── config.py            # Environment variable management
├── frontend/
│   ├── index.html           # Single page app
│   ├── styles.css           # Dark, warm, minimal design
│   ├── app.js               # WebSocket, audio, orb animation
│   └── manifest.json        # PWA manifest
├── railway.json
└── Procfile
```

## Safety

If someone mentions self-harm or crisis, Sunno gently surfaces Indian helpline numbers:
- **iCall**: 9152987821
- **Vandrevala Foundation**: 1860-2662-345

## Privacy

- No user accounts
- Session-based only
- Conversations auto-delete after 24 hours
- No data leaves the server except to API providers for processing
