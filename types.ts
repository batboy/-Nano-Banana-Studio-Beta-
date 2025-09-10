
export type Mode = 'create' | 'edit';
export type CreateFunction = 'free' | 'sticker' | 'text' | 'comic';
export type EditFunction = 'add-remove' | 'style' | 'compose';

export interface UploadedImage {
  base64: string;
  mimeType: string;
}

export interface HistoryEntry {
  id: string;
  imageUrl: string;

  // Common state
  prompt: string;
  mode: Mode;
  
  // Create mode state
  createFunction?: CreateFunction;
  aspectRatio?: string;
  
  // Edit mode state
  editFunction?: EditFunction;
  referenceImages?: UploadedImage[];
  referenceImagePreviews?: string[];
  styleIntensity?: number;
}