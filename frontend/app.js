// ── Sunno: Cloud-First Voice App ──
// Cloud by default, with option to download local AI model for offline/private use

// ── State ──
let ws = null;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let sessionId = crypto.randomUUID();
let state = "idle"; // idle | recording | thinking | speaking
let analyser = null;
let audioDataArray = null;
let recognition = null; // Web Speech API
let caps = null; // Device capabilities
let isDownloading = false;

// ── DOM ──
const landing = document.getElementById("landing");
const session = document.getElementById("session");
const startBtn = document.getElementById("start-btn");
const orbCanvas = document.getElementById("orb");
const statusEl = document.getElementById("status");
const transcriptArea = document.getElementById("transcript-area");
const ctx = orbCanvas.getContext("2d");
const modeIndicator = document.getElementById("mode-indicator");

// Settings panel
const settingsBtn = document.getElementById("settings-btn");
const settingsPanel = document.getElementById("settings-panel");
const settingsClose = document.getElementById("settings-close");
const llmToggle = document.getElementById("llm-toggle");
const llmStatus = document.getElementById("llm-status");
const llmDownloadRow = document.getElementById("llm-download-row");
const llmDownloadBtn = document.getElementById("llm-download-btn");
const llmProgressRow = document.getElementById("llm-progress-row");
const llmCachedRow = document.getElementById("llm-cached-row");
const llmDeleteBtn = document.getElementById("llm-delete-btn");
const settingsProgressFill = document.getElementById("settings-progress-fill");
const settingsProgressText = document.getElementById("settings-progress-text");

// Download banner
const downloadBanner = document.getElementById("download-banner");
const bannerDownload = document.getElementById("banner-download");
const bannerDismiss = document.getElementById("banner-dismiss");
const bannerProgress = document.getElementById("banner-progress");
const bannerProgressFill = document.getElementById("banner-progress-fill");
const bannerProgressText = document.getElementById("banner-progress-text");

// HiDPI canvas
function setupCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = orbCanvas.getBoundingClientRect();
    orbCanvas.width = rect.width * dpr;
    orbCanvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
}

// ── Landing → Session (always cloud-first, no setup screen) ──
startBtn.addEventListener("click", async () => {
    landing.classList.remove("active");

    // Detect capabilities (respects user preference from localStorage)
    caps = await SunnoCapabilities.detect();

    // Always go straight to session — no model download blocking
    startSession();
});

async function startSession() {
    session.classList.add("active");
    setupCanvas();

    // Show mode indicator
    updateModeIndicator();

    // Set up TTS voice if using on-device
    if (caps.tts === "speech-synthesis" && caps.bestTTSVoice) {
        SunnoTTS.setVoice(caps.bestTTSVoice);
    }

    // Set up STT
    if (caps.stt === "web-speech") {
        setupWebSpeech();
    }

    // Always request mic
    await requestMicPermission();

    // Connect WebSocket only if we need cloud STT or TTS
    if (caps.stt === "cloud" || caps.tts === "cloud") {
        connectWebSocket();
    }

    // If LLM is webllm and model is cached, init the engine
    if (caps.llm === "webllm") {
        SunnoLLM.init().catch(() => {
            // Failed to init, fall back to groq
            caps.llm = "groq";
            updateModeIndicator();
        });
    }

    drawOrb();
}

function updateModeIndicator() {
    if (!modeIndicator) return;
    const parts = [];
    if (caps.stt === "web-speech") parts.push("STT: on-device");
    else parts.push("STT: cloud");
    if (caps.llm === "webllm") parts.push("LLM: on-device");
    else if (caps.llm === "groq") parts.push("LLM: Groq");
    else parts.push("LLM: cloud");
    if (caps.tts === "speech-synthesis") parts.push("TTS: on-device");
    else parts.push("TTS: cloud");
    modeIndicator.textContent = parts.join(" · ");
}

// ── Backend URL (for cloud fallback) ──
const BACKEND_HOST = window.BACKEND_URL || location.host;

