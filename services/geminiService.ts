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

    let response;
    try {
        response = await ai.models.generateImages({
            model: 'imagen-4.0-generate-001',
            prompt: finalPrompt,
            config: {
                numberOfImages: 1,
                outputMimeType: 'image/png',
                aspectRatio: aspectRatio,
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
    styleIntensity?: number
): Promise<string> => {
    const parts = [];

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
1.  **IMAGE ROLES:** The very first image is the **CONTENT IMAGE**. ${maskProvided ? 'The second image is a MASK for the content image.' : ''} All subsequent images are **STYLE REFERENCE IMAGES**.
2.  **PRESERVE CONTENT:** You MUST preserve the subject, objects, composition, and overall layout of the CONTENT IMAGE. Do NOT copy, introduce, or blend any subjects or objects from the STYLE REFERENCE IMAGES.
3.  **APPLY STYLE:** You must ONLY extract the artistic style (e.g., color palette, textures, brushstrokes, lighting, mood) from the STYLE REFERENCE IMAGES and apply it to the CONTENT IMAGE.
4.  **INTENSITY:** The desired intensity of the style transfer is: **${intensityDescription}**.
`.trim();

            if (maskProvided) {
                 contextInstructions += `
**MASK INSTRUCTION:** You MUST apply the style transfer exclusively within the WHITE area of the provided MASK. The BLACK (unmasked) area must remain 100% unchanged and preserved from the original CONTENT IMAGE.`;
            }

            if (styleIntensity && styleIntensity >= 4) {
                contextInstructions += `

**ABSOLUTE RULE:** Because a high intensity ("${intensityDescription}") is requested, be extra careful. It is FORBIDDEN to transfer any recognizable objects or shapes from the style references. The goal is a stylistic transformation, NOT a content merge. For example, if the content is a cat and the style is a Van Gogh painting, the output should be a cat painted *like* Van Gogh, not a cat merged with elements from the specific painting.`;
            }
            break;

        case 'compose':
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
            break;
    }
    
    const dimensionInstruction = originalSize
        ? `**CRITICAL RULE**: The output image MUST have the exact same dimensions as the original image: ${originalSize.width}px by ${originalSize.height}px. Do NOT crop, resize, or change the aspect ratio. The entire scene from the original image must be present in the final output, just with the edits applied.`
        : '';

    const finalPrompt = `
${dimensionInstruction}

${contextInstructions}
`.trim().replace(/\n{2,}/g, '\n');

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