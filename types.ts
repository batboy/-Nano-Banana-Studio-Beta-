import { string } from "react-dom/test-utils";

export type Mode = 'create' | 'video' | 'edit';
export type CreateFunction = 'free' | 'sticker' | 'text' | 'comic';
export type VideoFunction = 'prompt' | 'animation';
export type EditFunction = 'montage';
export type AIModel = 'flash' | 'pro';

export interface UploadedImage {
  base64: string;
  mimeType: string;
}

// State for the Create mode
export interface CreateState {
  model: AIModel; // New field to select between Flash (Free-ish) and Pro (Paid Key)
  createFunction: CreateFunction;
  aspectRatio: string;
  resolution: '1K' | '2K' | '4K'; 
  negativePrompt: string;
  styleModifier: string;
  cameraAngle: string;
  lightingStyle: string;
  comicColorPalette: 'vibrant' | 'noir';
}

// State for the Video mode
export interface VideoState {
  videoFunction: VideoFunction;
  videoResolution: '720p' | '1080p'; // New Veo 3.1 feature
  startFrame: UploadedImage | null;
  startFramePreviewUrl: string | null;
}

// State for an individual reference layer in Edit mode
export interface ReferenceLayer {
    id: string;
    image: UploadedImage;
    previewUrl: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    zIndex: number;
}

// State for the Edit mode - now layer-based
export interface EditState {
  editFunction: EditFunction;
  background: UploadedImage | null;
  backgroundPreviewUrl: string | null;
  references: ReferenceLayer[];
  activeReferenceId: string | null;
  negativePrompt: string;
}

// Options for the generateImage API call for better maintainability
export interface GenerateImageOptions extends Omit<CreateState, 'negativePrompt'> {
  prompt: string;
  negativePrompt?: string;
}

// Discriminated union for History entries for type safety
interface BaseHistoryEntry {
  id: string;
  prompt: string;
  mode: Mode;
}

export interface CreateHistoryEntry extends BaseHistoryEntry, CreateState {
  mode: 'create';
  imageUrl: string;
}

export interface VideoHistoryEntry extends BaseHistoryEntry, VideoState {
  mode: 'video';
  videoUrl: string;
}

export interface EditHistoryEntry extends BaseHistoryEntry, Omit<EditState, 'activeReferenceId'> {
  mode: 'edit';
  imageUrl: string;
}

export type HistoryEntry = CreateHistoryEntry | VideoHistoryEntry | EditHistoryEntry;


export interface UploadProgress {
  id: string;
  name: string;
  progress: number;
  status: 'uploading' | 'success' | 'error';
  message?: string;
}