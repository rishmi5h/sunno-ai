// ── Sunno: Cloud-First Voice App ──
// Cloud by default, with option to download local AI model for offline/private use

// ── State ──
let ws = null;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let sessionId = (crypto.randomUUID ? crypto.randomUUID() :
    "xxxx-xxxx-xxxx".replace(/x/g, () => ((Math.random() * 16) | 0).toString(16)));
let state = "idle"; // idle | recording | thinking | speaking | breathing
let analyser = null;
let audioDataArray = null;
let recognition = null; // Web Speech API
let caps = null; // Device capabilities
let isDownloading = false;
let isOnline = navigator.onLine;
let pipelineMode = "cloud"; // "cloud" | "onnx" — negotiated with server
let onnxAudioReady = false; // SunnoAudio initialized
let recordingStartTime = 0; // tracks when recording started for usage metering

// Breathing exercise state
let breathingStartTime = 0;
let breathingTimers = [];
const BREATHING_CYCLES = 4;
const BREATHING_INHALE_MS = 4000;
const BREATHING_HOLD_MS = 7000;
const BREATHING_EXHALE_MS = 8000;
const BREATHING_CYCLE_MS = BREATHING_INHALE_MS + BREATHING_HOLD_MS + BREATHING_EXHALE_MS;

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

// Usage & paywall & premium
const remainingTimeEl = document.getElementById("remaining-time");
const premiumBadge = document.getElementById("premium-badge");
const subscribeBtn = document.getElementById("subscribe-btn");
const premiumEmail = document.getElementById("premium-email");
const paymentStatus = document.getElementById("payment-status");
const restorePremium = document.getElementById("restore-premium");
const minuteBanner = document.getElementById("minute-banner");
const minuteBannerText = document.getElementById("minute-banner-text");
const minuteBannerDismiss = document.getElementById("minute-banner-dismiss");
const paywallOverlay = document.getElementById("paywall-overlay");
const waitlistEmail = document.getElementById("waitlist-email");
const waitlistSubmit = document.getElementById("waitlist-submit");
const waitlistStatus = document.getElementById("waitlist-status");
const paywallDismiss = document.getElementById("paywall-dismiss");
let minuteBannerDismissed = false;

// Session recap
const endSessionBtn = document.getElementById("end-session-btn");
const breatheBtn = document.getElementById("breathe-btn");
const breatheMenuBtn = document.getElementById("breathe-menu-btn");
const recapOverlay = document.getElementById("recap-overlay");
const recapSummary = document.getElementById("recap-summary");
const recapMeta = document.getElementById("recap-meta");
const recapMoodDot = document.getElementById("recap-mood-dot");
const recapClose = document.getElementById("recap-close");

// Language
const LANGUAGES = {
    auto:    { label: "Auto",     sttCode: "en-IN", name: "Auto-detect from speech" },
    en:      { label: "English",  sttCode: "en-IN", name: "English" },
    hi:      { label: "Hindi",    sttCode: "hi-IN", name: "Hindi" },
    ta:      { label: "Tamil",    sttCode: "ta-IN", name: "Tamil" },
    te:      { label: "Telugu",   sttCode: "te-IN", name: "Telugu" },
    bn:      { label: "Bengali",  sttCode: "bn-IN", name: "Bengali" },
    mr:      { label: "Marathi",  sttCode: "mr-IN", name: "Marathi" },
    kn:      { label: "Kannada",  sttCode: "kn-IN", name: "Kannada" },
    gu:      { label: "Gujarati", sttCode: "gu-IN", name: "Gujarati" },
};
const langOptions = document.getElementById("lang-options");
const langStatus = document.getElementById("lang-status");
let currentLang = "auto";

// ONNX pipeline toggle
const onnxToggle = document.getElementById("onnx-toggle");
const onnxStatus = document.getElementById("onnx-status");

// Listener mood
const moodOptions = document.getElementById("mood-options");
const moodStatus = document.getElementById("mood-status");
let currentMood = "default";

// Voice selection
const voiceList = document.getElementById("voice-list");
const voiceStatus = document.getElementById("voice-status");

// Ambient sound
const ambientOptions = document.getElementById("ambient-options");
const ambientVolumeRow = document.getElementById("ambient-volume-row");
const ambientVolume = document.getElementById("ambient-volume");

// Offline / connection
const offlineIndicator = document.getElementById("offline-indicator");
const connectionStatus = document.getElementById("connection-status");
const connectionDot = document.getElementById("connection-dot");

// Download banner
const downloadBanner = document.getElementById("download-banner");
const bannerDownload = document.getElementById("banner-download");
const bannerDismiss = document.getElementById("banner-dismiss");
const bannerProgress = document.getElementById("banner-progress");
const bannerProgressFill = document.getElementById("banner-progress-fill");
const bannerProgressText = document.getElementById("banner-progress-text");

// ── Online/Offline Detection ──
window.addEventListener("online", () => {
    isOnline = true;
    onConnectivityChange();
});
window.addEventListener("offline", () => {
    isOnline = false;
    onConnectivityChange();
});

