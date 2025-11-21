import { GoogleGenAI, Modality } from "@google/genai";
import type { UploadedImage, GenerateImageOptions } from '../types';

if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable is not set.");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const handleGeminiError = (e: any, context: string): Error => {
    console.error(`Gemini API Error (${context}):`, e);
    const errorMessage = (e?.message || JSON.stringify(e) || '').toLowerCase();

    if (errorMessage.includes('api key not valid')) {
        return new Error("A chave da API é inválida. Por favor, contate o suporte.");
    }
    if (errorMessage.includes('quota') || errorMessage.includes('resource_exhausted')) {
        return new Error(`Sua cota de uso da API foi excedida durante a ${context}. Por favor, tente novamente mais tarde.`);
    }
    if (errorMessage.includes('safety') || errorMessage.includes('blocked')) {
        return new Error(`A ${context} foi bloqueada por motivos de segurança. Por favor, ajuste seu prompt ou imagem.`);
    }
    if (errorMessage.includes('network') || errorMessage.includes('fetch') || errorMessage.includes('failed to fetch')) {
        return new Error(`Ocorreu um erro de rede durante a ${context}. Verifique sua conexão com a internet e tente novamente.`);
    }
    if (errorMessage.includes('400') || errorMessage.includes('invalid argument')) {
        return new Error(`A solicitação para ${context} é inválida. Isso pode ser causado por um prompt malformado ou parâmetros incompatíveis.`);
    }

    return new Error(`Ocorreu um erro inesperado durante a ${context}. A API pode estar temporariamente indisponível. Tente novamente.`);
};

export const fileToBase64 = (file: File): Promise<UploadedImage> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve({ base64, mimeType: file.type });
    };
    reader.onerror = error => reject(error);
  });
};

export const generateVideo = async (
    prompt: string,
    startFrame?: UploadedImage,
    resolution: '720p' | '1080p' = '720p'
): Promise<string> => {
    try {
        const imagePayload = startFrame ? {
            imageBytes: startFrame.base64,
            mimeType: startFrame.mimeType,
        } : undefined;

        // Check for API Key selection if running in AI Studio environment (standard procedure for Veo)
        // This assumes window.aistudio is available in the specific environment, otherwise skips
        if (typeof window !== 'undefined' && (window as any).aistudio) {
            const hasKey = await (window as any).aistudio.hasSelectedApiKey();
            if (!hasKey) {
                 await (window as any).aistudio.openSelectKey();
            }
        }
        
        // Create a fresh instance to ensure key validity if changed via UI
        const currentAi = new GoogleGenAI({ apiKey: process.env.API_KEY });

        let operation = await currentAi.models.generateVideos({
            model: 'veo-3.1-fast-generate-preview', // Upgrade to Veo 3.1
            prompt: prompt,
            ...(imagePayload && { image: imagePayload }),
            config: {
                numberOfVideos: 1,
                resolution: resolution, // Support for 1080p
                aspectRatio: '16:9', // Veo 3.1 Fast usually defaults to standard ratios
            }
        });

        while (!operation.done) {
            await new Promise(resolve => setTimeout(resolve, 10000));
            operation = await currentAi.operations.getVideosOperation({ operation: operation });
        }

        const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
        if (!downloadLink) {
            throw new Error("A geração do vídeo falhou ou não retornou um link para download.");
        }

        const videoResponse = await fetch(`${downloadLink}&key=${process.env.API_KEY}`);
        if (!videoResponse.ok) {
            throw new Error(`Falha ao baixar o vídeo gerado. Status: ${videoResponse.status}`);
        }
        
        const videoBlob = await videoResponse.blob();
        return URL.createObjectURL(videoBlob);

    } catch (e: any) {
        throw handleGeminiError(e, "geração de vídeo");
    }
};

