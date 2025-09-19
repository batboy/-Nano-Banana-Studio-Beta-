import { GoogleGenAI, Modality, GenerateContentResponse } from "@google/genai";
import { UploadedImage, EditFunction, ReferenceImage } from '../types';

if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable is not set.");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const analyzeImageStyle = async (image: UploadedImage): Promise<string> => {
    const model = 'gemini-2.5-flash';
    const prompt = `Analise o estilo artístico da imagem fornecida. Descreva-o de forma concisa em uma lista de palavras-chave separadas por vírgulas, focando em elementos como paleta de cores, textura, tipo de pincelada, iluminação, gênero artístico e humor geral. Seja descritivo e direto. Exemplo: "pintura a óleo impressionista, pinceladas espessas e visíveis, paleta de cores quentes, luz suave da tarde, paisagem serena".`;

    const imagePart = {
        inlineData: {
            data: image.base64,
            mimeType: image.mimeType,
        },
    };

    try {
        const response = await ai.models.generateContent({
            model,
            contents: { parts: [imagePart, { text: prompt }] },
        });

        return response.text.trim();
    } catch (e: any) {
        console.error("Gemini API Error (analyzeImageStyle):", e);
        // Retorne uma string vazia em caso de falha para não quebrar o aplicativo.
        return "";
    }
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

export const generateImage = async (
    prompt: string, 
    createFunction: string, 
    aspectRatio: string,
    negativePrompt: string,
    styleModifier: string,
    cameraAngle: string,
    lightingStyle: string,
    comicColorPalette: 'vibrant' | 'noir'
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
                if (styleModifier !== 'default') {
                    promptParts.push(`${styleModifier} art style`);
                }
                if (comicColorPalette === 'noir') {
                    promptParts.push("noir comic art style, black and white, high contrast, heavy shadows, halftone dot texture");
                } else { // vibrant
                    promptParts.push("vibrant colors, bold lines, dynamic action");
                }
            }
            break;
        case 'free':
        default:
            // Etapa 1: Base de prompt mais neutra, focada no assunto e na qualidade.
            promptParts.push(`A photorealistic, hyper-detailed image of ${prompt}, 8K resolution`);

            // Etapa 2: Adicionar descrições de iluminação detalhadas e impactantes.
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
    
    // Etapa 3: Anexar modificadores adicionais.
    if (cameraAngle !== 'default') {
        promptParts.push(`${cameraAngle} shot`);
    }
    // O modificador de iluminação para o modo 'free' já foi tratado acima com mais detalhes.
    // Para outros modos, usamos a abordagem mais simples.
    if (createFunction !== 'free' && lightingStyle !== 'default') {
        promptParts.push(`${lightingStyle} lighting`);
    }

    let finalPrompt = promptParts.join(', ');

    // Etapa 4: Adicionar o prompt negativo como uma instrução de texto
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
    styleStrength: number,
    negativePrompt: string
): Promise<string> => {
    const parts = [];
    
    const dimensionInstruction = originalSize
        ? `**CRITICAL RULE**: The output image MUST have the exact same dimensions as the original image: ${originalSize.width}px by ${originalSize.height}px. Do NOT crop, resize, or change the aspect ratio. The entire scene from the original image must be present in the final output, just with the edits applied.`
        : '';

    if (editFunction === 'style') {
        if (referenceImages.length === 0) {
            throw new Error("Por favor, adicione uma imagem de referência de estilo.");
        }
        
        const styleImage = referenceImages[0];
        const userRequest = prompt || "aplique o estilo da imagem de referência à imagem de conteúdo.";

        // New prompt logic with interleaved instructions and images for clarity
        parts.push({
            text: `**Tarefa: Transferência de Estilo de Imagem**\n${dimensionInstruction}\n\nVocê receberá duas imagens. A primeira é a **IMAGEM DE CONTEÚDO**. Sua estrutura e composição devem ser preservadas.\nAqui está a IMAGEM DE CONTEÚDO:`
        });
        
        // 1. Content Image
        parts.push({
            inlineData: { data: mainImage.base64, mimeType: mainImage.mimeType }
        });
        
        parts.push({
            text: `Agora, você receberá a **IMAGEM DE ESTILO**. Você deve extrair o estilo artístico completo (cores, texturas, pinceladas, iluminação, etc.) desta imagem e aplicá-lo à IMAGEM DE CONTEÚDO.`
        });
        
        // 2. Style Image
        parts.push({
            inlineData: { data: styleImage.image.base64, mimeType: styleImage.image.mimeType }
        });
        
        parts.push({
            text: `\n**Instruções Finais:**\n1. Renderize a IMAGEM DE CONTEÚDO inteiramente no estilo da IMAGEM DE ESTILO.\n2. Preserve o assunto e a composição da IMAGEM DE CONTEÚDO original.\n3. **Intensidade do Estilo:** Aplique o estilo com uma intensidade de **${styleStrength}%**. Um valor mais alto significa uma correspondência mais próxima com a IMAGEM DE ESTILO.\n4. **Contexto do Usuário:** Considere esta orientação adicional: "${userRequest}".\n\nGere a imagem final agora.`
        });

    } else if (editFunction === 'transform') {
        if (!prompt) {
            throw new Error("Por favor, descreva como você quer transformar a imagem.");
        }
        
        parts.push({
            text: `**Tarefa: Transformação de Imagem Global**\n${dimensionInstruction}\n\nVocê receberá uma imagem e uma instrução em texto. Sua tarefa é re-renderizar a imagem INTEIRA de acordo com a instrução, preservando o assunto principal, mas aplicando a transformação solicitada de forma criativa e coerente.`
        });
        
        // 1. Content Image
        parts.push({
            inlineData: { data: mainImage.base64, mimeType: mainImage.mimeType }
        });
        
        let transformInstructions = `\n**Instrução de Transformação:**\n"${prompt}"`;

        if (negativePrompt) {
            transformInstructions += `\n\n**Restrições (o que evitar):**\n"${negativePrompt}"`;
        }

        transformInstructions += `\n\nGere a imagem final transformada agora.`;

        parts.push({
            text: transformInstructions
        });
        
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

        // Throw an error if there is absolutely no input for the model to work with
        if (!prompt && !mainMaskProvided && referenceImages.length === 0) {
            throw new Error("Por favor, descreva a edição, selecione uma área na imagem principal ou adicione uma imagem de referência para começar a editar.");
        }
        
        let contextInstructions: string;

        if (mainMaskProvided) {
            // The model is trained to understand that a mask following an image indicates the area to edit.
            // A simpler, more direct prompt combined with client-side compositing is more reliable.
            // The client will handle preserving the unmasked areas of the image.
            contextInstructions = `
**INSTRUÇÃO:** Você é um editor de fotos especialista. Edite a imagem principal na área indicada pela máscara.
**PEDIDO DO USUÁRIO:** "${userRequest}"

Se imagens de referência forem fornecidas, use-as como inspiração de conteúdo ou estilo para a área editada.
Gere a imagem inteira com a modificação solicitada aplicada de forma natural e coesa.
`;
        } else {
            // Case: General Edit. No mask on the main image. Edits apply globally.
            contextInstructions = `
**OPERATION: General Image Edit**
**PRIMARY GOAL:** Edit the entire image based on a user prompt and any reference images provided.
**INSTRUCTIONS:**
Follow the user's instructions to edit the image: "${userRequest}". Use the provided reference images for context, content, or style as applicable.
`;
        }
        
        const finalPrompt = `
${dimensionInstruction}

${contextInstructions}
`.trim().replace(/\n{2,}/g, '\n');
        parts.push({ text: finalPrompt });
    }

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