function onConnectivityChange() {
    // Update offline indicator
    if (offlineIndicator) {
        offlineIndicator.classList.toggle("hidden", isOnline);
    }
    // Update settings connection status
    if (connectionStatus) {
        connectionStatus.textContent = isOnline ? "Connected" : "Offline";
    }
    if (connectionDot) {
        connectionDot.className = `connection-dot ${isOnline ? "online" : "offline"}`;
    }

    if (isOnline) {
        // Reconnect WebSocket if needed
        if (caps && (caps.stt === "cloud" || caps.tts === "cloud") && (!ws || ws.readyState !== WebSocket.OPEN)) {
            connectWebSocket();
        }
    } else {
        // Close WebSocket gracefully
        if (ws) {
            ws.onclose = null; // Prevent auto-reconnect
            ws.close();
            ws = null;
        }
    }
}

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
    SunnoOnboarding.onStartTalking();
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

    // Set up TTS voice — check saved preference first
    if (caps.tts === "speech-synthesis") {
        const savedKey = SunnoStorage.getPreference("selected_voice_key", null);
        if (savedKey) {
            const voices = speechSynthesis.getVoices();
            const saved = voices.find(v => (v.name + "|" + v.lang) === savedKey);
            if (saved) {
                SunnoTTS.setVoice(saved);
            } else if (caps.bestTTSVoice) {
                SunnoTTS.setVoice(caps.bestTTSVoice);
            }
        } else if (caps.bestTTSVoice) {
            SunnoTTS.setVoice(caps.bestTTSVoice);
        }
    }

    // Set up STT
    if (caps.stt === "web-speech") {
        setupWebSpeech();
    }

    // Always request mic
    await requestMicPermission();

    // Connect WebSocket — needed for cloud mode AND ONNX mode
    const wantOnnx = SunnoStorage.getPreference("pipeline_mode", "cloud") === "onnx";
    if (isOnline && (wantOnnx || caps.stt === "cloud" || caps.tts === "cloud")) {
        connectWebSocket();
    }

    // If LLM is webllm and model is cached, init the engine
    if (caps.llm === "webllm") {
        SunnoLLM.init().catch(() => {
            caps.llm = "groq";
            updateModeIndicator();
        });
    }

    // Load saved language
    currentLang = SunnoStorage.getPreference("language", "auto");
    if (recognition && currentLang !== "auto") {
        recognition.lang = LANGUAGES[currentLang].sttCode;
    }

    // Load saved listener mood
    currentMood = SunnoStorage.getPreference("listener_mood", "default");
    SunnoTTS.setMood(currentMood);

    // Start ambient sound if user had a preference
    const savedAmbient = SunnoStorage.getPreference("ambient_sound", "silence");
    const savedVolume = SunnoStorage.getPreference("ambient_volume", 50);
    SunnoAmbient.setVolume(savedVolume / 100);
    if (savedAmbient !== "silence") {
        SunnoAmbient.setSound(savedAmbient);
        SunnoAmbient.start();
    }

    // Check premium or usage limit on session start
    const premiumData = SunnoStorage.getPremium();
    if (premiumData) {
        checkPremiumStatus(premiumData.email);
    } else {
        updateRemainingTime();
        if (SunnoStorage.isLimitReached()) {
            showPaywall();
        }
    }

    // Reveal breathe button if already discovered
    if (SunnoStorage.getPreference("breathing_discovered", false)) {
        revealBreatheButton();
    }

    // Update offline indicator
    onConnectivityChange();

    drawOrb();
    SunnoOnboarding.onSessionStart();
}

function updateModeIndicator() {
    if (!modeIndicator) return;
    if (pipelineMode === "onnx") {
        modeIndicator.textContent = "ONNX: STT + Emotion + TTS on-server · LLM: Groq";
        return;
    }
    const parts = [];
    if (caps && caps.stt === "web-speech") parts.push("STT: on-device");
    else parts.push("STT: cloud");
    if (caps && caps.llm === "webllm") parts.push("LLM: on-device");
    else if (caps && caps.llm === "groq") parts.push("LLM: Groq");
    else parts.push("LLM: cloud");
    if (caps && caps.tts === "speech-synthesis") parts.push("TTS: on-device");
    else parts.push("TTS: cloud");
    modeIndicator.textContent = parts.join(" · ");
}

// ── Backend URL (for cloud fallback) ──
const BACKEND_HOST = window.BACKEND_URL || location.host;

// ── WebSocket (cloud fallback path) ──
let wsReconnectDelay = 1000;
const WS_MAX_DELAY = 30000;

function connectWebSocket() {
    if (!isOnline) return;

    const isSecure = location.protocol === "https:" || BACKEND_HOST.includes("railway.app");
    const protocol = isSecure ? "wss:" : "ws:";
    const url = `${protocol}//${BACKEND_HOST}/ws/${sessionId}`;
    ws = new WebSocket(url);

    ws.onopen = () => {
        console.log("WS connected");
        wsReconnectDelay = 1000; // reset backoff on successful connect
        const wantOnnx = SunnoStorage.getPreference("pipeline_mode", "cloud") === "onnx";
        ws.send(JSON.stringify({ type: "init", mode: wantOnnx ? "onnx" : "cloud" }));
    };
    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
    };
    ws.onclose = () => {
        console.log("WS disconnected");
        if (isOnline && document.visibilityState !== "hidden") {
            setTimeout(connectWebSocket, wsReconnectDelay);
            wsReconnectDelay = Math.min(wsReconnectDelay * 1.5, WS_MAX_DELAY);
        }
    };
    ws.onerror = (err) => console.error("WS error:", err);
}

// Reconnect when app comes back to foreground
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && (!ws || ws.readyState !== WebSocket.OPEN)) {
        wsReconnectDelay = 1000;
        connectWebSocket();
    }
});

// ── Cloud fallback audio playback ──
let audioQueue = [];
let isPlaying = false;

function handleServerMessage(msg) {
    switch (msg.type) {
        case "init_ack":
            pipelineMode = msg.mode;
            console.log("Pipeline mode:", pipelineMode);
            updateModeIndicator();
            if (pipelineMode === "onnx") {
                initOnnxAudio();
                if (onnxStatus) onnxStatus.textContent = "On-device STT + TTS active";
                if (onnxToggle) onnxToggle.setAttribute("data-state", "on");
            } else {
                if (onnxStatus) onnxStatus.textContent = "Uses cloud APIs";
                if (onnxToggle) onnxToggle.setAttribute("data-state", "off");
            }
            break;
        case "transcript":
            showTranscript(msg.text, "user");
            break;
        case "thinking":
            setState("thinking");
            break;
        case "response_text":
            showTranscript(msg.text, "ai");
            break;
        case "emotion":
            console.log("Emotion:", msg.emotion);
            break;
        case "audio_chunk":
            audioQueue.push(base64ToArrayBuffer(msg.data));
            if (!isPlaying) playAudioQueue();
            break;
        case "audio_response":
            // ONNX mode: play WAV audio
            setState("speaking");
            SunnoAudio.playWavBase64(msg.data).then(() => {
                setState("idle");
                SunnoOnboarding.onConversationComplete();
            }).catch(() => setState("idle"));
            break;
        case "latency":
            if (msg.timings) {
                console.log("Latency:", msg.timings);
            }
            break;
        case "done":
            // In ONNX mode, done comes after audio_response
            if (pipelineMode !== "onnx") {
                if (!isPlaying) setState("idle");
                SunnoOnboarding.onConversationComplete();
            }
            break;
        case "error":
            statusEl.textContent = msg.message;
            setTimeout(() => setState("idle"), 2000);
            break;
    }
}

