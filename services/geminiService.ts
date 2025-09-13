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
    const promptParts: string[] = [];

    // 1. Construir a base do prompt com base na função
    switch (createFunction) {
        case 'sticker':
            promptParts.push(`A die-cut sticker of ${prompt}`);
            if (styleModifier !== 'default') promptParts.push(`${styleModifier} style`);
            promptParts.push("with a thick white border, on a simple background");
            break;
        case 'text':
            promptParts.push(`A clean, vector-style logo featuring the text "${prompt}"`);
            if (styleModifier !== 'default') promptParts.push(`${styleModifier} design`);
            break;
        case 'comic':
            promptParts.push(`A single comic book panel of ${prompt}`);
            if (styleModifier === 'noir comic') {
                promptParts.push("noir comic art style, black and white, high contrast, heavy shadows, halftone dot texture");
            } else {
                if (styleModifier !== 'default') {
                    promptParts.push(`${styleModifier} art style`);
                }
                promptParts.push("vibrant colors, bold lines, dynamic action");
            }
            break;
        case 'free':
        default:
            promptParts.push(`A cinematic, photorealistic image of ${prompt}`);
            promptParts.push("hyper-detailed, 8K resolution");
            break;
    }
    
    // 2. Anexar modificadores avançados se não forem padrão
    if (cameraAngle !== 'default') {
        promptParts.push(`${cameraAngle} shot`);
    }
    if (lightingStyle !== 'default') {
        promptParts.push(`${lightingStyle} lighting`);
    }

    let finalPrompt = promptParts.join(', ');

    // 3. Adicionar o prompt negativo como uma instrução de texto
    if (negativePrompt) {
        finalPrompt += `. Evite o seguinte: ${negativePrompt}`;
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
        const userRequest: string = prompt || "Realize a edição conforme instruído pelas imagens e máscaras.";
        const mainMaskProvided = !!mask;
        const referenceObjectProvided = referenceImages.length > 0 && !!referenceImages[0].mask;

        // Throw an error if there is absolutely no input for the model to work with
        if (!prompt && !mainMaskProvided && referenceImages.length === 0) {
            throw new Error("Por favor, descreva a edição, selecione uma área na imagem principal ou adicione uma imagem de referência para começar a editar.");
        }
        
        let contextInstructions: string;

        if (mainMaskProvided && referenceObjectProvided) {
            // Case 1: Object Insertion. User has masked an area on the main image AND provided a masked reference object.
            contextInstructions = `
**OPERATION: Precision Object Compositing**
**PRIMARY GOAL:** Insert an object from a reference image into a masked area of the base image without altering ANY other part of the base image.

**DIRETIVA CRÍTICA: PRESERVAÇÃO DO FUNDO**
- A imagem de saída final DEVE ser idêntica pixel por pixel à primeira imagem de entrada (BASE_IMAGE) em todas as áreas onde a segunda imagem de entrada (MAIN_MASK) for PRETA.
- Esta é uma regra não negociável. Qualquer alteração, mudança de cor ou re-renderização do fundo (a área com máscara preta) constitui uma falha completa.

**ENTRADAS (em ordem):**
1.  **BASE_IMAGE:** A cena principal. Este é o fundo que deve ser preservado.
2.  **MAIN_MASK:** Uma máscara preta e branca. A área BRANCA é a *única* região onde as alterações são permitidas. A área PRETA deve permanecer intocada.
3.  **REFERENCE_IMAGE:** Contém o objeto a ser inserido.
4.  **REFERENCE_MASK:** Isola o objeto dentro da REFERENCE_IMAGE.

**EXECUÇÃO PASSO A PASSO:**
1.  **Extrair:** Isole o objeto da REFERENCE_IMAGE usando a REFERENCE_MASK.
2.  **Posicionar:** Posicione o objeto extraído na área BRANCA definida pela MAIN_MASK sobre a BASE_IMAGE.
3.  **Integrar:** Mescle perfeitamente o objeto inserido com a BASE_IMAGE. Este processo de mesclagem (ajuste de iluminação, sombras, cor, bordas) deve afetar APENAS os pixels *dentro* da área BRANCA da MAIN_MASK.
4.  **Verificar:** Garanta que o fundo (tudo na área PRETA da MAIN_MASK) não foi alterado em relação à BASE_IMAGE original.

**ORIENTAÇÃO DO USUÁRIO (aplica-se APENAS ao objeto inserido):**
- "${userRequest}"
`;
        } else if (mainMaskProvided) {
            // Case 2: Inpainting. User has masked an area on the main image and provided a text prompt.
            contextInstructions = `
**OPERATION: Masked Image Edit (Inpainting)**
**PRIMARY GOAL:** Edit a specific region of an image based on a text prompt, leaving the rest untouched.

**CRITICAL RULE:** The final output image MUST be identical to the first input image (BASE_IMAGE) in every area that is BLACK in the second input image (THE_MASK). Any change outside the WHITE area of THE_MASK is a failure.

**INPUTS (in order):**
1.  **BASE_IMAGE:** The image to be edited.
2.  **THE_MASK:** The area to edit is marked in WHITE.

**INSTRUCTIONS:**
1.  Modify ONLY the area of the BASE_IMAGE that corresponds to the WHITE region in THE_MASK.
2.  Implement the user's instruction for the edit: "${userRequest}".
3.  If other reference images are provided (without masks), use them for stylistic inspiration for the inpainted area.
`;
        } else {
            // Case 3: General Edit. No mask on the main image. Edits apply globally.
            contextInstructions = `
**OPERATION: General Image Edit**
**PRIMARY GOAL:** Edit the entire image based on a user prompt and any reference images provided.
**INSTRUCTIONS:**
Follow the user's instructions to edit the image: "${userRequest}". Use the provided reference images for context, content, or style as applicable.
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