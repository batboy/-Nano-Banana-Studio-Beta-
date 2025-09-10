import { GoogleGenAI, Modality, GenerateContentResponse } from "@google/genai";
import { UploadedImage, EditFunction } from '../types';

if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable is not set.");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

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

export const generateImage = async (prompt: string, createFunction: string, aspectRatio: string): Promise<string> => {
    let finalPrompt = prompt;
    switch (createFunction) {
        case 'sticker':
            finalPrompt = `A cute die-cut sticker of ${prompt}, cartoon style, with a thick white border, on a white background.`;
            break;
        case 'text':
            finalPrompt = `A clean, modern, vector-style logo featuring the text "${prompt}". Minimalist design, high contrast, suitable for a tech company.`;
            break;
        case 'comic':
            finalPrompt = `A single comic book panel of ${prompt}, American comic book art style, vibrant colors, bold lines, dynamic action.`;
            break;
        case 'free':
        default:
             finalPrompt = `A cinematic, photorealistic image of ${prompt}, hyper-detailed, 8K resolution.`;
            break;
    }

    const response = await ai.models.generateImages({
        model: 'imagen-4.0-generate-001',
        prompt: finalPrompt,
        config: {
            numberOfImages: 1,
            outputMimeType: 'image/png',
            aspectRatio: aspectRatio,
        },
    });

    if (response.generatedImages && response.generatedImages.length > 0) {
        const base64ImageBytes: string = response.generatedImages[0].image.imageBytes;
        return `data:image/png;base64,${base64ImageBytes}`;
    }
    throw new Error("Image generation failed or returned no images.");
};


export const processImagesWithPrompt = async (
    prompt: string,
    mainImage: UploadedImage,
    referenceImages: UploadedImage[],
    mask: UploadedImage | null,
    editFunction: EditFunction,
    originalSize: { width: number, height: number } | null,
    styleIntensity?: number
): Promise<string> => {
    const parts = [];

    // 1. Add the main image
    parts.push({
        inlineData: { data: mainImage.base64, mimeType: mainImage.mimeType }
    });

    // 2. Add the mask immediately after the main image for correct context
    if (mask) {
        parts.push({
            inlineData: { data: mask.base64, mimeType: mask.mimeType }
        });
    }

    // 3. Add any reference images
    const referenceImageParts = referenceImages.map(image => ({
        inlineData: { data: image.base64, mimeType: image.mimeType }
    }));
    parts.push(...referenceImageParts);

    // --- PROMPT LOGIC ---
    let userRequest: string;
    let contextInstructions: string = '';

    switch (editFunction) {
        case 'style':
            if (referenceImages.length === 0) {
                throw new Error("Para transferência de estilo, você deve enviar uma imagem de referência.");
            }
             const intensityMap: { [key: number]: string } = {
                1: 'a very subtle hint of the style',
                2: 'a subtle application of the style',
                3: 'a moderate and balanced application of the style',
                4: 'a strong and noticeable application of the style',
                5: 'a very strong and prominent application of the style, transforming the original image completely while preserving its core subject and composition',
            };
            const intensityDescription = styleIntensity ? intensityMap[styleIntensity] : 'a moderate and balanced application of the style';

            userRequest = prompt || `Apply the style as instructed.`;
            
            contextInstructions = `
**CRITICAL INSTRUCTIONS FOR STYLE TRANSFER:**
1.  **IMAGE ROLES:** The very first image is the **CONTENT IMAGE**. All subsequent images are **STYLE REFERENCE IMAGES**.
2.  **PRESERVE CONTENT:** You MUST preserve the subject, objects, composition, and overall layout of the CONTENT IMAGE. Do NOT copy, introduce, or blend any subjects or objects from the STYLE REFERENCE IMAGES.
3.  **APPLY STYLE:** You must ONLY extract the artistic style (e.g., color palette, textures, brushstrokes, lighting, mood) from the STYLE REFERENCE IMAGES and apply it to the CONTENT IMAGE.
4.  **INTENSITY:** The desired intensity of the style transfer is: **${intensityDescription}**.
`.trim();

            if (styleIntensity && styleIntensity >= 4) {
                contextInstructions += `

**ABSOLUTE RULE:** Because a high intensity ("${intensityDescription}") is requested, be extra careful. It is FORBIDDEN to transfer any recognizable objects or shapes from the style references. The goal is a stylistic transformation, NOT a content merge. For example, if the content is a cat and the style is a Van Gogh painting, the output should be a cat painted *like* Van Gogh, not a cat merged with elements from the specific painting.`;
            }
            break;

        case 'compose':
            if (referenceImages.length === 0) {
                throw new Error("Para unir imagens, você deve enviar uma imagem de referência.");
            }
            userRequest = prompt || "Combine the elements of the images creatively.";
            contextInstructions = `Image 1 is the target canvas. The other images are references containing elements to be blended.`;
            break;
        
        case 'add-remove':
        default:
            userRequest = prompt;
             if (!userRequest) {
                 throw new Error("Por favor, descreva a edição que você deseja fazer.");
            }
            if (mask) {
                contextInstructions = `Image 1 is the original image. Image 2 is the edit mask. Apply the request ONLY to the WHITE area of the mask. The BLACK area must remain 100% unchanged. The edit must blend seamlessly.`;
            } else {
                contextInstructions = `Image 1 is the target image to be modified. Use any other images as references to guide the modification.`;
            }
            break;
    }
    
    const dimensionInstruction = originalSize
        ? `**CRITICAL RULE**: The output image MUST have the exact same dimensions as the original image: ${originalSize.width}px by ${originalSize.height}px. Do NOT crop, resize, or change the aspect ratio. The entire scene from the original image must be present in the final output, just with the edits applied.`
        : '';

    const finalPrompt = `
${dimensionInstruction}

User request: "${userRequest}"

${contextInstructions}
`.trim().replace(/\n{2,}/g, '\n');

    parts.push({ text: finalPrompt });

    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: { parts: parts },
        config: {
            responseModalities: [Modality.IMAGE, Modality.TEXT],
        },
    });
    
    for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
            // Return the raw image from the model, without any client-side resizing.
            return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
    }
    
    throw new Error("A edição da imagem falhou. O modelo pode ter retornado texto em vez de uma imagem. Tente um prompt diferente.");
};