// ── State ──
let ws = null;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let sessionId = crypto.randomUUID();
let state = "idle"; // idle | recording | thinking | speaking
let analyser = null;
let audioDataArray = null;

// ── DOM ──
const landing = document.getElementById("landing");
const session = document.getElementById("session");
const startBtn = document.getElementById("start-btn");
const orbCanvas = document.getElementById("orb");
const statusEl = document.getElementById("status");
const transcriptArea = document.getElementById("transcript-area");
const ctx = orbCanvas.getContext("2d");

// HiDPI canvas
function setupCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = orbCanvas.getBoundingClientRect();
    orbCanvas.width = rect.width * dpr;
    orbCanvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
}

// ── Landing → Session ──
startBtn.addEventListener("click", async () => {
    landing.classList.remove("active");
    session.classList.add("active");
    await initSession();
});

async function initSession() {
    setupCanvas();
    connectWebSocket();
    await requestMicPermission();
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
            showTranscript(msg.text, "user");
            break;

        case "thinking":
            setState("thinking");
            break;

        case "response_text":
            showTranscript(msg.text, "ai");
            break;

        case "audio_chunk":
            audioQueue.push(base64ToArrayBuffer(msg.data));
            if (!isPlaying) playAudioQueue();
            break;

        case "done":
            if (!isPlaying) setState("idle");
            break;

        case "error":
            statusEl.textContent = msg.message;
            setTimeout(() => setState("idle"), 2000);
            break;
    }
}

function showTranscript(text, who) {
    transcriptArea.textContent = text;
    transcriptArea.className = `transcript-area ${who}`;
    // Fade out after a delay
    clearTimeout(transcriptArea._fadeTimer);
    transcriptArea.style.opacity = "0.7";
    transcriptArea._fadeTimer = setTimeout(() => {
        transcriptArea.style.opacity = "0.3";
    }, 4000);
}

async function playAudioQueue() {
    if (audioQueue.length === 0) {
        isPlaying = false;
        setState("idle");
        return;
    }

    isPlaying = true;
    setState("speaking");

    const combined = new Blob(audioQueue, { type: "audio/mpeg" });
    audioQueue = [];

    const url = URL.createObjectURL(combined);
    const audio = new Audio(url);

    audio.onended = () => {
        URL.revokeObjectURL(url);
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
        setupAnalyser(stream);
        setState("idle");
    } catch (err) {
        statusEl.textContent = "Mic access needed to talk";
        console.error("Mic error:", err);
    }
}

function setupAnalyser(stream) {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    audioDataArray = new Uint8Array(analyser.frequencyBinCount);
}