// ── ONNX Audio Init ──
async function initOnnxAudio() {
    if (onnxAudioReady) return;
    try {
        const ok = await SunnoAudio.init({
            onSpeechStart: () => {
                if (state === "idle") {
                    setState("recording");
                    statusEl.textContent = "Listening...";
                }
            },
            onSpeechEnd: () => {
                // VAD detected end of speech — audio is sent via onAudioReady
                setState("thinking");
                statusEl.textContent = "Thinking...";
            },
            onVadScore: (score) => {
                // Could use for orb visualization
                if (state === "recording") audioLevel = score;
            },
            onAudioReady: (pcmFloat32) => {
                // Send audio to backend ONNX pipeline
                sendOnnxAudio(pcmFloat32);
            },
        });
        onnxAudioReady = ok;
        if (ok) console.log("ONNX audio ready (VAD + AudioWorklet)");
        else console.warn("ONNX audio init failed — falling back to cloud");
    } catch (err) {
        console.error("ONNX audio init error:", err);
        onnxAudioReady = false;
    }
}

function sendOnnxAudio(pcmFloat32) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        statusEl.textContent = "Not connected. Try again.";
        setTimeout(() => setState("idle"), 2000);
        return;
    }
    const b64 = SunnoAudio.float32ToBase64(pcmFloat32);
    ws.send(JSON.stringify({
        type: "audio_data",
        data: b64,
        mood: currentMood,
        language: currentLang,
    }));
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

    await audio.play().catch((err) => {
        console.warn("Audio play failed:", err.name);
        if (err.name === "NotAllowedError") {
            statusEl.textContent = "Tap to hear response";
        }
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
    const langCode = LANGUAGES[currentLang] ? LANGUAGES[currentLang].sttCode : "en-IN";
    recognition.lang = langCode;
    recognition.continuous = true;  // Keep listening until user taps stop
    recognition.interimResults = true;

    // Accumulate transcript across multiple results
    let pendingTranscript = "";

    recognition.onresult = (event) => {
        let interim = "";
        let final = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            if (result.isFinal) {
                final += result[0].transcript;
            } else {
                interim += result[0].transcript;
            }
        }

        if (final) pendingTranscript += final + " ";

        // Show what user is saying in real-time
        const display = pendingTranscript + interim;
        if (display.trim()) showTranscript(display.trim(), "user");
    };

    recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        if (event.error === "no-speech") {
            statusEl.textContent = "Didn't catch that. Try again?";
            setTimeout(() => {
                if (state === "idle") statusEl.textContent = "Tap to talk";
            }, 2000);
        } else if (event.error === "aborted") {
            // Intentional abort — don't show error
        }
        isRecording = false;
        setState("idle");
    };

    recognition.onend = () => {
        // With continuous=true, onend fires when stop() is called or on error.
        // If we were recording, track usage and process transcript.
        if (isRecording) {
            isRecording = false;
            // Track speaking time
            if (recordingStartTime > 0) {
                const elapsedSec = (Date.now() - recordingStartTime) / 1000;
                if (!SunnoStorage.isPremiumUser()) SunnoStorage.addUsage(elapsedSec);
                recordingStartTime = 0;
                updateRemainingTime();
            }
            const transcript = pendingTranscript.trim();
            pendingTranscript = "";
            if (transcript) {
                setState("thinking");
                processLocalPipeline(transcript);
            } else {
                setState("idle");
                statusEl.textContent = "Didn't catch that. Try again?";
                setTimeout(() => {
                    if (state === "idle") statusEl.textContent = "Tap to talk";
                }, 2000);
            }
        }
        pendingTranscript = "";
        // Reinitialize for next use
        setupWebSpeech();
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

    // Track anxious emotion for breathing discovery
    if (emotion === "anxious") {
        const count = SunnoStorage.getPreference("anxious_count", 0);
        SunnoStorage.setPreference("anxious_count", count + 1);
    }

    // Get conversation history from local storage
    const history = SunnoStorage.getHistory(sessionId);

    let responseText;
    try {
        if (caps.llm === "webllm" && SunnoLLM.getIsReady()) {
            responseText = await SunnoLLM.generate(transcript, history, emotion, currentMood, currentLang);
        } else if (!isOnline) {
            // Offline and no local model
            statusEl.textContent = "You're offline. Download the AI model to use Sunno offline.";
            setTimeout(() => setState("idle"), 4000);
            return;
        } else {
            responseText = await callGroqAPI(transcript, history);
        }
    } catch (err) {
        console.error("LLM error:", err.message, err.stack);
        statusEl.textContent = `Error: ${err.message || "Something went wrong"}`;
        setTimeout(() => setState("idle"), 4000);
        return;
    }

    showTranscript(responseText, "ai");

    // Save to local history
    SunnoStorage.saveMessage(sessionId, "user", transcript);
    SunnoStorage.saveMessage(sessionId, "assistant", responseText);

    // Speak the response
    await speakResponse(responseText);

    SunnoOnboarding.onConversationComplete();

    // Show "End session" button after 3+ messages
    if (msgCount >= 3 && endSessionBtn) {
        endSessionBtn.classList.remove("hidden");
    }

    // Check if we should reveal breathing feature
    maybeShowBreathingHint();

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
            mood: currentMood,
            language: currentLang,
        }),
    });

    if (!response.ok) {
        throw new Error(`Groq API error: ${response.status}`);
    }

    const data = await response.json();
    return data.response_text;
}

async function speakResponse(text) {
    if (SunnoStorage.isPremiumUser()) {
        // Premium: ElevenLabs via backend
        setState("speaking");
        try {
            const premData = SunnoStorage.getPremium();
            const base = window.BACKEND_URL ? `https://${window.BACKEND_URL}` : "";
            const resp = await fetch(`${base}/api/tts`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text, email: premData.email, mood: currentMood }),
            });
            if (resp.ok) {
                const blob = await resp.blob();
                const url = URL.createObjectURL(blob);
                const audio = new Audio(url);
                await new Promise((resolve) => {
                    audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
                    audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
                    audio.play().catch(resolve);
                });
            } else {
                // Fallback to browser TTS if premium TTS fails
                await SunnoTTS.speak(text, { onEnd: () => {} });
            }
        } catch { /* fall through */ }
        if (state === "speaking") setState("idle");
    } else if (caps.tts === "speech-synthesis") {
        setState("speaking");
        try {
            await SunnoTTS.speak(text, {
                onStart: () => setState("speaking"),
                onEnd: () => setState("idle"),
            });
        } catch { /* fall through */ }
        if (state === "speaking") setState("idle");
    } else {
        setState("idle");
    }
}

