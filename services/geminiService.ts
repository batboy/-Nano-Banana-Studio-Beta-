import { GoogleGenAI, Modality, GenerateContentResponse } from "@google/genai";
import { UploadedImage, EditFunction, ReferenceImage } from '../types';

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

export const generateImage = async (
    prompt: string, 
    createFunction: string, 
    aspectRatio: string,
    negativePrompt: string,
    styleModifier: string,
    cameraAngle: string,
    lightingStyle: string
): Promise<string> => {
    let basePrompt = prompt;
    let styleDescription = '';

    switch (createFunction) {
        case 'sticker':
            styleDescription = `A die-cut sticker of ${basePrompt}, ${styleModifier} style, with a thick white border, on a simple background.`;
            break;
        case 'text':
             styleDescription = `A clean, vector-style logo featuring the text "${basePrompt}", ${styleModifier} design.`;
            break;
        case 'comic':
             styleDescription = `A single comic book panel of ${basePrompt}, ${styleModifier} art style, vibrant colors, bold lines, dynamic action.`;
            break;
        case 'free':
        default:
             styleDescription = `A cinematic, photorealistic image of ${basePrompt}, hyper-detailed, 8K resolution.`;
            break;
    }
    
    // Append camera and lighting modifiers if they are not 'default'
    if (cameraAngle !== 'default') {
        styleDescription += `, ${cameraAngle} shot`;
    }
    if (lightingStyle !== 'default') {
        styleDescription += `, ${lightingStyle} lighting`;
    }

    let response;
    try {
        response = await ai.models.generateImages({
            model: 'imagen-4.0-generate-001',
            prompt: styleDescription,
            config: {
                numberOfImages: 1,
                outputMimeType: 'image/png',
                aspectRatio: aspectRatio,
                ...(negativePrompt && { negativePrompt }),
            },
        });
    } catch (e: any) {
        console.error("Gemini API Error (generateImage):", e);
        throw new Error("Ocorreu um erro na comunicação com a API. Verifique sua conexão e tente novamente.");
    }


    if (response.generatedImages && response.generatedImages.length > 0) {
        const base64ImageBytes: string = response.generatedImages[0].image.imageBytes;
        return `data:image/png;base64,${base64ImageBytes}`;
    }
    
    throw new Error("A geração da imagem falhou. Isso pode ser devido a uma restrição de segurança no seu prompt. Tente reformular sua solicitação.");
};