// ── WebSocket (cloud fallback path) ──
function connectWebSocket() {
    const isSecure = location.protocol === "https:" || BACKEND_HOST.includes("railway.app");
    const protocol = isSecure ? "wss:" : "ws:";
    const url = `${protocol}//${BACKEND_HOST}/ws/${sessionId}`;
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

// ── Cloud fallback audio playback ──
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

// ── Web Speech API (on-device STT) ──
function setupWebSpeech() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    recognition = new SpeechRecognition();
    recognition.lang = "en-IN";
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
        let interimTranscript = "";
        let finalTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            if (result.isFinal) {
                finalTranscript += result[0].transcript;
            } else {
                interimTranscript += result[0].transcript;
            }
        }

        if (interimTranscript) {
            showTranscript(interimTranscript, "user");
        }

        if (finalTranscript) {
            showTranscript(finalTranscript, "user");
            isRecording = false;
            setState("thinking");
            processLocalPipeline(finalTranscript);
        }
    };

    recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        if (event.error === "no-speech") {
            setState("idle");
            statusEl.textContent = "Didn't catch that. Try again?";
            setTimeout(() => {
                if (state === "idle") statusEl.textContent = "Tap to talk";
            }, 2000);
        } else {
            setState("idle");
        }
        isRecording = false;
    };

    recognition.onend = () => {
        if (isRecording) {
            isRecording = false;
            setState("idle");
        }
    };
}

// ── On-Device Pipeline ──
async function processLocalPipeline(transcript) {
    if (!transcript.trim()) {
        setState("idle");
        return;
    }

    // Track message count for download banner
    const msgCount = SunnoStorage.incrementMessageCount();

    // Safety check (client-side)
    const safetyResponse = SunnoSafety.checkSafety(transcript);
    if (safetyResponse) {
        showTranscript(safetyResponse, "ai");
        await speakResponse(safetyResponse);
        return;
    }

    // Detect emotion
    const emotion = SunnoSafety.detectEmotion(transcript);

    // Get conversation history from local storage
    const history = SunnoStorage.getHistory(sessionId);

    let responseText;
    try {
        if (caps.llm === "webllm" && SunnoLLM.getIsReady()) {
            responseText = await SunnoLLM.generate(transcript, history, emotion);
        } else if (caps.llm === "groq") {
            responseText = await callGroqAPI(transcript, history);
        } else {
            sendAudioToCloud(transcript);
            return;
        }
    } catch (err) {
        console.error("LLM error:", err);
        statusEl.textContent = "Something went wrong. Try again?";
        setTimeout(() => setState("idle"), 2000);
        return;
    }

    showTranscript(responseText, "ai");

    // Save to local history
    SunnoStorage.saveMessage(sessionId, "user", transcript);
    SunnoStorage.saveMessage(sessionId, "assistant", responseText);

    // Speak the response
    await speakResponse(responseText);

    // Show download banner after 3 messages if device supports local and model not cached
    if (msgCount >= 3 && !isDownloading) {
        maybeShowDownloadBanner();
    }
}

async function callGroqAPI(transcript, history) {
    const backendUrl = window.BACKEND_URL || "";
    const base = backendUrl ? `https://${backendUrl}` : "";
    const response = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            transcript,
            conversation_history: history,
            session_id: sessionId,
        }),
    });

    if (!response.ok) {
        throw new Error(`Groq API error: ${response.status}`);
    }

    const data = await response.json();
    return data.response_text;
}

async function speakResponse(text) {
    if (caps.tts === "speech-synthesis") {
        setState("speaking");
        try {
            await SunnoTTS.speak(text, {
                onStart: () => setState("speaking"),
                onEnd: () => setState("idle"),
            });
        } catch {
            setState("idle");
        }
    } else {
        setState("idle");
    }
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
    return sum / audioDataArray.length / 255;
}

function setupRecorder(stream) {
    mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
            ? "audio/webm;codecs=opus"
            : "audio/webm",
    });

    mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
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

// ── Tap to Record / Hold to talk ──
const orbContainer = document.getElementById("orb-container");
let holdTimer = null;
let isHolding = false;