// ── Breathing Exercise ──
function startBreathingExercise() {
    if (state !== "idle") return;

    breathingStartTime = Date.now();
    setState("breathing");
    if (breatheBtn) breatheBtn.classList.add("active");

    // Schedule status text cycle for each phase of each cycle
    const clearAll = () => { breathingTimers.forEach(t => clearTimeout(t)); breathingTimers = []; };
    clearAll();

    for (let i = 0; i < BREATHING_CYCLES; i++) {
        const cycleStart = i * BREATHING_CYCLE_MS;
        // Inhale
        breathingTimers.push(setTimeout(() => {
            if (state === "breathing") statusEl.textContent = "Breathe in...";
        }, cycleStart));
        // Hold
        breathingTimers.push(setTimeout(() => {
            if (state === "breathing") statusEl.textContent = "Hold...";
        }, cycleStart + BREATHING_INHALE_MS));
        // Exhale
        breathingTimers.push(setTimeout(() => {
            if (state === "breathing") statusEl.textContent = "Breathe out...";
        }, cycleStart + BREATHING_INHALE_MS + BREATHING_HOLD_MS));
    }

    // After all cycles — show "Nice." briefly then return to idle
    const totalMs = BREATHING_CYCLES * BREATHING_CYCLE_MS;
    breathingTimers.push(setTimeout(() => {
        if (state === "breathing") {
            statusEl.textContent = "Nice.";
            breathingTimers.push(setTimeout(() => {
                stopBreathingExercise();
            }, 2000));
        }
    }, totalMs));
}

function stopBreathingExercise() {
    breathingTimers.forEach(t => clearTimeout(t));
    breathingTimers = [];
    breathingStartTime = 0;
    if (breatheBtn) breatheBtn.classList.remove("active");
    if (state === "breathing") {
        setState("idle");
    }
}

// Breathing phase helper for orb animation
// Returns { phase: "inhale"|"hold"|"exhale", progress: 0-1 } or null if not breathing
function getBreathingPhase() {
    if (state !== "breathing" || !breathingStartTime) return null;
    const elapsed = Date.now() - breathingStartTime;
    const totalMs = BREATHING_CYCLES * BREATHING_CYCLE_MS;
    if (elapsed >= totalMs) return { phase: "hold", progress: 1 }; // post-cycles ("Nice.")
    const inCycle = elapsed % BREATHING_CYCLE_MS;
    if (inCycle < BREATHING_INHALE_MS) {
        return { phase: "inhale", progress: inCycle / BREATHING_INHALE_MS };
    } else if (inCycle < BREATHING_INHALE_MS + BREATHING_HOLD_MS) {
        return { phase: "hold", progress: (inCycle - BREATHING_INHALE_MS) / BREATHING_HOLD_MS };
    } else {
        return { phase: "exhale", progress: (inCycle - BREATHING_INHALE_MS - BREATHING_HOLD_MS) / BREATHING_EXHALE_MS };
    }
}

// Ease-in-out cubic
function easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Reveal breathing feature based on progressive discovery rules
function maybeShowBreathingHint() {
    const discovered = SunnoStorage.getPreference("breathing_discovered", false);
    if (discovered) {
        // Already unlocked — ensure button is visible
        revealBreatheButton();
        return;
    }

    const conversations = parseInt(SunnoStorage.getPreference("onboarding_conversations", "0"), 10);
    const anxiousCount = SunnoStorage.getPreference("anxious_count", 0);

    if (conversations >= 5 || anxiousCount >= 3) {
        // Show one-time discovery hint 2s after conversation ends
        setTimeout(() => {
            if (state !== "idle") return;
            showBreathingDiscoveryHint();
            SunnoStorage.setPreference("breathing_discovered", true);
            revealBreatheButton();
        }, 2000);
    }
}

function showBreathingDiscoveryHint() {
    // Reuse the .onboarding-hint CSS pattern
    const hint = document.createElement("div");
    hint.className = "onboarding-hint";
    hint.style.top = "auto";
    hint.style.bottom = "20%";
    hint.style.left = "50%";
    hint.style.transform = "translateX(-50%)";

    const text = document.createElement("p");
    text.className = "hint-text";
    text.textContent = "When anxiety hits, I can guide you through breathing. Tap the breathe button any time.";
    hint.appendChild(text);

    const dismiss = document.createElement("button");
    dismiss.className = "hint-dismiss";
    dismiss.textContent = "\u00d7";
    dismiss.addEventListener("click", () => {
        hint.classList.add("fading");
        setTimeout(() => hint.remove(), 400);
    });
    hint.appendChild(dismiss);

    document.body.appendChild(hint);

    // Auto-dismiss after 8s
    setTimeout(() => {
        if (hint.parentNode) {
            hint.classList.add("fading");
            setTimeout(() => hint.remove(), 400);
        }
    }, 8000);
}

function revealBreatheButton() {
    if (breatheBtn && state === "idle") {
        breatheBtn.classList.remove("hidden");
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
    // Pick best supported codec — iOS Safari needs mp4, Chrome/Firefox use webm
    const codecs = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
    const mimeType = codecs.find(c => MediaRecorder.isTypeSupported(c)) || "";
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});

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
    SunnoOnboarding.onOrbTap();
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

orbContainer.addEventListener("pointerleave", (e) => {
    // Only act on pointerleave for hold-to-talk mode, and only if pointer
    // actually left (Firefox fires this aggressively on minor movements)
    clearTimeout(holdTimer);
    if (isHolding && isRecording && e.pointerType !== "touch") {
        // Small delay to avoid false triggers in Firefox
        setTimeout(() => {
            if (isHolding && isRecording) {
                stopRecording();
                isHolding = false;
            }
        }, 100);
    }
});

