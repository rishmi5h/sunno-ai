// ── WebLLM Engine Wrapper ──
// Runs Llama 3.2 3B entirely in-browser via WebGPU
// WebLLM is loaded dynamically via ESM import from CDN

const SunnoLLM = (() => {
    let engine = null;
    let webllmModule = null;
    let isReady = false;
    let isLoading = false;

    const MODEL_ID = "Llama-3.2-3B-Instruct-q4f16_1-MLC";

    // Callbacks for download progress UI
    let onProgress = null;

    function setProgressCallback(cb) {
        onProgress = cb;
    }

    async function init() {
        if (isReady || isLoading) return;
        isLoading = true;

        try {
            // Dynamically import WebLLM from CDN
            if (!webllmModule) {
                webllmModule = await import("https://esm.run/@mlc-ai/web-llm");
            }

            engine = await webllmModule.CreateMLCEngine(MODEL_ID, {
                initProgressCallback: (report) => {
                    console.log(`WebLLM init: ${report.text}`);
                    if (onProgress) {
                        onProgress({
                            text: report.text,
                            progress: report.progress || 0,
                        });
                    }
                },
            });

            isReady = true;
            isLoading = false;
            console.log("WebLLM engine ready");
        } catch (err) {
            isLoading = false;
            console.error("WebLLM init failed:", err);
            throw err;
        }
    }

    const LANG_NAMES = { en: "English", hi: "Hindi", ta: "Tamil", te: "Telugu", bn: "Bengali", mr: "Marathi", kn: "Kannada", gu: "Gujarati" };

    async function generate(transcript, conversationHistory, emotion, mood, language) {
        if (!isReady || !engine) {
            throw new Error("WebLLM engine not initialized");
        }

        // Build messages in OpenAI chat format (WebLLM uses this)
        const systemPrompt = (typeof getListenerPrompt === "function")
            ? getListenerPrompt(mood)
            : LISTENER_SYSTEM_PROMPT;
        const messages = [
            { role: "system", content: systemPrompt },
        ];

        // Add conversation history
        for (const turn of conversationHistory) {
            messages.push({ role: turn.role, content: turn.content });
        }

        // Add current message with language + emotion context
        let userContent = transcript;
        const prefixes = [];
        if (language && language !== "auto" && LANG_NAMES[language]) {
            prefixes.push(`[Respond in ${LANG_NAMES[language]}.]`);
        }
        if (emotion && emotion !== "neutral") {
            prefixes.push(`[The person seems to be feeling ${emotion}.]`);
        }
        if (prefixes.length > 0) {
            userContent = prefixes.join(" ") + "\n\n" + transcript;
        }
        messages.push({ role: "user", content: userContent });

        // Stream response
        let fullText = "";
        const chunks = await engine.chat.completions.create({
            messages,
            max_tokens: 150,
            temperature: 0.8,
            top_p: 0.95,
            stream: true,
        });

        for await (const chunk of chunks) {
            const delta = chunk.choices[0]?.delta?.content || "";
            fullText += delta;
        }

        return fullText.trim();
    }

    function getIsReady() {
        return isReady;
    }

    function getIsLoading() {
        return isLoading;
    }

    async function isModelCached() {
        try {
            const cacheNames = await caches.keys();
            return cacheNames.some(n => n.includes("webllm") || n.includes("mlc"));
        } catch {
            return false;
        }
    }

    async function deleteModel() {
        try {
            const cacheNames = await caches.keys();
            for (const name of cacheNames) {
                if (name.includes("webllm") || name.includes("mlc")) {
                    await caches.delete(name);
                }
            }
            engine = null;
            isReady = false;
            isLoading = false;
            console.log("WebLLM model deleted from cache");
        } catch (err) {
            console.error("Failed to delete model cache:", err);
        }
    }

    function getModelSizeEstimate() {
        return "~1.8 GB";
    }

    return {
        init, generate, setProgressCallback,
        getIsReady, getIsLoading,
        isModelCached, deleteModel, getModelSizeEstimate,
    };
})();