function getAudioLevel() {
    if (!analyser || !audioDataArray) return 0;
    analyser.getByteFrequencyData(audioDataArray);
    let sum = 0;
    for (let i = 0; i < audioDataArray.length; i++) {
        sum += audioDataArray[i];
    }
    return sum / audioDataArray.length / 255; // 0-1
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

// ── Tap to Record (toggle) + Hold to talk ──
const orbContainer = document.getElementById("orb-container");
let holdTimer = null;
let isHolding = false;

orbContainer.addEventListener("pointerdown", (e) => {
    if (state === "thinking" || state === "speaking") return;
    e.preventDefault();

    // Start hold-to-talk timer
    isHolding = false;
    holdTimer = setTimeout(() => {
        isHolding = true;
        if (!isRecording) startRecording();
    }, 300);
});

orbContainer.addEventListener("pointerup", (e) => {
    e.preventDefault();
    clearTimeout(holdTimer);

    if (isHolding) {
        // Was hold-to-talk, stop on release
        if (isRecording) stopRecording();
        isHolding = false;
    } else {
        // Was a tap — toggle
        if (state === "thinking" || state === "speaking") return;
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    }
});

orbContainer.addEventListener("pointerleave", () => {
    clearTimeout(holdTimer);
    if (isHolding && isRecording) {
        stopRecording();
        isHolding = false;
    }
});

function startRecording() {
    if (!mediaRecorder || mediaRecorder.state === "recording") return;
    audioChunks = [];
    mediaRecorder.start();
    isRecording = true;
    setState("recording");
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
    orbContainer.setAttribute("data-state", state);
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
let orbTime = 0;
let smoothRadius = 80;
let smoothGlow = 0.12;
let targetRadius = 80;
let targetGlow = 0.12;

// Particle system for ambient floaters
const particles = [];
for (let i = 0; i < 20; i++) {
    particles.push({
        angle: Math.random() * Math.PI * 2,
        dist: 100 + Math.random() * 50,
        speed: 0.2 + Math.random() * 0.3,
        size: 1 + Math.random() * 2,
        alpha: 0.1 + Math.random() * 0.2,
        phase: Math.random() * Math.PI * 2,
    });
}

function drawOrb() {
    const rect = orbCanvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const cx = w / 2;
    const cy = h / 2;
    const baseRadius = 80;

    orbTime += 0.016;
    ctx.clearRect(0, 0, w, h);

    // Audio-reactive amplitude
    const audioLevel = state === "recording" ? getAudioLevel() : 0;

    // Target values by state
    if (state === "idle") {
        targetRadius = baseRadius + Math.sin(orbTime * 1.2) * 4;
        targetGlow = 0.1 + Math.sin(orbTime * 0.8) * 0.03;
    } else if (state === "recording") {
        targetRadius = baseRadius + 12 + audioLevel * 25 + Math.sin(orbTime * 2.5) * 5;
        targetGlow = 0.25 + audioLevel * 0.25;
    } else if (state === "thinking") {
        targetRadius = baseRadius + Math.sin(orbTime * 3) * 3;
        targetGlow = 0.15 + Math.sin(orbTime * 2) * 0.05;
    } else if (state === "speaking") {
        targetRadius = baseRadius + 4 + Math.sin(orbTime * 4) * 7 + Math.sin(orbTime * 6.5) * 3;
        targetGlow = 0.2 + Math.sin(orbTime * 4) * 0.08;
    }

    // Smooth interpolation
    smoothRadius += (targetRadius - smoothRadius) * 0.12;
    smoothGlow += (targetGlow - smoothGlow) * 0.1;
    const radius = smoothRadius;

    // Outer glow
    const glowRadius = radius + 60;
    const gradient = ctx.createRadialGradient(cx, cy, radius * 0.5, cx, cy, glowRadius);
    gradient.addColorStop(0, `rgba(244, 162, 97, ${smoothGlow})`);
    gradient.addColorStop(0.5, `rgba(244, 140, 80, ${smoothGlow * 0.3})`);
    gradient.addColorStop(1, "rgba(244, 162, 97, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    // Ambient particles
    for (const p of particles) {
        p.angle += p.speed * 0.016;
        const wobble = Math.sin(orbTime * 0.7 + p.phase) * 10;
        const d = p.dist + wobble + (state === "recording" ? audioLevel * 30 : 0);
        const px = cx + Math.cos(p.angle) * d;
        const py = cy + Math.sin(p.angle) * d;
        const pa = p.alpha * (state === "idle" ? 0.5 : 1);
        ctx.beginPath();
        ctx.arc(px, py, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(244, 180, 120, ${pa})`;
        ctx.fill();
    }

    // Recording ripples (multiple expanding rings)
    if (state === "recording") {
        for (let i = 0; i < 3; i++) {
            const t = (orbTime * 0.8 + i * 1.2) % 3.6;
            const rippleR = radius + t * 25;
            const rippleA = Math.max(0, 0.25 - t * 0.07);
            ctx.beginPath();
            ctx.arc(cx, cy, rippleR, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(244, 162, 97, ${rippleA})`;
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
    }

    // Orb body — layered gradient for depth
    const orbGrad = ctx.createRadialGradient(cx - radius * 0.15, cy - radius * 0.2, 0, cx, cy, radius);
    orbGrad.addColorStop(0, "#ffc58a");
    orbGrad.addColorStop(0.3, "#f4a261");
    orbGrad.addColorStop(0.7, "#e07a3a");
    orbGrad.addColorStop(1, "#c45e20");

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = orbGrad;
    ctx.fill();

    // Soft inner light (shifts with time for organic feel)
    const lightX = cx - radius * 0.2 + Math.sin(orbTime * 0.5) * 8;
    const lightY = cy - radius * 0.25 + Math.cos(orbTime * 0.7) * 5;
    const highlight = ctx.createRadialGradient(lightX, lightY, 0, cx, cy, radius * 0.7);
    highlight.addColorStop(0, "rgba(255, 230, 200, 0.4)");
    highlight.addColorStop(0.5, "rgba(255, 220, 180, 0.1)");
    highlight.addColorStop(1, "rgba(255, 220, 180, 0)");
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = highlight;
    ctx.fill();

    // Subtle rim light
    const rimGrad = ctx.createRadialGradient(cx, cy, radius - 3, cx, cy, radius);
    rimGrad.addColorStop(0, "rgba(255, 200, 150, 0)");
    rimGrad.addColorStop(1, "rgba(255, 200, 150, 0.12)");
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = rimGrad;
    ctx.fill();

    // Thinking: orbiting dots with trails
    if (state === "thinking") {
        for (let i = 0; i < 3; i++) {
            const angle = orbTime * 2.5 + (i * Math.PI * 2) / 3;
            const dotDist = radius + 18 + Math.sin(orbTime * 1.5 + i) * 4;
            const dotX = cx + Math.cos(angle) * dotDist;
            const dotY = cy + Math.sin(angle) * dotDist;

            // Trail
            for (let t = 0; t < 4; t++) {
                const trailAngle = angle - t * 0.15;
                const tx = cx + Math.cos(trailAngle) * dotDist;
                const ty = cy + Math.sin(trailAngle) * dotDist;
                ctx.beginPath();
                ctx.arc(tx, ty, 2.5 - t * 0.5, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(244, 162, 97, ${0.5 - t * 0.12})`;
                ctx.fill();
            }

            // Main dot
            ctx.beginPath();
            ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(255, 200, 150, 0.8)";
            ctx.fill();
        }
    }

    // Speaking: waveform ring
    if (state === "speaking") {
        ctx.beginPath();
        const segments = 60;
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const wave = Math.sin(orbTime * 5 + i * 0.5) * 4 + Math.sin(orbTime * 3.3 + i * 0.3) * 2;
            const r = radius + 12 + wave;
            const x = cx + Math.cos(angle) * r;
            const y = cy + Math.sin(angle) * r;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = "rgba(244, 180, 120, 0.3)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    requestAnimationFrame(drawOrb);
}
