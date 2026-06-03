const OLLAMA_PROXY_BASE_URL = '/api/ollama';

export const DEFAULT_VISION_MODEL = 'gemini-3-flash-preview:cloud';

export const VISION_MODEL_OPTIONS = [
    {
        value: DEFAULT_VISION_MODEL,
        label: 'Gemini 3 Flash Preview Cloud',
        disabled: false,
    },
    {
        value: 'kimi-k2.6:cloud',
        label: 'Kimi K2.6 Cloud (image API currently failing)',
        disabled: true,
    },
    {
        value: 'qwen3.6:35b',
        label: 'Qwen3.6 35B (not available on Ollama Cloud API)',
        disabled: true,
    },
];

export const isSupportedVisionModel = (model) =>
    VISION_MODEL_OPTIONS.some(option => option.value === model && !option.disabled);

export const isVisionProviderConfigured = ({ apiKey, model } = {}) =>
    Boolean(apiKey?.trim() && isSupportedVisionModel(model));

export const generateGrokPrompt = async (apiKey, model, base64Image, contextPrompt, systemPrompt, negativePrompt = '') => {
    if (!apiKey?.trim()) {
        throw new Error('Ollama Cloud API key is missing.');
    }

    if (!model?.trim()) {
        throw new Error('Ollama model is missing.');
    }

    let mimeType = 'image/jpeg';
    let pureBase64 = base64Image;
    if (base64Image?.startsWith('data:')) {
        const parts = base64Image.split(',');
        if (parts.length > 1) {
            pureBase64 = parts[1];
            mimeType = parts[0].split(':')[1]?.split(';')[0] || mimeType;
        }
    }

    const baseSystemPrompt = systemPrompt || 'You are an expert video director. Analyze the image and generate a concise, cinematic video prompt.';
    const finalSystemPrompt = `[HARD CONSTRAINT]
You MUST maintain 100% exact visual continuity with the reference image. Describe the EXACT clothing, EXACT lighting, EXACT physical features, and EXACT environment present in the image. DO NOT hallucinate elements, features, or weather conditions that are not visible.

${baseSystemPrompt}

===ABSOLUTE OUTPUT RULE (overrides everything above)===
Output ONLY the final prompt text as a single plain paragraph.
NO explanations. NO options. NO "Option 1 / Option 2". NO markdown. NO headers. NO bullet points. NO labels. NO opening phrases like "Here is..." or "Based on the image...". NO advice or commentary.
Just the raw prompt string. Nothing else.`;

    let userText = 'Generate a concise Image-to-Video prompt for this image.';

    if (contextPrompt && contextPrompt.trim().length > 0) {
        userText += `\n\n[DIRECTOR'S OVERRIDE - HIGHEST PRIORITY]\n"${contextPrompt.trim()}"\n(You must enforce this tone, motion, or emotion into the prompt. It overrides visual suggestions if conflicted.)`;
    }

    if (negativePrompt && negativePrompt.trim().length > 0) {
        userText += `\n\n[NEGATIVE CONSTRAINTS - STRICTLY FORBIDDEN]\n"${negativePrompt.trim()}"\n(DO NOT include any of these concepts, themes, or objects in the final prompt.)`;
    }

    const payload = {
        model,
        max_tokens: 1500,
        temperature: 0.7,
        messages: [
            {
                role: 'system',
                content: finalSystemPrompt,
            },
            {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: userText,
                    },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:${mimeType};base64,${pureBase64}`,
                        },
                    },
                ],
            },
        ],
    };

    try {
        const response = await fetch(`${OLLAMA_PROXY_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey.trim()}`,
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const errMsg = errorData.error?.message || errorData.error || errorData.message || response.statusText;

            if (response.status === 429) {
                const err = new Error(`API Error (429): ${errMsg}`);
                err.isRateLimit = true;
                err.retryAfter = Number(response.headers.get('retry-after')) || 60;
                throw err;
            }

            if (response.status === 401 || response.status === 403) {
                const err = new Error(`API Error (${response.status}): ${errMsg}`);
                err.isAuthError = true;
                err.userMessage = 'Ollama Cloud rejected the API key or this account cannot access the selected model.';
                throw err;
            }

            throw new Error(`API Error (${response.status}): ${errMsg}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;

        if (content?.trim()) {
            return content.trim();
        }

        throw new Error('No completion returned from Ollama Cloud');
    } catch (error) {
        console.error('generateGrokPrompt error:', error);
        throw error;
    }
};
