/**
 * Audio capture, buffering, and playback utilities for ONNX mode.
 * Captures 16kHz mono PCM via AudioWorklet, buffers during speech,
 * and plays back WAV responses.
 */
const SunnoAudio = (() => {
    let audioCtx = null;
    let workletNode = null;
    let stream = null;
    let vadWorker = null;
    let isCapturing = false;
    let isSpeechActive = false;
    let audioBuffer = []; // accumulates PCM chunks during speech

    // Callbacks
    let onSpeechStart = null;
    let onSpeechEnd = null;
    let onVadScore = null;
    let onAudioReady = null; // called with Float32Array when speech ends

    async function init(callbacks = {}) {
        onSpeechStart = callbacks.onSpeechStart || null;
        onSpeechEnd = callbacks.onSpeechEnd || null;
        onVadScore = callbacks.onVadScore || null;
        onAudioReady = callbacks.onAudioReady || null;

        // Create AudioContext
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: 48000, // will resample in worklet
        });

        // Load AudioWorklet
        await audioCtx.audioWorklet.addModule("audio-worklet-processor.js");

        // Init VAD worker
        vadWorker = new Worker("vad-worker.js");
        vadWorker.onmessage = handleVadMessage;

        // Init VAD model — serve from backend or CDN
        const vadModelUrl = window.BACKEND_URL
            ? `https://${window.BACKEND_URL}/models/silero_vad.onnx`
            : "/models/silero_vad.onnx";
        vadWorker.postMessage({ type: "init", modelUrl: vadModelUrl });

        return new Promise((resolve) => {
            const originalHandler = vadWorker.onmessage;
            vadWorker.onmessage = (e) => {
                if (e.data.type === "ready") {
                    vadWorker.onmessage = originalHandler;
                    resolve(true);
                } else if (e.data.type === "error") {
                    console.error("VAD init failed:", e.data.message);
                    vadWorker.onmessage = originalHandler;
                    resolve(false);
                }
            };
        });
    }

    function handleVadMessage(e) {
        const msg = e.data;

        if (msg.type === "vad_score" && onVadScore) {
            onVadScore(msg.score);
        }

        if (msg.type === "speech_start") {
            isSpeechActive = true;
            if (onSpeechStart) onSpeechStart();
        }

        if (msg.type === "speech_end") {
            isSpeechActive = false;
            if (onSpeechEnd) onSpeechEnd();

            // Combine buffered chunks into single Float32Array
            if (audioBuffer.length > 0) {
                const totalLen = audioBuffer.reduce((sum, c) => sum + c.length, 0);
                const combined = new Float32Array(totalLen);
                let offset = 0;
                for (const chunk of audioBuffer) {
                    combined.set(chunk, offset);
                    offset += chunk.length;
                }
                audioBuffer = [];
                if (onAudioReady) onAudioReady(combined);
            }
        }
    }

    async function startCapture() {
        if (isCapturing) return;

        stream = await navigator.mediaDevices.getUserMedia({
            audio: { channelCount: 1, sampleRate: 48000 },
        });

        const source = audioCtx.createMediaStreamSource(stream);
        workletNode = new AudioWorkletNode(audioCtx, "pcm-capture-processor", {
            processorOptions: { sampleRate: audioCtx.sampleRate },
        });

        workletNode.port.onmessage = (e) => {
            if (e.data.type === "pcm_chunk") {
                const chunk = new Float32Array(e.data.data);

                // Feed to VAD
                if (vadWorker) {
                    vadWorker.postMessage({ type: "audio", data: chunk });
                }

                // Buffer if speech is active (or always buffer last 300ms for pre-roll)
                if (isSpeechActive) {
                    audioBuffer.push(chunk);
                }
            }
        };

        source.connect(workletNode);
        workletNode.connect(audioCtx.destination); // needed for processing
        isCapturing = true;
    }

    function stopCapture() {
        if (!isCapturing) return;
        if (workletNode) {
            workletNode.disconnect();
            workletNode = null;
        }
        if (stream) {
            stream.getTracks().forEach((t) => t.stop());
            stream = null;
        }
        audioBuffer = [];
        isSpeechActive = false;
        isCapturing = false;
        if (vadWorker) vadWorker.postMessage({ type: "reset" });
    }

    function float32ToBase64(float32Array) {
        const bytes = new Uint8Array(float32Array.buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    async function playWavBase64(b64Data) {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        const binary = atob(b64Data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        const audioData = await audioCtx.decodeAudioData(bytes.buffer);
        const source = audioCtx.createBufferSource();
        source.buffer = audioData;
        source.connect(audioCtx.destination);
        source.start();
        return new Promise((resolve) => {
            source.onended = resolve;
        });
    }

    function getAudioContext() {
        return audioCtx;
    }

    return {
        init,
        startCapture,
        stopCapture,
        playWavBase64,
        float32ToBase64,
        getAudioContext,
    };
})();