function startRecording() {
    // Check usage limit before allowing recording
    if (SunnoStorage.isLimitReached()) {
        showPaywall();
        return;
    }

    recordingStartTime = Date.now();

    // ONNX mode: use AudioWorklet + VAD (auto-detects speech end)
    if (pipelineMode === "onnx" && onnxAudioReady) {
        SunnoAudio.startCapture();
        isRecording = true;
        setState("recording");
        statusEl.textContent = "Speak now...";
        if (navigator.vibrate) navigator.vibrate(30);
        return;
    }

    if (caps && caps.stt === "web-speech" && recognition) {
        try {
            recognition.start();
            isRecording = true;
            setState("recording");
            if (navigator.vibrate) navigator.vibrate(30);
        } catch (err) {
            // Recognition may be in terminal state — reinitialize and retry
            console.warn("Recognition start failed, reinitializing:", err.message);
            setupWebSpeech();
            try {
                recognition.start();
                isRecording = true;
                setState("recording");
                if (navigator.vibrate) navigator.vibrate(30);
            } catch (retryErr) {
                console.error("Recognition start failed after reinit:", retryErr);
                isRecording = false;
                setState("idle");
                statusEl.textContent = "Voice recognition unavailable. Try again?";
                setTimeout(() => { if (state === "idle") statusEl.textContent = "Tap to talk"; }, 3000);
            }
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
    // ONNX mode: stop capture (VAD already sent the audio)
    if (pipelineMode === "onnx" && onnxAudioReady) {
        SunnoAudio.stopCapture();
        isRecording = false;
        if (navigator.vibrate) navigator.vibrate(20);
        return;
    }

    if (caps && caps.stt === "web-speech" && recognition) {
        try {
            // recognition.stop() triggers onend, which processes the transcript
            recognition.stop();
        } catch {
            // Ignore if already stopped
            isRecording = false;
            setState("idle");
        }
        if (navigator.vibrate) navigator.vibrate(20);
    } else {
        if (!mediaRecorder || mediaRecorder.state !== "recording") return;
        mediaRecorder.stop();
        // Track speaking time for MediaRecorder path too
        if (recordingStartTime > 0) {
            const elapsedSec = (Date.now() - recordingStartTime) / 1000;
            SunnoStorage.addUsage(elapsedSec);
            recordingStartTime = 0;
            updateRemainingTime();
        }
        isRecording = false;
        setState("thinking");
        if (navigator.vibrate) navigator.vibrate(20);
    }
}

// ── Usage Display & Paywall ──
function updateRemainingTime() {
    if (SunnoStorage.isPremiumUser()) return;
    const remaining = SunnoStorage.getRemainingMinutes();
    const pct = SunnoStorage.getUsagePercent();

    // Show remaining time after first use
    if (remainingTimeEl && pct > 0) {
        remainingTimeEl.classList.remove("hidden");
        const mins = Math.ceil(remaining);
        remainingTimeEl.textContent = `${mins} min remaining today`;
        if (pct >= 80) {
            remainingTimeEl.classList.add("warning");
        } else {
            remainingTimeEl.classList.remove("warning");
        }
    }

    // Show warning banner at 80%
    if (pct >= 80 && pct < 100 && !minuteBannerDismissed && minuteBanner) {
        const mins = Math.ceil(remaining);
        minuteBannerText.textContent = `${mins} minute${mins !== 1 ? "s" : ""} remaining today`;
        minuteBanner.classList.remove("hidden");
    }

    // Show paywall at 100%
    if (pct >= 100) {
        showPaywall();
    }
}

function showPaywall() {
    if (paywallOverlay) paywallOverlay.classList.remove("hidden");
    if (minuteBanner) minuteBanner.classList.add("hidden");
    // Disable orb
    const orb = document.getElementById("orb-container");
    if (orb) orb.style.pointerEvents = "none";
    statusEl.textContent = "Free time used up for today";
}

function hidePaywall() {
    if (paywallOverlay) paywallOverlay.classList.add("hidden");
}

// Paywall event listeners
if (minuteBannerDismiss) {
    minuteBannerDismiss.addEventListener("click", () => {
        minuteBanner.classList.add("hidden");
        minuteBannerDismissed = true;
    });
}

if (paywallDismiss) {
    paywallDismiss.addEventListener("click", hidePaywall);
}

if (waitlistSubmit) {
    waitlistSubmit.addEventListener("click", async () => {
        const email = waitlistEmail.value.trim();
        if (!email || !email.includes("@")) {
            waitlistStatus.textContent = "Please enter a valid email";
            waitlistStatus.style.color = "#e07a5f";
            return;
        }

        waitlistSubmit.disabled = true;
        waitlistSubmit.textContent = "Joining...";

        try {
            const base = window.BACKEND_URL ? `https://${window.BACKEND_URL}` : "";
            const resp = await fetch(`${base}/api/waitlist`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email }),
            });

            if (resp.ok) {
                waitlistStatus.textContent = "You're on the list! We'll reach out soon.";
                waitlistStatus.style.color = "#5a9a6a";
                waitlistEmail.value = "";
                waitlistSubmit.textContent = "Joined!";
            } else {
                throw new Error("Failed");
            }
        } catch {
            waitlistStatus.textContent = "Couldn't save. Try again?";
            waitlistStatus.style.color = "#e07a5f";
            waitlistSubmit.disabled = false;
            waitlistSubmit.textContent = "Join waitlist";
        }
    });
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
        case "breathing":
            // Text is updated by breathing timers — leave current text
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

