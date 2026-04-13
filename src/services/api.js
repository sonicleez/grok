/**
 * EzAI API Client for Video Prompt Generation
 * Supports dynamic system prompts (Grok, Veo3, Seedance, Kling, Custom...)
 */

const EZAI_BASE_URL = '/api/ezai';

export const generateGrokPrompt = async (apiKey, model, base64Image, contextPrompt, systemPrompt, negativePrompt = '') => {
    if (!apiKey) {
        throw new Error('API Key is missing');
    }

    // Extract raw base64 and MIME type
    let mimeType = 'image/jpeg';
    let pureBase64 = base64Image;

    if (base64Image.startsWith('data:')) {
        const parts = base64Image.split(',');
        if (parts.length > 1) {
            pureBase64 = parts[1];
            mimeType = parts[0].split(':')[1].split(';')[0];
        }
    }

    // Convert OpenAI-style "gemini" to what EzAI might expect, though EzAI handles aliases
    // Anthropic API format explicitly requires valid web image mimes
    const validMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!validMimes.includes(mimeType)) {
        mimeType = 'image/jpeg';
    }

    const baseSystemPrompt = systemPrompt || 'You are an expert video director. Analyze the image and generate a concise, cinematic video prompt.';

    // Always enforce output-only rule regardless of what the user writes in the system prompt
    const finalSystemPrompt = `[HARD CONSTRAINT]
You MUST maintain 100% exact visual continuity with the reference image. Describe the EXACT clothing, EXACT lighting, EXACT physical features, and EXACT environment present in the image. DO NOT hallucinate elements, features, or weather conditions that are not visible.

` + baseSystemPrompt + `

===ABSOLUTE OUTPUT RULE (overrides everything above)===
Output ONLY the final prompt text as a single plain paragraph.
NO explanations. NO options. NO "Option 1 / Option 2". NO markdown. NO headers. NO bullet points. NO labels. NO opening phrases like "Here is..." or "Based on the image...". NO advice or commentary.
Just the raw prompt string. Nothing else.`;

    let userText = `Generate a concise Image-to-Video prompt for this image.`;
    
    if (contextPrompt && contextPrompt.trim().length > 0) {
        userText += `\n\n[DIRECTOR'S OVERRIDE - HIGHEST PRIORITY]\n"${contextPrompt.trim()}"\n(You must enforce this tone, motion, or emotion into the prompt. It overrides visual suggestions if conflicted.)`;
    }
    
    if (negativePrompt && negativePrompt.trim().length > 0) {
        userText += `\n\n[NEGATIVE CONSTRAINTS - STRICTLY FORBIDDEN]\n"${negativePrompt.trim()}"\n(DO NOT include any of these concepts, themes, or objects in the final prompt.)`;
    }

    const payload = {
        model: model || 'gemini-3-flash',
        max_tokens: 1500,
        temperature: 0.7,
        system: finalSystemPrompt,
        messages: [
            {
                role: 'user',
                content: [
                    {
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: mimeType,
                            data: pureBase64
                        }
                    },
                    {
                        type: 'text',
                        text: userText
                    }
                ]
            }
        ]
    };

    try {
        const response = await fetch(`${EZAI_BASE_URL}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'User-Agent': 'EzAI/1.0'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const errMsg = errorData.error?.message || response.statusText;

            // Special handling for 429 rate limit / auth lockout
            if (response.status === 429) {
                const err = new Error(`API Error (429): ${errMsg}`);
                err.isRateLimit = true;
                // Extract "try again in N seconds" from error message
                const match = errMsg.match(/(\d+)\s*second/i);
                err.retryAfter = match ? parseInt(match[1]) : 60;
                throw err;
            }

            throw new Error(`API Error (${response.status}): ${errMsg}`);
        }

        const data = await response.json();

        // Anthropic response format
        if (data.content && data.content.length > 0) {
            return data.content[0].text.trim();
        } else {
            throw new Error('No completion returned from API');
        }
    } catch (error) {
        console.error('generateGrokPrompt error:', error);
        throw error;
    }
};