orbContainer.addEventListener("pointerdown", (e) => {
    if (state === "thinking" || state === "speaking") return;
    e.preventDefault();

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
        if (isRecording) stopRecording();
        isHolding = false;
    } else {
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
    if (caps && caps.stt === "web-speech" && recognition) {
        try {
            recognition.start();
            isRecording = true;
            setState("recording");
            if (navigator.vibrate) navigator.vibrate(30);
        } catch (err) {
            console.error("Speech recognition start error:", err);
        }
    } else {
        if (!mediaRecorder || mediaRecorder.state === "recording") return;
        audioChunks = [];
        mediaRecorder.start();
        isRecording = true;
        setState("recording");
        if (navigator.vibrate) navigator.vibrate(30);
    }
}

function stopRecording() {
    if (caps && caps.stt === "web-speech" && recognition) {
        try {
            recognition.stop();
        } catch {
            // Ignore if already stopped
        }
        isRecording = false;
        setState("thinking");
        if (navigator.vibrate) navigator.vibrate(20);
    } else {
        if (!mediaRecorder || mediaRecorder.state !== "recording") return;
        mediaRecorder.stop();
        isRecording = false;
        setState("thinking");
        if (navigator.vibrate) navigator.vibrate(20);
    }
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

// ══════════════════════════════════════════════
// ── Download Banner Logic ──
// ══════════════════════════════════════════════

async function maybeShowDownloadBanner() {
    // Don't show if already dismissed, already local, or device can't run it
    const dismissed = SunnoStorage.getPreference("banner_dismissed", false);
    if (dismissed) return;
    if (caps.llm === "webllm") return;

    const local = SunnoCapabilities.canGoLocal();
    if (!local.llm) return;

    const cached = await SunnoCapabilities.isModelCached();
    if (cached) return;

    // Show the banner
    downloadBanner.classList.remove("hidden");
}

bannerDownload.addEventListener("click", () => {
    startModelDownload("banner");
});

bannerDismiss.addEventListener("click", () => {
    downloadBanner.classList.add("hidden");
    SunnoStorage.setPreference("banner_dismissed", true);
});

function startModelDownload(source) {
    if (isDownloading) return;
    isDownloading = true;

    // Update UI based on source
    if (source === "banner") {
        downloadBanner.querySelector(".banner-content").style.display = "none";
        bannerProgress.classList.remove("hidden");
    } else {
        llmDownloadRow.classList.add("hidden");
        llmProgressRow.classList.remove("hidden");
    }

    SunnoLLM.setProgressCallback(({ text, progress }) => {
        const pct = Math.round(progress * 100);
        // Update banner progress
        if (bannerProgressFill) bannerProgressFill.style.width = `${pct}%`;
        if (bannerProgressText) bannerProgressText.textContent = text || `${pct}%`;
        // Update settings progress
        if (settingsProgressFill) settingsProgressFill.style.width = `${pct}%`;
        if (settingsProgressText) settingsProgressText.textContent = text || `${pct}%`;
    });

    SunnoLLM.init()
        .then(() => {
            isDownloading = false;

            // Switch to local LLM
            caps.llm = "webllm";
            SunnoStorage.setPreference("llm_mode", "local");
            updateModeIndicator();

            // Hide banner
            downloadBanner.classList.add("hidden");

            // Update settings panel
            refreshSettingsUI();

            // Brief notification
            statusEl.textContent = "Local AI ready!";
            setTimeout(() => {
                if (state === "idle") statusEl.textContent = "Tap to talk";
            }, 3000);
        })
        .catch((err) => {
            console.error("Model download failed:", err);
            isDownloading = false;

            // Reset banner
            if (source === "banner") {
                downloadBanner.querySelector(".banner-content").style.display = "flex";
                bannerProgress.classList.add("hidden");
            }

            // Reset settings
            llmProgressRow.classList.add("hidden");
            llmDownloadRow.classList.remove("hidden");
        });
}

// ══════════════════════════════════════════════
// ── Settings Panel Logic ──
// ══════════════════════════════════════════════

settingsBtn.addEventListener("click", () => {
    refreshSettingsUI();
    settingsPanel.classList.remove("hidden");
});

settingsClose.addEventListener("click", () => {
    settingsPanel.classList.add("hidden");
});

// Close settings when clicking outside
settingsPanel.addEventListener("click", (e) => {
    if (e.target === settingsPanel) {
        settingsPanel.classList.add("hidden");
    }
});

llmToggle.addEventListener("click", async () => {
    const currentState = llmToggle.getAttribute("data-state");

    if (currentState === "off") {
        // User wants local — check if possible
        const local = SunnoCapabilities.canGoLocal();
        if (!local.llm) {
            llmStatus.textContent = "Your device doesn't support on-device AI";
            return;
        }

        const cached = await SunnoLLM.isModelCached();
        if (cached) {
            // Model cached — switch to local
            llmToggle.setAttribute("data-state", "on");
            caps.llm = "webllm";
            SunnoStorage.setPreference("llm_mode", "local");
            updateModeIndicator();

            // Init engine if not ready
            if (!SunnoLLM.getIsReady()) {
                SunnoLLM.init().catch(() => {
                    caps.llm = "groq";
                    llmToggle.setAttribute("data-state", "off");
                    updateModeIndicator();
                    refreshSettingsUI();
                });
            }
        } else {
            // Model not cached — show download option
            llmToggle.setAttribute("data-state", "on");
        }
        refreshSettingsUI();
    } else {
        // User wants cloud
        llmToggle.setAttribute("data-state", "off");
        caps.llm = "groq";
        SunnoStorage.setPreference("llm_mode", "cloud");
        updateModeIndicator();
        refreshSettingsUI();
    }
});

llmDownloadBtn.addEventListener("click", () => {
    startModelDownload("settings");
});

llmDeleteBtn.addEventListener("click", async () => {
    await SunnoLLM.deleteModel();
    caps.llm = "groq";
    SunnoStorage.setPreference("llm_mode", "cloud");
    llmToggle.setAttribute("data-state", "off");
    updateModeIndicator();
    refreshSettingsUI();
    // Re-enable download banner for future
    SunnoStorage.setPreference("banner_dismissed", false);
});

async function refreshSettingsUI() {
    const local = SunnoCapabilities.canGoLocal();
    const cached = await SunnoLLM.isModelCached();
    const isLocal = caps.llm === "webllm";

    // Toggle state
    llmToggle.setAttribute("data-state", isLocal ? "on" : "off");

    // Status text
    if (!local.llm) {
        llmStatus.textContent = "Device doesn't support on-device AI";
        llmToggle.style.opacity = "0.4";
        llmToggle.style.pointerEvents = "none";
    } else if (isLocal && cached) {
        llmStatus.textContent = "Running on your device";
    } else if (cached) {
        llmStatus.textContent = "Model downloaded · using cloud";
    } else {
        llmStatus.textContent = "Uses cloud by default";
    }

    // Show/hide sub-rows
    llmDownloadRow.classList.add("hidden");
    llmProgressRow.classList.add("hidden");
    llmCachedRow.classList.add("hidden");

    if (cached) {
        llmCachedRow.classList.remove("hidden");
    } else if (isDownloading) {
        llmProgressRow.classList.remove("hidden");
    } else if (local.llm && llmToggle.getAttribute("data-state") === "on") {
        llmDownloadRow.classList.remove("hidden");
    }
}

// ── Orb Animation ──
let orbTime = 0;
let smoothRadius = 80;
let smoothGlow = 0.12;
let targetRadius = 80;
let targetGlow = 0.12;

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

    const audioLevel = state === "recording" ? getAudioLevel() : 0;

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

    // Recording ripples
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

    // Orb body
    const orbGrad = ctx.createRadialGradient(cx - radius * 0.15, cy - radius * 0.2, 0, cx, cy, radius);
    orbGrad.addColorStop(0, "#ffc58a");
    orbGrad.addColorStop(0.3, "#f4a261");
    orbGrad.addColorStop(0.7, "#e07a3a");
    orbGrad.addColorStop(1, "#c45e20");

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = orbGrad;
    ctx.fill();

    // Soft inner light
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

    // Thinking: orbiting dots
    if (state === "thinking") {
        for (let i = 0; i < 3; i++) {
            const angle = orbTime * 2.5 + (i * Math.PI * 2) / 3;
            const dotDist = radius + 18 + Math.sin(orbTime * 1.5 + i) * 4;
            const dotX = cx + Math.cos(angle) * dotDist;
            const dotY = cy + Math.sin(angle) * dotDist;

            for (let t = 0; t < 4; t++) {
                const trailAngle = angle - t * 0.15;
                const tx = cx + Math.cos(trailAngle) * dotDist;
                const ty = cy + Math.sin(trailAngle) * dotDist;
                ctx.beginPath();
                ctx.arc(tx, ty, 2.5 - t * 0.5, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(244, 162, 97, ${0.5 - t * 0.12})`;
                ctx.fill();
            }

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