const buildImagePrompt = (options: GenerateImageOptions): string => {
    const {
        prompt,
        createFunction,
        styleModifier,
        cameraAngle,
        lightingStyle,
        comicColorPalette,
        negativePrompt
    } = options;
    const promptParts: string[] = [];

    switch (createFunction) {
        case 'sticker':
            promptParts.push(`A die-cut sticker of ${prompt}`);
            if (styleModifier !== 'default') promptParts.push(`${styleModifier} style`);
            promptParts.push("with a thick white border, on a simple background");
            break;
        case 'text':
            promptParts.push(`A clean, vector-style logo of ${prompt}`);
            if (styleModifier !== 'default') promptParts.push(`${styleModifier} design`);
            break;
        case 'comic':
            promptParts.push(`A single comic book panel of ${prompt}`);
            if (styleModifier === 'Japanese manga') {
                promptParts.push('in a classic Japanese manga style');
                if (comicColorPalette === 'noir') {
                    promptParts.push('black and white, high contrast, heavy use of screentones for shading and texture, dynamic inking with varied line weights, dramatic shadows, G-pen art style');
                } else { // vibrant
                    promptParts.push('vibrant color palette typical of modern manga covers, cel-shading, bold and clean line art, dynamic composition, expressive characters');
                }
            } else {
                if (styleModifier !== 'default') promptParts.push(`${styleModifier} art style`);
                if (comicColorPalette === 'noir') {
                    promptParts.push("noir comic art style, black and white, high contrast, heavy shadows, halftone dot texture");
                } else { // vibrant
                    promptParts.push("vibrant colors, bold lines, dynamic action");
                }
            }
            break;
        case 'free':
        default:
            promptParts.push(`A high quality image of ${prompt}`);
            const lightingDescriptions: { [key: string]: string } = {
                'cinematic': 'film-inspired cinematic lighting with strong contrasts between light and shadow, slightly desaturated or artistically toned colors, focused on a dramatic movie scene atmosphere, with directional lighting to create depth',
                'soft': 'soft, diffused, and homogeneous lighting with gentle, subtle shadows, creating a delicate, cozy, and serene atmosphere, perfect for elegant and natural portraits that soften imperfections',
                'dramatic': 'high-impact dramatic lighting with accentuated chiaroscuro contrast, focusing on specific areas of the subject against a generally dark background to evoke a sense of intensity, mystery, and impact, ideal for artistic portraits',
                'studio': 'professional, controlled, and balanced studio lighting with multiple light sources positioned to highlight details with clarity against a clean, uniform, and neutral background for a polished look',
                'natural': 'lighting that realistically imitates natural sunlight, featuring warm and realistic tones with soft yet present shadows, as if shot outdoors, creating a fresh, organic, and authentic appearance',
            };
            if (lightingStyle !== 'default' && lightingDescriptions[lightingStyle]) {
                promptParts.push(lightingDescriptions[lightingStyle]);
            }
            break;
    }
    
    if (cameraAngle !== 'default') {
        promptParts.push(`${cameraAngle} shot`);
    }
    
    if (createFunction !== 'free' && lightingStyle !== 'default') {
        promptParts.push(`${lightingStyle} lighting`);
    }

    let finalPrompt = promptParts.join(', ');

    if (negativePrompt) {
        finalPrompt += `. Avoid the following: ${negativePrompt}`;
    }

    return finalPrompt;
};

export const generateImage = async (options: GenerateImageOptions): Promise<string> => {
    const finalPrompt = buildImagePrompt(options);

    try {
        // Upgrade to Gemini 3 Pro Image Preview for Create Mode
        // This supports 1K, 2K, 4K via 'imageSize'
        const response = await ai.models.generateContent({
            model: 'gemini-3-pro-image-preview',
            contents: { parts: [{ text: finalPrompt }] },
            config: {
                imageConfig: {
                    aspectRatio: options.aspectRatio,
                    imageSize: options.resolution || "1K"
                }
            },
        });

        // Loop through parts to find the image data (as per Gemini 3 specs)
        if (response.candidates?.[0]?.content?.parts) {
            for (const part of response.candidates[0].content.parts) {
                if (part.inlineData) {
                    const base64EncodeString: string = part.inlineData.data;
                    // Assuming PNG based on model behavior or mimeType from response if available
                    const mimeType = part.inlineData.mimeType || 'image/png';
                    return `data:${mimeType};base64,${base64EncodeString}`;
                }
            }
        }

        throw new Error("A API não retornou dados de imagem.");
        
    } catch (e: any) {
        throw handleGeminiError(e, "geração da imagem (Gemini 3)");
    }
};

export const editImage = async (
    prompt: string,
    image: UploadedImage
): Promise<string> => {
    try {
        const imagePart = { inlineData: { data: image.base64, mimeType: image.mimeType } };
        const textPart = { text: prompt };

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image', // Using Flash for fast editing/reasoning on images
            contents: { parts: [imagePart, textPart] },
            config: {
                responseModalities: [Modality.IMAGE],
            },
        });

        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData && part.inlineData.mimeType?.startsWith('image/')) {
                const base64ImageBytes: string = part.inlineData.data;
                return `data:${part.inlineData.mimeType};base64,${base64ImageBytes}`;
            }
        }
        throw new Error("A API não retornou uma imagem. Tente ajustar o prompt ou as imagens.");

    } catch (e: any) {
        throw handleGeminiError(e, "edição de imagem");
    }
};