export type Mode = 'create' | 'edit' | 'video';
export type CreateFunction = 'free' | 'sticker' | 'text' | 'comic';
export type EditFunction = 'compose' | 'style';
export type VideoFunction = 'prompt' | 'animation';

export interface BoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface DetectedObject {
  name: string;
  // FIX: Corrected typo from Bounding-Box to BoundingBox
  box: BoundingBox;
}

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
  imageUrl?: string;
  videoUrl?: string;

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

  // Video mode state
  videoFunction?: VideoFunction;
  startFrame?: UploadedImage;
  startFramePreviewUrl?: string;
}

export interface UploadProgress {
  id: string;
  name: string;
  progress: number;
  status: 'uploading' | 'success' | 'error';
  message?: string;
}