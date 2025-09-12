export type Mode = 'create' | 'edit';
export type CreateFunction = 'free' | 'sticker' | 'text' | 'comic';
export type EditFunction = 'style' | 'compose';

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
  
  // Create mode state
  createFunction?: CreateFunction;
  aspectRatio?: string;
  
  // Edit mode state
  editFunction?: EditFunction;
  referenceImages?: ReferenceImage[];
  styleIntensity?: number;
}

export interface UploadProgress {
  id: string;
  name: string;
  progress: number;
  status: 'uploading' | 'success' | 'error';
  message?: string;
}