settingsBtn.addEventListener("click", async () => {
    if (!caps) {
        caps = await SunnoCapabilities.detect();
    }
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

// ── ONNX Pipeline Toggle ──
onnxToggle.addEventListener("click", () => {
    const current = onnxToggle.getAttribute("data-state");
    if (current === "off") {
        onnxToggle.setAttribute("data-state", "on");
        SunnoStorage.setPreference("pipeline_mode", "onnx");
        onnxStatus.textContent = "Switching to ONNX...";
        // Auto-reconnect WebSocket to negotiate ONNX mode
        if (ws) { ws.close(); }
        setTimeout(() => {
            connectWebSocket();
            // Update status once connected
            setTimeout(() => {
                if (pipelineMode === "onnx") {
                    onnxStatus.textContent = "On-device STT + TTS active";
                } else {
                    onnxStatus.textContent = "ONNX not available on server";
                    onnxToggle.setAttribute("data-state", "off");
                }
            }, 2000);
        }, 300);
    } else {
        onnxToggle.setAttribute("data-state", "off");
        SunnoStorage.setPreference("pipeline_mode", "cloud");
        pipelineMode = "cloud";
        onnxStatus.textContent = "Uses cloud APIs";
        onnxAudioReady = false;
        if (ws) { ws.close(); }
        setTimeout(connectWebSocket, 300);
        updateModeIndicator();
    }
});

let toggleBusy = false;
llmToggle.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (toggleBusy) return;
    toggleBusy = true;
    setTimeout(() => { toggleBusy = false; }, 300);

    // Ensure capabilities are detected
    if (!caps) {
        caps = await SunnoCapabilities.detect();
    }

    const currentState = llmToggle.getAttribute("data-state");

    if (currentState === "off") {
        // User wants local — check if possible
        const local = SunnoCapabilities.canGoLocal();
        if (!local.llm) {
            llmStatus.textContent = "Your device doesn't support on-device AI (needs WebGPU)";
            llmStatus.style.color = "#e07a5f";
            setTimeout(() => {
                llmStatus.textContent = "Uses cloud by default";
                llmStatus.style.color = "";
            }, 3000);
            return;
        }

        // Toggle ON — check if model is already cached
        llmToggle.setAttribute("data-state", "on");

        if (caps.llm === "webllm" || SunnoLLM.getIsReady()) {
            // Already running local
        } else {
            // Try to init if cached, otherwise show download option
            SunnoLLM.isModelCached().then(cached => {
                if (cached) {
                    caps.llm = "webllm";
                    SunnoStorage.setPreference("llm_mode", "local");
                    updateModeIndicator();
                    SunnoLLM.init().catch(() => {
                        caps.llm = "groq";
                        llmToggle.setAttribute("data-state", "off");
                        updateModeIndicator();
                        refreshSettingsUI();
                    });
                }
                refreshSettingsUI();
            });
        }
        refreshSettingsUI();
    } else {
        // User wants cloud
        llmToggle.setAttribute("data-state", "off");
        if (caps) caps.llm = "groq";
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

function refreshSettingsUI() {
    // ONNX toggle
    const savedPipeline = SunnoStorage.getPreference("pipeline_mode", "cloud");
    onnxToggle.setAttribute("data-state", savedPipeline === "onnx" ? "on" : "off");
    if (pipelineMode === "onnx") {
        onnxStatus.textContent = "Active — ONNX STT + Emotion + TTS";
    } else if (savedPipeline === "onnx") {
        onnxStatus.textContent = "Enabled — waiting for server confirmation";
    } else {
        onnxStatus.textContent = "Uses cloud APIs by default";
    }

    const local = SunnoCapabilities.canGoLocal();
    const isLocal = caps && caps.llm === "webllm";
    const toggleState = llmToggle.getAttribute("data-state");

    // LLM Status text
    if (!local.llm) {
        llmStatus.textContent = "Not available on this device — needs WebGPU";
        llmStatus.style.color = "#e07a5f";
        llmToggle.style.opacity = "0.3";
        llmToggle.style.pointerEvents = "none";
        llmToggle.setAttribute("data-state", "off");
    } else if (isLocal) {
        llmStatus.textContent = "Running on your device";
    } else if (toggleState === "on") {
        llmStatus.textContent = "Download model to use on-device AI";
    } else {
        llmStatus.textContent = "Uses cloud by default";
    }

    // Show/hide sub-rows
    llmDownloadRow.classList.add("hidden");
    llmProgressRow.classList.add("hidden");
    llmCachedRow.classList.add("hidden");

    if (isLocal) {
        llmCachedRow.classList.remove("hidden");
    } else if (isDownloading) {
        llmProgressRow.classList.remove("hidden");
    } else if (local.llm && toggleState === "on") {
        llmDownloadRow.classList.remove("hidden");
    }

    // Language
    refreshLanguageUI();

    // Mood
    refreshMoodUI();

    // Voice list
    refreshVoiceUI();

    // Ambient
    refreshAmbientUI();

    // Connection
    if (connectionStatus) {
        connectionStatus.textContent = isOnline ? "Connected" : "Offline";
    }
    if (connectionDot) {
        connectionDot.className = `connection-dot ${isOnline ? "online" : "offline"}`;
    }
}

// ── Language UI ──
function refreshLanguageUI() {
    if (!langOptions) return;
    langOptions.innerHTML = "";

    for (const [key, lang] of Object.entries(LANGUAGES)) {
        const pill = document.createElement("button");
        pill.className = "lang-pill" + (key === currentLang ? " active" : "");
        pill.textContent = lang.label;
        pill.addEventListener("click", () => {
            currentLang = key;
            SunnoStorage.setPreference("language", key);
            if (langStatus) langStatus.textContent = lang.name;

            // Update STT language
            if (recognition) {
                recognition.lang = lang.sttCode;
            }

            // Auto-select best voice for this language
            const scored = SunnoCapabilities.getAvailableVoices(key === "auto" ? null : key);
            if (scored.length > 0) {
                SunnoTTS.setVoice(scored[0].voice);
                SunnoStorage.setPreference("selected_voice_key", scored[0].voice.name + "|" + scored[0].voice.lang);
            }

            refreshLanguageUI();
            refreshVoiceUI();
        });
        langOptions.appendChild(pill);
    }

    const active = LANGUAGES[currentLang];
    if (langStatus && active) langStatus.textContent = active.name;
}

// ── Listener Mood UI ──
function refreshMoodUI() {
    if (!moodOptions) return;
    moodOptions.innerHTML = "";

    for (const [key, mood] of Object.entries(LISTENER_MOODS)) {
        const pill = document.createElement("button");
        pill.className = "mood-pill" + (key === currentMood ? " active" : "");
        pill.textContent = mood.label;
        pill.addEventListener("click", () => {
            currentMood = key;
            SunnoStorage.setPreference("listener_mood", key);
            SunnoTTS.setMood(key);
            if (moodStatus) moodStatus.textContent = mood.desc;
            refreshMoodUI();
        });
        moodOptions.appendChild(pill);
    }

    const active = LISTENER_MOODS[currentMood];
    if (moodStatus && active) moodStatus.textContent = active.desc;
}

// ── Voice Selection UI ──
function voiceKey(v) {
    return v.name + "|" + v.lang;
}

function refreshVoiceUI() {
    if (!voiceList) return;
    voiceList.innerHTML = "";

    const langFilter = currentLang === "auto" ? null : currentLang;
    const scored = SunnoCapabilities.getAvailableVoices(langFilter);
    if (scored.length === 0) {
        voiceStatus.textContent = langFilter ? `No ${LANGUAGES[currentLang]?.name || ""} voices available` : "No voices available";
        return;
    }

    const currentVoice = SunnoTTS.getVoice();
    const currentKey = currentVoice ? voiceKey(currentVoice) : null;
    const bestVoice = caps ? caps.bestTTSVoice : null;
    const bestKey = bestVoice ? voiceKey(bestVoice) : null;

    // Group by language
    const LANG_NAMES = { en: "English", hi: "Hindi", ta: "Tamil", te: "Telugu", bn: "Bengali", mr: "Marathi", kn: "Kannada", gu: "Gujarati" };
    const groups = {};
    for (const { voice } of scored) {
        const prefix = voice.lang.substring(0, 2);
        const lang = LANG_NAMES[prefix] || prefix.toUpperCase();
        if (!groups[lang]) groups[lang] = [];
        groups[lang].push(voice);
    }

    for (const [lang, voices] of Object.entries(groups)) {
        const label = document.createElement("div");
        label.className = "voice-group-label";
        label.textContent = lang;
        voiceList.appendChild(label);

        for (const voice of voices) {
            const key = voiceKey(voice);
            const isSelected = key === currentKey;
            const isBest = key === bestKey;

            const item = document.createElement("div");
            item.className = "voice-item" + (isSelected ? " selected" : "");

            const name = document.createElement("span");
            name.className = "voice-item-name";
            name.textContent = voice.name;

            if (isBest) {
                const auto = document.createElement("span");
                auto.className = "voice-item-auto";
                auto.textContent = "(Auto)";
                name.appendChild(auto);
            }

            const preview = document.createElement("button");
            preview.className = "voice-item-preview";
            preview.textContent = "\u25B6";
            preview.title = "Preview";
            preview.addEventListener("click", (e) => {
                e.stopPropagation();
                SunnoTTS.preview("Hi, I'm here to listen.", voice);
            });

            const check = document.createElement("span");
            check.className = "voice-item-check";
            check.textContent = isSelected ? "\u2713" : "";

            item.appendChild(name);
            item.appendChild(preview);
            item.appendChild(check);

            item.addEventListener("click", () => {
                SunnoTTS.setVoice(voice);
                SunnoStorage.setPreference("selected_voice_key", voiceKey(voice));
                voiceStatus.textContent = voice.name;
                refreshVoiceUI();
            });

            voiceList.appendChild(item);
        }
    }

    if (currentVoice) {
        voiceStatus.textContent = currentVoice.name;
    }
}

// ── Ambient Sound UI ──
function refreshAmbientUI() {
    const current = SunnoAmbient.getSound();
    const pills = ambientOptions.querySelectorAll(".ambient-pill");
    pills.forEach(pill => {
        pill.classList.toggle("active", pill.dataset.sound === current);
    });

    // Show volume row only when a sound is active
    if (ambientVolumeRow) {
        ambientVolumeRow.classList.toggle("hidden", current === "silence");
    }

    // Sync slider
    if (ambientVolume) {
        ambientVolume.value = Math.round(SunnoAmbient.getVolume() * 100);
    }
}

// Ambient pill click handlers
ambientOptions.addEventListener("click", (e) => {
    const pill = e.target.closest(".ambient-pill");
    if (!pill) return;

    const sound = pill.dataset.sound;
    SunnoAmbient.setSound(sound);
    if (sound !== "silence") {
        SunnoAmbient.start();
    }
    SunnoStorage.setPreference("ambient_sound", sound);
    refreshAmbientUI();
});

// Volume slider
ambientVolume.addEventListener("input", () => {
    const val = parseInt(ambientVolume.value, 10);
    SunnoAmbient.setVolume(val / 100);
    SunnoStorage.setPreference("ambient_volume", val);
});

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
        dist: 80 + Math.random() * 40,
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
    const baseRadius = Math.min(w, h) * 0.27; // scale to canvas size

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
    } else if (state === "breathing") {
        const phase = getBreathingPhase();
        if (phase) {
            const eased = easeInOut(phase.progress);
            if (phase.phase === "inhale") {
                // Grow from base to base * 1.5
                targetRadius = baseRadius + (baseRadius * 0.5) * eased;
                targetGlow = 0.12 + eased * 0.15;
            } else if (phase.phase === "hold") {
                // Stay expanded, gentle glow pulse
                targetRadius = baseRadius * 1.5;
                targetGlow = 0.27 + Math.sin(orbTime * 2) * 0.03;
            } else { // exhale
                // Shrink back to base
                targetRadius = baseRadius * 1.5 - (baseRadius * 0.5) * eased;
                targetGlow = 0.27 - eased * 0.15;
            }
        } else {
            targetRadius = baseRadius;
            targetGlow = 0.12;
        }
    }

    smoothRadius += (targetRadius - smoothRadius) * 0.12;
    smoothGlow += (targetGlow - smoothGlow) * 0.1;
    const radius = smoothRadius;

    // Outer glow (use arc instead of fillRect to avoid canvas edge artifacts)
    const glowRadius = radius + Math.min(60, Math.min(w, h) * 0.2);
    const gradient = ctx.createRadialGradient(cx, cy, radius * 0.5, cx, cy, glowRadius);
    gradient.addColorStop(0, `rgba(244, 162, 97, ${smoothGlow})`);
    gradient.addColorStop(0.5, `rgba(244, 140, 80, ${smoothGlow * 0.3})`);
    gradient.addColorStop(1, "rgba(244, 162, 97, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
    ctx.fill();

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

// ── Premium Subscription ──

async function checkPremiumStatus(email) {
    try {
        const base = window.BACKEND_URL ? `https://${window.BACKEND_URL}` : "";
        const resp = await fetch(`${base}/api/check-subscription?email=${encodeURIComponent(email)}`);
        const data = await resp.json();
        if (data.premium) {
            SunnoStorage.setPremium(email, data.expires_at);
            applyPremiumState();
        } else {
            SunnoStorage.clearPremium();
            applyFreeState();
        }
    } catch {
        // Fall back to cached localStorage state
        if (SunnoStorage.isPremiumUser()) applyPremiumState();
    }
}

function applyPremiumState() {
    if (premiumBadge) premiumBadge.classList.remove("hidden");
    if (remainingTimeEl) remainingTimeEl.classList.add("hidden");
    if (minuteBanner) minuteBanner.classList.add("hidden");
    hidePaywall();
    // Re-enable orb if it was disabled by paywall
    const orb = document.getElementById("orb-container");
    if (orb) orb.style.pointerEvents = "";
}

function applyFreeState() {
    if (premiumBadge) premiumBadge.classList.add("hidden");
    updateRemainingTime();
}

// Razorpay Checkout
if (subscribeBtn) {
    subscribeBtn.addEventListener("click", async () => {
        const email = premiumEmail.value.trim().toLowerCase();
        if (!email || !email.includes("@")) {
            paymentStatus.textContent = "Please enter a valid email";
            paymentStatus.style.color = "#e07a5f";
            return;
        }

        subscribeBtn.disabled = true;
        paymentStatus.textContent = "Creating order...";
        paymentStatus.style.color = "var(--text-dim)";

        try {
            const base = window.BACKEND_URL ? `https://${window.BACKEND_URL}` : "";
            const orderResp = await fetch(`${base}/api/create-order`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email }),
            });
            const orderData = await orderResp.json();

            if (!orderData.order_id) {
                throw new Error(orderData.message || "Order creation failed");
            }

            const options = {
                key: orderData.key_id,
                amount: orderData.amount,
                currency: orderData.currency,
                name: "Sunno",
                description: "Premium — Unlimited Listening",
                order_id: orderData.order_id,
                prefill: { email },
                theme: { color: "#f4a261" },
                handler: async function(response) {
                    paymentStatus.textContent = "Verifying payment...";
                    try {
                        const verifyResp = await fetch(`${base}/api/verify-payment`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                razorpay_order_id: response.razorpay_order_id,
                                razorpay_payment_id: response.razorpay_payment_id,
                                razorpay_signature: response.razorpay_signature,
                                email,
                            }),
                        });
                        const verifyData = await verifyResp.json();
                        if (verifyData.premium) {
                            SunnoStorage.setPremium(email, verifyData.expires_at);
                            applyPremiumState();
                            hidePaywall();
                            paymentStatus.textContent = "";
                        } else {
                            paymentStatus.textContent = "Verification failed. Contact support.";
                            paymentStatus.style.color = "#e07a5f";
                        }
                    } catch {
                        paymentStatus.textContent = "Verification error. Your payment is safe.";
                        paymentStatus.style.color = "#e07a5f";
                    }
                    subscribeBtn.disabled = false;
                },
                modal: {
                    ondismiss: function() {
                        subscribeBtn.disabled = false;
                        paymentStatus.textContent = "";
                    },
                },
            };

            const rzp = new Razorpay(options);
            rzp.open();
        } catch (err) {
            paymentStatus.textContent = err.message || "Something went wrong. Try again.";
            paymentStatus.style.color = "#e07a5f";
            subscribeBtn.disabled = false;
        }
    });
}

