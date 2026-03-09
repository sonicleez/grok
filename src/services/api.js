/**
 * EzAI API Client for Grok Image-to-Video Prompts
 */

const EZAI_BASE_URL = '/api/ezai';

const GROK_SYSTEM_PROMPT = `You are an expert video director prompter for Grok.com/imagine (Image-to-Video) in 2026. 
Your task is to generate a highly detailed, vivid, and rich descriptive prompt for a video generation model based on the provided image and any additional context.

CRITICAL INSTRUCTIONS:
You MUST ALWAYS use this exact "Golden 4-part formula" for your output. Do not skip any parts. Output ONLY the resulting prompt paragraph.

1. [What we see] - A detailed and vivid description of the main subject, setting, ambiance, and lighting. Do not just say "a man", describe his expression, what he is wearing, the background, the mood, and the lighting in detail.
2. [What moves] - Explicitly and richly describe the motion of the subject, natural physics, environment, and facial expressions (e.g., "He gestures intensely with his hands, chest heaving with heavy breaths, hair blowing in the wind, as the background trees sway softly"). Incorporate any USER CONTEXT about tone/emotion/voice here.
3. [Camera motion] - Explicitly describe the cinematic camera movement (e.g., "Slow cinematic push-in", "Gentle dolly forward", "Dynamic tracking shot", "Handheld shaky cam").
4. [Constraints + Style] - ALWAYS append EXACTLY this string at the very end of your response, word for word: "Keep exact same face, clothing, pose, lighting and details from the source image, no morphing, no warping. Smooth natural 24fps motion, cinematic, photorealistic, 720p, high detail."

TEMPLATE (Your output MUST follow this structure):
[Detailed description of what we see]. [Detailed description of what moves]. [Camera motion]. Keep exact same face, clothing, pose, lighting and details from the source image, no morphing, no warping. Smooth natural 24fps motion, cinematic, photorealistic, 720p, high detail.

Output ONLY the final English prompt text. NO INTRODUCTION, NO EXPLANATION, NO MARKDOWN FORMATTING (no bolding, no bullet points). Make the prompt descriptive and rich!`;

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
                            ? `Please generate the highly detailed Image-to-Video prompt for this image using the 4-part formula.\n\nCRUCIAL ADDITIONAL CONTEXT (Tone, Voice, Motion, Emotion from User):\n"${contextPrompt}"\n\nYou MUST incorporate this context deeply into the [What we see], [What moves], and [Camera motion] parts of your prompt. Remember to include the mandatory Constraints + Style text at the end.`
                            : 'Please generate the highly detailed Image-to-Video prompt for this image using the 4-part formula. Describe the subject brightly, outline clear motion, detail the camera movement, and include the mandatory Constraints + Style text at the end.'
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