export const processImagesWithPrompt = async (
    prompt: string,
    mainImage: UploadedImage,
    referenceImages: ReferenceImage[],
    mask: UploadedImage | null,
    editFunction: EditFunction,
    originalSize: { width: number, height: number } | null,
    styleStrength: number
): Promise<string> => {
    const parts = [];
    
    const dimensionInstruction = originalSize
        ? `**CRITICAL RULE**: The output image MUST have the exact same dimensions as the original image: ${originalSize.width}px by ${originalSize.height}px. Do NOT crop, resize, or change the aspect ratio. The entire scene from the original image must be present in the final output, just with the edits applied.`
        : '';
        
    let finalPrompt: string;

    if (editFunction === 'style') {
        if (referenceImages.length === 0) {
            throw new Error("Por favor, adicione uma imagem de referência de estilo.");
        }
        
        // 1. Add the main image (content)
        parts.push({
            inlineData: { data: mainImage.base64, mimeType: mainImage.mimeType }
        });
        
        // 2. Add the style reference image
        const styleImage = referenceImages[0];
        parts.push({
            inlineData: { data: styleImage.image.base64, mimeType: styleImage.image.mimeType }
        });

        const userRequest = prompt || "Aplique o estilo da imagem de referência à imagem de conteúdo.";

        finalPrompt = `
${dimensionInstruction}

**OPERATION: High-Fidelity Style Transfer**

**INPUTS:**
- **Image 1 (CONTENT_IMAGE):** The primary image whose content and composition must be preserved.
- **Image 2 (STYLE_IMAGE):** The reference image providing the artistic style.

**PRIMARY DIRECTIVE:** Your task is to perform a high-fidelity style transfer. You must meticulously analyze the STYLE_IMAGE and replicate its artistic DNA onto the CONTENT_IMAGE. The final output must look as if the content of the CONTENT_IMAGE was originally created by the same artist or method that produced the STYLE_IMAGE.

**STYLE ANALYSIS (CRITICAL):**
Analyze the STYLE_IMAGE for the following elements. This is not just about color, but the entire artistic medium and execution.
- **Medium Emulation:** Is it a photograph, an oil painting, a watercolor, a 3D render, a charcoal sketch, a vector illustration, a comic book panel, pixel art, etc.? Replicate the fundamental properties of this medium.
- **Texture & Brushwork:** Observe and replicate any canvas texture, paper grain, paint strokes, ink lines, digital noise, or rendering artifacts.
- **Color Palette & Grading:** Extract the exact color palette, including saturation, contrast, and overall color grading.
- **Lighting & Shading:** Analyze the lighting model. Is it soft and diffused, or harsh with dramatic shadows? Replicate the quality and direction of light and how it interacts with surfaces.
- **Compositional Elements:** While preserving the CONTENT_IMAGE's composition, incorporate stylistic compositional traits from the STYLE_IMAGE if applicable (e.g., film grain, lens flares, specific focus effects).

**STYLE STRENGTH MODULATION (${styleStrength}%):**
The user has set the style strength to ${styleStrength}%. This dictates your adherence to the STYLE_IMAGE's aesthetic.
- **At 100%:** You must perform a *total stylistic transformation*. The output should be indistinguishable in style from the STYLE_IMAGE. Prioritize style emulation above all else, while still retaining the recognizable content and composition from the CONTENT_IMAGE.
- **At lower percentages:** Gradually blend the styles, allowing more of the CONTENT_IMAGE's original visual characteristics to remain.
- **Your Current Task:** At ${styleStrength}%, apply the style with corresponding intensity.

**USER CONTEXT:**
The user provides this additional guidance for the content: "${userRequest}".

**FINAL GOAL:** Produce a new image that maintains the subject and layout of the CONTENT_IMAGE, but is rendered entirely in the authentic, deeply analyzed style of the STYLE_IMAGE.
`.trim().replace(/\n{2,}/g, '\n');

    } else { // 'compose' logic
        // 1. Add the main image
        parts.push({
            inlineData: { data: mainImage.base64, mimeType: mainImage.mimeType }
        });

        // 2. Add the main image mask immediately after the main image
        if (mask) {
            parts.push({
                inlineData: { data: mask.base64, mimeType: mask.mimeType }
            });
        }

        // 3. Add any reference images and their corresponding masks
        referenceImages.forEach(ref => {
            parts.push({
                inlineData: { data: ref.image.base64, mimeType: ref.image.mimeType }
            });
            if (ref.mask) {
                parts.push({
                    inlineData: { data: ref.mask.base64, mimeType: ref.mask.mimeType }
                });
            }
        });
        
        // --- PROMPT LOGIC ---
        let userRequest: string;
        let contextInstructions: string = '';
        const maskProvided = !!mask;

        userRequest = prompt || (referenceImages.length > 0 ? "Una os elementos das imagens de forma criativa e realista." : "Aplique a edição solicitada na área selecionada.");
        if (!userRequest && !referenceImages.length) {
            throw new Error("Por favor, descreva a edição que você deseja fazer ou adicione uma imagem de referência.");
        }
        
        contextInstructions = `
**OPERATION: Object Insertion**

**RULE #1 (ABSOLUTE):** The output image MUST be identical to the first input image (BASE_IMAGE) in every area that is BLACK in the second input image (MAIN_MASK). Do NOT change the background, lighting, or style of the original scene. Any change outside the WHITE area of the MAIN_MASK is a critical failure.

**INPUTS:**
- **Image 1 (BASE_IMAGE):** The background scene.
- **Image 2 (MAIN_MASK):** The target area for insertion, marked in WHITE.
- **Image 3 (REFERENCE_IMAGE):** Contains the object to be inserted.
- **Image 4 (REFERENCE_MASK):** Isolates the object to be extracted from Image 3, marked in WHITE.
- (Additional reference images and masks may follow in pairs)

**INSTRUCTIONS:**
1.  Precisely extract the object from the REFERENCE_IMAGE using the REFERENCE_MASK.
2.  Place the extracted object into the WHITE area of the MAIN_MASK on the BASE_IMAGE.
3.  Integrate the object seamlessly. Adjust only the object's lighting and shadows to match the BASE_IMAGE.
4.  The user provides this additional context for the integration: "${userRequest}". This context applies ONLY to the inserted object and the immediate blend area, NOT the entire scene.

**GOAL:** The final image should look like the original BASE_IMAGE, but with the new object realistically added in the specified location.
`;
        if (!maskProvided) {
             contextInstructions = `
**OPERATION: General Image Edit**
Follow the user's instructions to edit the image: "${userRequest}". Use the reference images provided for context or style if applicable.
`;
        }
        
        finalPrompt = `
${dimensionInstruction}

${contextInstructions}
`.trim().replace(/\n{2,}/g, '\n');
    }

    parts.push({ text: finalPrompt });

    let response: GenerateContentResponse;
    try {
        response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image-preview',
            contents: { parts: parts },
            config: {
                responseModalities: [Modality.IMAGE, Modality.TEXT],
            },
        });
    } catch(e: any) {
        console.error("Gemini API Error (processImagesWithPrompt):", e);
        throw new Error("Ocorreu um erro na comunicação com a API. Verifique sua conexão e tente novamente.");
    }
    
    const candidate = response.candidates?.[0];

    if (!candidate) {
        const blockReason = response.promptFeedback?.blockReason;
        if (blockReason) {
            return `A edição foi bloqueada por motivos de segurança (${blockReason}). Por favor, ajuste o prompt ou as imagens.`;
        }
        throw new Error("A edição falhou pois o modelo não retornou uma resposta. Sua imagem ou prompt pode ter sido bloqueado.");
    }

    if (candidate.finishReason && candidate.finishReason !== 'STOP') {
        if (candidate.finishReason === 'SAFETY') {
            throw new Error("A edição foi bloqueada por motivos de segurança. Por favor, ajuste o prompt ou as imagens e tente novamente.");
        }
        throw new Error(`A edição falhou com o motivo: ${candidate.finishReason}. Tente um prompt diferente.`);
    }

    for (const part of candidate.content.parts) {
        if (part.inlineData) {
            return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
    }
    
    throw new Error("A edição da imagem falhou. O modelo não retornou uma imagem, o que pode ocorrer com instruções complexas. Tente simplificar seu pedido.");
};