// Restore premium with email
if (restorePremium) {
    restorePremium.addEventListener("click", async (e) => {
        e.preventDefault();
        const email = premiumEmail.value.trim().toLowerCase();
        if (!email || !email.includes("@")) {
            paymentStatus.textContent = "Enter your email above, then tap Restore";
            paymentStatus.style.color = "#e07a5f";
            return;
        }
        paymentStatus.textContent = "Checking...";
        paymentStatus.style.color = "var(--text-dim)";
        await checkPremiumStatus(email);
        if (SunnoStorage.isPremiumUser()) {
            hidePaywall();
            paymentStatus.textContent = "";
        } else {
            paymentStatus.textContent = "No active subscription for this email";
            paymentStatus.style.color = "#e07a5f";
        }
    });
}

// ── Session Recap ──
if (endSessionBtn) {
    endSessionBtn.addEventListener("click", async () => {
        const history = SunnoStorage.getHistory(sessionId);
        if (history.length < 2) return;

        endSessionBtn.textContent = "Reflecting...";
        endSessionBtn.disabled = true;

        try {
            const base = window.BACKEND_URL ? `https://${window.BACKEND_URL}` : "";
            const resp = await fetch(`${base}/api/recap`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ conversation_history: history }),
            });

            if (!resp.ok) throw new Error("Recap failed");
            const data = await resp.json();

            recapSummary.textContent = data.summary || "Thanks for talking.";
            recapMoodDot.setAttribute("data-mood", data.mood || "neutral");
            recapMeta.textContent = `${data.message_count || 0} messages this session`;
            recapOverlay.classList.remove("hidden");
        } catch (err) {
            console.error("Recap error:", err);
            recapSummary.textContent = "Thanks for talking.";
            recapMoodDot.setAttribute("data-mood", "calm");
            recapMeta.textContent = "";
            recapOverlay.classList.remove("hidden");
        } finally {
            endSessionBtn.textContent = "End session";
            endSessionBtn.disabled = false;
        }
    });
}

