// ── State ──
let ws = null;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let sessionId = crypto.randomUUID();
let state = "idle"; // idle | recording | thinking | speaking

// ── DOM ──
const landing = document.getElementById("landing");
const session = document.getElementById("session");
const startBtn = document.getElementById("start-btn");
const orbCanvas = document.getElementById("orb");
const statusEl = document.getElementById("status");
const transcriptArea = document.getElementById("transcript-area");
const ctx = orbCanvas.getContext("2d");

// ── Landing → Session ──
startBtn.addEventListener("click", async () => {
    landing.classList.remove("active");
    session.classList.add("active");
    await initSession();
});

async function initSession() {
    connectWebSocket();
    requestMicPermission();
    drawOrb();
}

// ── WebSocket ──
function connectWebSocket() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${location.host}/ws/${sessionId}`;
    ws = new WebSocket(url);

    ws.onopen = () => console.log("WS connected");

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
    };

    ws.onclose = () => {
        console.log("WS disconnected, reconnecting...");
        setTimeout(connectWebSocket, 2000);
    };

    ws.onerror = (err) => console.error("WS error:", err);
}

// ── Audio chunks for playback ──
let audioQueue = [];
let isPlaying = false;

function handleServerMessage(msg) {
    switch (msg.type) {
        case "transcript":
            transcriptArea.textContent = msg.text;
            break;

        case "thinking":
            setState("thinking");
            break;

        case "response_text":
            // Could display this, keeping it subtle
            break;

        case "audio_chunk":
            audioQueue.push(base64ToArrayBuffer(msg.data));
            if (!isPlaying) playAudioQueue();
            break;

        case "done":
            // Audio might still be playing, state will reset after playback
            if (!isPlaying) setState("idle");
            break;

        case "error":
            statusEl.textContent = msg.message;
            setState("idle");
            break;
    }
}

async function playAudioQueue() {
    if (audioQueue.length === 0) {
        isPlaying = false;
        setState("idle");
        return;
    }

    isPlaying = true;
    setState("speaking");

    // Combine all chunks into one blob
    const combined = new Blob(audioQueue, { type: "audio/mpeg" });
    audioQueue = [];

    const url = URL.createObjectURL(combined);
    const audio = new Audio(url);

    audio.onended = () => {
        URL.revokeObjectURL(url);
        // Check if more chunks arrived while playing
        if (audioQueue.length > 0) {
            playAudioQueue();
        } else {
            isPlaying = false;
            setState("idle");
        }
    };

    audio.onerror = () => {
        URL.revokeObjectURL(url);
        isPlaying = false;
        setState("idle");
    };

    await audio.play().catch(() => {
        isPlaying = false;
        setState("idle");
    });
}

function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

// ── Microphone ──
async function requestMicPermission() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setupRecorder(stream);
    } catch (err) {
        statusEl.textContent = "Mic access needed to talk";
        console.error("Mic error:", err);
    }
}

function setupRecorder(stream) {
    mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
            ? "audio/webm;codecs=opus"
            : "audio/webm",
    });

    mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
            audioChunks.push(e.data);
        }
    };

    mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
        audioChunks = [];

        // Convert to base64 and send
        const buffer = await blob.arrayBuffer();
        const base64 = arrayBufferToBase64(buffer);

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "audio_chunk", data: base64 }));
            ws.send(JSON.stringify({ type: "end_turn" }));
        }
    };
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

// ── Tap to Record (toggle) ──
const orbContainer = document.getElementById("orb-container");

orbContainer.addEventListener("click", () => {
    if (state === "thinking" || state === "speaking") return;

    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
});

// Also support hold-to-talk
orbContainer.addEventListener("mousedown", (e) => {
    // Only for long press, handled by click for toggle
});

function startRecording() {
    if (!mediaRecorder || mediaRecorder.state === "recording") return;
    audioChunks = [];
    mediaRecorder.start();
    isRecording = true;
    setState("recording");

    // Haptic feedback on mobile
    if (navigator.vibrate) navigator.vibrate(30);
}

function stopRecording() {
    if (!mediaRecorder || mediaRecorder.state !== "recording") return;
    mediaRecorder.stop();
    isRecording = false;
    setState("thinking");

    if (navigator.vibrate) navigator.vibrate(20);
}

// ── State Management ──
function setState(newState) {
    state = newState;
    switch (state) {
        case "idle":
            statusEl.textContent = "Tap to talk";
            break;
        case "recording":
            statusEl.textContent = "Listening...";
            transcriptArea.textContent = "";
            break;
        case "thinking":
            statusEl.textContent = "";
            break;
        case "speaking":
            statusEl.textContent = "";
            break;
    }
}

// ── Orb Animation ──
let animFrame;
let orbTime = 0;

function drawOrb() {
    const w = orbCanvas.width;
    const h = orbCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const baseRadius = 80;

    orbTime += 0.016;
    ctx.clearRect(0, 0, w, h);

    // Glow
    const glowAlpha = state === "recording" ? 0.3 : state === "speaking" ? 0.25 : 0.12;
    const glowRadius = state === "recording" ? 140 : state === "speaking" ? 130 : 110;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
    gradient.addColorStop(0, `rgba(244, 162, 97, ${glowAlpha})`);
    gradient.addColorStop(0.6, `rgba(244, 162, 97, ${glowAlpha * 0.3})`);
    gradient.addColorStop(1, "rgba(244, 162, 97, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    // Orb body
    let radius = baseRadius;
    if (state === "idle") {
        // Gentle breathing
        radius += Math.sin(orbTime * 1.5) * 4;
    } else if (state === "recording") {
        // Expand with ripple
        radius += Math.sin(orbTime * 3) * 8 + 10;
    } else if (state === "thinking") {
        // Subtle shimmer
        radius += Math.sin(orbTime * 4) * 3;
    } else if (state === "speaking") {
        // Rhythmic pulse
        radius += Math.sin(orbTime * 5) * 6;
    }

    // Main circle
    const orbGradient = ctx.createRadialGradient(cx - 15, cy - 15, 0, cx, cy, radius);
    orbGradient.addColorStop(0, "#f4a261");
    orbGradient.addColorStop(0.5, "#e07a3a");
    orbGradient.addColorStop(1, "#c45e20");

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = orbGradient;
    ctx.fill();

    // Inner highlight
    const highlight = ctx.createRadialGradient(cx - 20, cy - 25, 0, cx, cy, radius * 0.6);
    highlight.addColorStop(0, "rgba(255, 220, 180, 0.35)");
    highlight.addColorStop(1, "rgba(255, 220, 180, 0)");
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = highlight;
    ctx.fill();

    // Recording ripples
    if (state === "recording") {
        const rippleRadius = radius + 20 + Math.sin(orbTime * 2) * 15;
        ctx.beginPath();
        ctx.arc(cx, cy, rippleRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(244, 162, 97, ${0.2 + Math.sin(orbTime * 2) * 0.1})`;
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // Thinking rotation dots
    if (state === "thinking") {
        for (let i = 0; i < 3; i++) {
            const angle = orbTime * 2 + (i * Math.PI * 2) / 3;
            const dotX = cx + Math.cos(angle) * (radius + 20);
            const dotY = cy + Math.sin(angle) * (radius + 20);
            ctx.beginPath();
            ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(244, 162, 97, ${0.4 + Math.sin(orbTime * 3 + i) * 0.3})`;
            ctx.fill();
        }
    }

    animFrame = requestAnimationFrame(drawOrb);
}
