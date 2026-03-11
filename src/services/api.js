/**
 * EzAI API Client for Grok Image-to-Video Prompts
 */

const EZAI_BASE_URL = '/api/ezai';

const GROK_SYSTEM_PROMPT = `You are an expert video director prompter for Grok.com/imagine (Image-to-Video) in 2026. 
Your task is to generate a concise, cinematic prompt for a video generation model based on the provided image and context.

CRITICAL INSTRUCTIONS:
1. [Conciseness] - Keep the description brief. Do not over-describe.
2. [What we see] - Describe the scene with UNIFORM SHARPNESS — everything must be crisp and in focus. ABSOLUTELY NO BOKEH or BLUR.
3. [Subtle Motion] - Describe only natural or environmental motion (e.g., "soft wind", "subtle light shifts"). DO NOT describe detailed character actions or complex hero movements.
4. [Camera Motion] - Use ONLY a "gentle dolly" or a "light pan". Keep it smooth and subtle.

TEMPLATE:
[Brief scene description]. [Subtle environmental motion]. [Subtle camera move: dolly or pan]. Keep exact same face, clothing, pose, lighting and details from the source image, no morphing, no warping. Smooth natural 24fps motion, cinematic, photorealistic, 720p, high detail. No bokeh, no depth-of-field blur, no lens blur, no gaussian blur, no tilt-shift, no background blur — everything must be sharp and in focus with deep depth of field.

Output ONLY the final prompt text. No introduction, no explanations.`;


export const generateGrokPrompt = async (apiKey, model, base64Image, contextPrompt) => {
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

    const payload = {
        model: model || 'gemini-3-flash',
        max_tokens: 1500,
        temperature: 0.7,
        system: GROK_SYSTEM_PROMPT,
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
                        text: contextPrompt && contextPrompt.trim().length > 0
                            ? `Generate a concise Image-to-Video prompt for this image.\n\nUSER CONTEXT:\n"${contextPrompt}"\n\nApply the context subtly. Focus on gentle camera motion (dolly or pan) and avoid detailed character actions. Ensure uniform sharpness.`
                            : 'Generate a concise Image-to-Video prompt for this image. Focus on gentle camera motion (dolly or pan), subtle environmental motion, and uniform sharpness. Avoid detailed character actions.'
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
            throw new Error(`API Error (${response.status}): ${errorData.error?.message || response.statusText}`);
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