// Share after session recap
const recapShareBtn = document.getElementById("recap-share");
if (recapShareBtn) {
    recapShareBtn.addEventListener("click", async () => {
        const summary = document.getElementById("recap-summary").textContent;
        const shareText = summary
            ? `"${summary}" — I just talked it out on Sunno. No advice, just someone to listen.`
            : "Sometimes you just need someone to listen. Try Sunno.";
        const shareUrl = "https://sunno.rishmi5h.com";

        if (navigator.share) {
            try {
                await navigator.share({ text: shareText, url: shareUrl });
            } catch { /* user cancelled — fine */ }
        } else {
            // Fallback: copy to clipboard
            try {
                await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
                recapShareBtn.textContent = "Copied!";
                setTimeout(() => { recapShareBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> Share how you\'re feeling'; }, 2000);
            } catch {
                // Last resort: open Twitter
                const encoded = encodeURIComponent(`${shareText} ${shareUrl}`);
                window.open(`https://twitter.com/intent/tweet?text=${encoded}`, "_blank");
            }
        }
    });
}

if (recapClose) {
    recapClose.addEventListener("click", () => {
        recapOverlay.classList.add("hidden");
        // Reset session
        sessionId = (crypto.randomUUID ? crypto.randomUUID() :
            "xxxx-xxxx-xxxx".replace(/x/g, () => ((Math.random() * 16) | 0).toString(16)));
        SunnoStorage.setPreference("msg_count", 0);
        if (endSessionBtn) endSessionBtn.classList.add("hidden");
        if (transcriptArea) transcriptArea.innerHTML = "";
        statusEl.textContent = "Tap to talk";
        // Reconnect WebSocket with new session
        if (ws) ws.close();
        setTimeout(connectWebSocket, 500);
    });
}

// ── Breathe button handler ──
if (breatheBtn) {
    breatheBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (state === "breathing") {
            stopBreathingExercise();
        } else if (state === "idle") {
            startBreathingExercise();
        }
    });
}

// Breathe from settings menu — reveals the breathe button near orb, user taps to start
if (breatheMenuBtn) {
    breatheMenuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        // Close settings panel and reveal the breathe button so user can start when ready
        settingsPanel.classList.add("hidden");
        revealBreatheButton();
        // Highlight the button briefly so the user notices it
        if (breatheBtn) {
            setTimeout(() => {
                breatheBtn.classList.add("pulse");
                setTimeout(() => breatheBtn.classList.remove("pulse"), 2000);
            }, 350);
        }
    });
}

// Tap anywhere during breathing to exit early
document.addEventListener("pointerdown", (e) => {
    if (state === "breathing") {
        // Ignore clicks on the breathe button itself (handled separately)
        if (e.target.closest("#breathe-btn")) return;
        stopBreathingExercise();
    }
});

// ── Onboarding init ──
SunnoOnboarding.initLanding();
