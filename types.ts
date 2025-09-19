export type Mode = 'create' | 'edit';
export type CreateFunction = 'free' | 'sticker' | 'text' | 'comic';
export type EditFunction = 'compose' | 'style' | 'transform';

export interface UploadedImage {
  base64: string;
  mimeType: string;
}

export interface ReferenceImage {
  image: UploadedImage;
  previewUrl: string;
  mask: UploadedImage | null;
  maskedObjectPreviewUrl?: string;
}

export interface HistoryEntry {
  id: string;
  imageUrl: string;

  // Common state
  prompt: string;
  mode: Mode;
  negativePrompt?: string;
  
  // Create mode state
  createFunction?: CreateFunction;
  aspectRatio?: string;
  comicColorPalette?: 'vibrant' | 'noir';
  
  // Edit mode state
  editFunction?: EditFunction;
  referenceImages?: ReferenceImage[];
  styleStrength?: number;
}

export interface UploadProgress {
  id: string;
  name: string;
  progress: number;
  status: 'uploading' | 'success' | 'error';
  message?: string;
}
