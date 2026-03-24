// ── Device Capability Detection ──
// Determines what runs on-device vs cloud fallback
// Respects user preference: cloud-first by default, local after user opts in

const SunnoCapabilities = (() => {
    const caps = {
        stt: "cloud",        // 'web-speech' | 'cloud'
        llm: "cloud",        // 'webllm' | 'groq' | 'cloud'
        tts: "cloud",        // 'speech-synthesis' | 'cloud'
        webgpu: false,
        estimatedMemoryGB: 4,
        availableStorageGB: 0,
        bestTTSVoice: null,
        modelCached: false,
        canUseLLMLocally: false,  // device capable of running WebLLM
    };

    async function detect() {
        // 1. Web Speech API (STT) — always use if available (free, on-device, instant)
        if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
            caps.stt = "web-speech";
        }

        // 2. WebGPU support
        if (navigator.gpu) {
            try {
                const adapter = await navigator.gpu.requestAdapter();
                if (adapter) caps.webgpu = true;
            } catch {
                // WebGPU not available
            }
        }

        // 3. Device memory
        if (navigator.deviceMemory) {
            caps.estimatedMemoryGB = navigator.deviceMemory;
        }

        // 4. Available storage
        if (navigator.storage && navigator.storage.estimate) {
            try {
                const est = await navigator.storage.estimate();
                caps.availableStorageGB = ((est.quota || 0) - (est.usage || 0)) / (1024 ** 3);
            } catch {}
        }

        // 5. Can this device run WebLLM?
        caps.canUseLLMLocally = caps.webgpu && caps.estimatedMemoryGB >= 4 && caps.availableStorageGB > 2;

        // 6. Check if model is already cached
        caps.modelCached = await isModelCached();

        // 7. LLM decision — respect user preference
        const llmPref = SunnoStorage.getPreference("llm_mode", "cloud");
        if (llmPref === "local" && caps.canUseLLMLocally && caps.modelCached) {
            caps.llm = "webllm";
        } else {
            // Default: use Groq (free, fast cloud)
            caps.llm = "groq";
        }

        // 8. SpeechSynthesis voices (TTS) — always use if available (free, on-device)
        caps.bestTTSVoice = await selectBestVoice();
        if (caps.bestTTSVoice) {
            caps.tts = "speech-synthesis";
        }

        console.log("Sunno capabilities:", caps);
        return caps;
    }

    async function isModelCached() {
        try {
            const cacheNames = await caches.keys();
            return cacheNames.some(n => n.includes("webllm") || n.includes("mlc"));
        } catch {
            return false;
        }
    }

    function canGoLocal() {
        return {
            llm: caps.canUseLLMLocally,
            stt: caps.stt === "web-speech",
            tts: caps.tts === "speech-synthesis",
        };
    }

    function selectBestVoice() {
        return new Promise((resolve) => {
            const trySelect = () => {
                const voices = speechSynthesis.getVoices();
                if (voices.length === 0) return null;

                const scored = voices
                    .filter(v => v.lang.startsWith("en") || v.lang.startsWith("hi"))
                    .map(v => ({
                        voice: v,
                        score:
                            (v.localService ? 10 : 0) +
                            (v.lang.includes("IN") ? 5 : 0) +
                            (v.lang.includes("en") ? 2 : 0) +
                            (v.name.includes("Google") ? 3 : 0) +
                            (v.name.includes("Samantha") ? 3 : 0) +
                            (v.name.includes("Rishi") ? 4 : 0) +
                            (v.name.includes("Veena") ? 4 : 0) +
                            (v.name.toLowerCase().includes("india") ? 3 : 0),
                    }))
                    .sort((a, b) => b.score - a.score);

                return scored.length > 0 ? scored[0].voice : null;
            };

            // Voices may not be loaded yet
            const result = trySelect();
            if (result) {
                resolve(result);
                return;
            }

            // Wait for voiceschanged event
            if (speechSynthesis.onvoiceschanged !== undefined) {
                speechSynthesis.onvoiceschanged = () => {
                    resolve(trySelect());
                };
                // Timeout fallback
                setTimeout(() => resolve(trySelect()), 2000);
            } else {
                setTimeout(() => resolve(trySelect()), 500);
            }
        });
    }

    return { detect, caps, canGoLocal, isModelCached };
})();
