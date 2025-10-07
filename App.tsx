import React, { useState, useCallback, ChangeEvent, useEffect, useRef, useImperativeHandle, forwardRef, useMemo } from 'react';
import type { Mode, CreateFunction, EditFunction, UploadedImage, HistoryEntry, UploadProgress, ReferenceImage, DetectedObject, VideoFunction } from './types';
import { generateImage, processImagesWithPrompt, analyzeImageStyle, detectObjects, generateVideo, generateObjectMask } from './services/geminiService';
import * as Icons from './Icons';

// Reusable Slider Component
const Slider: React.FC<{
    label?: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    'aria-label': string;
    sliderWidthClass?: string;
}> = ({ label, value, min, max, step, onChange, 'aria-label': ariaLabel, sliderWidthClass = 'w-24' }) => {
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (inputRef.current) {
            const rangeInput = inputRef.current;
            const percentage = ((value - min) * 100) / (max - min);
            rangeInput.style.background = `linear-gradient(to right, #3b82f6 ${percentage}%, #3f3f46 ${percentage}%)`;
        }
    }, [value, min, max]);

    return (
        <div className="flex items-center gap-2">
            {label && <label className="text-xs text-zinc-400 whitespace-nowrap">{label}</label>}
            <input
                ref={inputRef}
                type="range"
                min={min}
                max={max}
                step={step || 1}
                value={value}
                onChange={onChange}
                className={`custom-slider ${sliderWidthClass}`}
                aria-label={ariaLabel}
            />
        </div>
    );
};

const ToolbarButton: React.FC<{
  'data-function': string;
  isActive: boolean;
  onClick: (func: any) => void;
  icon: React.ReactNode;
  name: string;
}> = ({ 'data-function': dataFunction, isActive, onClick, icon, name }) => (
  <button
    data-function={dataFunction}
    onClick={() => onClick(dataFunction)}
    title={name}
    className={`relative flex items-center justify-center p-3 rounded-lg cursor-pointer transition-colors duration-200 w-full aspect-square group
      ${isActive ? 'bg-zinc-700 text-zinc-100' : 'hover:bg-zinc-800 text-zinc-400'
    }`}
  >
    {icon}
    {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 bg-blue-500 rounded-r-full"></div>}
  </button>
);


const PanelSection: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }> = ({ title, icon, children, defaultOpen = true }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className="border-b border-zinc-800">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-2 text-xs font-bold text-zinc-300 hover:bg-zinc-800/50"
                aria-expanded={isOpen}
                title={`Expandir/recolher ${title}`}
            >
                <div className="flex items-center gap-2">
                    {icon}
                    <span className="uppercase tracking-wider">{title}</span>
                </div>
                <Icons.ChevronDown className={`transition-transform duration-200 text-base ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && <div className="p-3 space-y-3">{children}</div>}
        </div>
    );
};


interface ImageEditorProps {
  src: string;
  activeEditFunction: EditFunction | null;
  detectedObjects: DetectedObject[];
  highlightedObject: DetectedObject | null;
  zoom: number;
}

interface ImageEditorRef {
  getMaskData: () => UploadedImage | null;
  getMaskAsCanvas: () => HTMLCanvasElement | null;
  hasMaskData: () => boolean;
  getOriginalImageSize: () => { width: number, height: number } | null;
  clearMask: () => void;
  clearOverlays: () => void;
  stampObjectOnMask: (data: { previewUrl: string, placerTransform: any, maskOpacity: number }) => void;
}

const ImageEditor = forwardRef<ImageEditorRef, ImageEditorProps>(({ src, activeEditFunction, detectedObjects, highlightedObject, zoom }, ref) => {
    const imageCanvasRef = useRef<HTMLCanvasElement>(null);
    const maskCanvasRef = useRef<HTMLCanvasElement>(null);
    const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const originalImageSizeRef = useRef<{ width: number, height: number }>({ width: 0, height: 0 });
    const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
    const panRef = useRef({ isPanning: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 });

    const clearOverlays = useCallback(() => {
        const canvas = overlayCanvasRef.current;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx?.clearRect(0, 0, canvas.width, canvas.height);
        }
    }, []);

    const clearMask = useCallback(() => {
        const canvas = maskCanvasRef.current;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx?.clearRect(0, 0, canvas.width, canvas.height);
        }
    }, []);
    
    useEffect(() => {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.src = src;
        image.onload = () => {
            originalImageSizeRef.current = { width: image.width, height: image.height };
            setImageDimensions({ width: image.width, height: image.height });
            
            const imageCanvas = imageCanvasRef.current;
            const maskCanvas = maskCanvasRef.current;
            const overlayCanvas = overlayCanvasRef.current;
            if (!imageCanvas || !maskCanvas || !overlayCanvas) return;

            imageCanvas.width = image.width;
            imageCanvas.height = image.height;
            maskCanvas.width = image.width;
            maskCanvas.height = image.height;
            overlayCanvas.width = image.width;
            overlayCanvas.height = image.height;

            const ctx = imageCanvas.getContext('2d');
            ctx?.drawImage(image, 0, 0);
            clearMask();
            clearOverlays();
        };
    }, [src, clearMask, clearOverlays]);

    useEffect(() => {
        const overlayCanvas = overlayCanvasRef.current;
        const ctx = overlayCanvas?.getContext('2d');
        const { width: imgWidth, height: imgHeight } = originalImageSizeRef.current;

        if (!ctx || !overlayCanvas || imgWidth === 0 || !detectedObjects) return;

        ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

        detectedObjects.forEach(obj => {
            const isHighlighted = highlightedObject &&
                highlightedObject.name === obj.name &&
                JSON.stringify(highlightedObject.box) === JSON.stringify(obj.box);

            const x = obj.box.x1 * imgWidth;
            const y = obj.box.y1 * imgHeight;
            const w = (obj.box.x2 - obj.box.x1) * imgWidth;
            const h = (obj.box.y2 - obj.box.y1) * imgHeight;

            // Box
            ctx.strokeStyle = isHighlighted ? '#facc15' : '#3b82f6';
            ctx.lineWidth = isHighlighted ? 3 : 1.5;
            ctx.strokeRect(x, y, w, h);

            // Label
            const label = obj.name;
            ctx.font = 'bold 14px Inter, sans-serif';
            const textMetrics = ctx.measureText(label);
            const textWidth = textMetrics.width;
            const textHeight = 14;
            const padding = 4;

            ctx.fillStyle = isHighlighted ? '#facc15' : '#3b82f6';
            ctx.fillRect(x, y - (textHeight + padding), textWidth + padding * 2, textHeight + padding);
            
            ctx.fillStyle = '#18181b';
            ctx.fillText(label, x + padding, y - (padding / 2) + 1);
        });

    }, [detectedObjects, highlightedObject]);
    
    useEffect(() => {
        const container = containerRef.current;
        if (container) {
            const canPan = container.scrollWidth > container.clientWidth || container.scrollHeight > container.clientHeight;
            if (canPan) {
                container.style.cursor = 'grab';
            } else {
                container.style.cursor = 'default';
            }
        }
    }, [imageDimensions, zoom]);

    useImperativeHandle(ref, () => {
        const getMaskAsCanvas = () => {
            const maskCanvas = maskCanvasRef.current;
            if (!maskCanvas) return null;

            const finalMaskCanvas = document.createElement('canvas');
            finalMaskCanvas.width = maskCanvas.width;
            finalMaskCanvas.height = maskCanvas.height;
            const finalCtx = finalMaskCanvas.getContext('2d', { willReadFrequently: true });
            if (!finalCtx) return null;

            finalCtx.drawImage(maskCanvas, 0, 0);

            const imageData = finalCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
            const data = imageData.data;
            let hasMask = false;
            for (let i = 0; i < data.length; i += 4) {
                if (data[i + 3] > 10) {
                    data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
                    hasMask = true;
                } else {
                    data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
                }
            }

            if (!hasMask) return null;

            finalCtx.putImageData(imageData, 0, 0);
            return finalMaskCanvas;
        };
        
        return {
            getMaskAsCanvas,
            getMaskData: () => {
                const finalMaskCanvas = getMaskAsCanvas();
                if (!finalMaskCanvas) return null;
                
                const dataUrl = finalMaskCanvas.toDataURL('image/png');
                const base64 = dataUrl.split(',')[1];
                return { base64, mimeType: 'image/png' };
            },
            hasMaskData: () => {
                const maskCanvas = maskCanvasRef.current;
                if (!maskCanvas) return false;
                const ctx = maskCanvas.getContext('2d', { willReadFrequently: true });
                if (!ctx) return false;
                const imageData = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
                for (let i = 3; i < imageData.data.length; i += 4) {
                    if (imageData.data[i] > 10) { 
                        return true;
                    }
                }
                return false;
            },
            getOriginalImageSize: () => {
                return originalImageSizeRef.current.width > 0 ? originalImageSizeRef.current : null;
            },
            clearMask,
            clearOverlays,
            stampObjectOnMask: (data) => {
                const maskCanvas = maskCanvasRef.current;
                const container = containerRef.current;
                if (!maskCanvas || !container) return;

                const ctx = maskCanvas.getContext('2d');
                if (!ctx) return;
                
                const { placerTransform } = data;
                
                const leftOffset = Math.max(0, (container.clientWidth - imageDimensions.width * zoom) / 2);
                const topOffset = Math.max(0, (container.clientHeight - imageDimensions.height * zoom) / 2);

                const canvasX = (container.scrollLeft + placerTransform.x - leftOffset) / zoom;
                const canvasY = (container.scrollTop + placerTransform.y - topOffset) / zoom;
                const canvasWidth = placerTransform.width / zoom;
                const canvasHeight = placerTransform.height / zoom;
                
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.onload = () => {
                    const tempStampCanvas = document.createElement('canvas');
                    tempStampCanvas.width = maskCanvas.width;
                    tempStampCanvas.height = maskCanvas.height;
                    const tempCtx = tempStampCanvas.getContext('2d');
                    if (!tempCtx) return;

                    tempCtx.save();
                    tempCtx.translate(canvasX + canvasWidth / 2, canvasY + canvasHeight / 2);
                    tempCtx.rotate((placerTransform.rotation * Math.PI) / 180);
                    tempCtx.drawImage(img, -canvasWidth / 2, -canvasHeight / 2, canvasWidth, canvasHeight);
                    tempCtx.restore();

                    const imageData = tempCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
                    const pixelData = imageData.data;
                    for (let i = 0; i < pixelData.length; i += 4) {
                        if (pixelData[i + 3] > 0) {
                            pixelData[i] = 74;
                            pixelData[i + 1] = 222;
                            pixelData[i + 2] = 128;
                            pixelData[i + 3] = Math.round(255 * data.maskOpacity);
                        }
                    }
                    tempCtx.putImageData(imageData, 0, 0);
                    
                    ctx.drawImage(tempStampCanvas, 0, 0);
                };
                img.src = data.previewUrl;
            },
        };
    });
    
    const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        const container = containerRef.current;
        if (!container || (container.scrollWidth <= container.clientWidth && container.scrollHeight <= container.clientHeight)) {
            return;
        }
        e.preventDefault();
        panRef.current = {
            isPanning: true,
            startX: e.pageX - container.offsetLeft,
            startY: e.pageY - container.offsetTop,
            scrollLeft: container.scrollLeft,
            scrollTop: container.scrollTop,
        };
        container.style.cursor = 'grabbing';
    };

    const handleMouseUp = () => {
         const container = containerRef.current;
         if(container) {
            panRef.current.isPanning = false;
            if (container.scrollWidth > container.clientWidth || container.scrollHeight > container.clientHeight) {
                 container.style.cursor = 'grab';
            } else {
                 container.style.cursor = 'default';
            }
         }
    };
    
    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!panRef.current.isPanning) return;
        const container = containerRef.current;
        if (!container) return;

        e.preventDefault();
        const x = e.pageX - container.offsetLeft;
        const y = e.pageY - container.offsetTop;
        const walkX = (x - panRef.current.startX);
        const walkY = (y - panRef.current.startY);
        container.scrollLeft = panRef.current.scrollLeft - walkX;
        container.scrollTop = panRef.current.scrollTop - walkY;
    };


    return (
        <div ref={containerRef} 
             className="w-full h-full overflow-auto flex items-center justify-center bg-zinc-900/50 rounded-lg"
             onMouseDown={handleMouseDown}
             onMouseUp={handleMouseUp}
             onMouseLeave={handleMouseUp}
             onMouseMove={handleMouseMove}
        >
            <div 
                className="relative shrink-0"
                style={{
                    width: imageDimensions.width * zoom,
                    height: imageDimensions.height * zoom
                }}
            >
                <canvas ref={imageCanvasRef} className="absolute top-0 left-0 w-full h-full" />
                <canvas
                    ref={maskCanvasRef}
                    className="absolute top-0 left-0 transition-opacity duration-200 w-full h-full"
                    style={{ opacity: activeEditFunction === 'compose' ? 0.6 : 0 }}
                />
                <canvas
                    ref={overlayCanvasRef}
                    className="absolute top-0 left-0 pointer-events-none w-full h-full"
                />
            </div>
        </div>
    );
});


interface ConfirmationDialogProps {
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
}

const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({ isOpen, title, message, onConfirm, onCancel }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <div className="bg-zinc-900 p-6 rounded-lg max-w-sm w-full shadow-xl ring-1 ring-white/10">
                <h2 className="text-xl font-bold mb-4 text-zinc-100">{title}</h2>
                <p className="text-zinc-300 mb-6">{message}</p>
                <div className="flex justify-end gap-3">
                    <button onClick={onCancel} className="px-4 py-2 text-sm font-semibold rounded-md bg-zinc-800 hover:bg-zinc-700 transition-colors">
                        Cancelar
                    </button>
                    <button onClick={onConfirm} className="px-4 py-2 text-sm font-semibold rounded-md bg-zinc-600 hover:bg-zinc-500 text-white transition-colors">
                        Confirmar
                    </button>
                </div>
            </div>
        </div>
    );
};

const ImageUploadSlot: React.FC<{
    id: string;
    label: string;
    icon: React.ReactNode;
    imagePreviewUrl: string | null;
    onUpload: (file: File) => void;
    onRemove: () => void;
    className?: string;
}> = ({ id, label, icon, imagePreviewUrl, onUpload, onRemove, className = '' }) => {
    const [isDragging, setIsDragging] = useState(false);
    const dragCounter = useRef(0);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            onUpload(e.target.files[0]);
            e.target.value = '';
        }
    };

    const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter.current++;
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter.current--;
        if (dragCounter.current === 0) {
            setIsDragging(false);
        }
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        dragCounter.current = 0;
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            onUpload(e.dataTransfer.files[0]);
        }
    };

    if (imagePreviewUrl) {
        return (
            <div className={`relative group w-full h-full bg-zinc-800 rounded-md overflow-hidden ${className}`}>
                <img src={imagePreviewUrl} alt={label} className="w-full h-full object-contain" />
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <button onClick={onRemove} className="p-2 bg-zinc-900/80 text-red-400 rounded-full hover:bg-zinc-700 transition-colors" title="Remover Imagem">
                        <Icons.Close />
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className={`w-full h-full border-2 rounded-md transition-all duration-200 ${className} ${isDragging ? 'border-blue-500 bg-blue-500/10 border-solid' : 'border-zinc-800 border-dashed'}`}
        >
            <input type="file" id={id} className="hidden" accept="image/png, image/jpeg, image/webp" onChange={handleFileChange} />
            <label htmlFor={id} className="cursor-pointer flex flex-col items-center justify-center h-full text-center p-2 text-zinc-500 hover:text-zinc-400">
                {icon}
                <span className="text-xs font-semibold mt-1">{label}</span>
                <span className="text-xs mt-1">Arraste ou clique</span>
            </label>
        </div>
    );
};

const getImageDimensions = (url: string): Promise<{ width: number; height: number }> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.width, height: img.height });
        img.onerror = (err) => reject(err);
        img.src = url;
    });
};

const getAspectRatioString = (width: number, height: number): string => {
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const commonDivisor = gcd(width, height);
    return `${width / commonDivisor}:${height / commonDivisor}`;
};

const ALL_SUPPORTED_ASPECT_RATIOS = [
    { label: 'Quadrado', options: ['1:1'] },
    { label: 'Paisagem (Horizontal)', options: ['16:9', '4:3'] },
    { label: 'Retrato (Vertical)', options: ['9:16', '3:4'] },
];

const FILTERS = [
    { name: 'Noir', prompt: "Aplique um filtro noir preto e branco de alto contraste e dramático à imagem, com sombras profundas e realces brilhantes." },
    { name: 'Sépia', prompt: "Converta a imagem para um tom sépia quente, dando-lhe uma aparência de fotografia antiga e vintage." },
    { name: 'Vívido', prompt: "Realce as cores da imagem para torná-las mais vibrantes e saturadas. Aumente ligeiramente o contraste geral." },
    { name: 'Sonhador', prompt: "Aplique um efeito etéreo e sonhador à imagem com foco suave, um brilho delicado e cores pastel ligeiramente dessaturadas." },
    { name: 'Cyberpunk', prompt: "Transforme a imagem com uma estética cyberpunk, apresentando azuis, rosas e roxos neon na iluminação, alto contraste e uma sensação futurista e urbana." },
    { name: 'Aquarela', prompt: "Converta a imagem para que pareça uma pintura em aquarela, com bordas suaves, cores mescladas e uma aparência de papel texturizado." },
];

const CREATE_FUNCTIONS: { id: CreateFunction, name: string, icon: React.ReactNode }[] = [
    { id: 'free', name: 'Livre', icon: <Icons.Image /> },
    { id: 'sticker', name: 'Sticker', icon: <Icons.Sticker /> },
    { id: 'text', name: 'Texto / Logo', icon: <Icons.Type /> },
    { id: 'comic', name: 'HQ', icon: <Icons.Comic /> },
];

const EDIT_FUNCTIONS: { id: EditFunction, name: string, icon: React.ReactNode }[] = [
    { id: 'compose', name: 'Compor', icon: <Icons.Layers /> },
    { id: 'style', name: 'Estilizar', icon: <Icons.Palette /> },
];

const VIDEO_FUNCTIONS: { id: VideoFunction, name: string, icon: React.ReactNode }[] = [
    { id: 'prompt', name: 'A Partir de Prompt', icon: <Icons.Prompt /> },
    { id: 'animation', name: 'Animar Imagem', icon: <Icons.Start /> },
];


export default function App() {
    const [prompt, setPrompt] = useState<string>('');
    const [mode, setMode] = useState<Mode>('create');
    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [historyIndex, setHistoryIndex] = useState<number>(-1);
    
    const [activeCreateFunction, setActiveCreateFunction] = useState<CreateFunction>('free');
    const [aspectRatio, setAspectRatio] = useState<string>('1:1');
    const [negativePrompt, setNegativePrompt] = useState<string>('');
    const [styleModifier, setStyleModifier] = useState<string>('default');
    const [cameraAngle, setCameraAngle] = useState<string>('default');
    const [lightingStyle, setLightingStyle] = useState<string>('default');
    const [comicColorPalette, setComicColorPalette] = useState<'vibrant' | 'noir'>('vibrant');

    const [activeEditFunction, setActiveEditFunction] = useState<EditFunction>('compose');
    const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
    const [styleStrength, setStyleStrength] = useState<number>(100);
    const [detectedObjects, setDetectedObjects] = useState<DetectedObject[]>([]);
    const [highlightedObject, setHighlightedObject] = useState<DetectedObject | null>(null);
    const [currentImageDimensions, setCurrentImageDimensions] = useState<{w: number, h: number} | null>(null);
    const [placingImageIndex, setPlacingImageIndex] = useState<number | null>(null);
    
    const [activeVideoFunction, setActiveVideoFunction] = useState<VideoFunction>('prompt');
    const [startFrame, setStartFrame] = useState<UploadedImage | null>(null);
    const [startFramePreview, setStartFramePreview] = useState<string | null>(null);

    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [loadingMessage, setLoadingMessage] = useState<string>('Gerando sua mídia...');
    const [isAnalyzingStyle, setIsAnalyzingStyle] = useState<boolean>(false);
    const [isDetectingObjects, setIsDetectingObjects] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [showMobileModal, setShowMobileModal] = useState<boolean>(false);
    const [isDragging, setIsDragging] = useState<boolean>(false);
    const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([]);
    const [confirmationDialog, setConfirmationDialog] = useState({ isOpen: false, title: '', message: '', onConfirm: () => {} });
    const [zoom, setZoom] = useState(1);
    const [isFitToScreen, setIsFitToScreen] = useState(true);
        
    const editorRef = useRef<ImageEditorRef>(null);
    const mainContentRef = useRef<HTMLDivElement>(null);
    const placerContainerRef = useRef<HTMLDivElement>(null);
    const dragCounter = useRef(0);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const negativeTextareaRef = useRef<HTMLTextAreaElement>(null);

    const currentEntry = history[historyIndex] ?? null;
    const generatedImage = currentEntry?.imageUrl ?? null;
    const generatedVideo = currentEntry?.videoUrl ?? null;

    const ObjectPlacer: React.FC<{
        src: string;
        containerRef: React.RefObject<HTMLDivElement>;
        onConfirm: (transform: { x: number; y: number; width: number; height: number; rotation: number; }) => void;
        onCancel: () => void;
    }> = ({ src, containerRef, onConfirm, onCancel }) => {
        const [transform, setTransform] = useState({ x: 0, y: 0, width: 200, height: 200, rotation: 0 });
        const [isLoaded, setIsLoaded] = useState(false);
        const actionRef = useRef<{ 
            type: 'move' | 'scale' | 'rotate'; 
            startX: number; 
            startY: number; 
            startTransform: typeof transform; 
            aspectRatio: number; 
            centerX: number; 
            centerY: number;
            startMouseAngle?: number;
            startDragDistance?: number;
        } | null>(null);
    
        useEffect(() => {
            const img = new Image();
            img.src = src;
            img.onload = () => {
                const container = containerRef.current;
                if (!container) return;
    
                const containerRect = container.getBoundingClientRect();
                const MAX_DIM = Math.min(containerRect.width, containerRect.height) * 0.5;
                const aspectRatio = img.width / img.height;
                let width, height;
                if (aspectRatio > 1) {
                    width = MAX_DIM;
                    height = MAX_DIM / aspectRatio;
                } else {
                    height = MAX_DIM;
                    width = MAX_DIM * aspectRatio;
                }
                setTransform({
                    width,
                    height,
                    x: (containerRect.width - width) / 2,
                    y: (containerRect.height - height) / 2,
                    rotation: 0,
                });
                setIsLoaded(true);
            };
        }, [src, containerRef]);
    
        const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>, type: 'move' | 'scale' | 'rotate') => {
            e.preventDefault();
            e.stopPropagation();
            if (!isLoaded) return;
    
            const containerRect = containerRef.current?.getBoundingClientRect();
            if (!containerRect) return;

            const centerX = transform.x + transform.width / 2;
            const centerY = transform.y + transform.height / 2;

            const mouseX = e.clientX - containerRect.left;
            const mouseY = e.clientY - containerRect.top;

            actionRef.current = {
                type,
                startX: e.clientX,
                startY: e.clientY,
                startTransform: { ...transform },
                aspectRatio: transform.width / transform.height,
                centerX,
                centerY
            };

            if (type === 'rotate') {
                actionRef.current.startMouseAngle = Math.atan2(mouseY - centerY, mouseX - centerX) * (180 / Math.PI);
            } else if (type === 'scale') {
                const dx = mouseX - centerX;
                const dy = mouseY - centerY;
                actionRef.current.startDragDistance = Math.sqrt(dx * dx + dy * dy);
            }
    
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        };
    
        const handleMouseMove = (e: MouseEvent) => {
            if (!actionRef.current) return;
            
            const containerRect = containerRef.current?.getBoundingClientRect();
            if (!containerRect) return;
    
            const { type, startTransform, centerX, centerY } = actionRef.current;
    
            if (type === 'move') {
                const dx = e.clientX - actionRef.current.startX;
                const dy = e.clientY - actionRef.current.startY;
                setTransform(t => ({ ...t, x: startTransform.x + dx, y: startTransform.y + dy }));
            } else if (type === 'rotate') {
                const mouseX = e.clientX - containerRect.left;
                const mouseY = e.clientY - containerRect.top;
                const currentMouseAngle = Math.atan2(mouseY - centerY, mouseX - centerX) * (180 / Math.PI);
                const startMouseAngle = actionRef.current.startMouseAngle || 0;
                const angleDiff = currentMouseAngle - startMouseAngle;
                setTransform(t => ({ ...t, rotation: startTransform.rotation + angleDiff }));
            } else if (type === 'scale') {
                const mouseX = e.clientX - containerRect.left;
                const mouseY = e.clientY - containerRect.top;
                const dx = mouseX - centerX;
                const dy = mouseY - centerY;
                const currentDragDistance = Math.sqrt(dx * dx + dy * dy);
                const startDragDistance = actionRef.current.startDragDistance || 1;
                
                const scaleFactor = currentDragDistance / startDragDistance;

                const newWidth = startTransform.width * scaleFactor;
                const newHeight = startTransform.height * scaleFactor;

                setTransform(t => ({
                    ...t,
                    width: Math.max(20, newWidth),
                    height: Math.max(20, newHeight),
                    x: centerX - newWidth / 2,
                    y: centerY - newHeight / 2,
                }));
            }
        };
    
        const handleMouseUp = () => {
            actionRef.current = null;
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    
        if (!isLoaded) return null;
    
        return (
            <div className="absolute inset-0 z-30 pointer-events-none">
                <div
                    className="absolute border-2 border-blue-500 border-dashed pointer-events-auto"
                    style={{
                        left: transform.x,
                        top: transform.y,
                        width: transform.width,
                        height: transform.height,
                        transform: `rotate(${transform.rotation}deg)`,
                    }}
                    onMouseDown={(e) => handleMouseDown(e, 'move')}
                >
                    <img src={src} className="w-full h-full object-contain" alt="Object to place" draggable="false" />
                    <div onMouseDown={(e) => handleMouseDown(e, 'scale')} className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-white rounded-full cursor-nwse-resize border-2 border-blue-500"></div>
                    <div onMouseDown={(e) => handleMouseDown(e, 'scale')} className="absolute -bottom-1.5 -right-1.5 w-4 h-4 bg-white rounded-full cursor-nesw-resize border-2 border-blue-500"></div>
                    <div onMouseDown={(e) => handleMouseDown(e, 'scale')} className="absolute -bottom-1.5 -left-1.5 w-4 h-4 bg-white rounded-full cursor-nwse-resize border-2 border-blue-500"></div>
                    <div onMouseDown={(e) => handleMouseDown(e, 'scale')} className="absolute -top-1.5 -left-1.5 w-4 h-4 bg-white rounded-full cursor-nesw-resize border-2 border-blue-500"></div>
                    <div
                        className="absolute -top-8 left-1/2 -translate-x-1/2 w-5 h-5 bg-white rounded-full cursor-grab flex items-center justify-center border-2 border-blue-500"
                        onMouseDown={(e) => handleMouseDown(e, 'rotate')}
                    >
                       <Icons.RotateRight className="text-blue-600 !text-base" />
                    </div>
                </div>
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-zinc-900/80 backdrop-blur-sm p-2 rounded-lg shadow-lg flex items-center gap-2 ring-1 ring-white/10 pointer-events-auto">
                    <button onClick={onCancel} className="px-3 py-1.5 text-sm font-semibold rounded-md bg-zinc-800 hover:bg-zinc-700 transition-colors flex items-center gap-1.5">
                        <Icons.Close className="!text-base" /> Cancelar
                    </button>
                    <button onClick={() => onConfirm(transform)} className="px-3 py-1.5 text-sm font-semibold rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-colors flex items-center gap-1.5">
                        <Icons.Check className="!text-base" /> Aplicar
                    </button>
                </div>
            </div>
        );
    };

    const styleOptions: Record<CreateFunction, { value: string, label: string }[]> = {
        free: [],
        sticker: [ { value: 'cartoon', label: 'Desenho' }, { value: 'vintage', label: 'Vintage' }, { value: 'holographic', label: 'Holográfico' }, { value: 'embroidered patch', label: 'Bordado' }, ],
        text: [ { value: 'minimalist', label: 'Minimalista' }, { value: 'corporate', label: 'Corporativo' }, { value: 'playful', label: 'Divertido' }, { value: 'geometric', label: 'Geométrico' }, ],
        comic: [ { value: 'American comic book', label: 'Americano' }, { value: 'Japanese manga', label: 'Mangá' }, { value: 'franco-belgian comics (bande dessinée)', label: 'Franco-Belga' }, ],
    };
    const cameraAngleOptions = [ { value: 'default', label: 'Padrão' }, { value: 'eye-level', label: 'Nível do Olhar' }, { value: 'close-up', label: 'Close-up' }, { value: 'low angle', label: 'Ângulo Baixo' }, { value: 'high angle (bird\'s-eye view)', label: 'Plano Alto' }, { value: 'wide shot (long shot)', label: 'Plano Geral' }, ];
    const lightingStyleOptions = [ { value: 'default', label: 'Padrão' }, { value: 'cinematic', label: 'Cinemática' }, { value: 'soft', label: 'Luz Suave' }, { value: 'dramatic', label: 'Dramática' }, { value: 'studio', label: 'Estúdio' }, { value: 'natural', label: 'Natural' }, ];
    
    const closeConfirmationDialog = () => setConfirmationDialog(prev => ({ ...prev, isOpen: false }));
    const handleConfirm = () => { confirmationDialog.onConfirm(); closeConfirmationDialog(); };
    const resetDetectionState = useCallback(() => { setDetectedObjects([]); setHighlightedObject(null); editorRef.current?.clearOverlays(); }, []);

    const fitZoomToScreen = useCallback(() => {
        if (!mainContentRef.current || !currentImageDimensions) return;
        const PADDING = 32;
        const container = mainContentRef.current;
        const containerWidth = container.clientWidth - PADDING;
        const containerHeight = container.clientHeight - PADDING;
        const { w: imageWidth, h: imageHeight } = currentImageDimensions;
        if (containerWidth <= 0 || containerHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) {
            setZoom(1); return;
        }
        const scaleX = containerWidth / imageWidth;
        const scaleY = containerHeight / imageHeight;
        const newZoom = Math.min(scaleX, scaleY);
        setZoom(prevZoom => Math.abs(prevZoom - newZoom) > 0.001 ? newZoom : prevZoom);
    }, [currentImageDimensions]);

    useEffect(() => {
        if (isFitToScreen || !generatedImage) {
            fitZoomToScreen();
        }
    }, [isFitToScreen, generatedImage, fitZoomToScreen]);

    useEffect(() => {
        const container = mainContentRef.current;
        if (!container) return;
        const resizeObserver = new ResizeObserver(() => {
            if (isFitToScreen) {
                fitZoomToScreen();
            }
        });
        resizeObserver.observe(container);
        return () => resizeObserver.disconnect();
    }, [isFitToScreen, fitZoomToScreen]);

    const handleZoom = (factor: number) => {
        setIsFitToScreen(false);
        setZoom(prev => Math.max(0.1, Math.min(prev * factor, 5)));
    };
    
    const handleFitToScreen = () => setIsFitToScreen(true);

    useEffect(() => {
        if (generatedImage) {
            getImageDimensions(generatedImage).then(({ width, height }) => {
                setCurrentImageDimensions({ w: width, h: height });
            }).catch(err => {
                console.error("Could not get image dimensions:", err);
                setCurrentImageDimensions(null);
            });
        } else {
            setCurrentImageDimensions(null);
        }
    }, [generatedImage]);

    const resetImages = () => {
        setReferenceImages([]);
        setStartFrame(null);
        setStartFramePreview(null);
        resetDetectionState();
    };

    const isEditStateDirty = useCallback(() => {
        if (mode !== 'edit' || !generatedImage) return false;
        const hasMask = editorRef.current?.hasMaskData() ?? false;
        const hasPrompt = prompt.trim() !== '';
        const hasRefImages = referenceImages.length > 0;
        return hasMask || hasPrompt || hasRefImages;
    }, [mode, generatedImage, prompt, referenceImages]);

    const handleModeToggle = (newMode: Mode) => {
        if (newMode === mode) return;
        const latestImage = history[historyIndex]?.imageUrl;
        const performSwitch = (targetMode: Mode) => {
            setMode(targetMode);
            resetImages(); setHistory([]); setHistoryIndex(-1); setPrompt(''); setNegativePrompt('');
            switch (targetMode) {
                case 'create': setActiveCreateFunction('free'); break;
                case 'edit': setActiveEditFunction('compose'); break;
                case 'video': setActiveVideoFunction('prompt'); break;
            }
        };
        const performSwitchToEdit = () => {
            setMode('edit');
            setActiveEditFunction('compose');
            resetImages();
            if (latestImage) {
                const currentEntry = history[historyIndex];
                setHistory([currentEntry]);
                setHistoryIndex(0);
                setPrompt(currentEntry.prompt);
                setNegativePrompt(currentEntry.negativePrompt || '');
            } else {
                setHistory([]); setHistoryIndex(-1); setPrompt(''); setNegativePrompt('');
            }
        };
        const performSwitchToVideoWithAnimation = () => {
            if (!latestImage) { performSwitch('video'); return; }
            setMode('video'); resetImages(); setPrompt(''); setNegativePrompt(''); setActiveVideoFunction('animation');
            const base64 = latestImage.split(',')[1];
            const mimeType = latestImage.match(/data:(image\/[^;]+);/)?.[1] || 'image/png';
            setStartFrame({ base64, mimeType }); setStartFramePreview(latestImage);
        };
        if (mode === 'edit' && history.length > 0 && newMode !== 'edit') {
            const isContinuingToVideo = newMode === 'video';
            const onConfirmAction = isContinuingToVideo ? performSwitchToVideoWithAnimation : () => performSwitch(newMode);
            const dialogMessage = isContinuingToVideo ? "Isso irá transferir sua imagem atual para o modo de vídeo para animação. Deseja continuar?" : "Ao sair do modo de edição, a imagem atual e seu histórico serão perdidos. Deseja continuar?";
            const dialogTitle = isContinuingToVideo ? 'Mudar para o Modo de Vídeo?' : 'Sair do Modo de Edição?';
            setConfirmationDialog({ isOpen: true, title: dialogTitle, message: dialogMessage, onConfirm: onConfirmAction });
            return;
        }
        if (newMode === 'edit') { performSwitchToEdit(); }
        else if (newMode === 'video' && activeVideoFunction === 'animation') { performSwitchToVideoWithAnimation(); }
        else { performSwitch(newMode); }
    };
    
    const handleHistoryNavigation = useCallback((index: number) => {
        if (index < 0 || index >= history.length) return;
        const entry = history[index];
        if (!entry) return;
        resetDetectionState();
        setHistoryIndex(index);
        setPrompt(entry.prompt);
        setNegativePrompt(entry.negativePrompt || '');
        setMode(entry.mode);
        if (entry.mode === 'create') {
            setActiveCreateFunction(entry.createFunction!);
            setAspectRatio(entry.aspectRatio!);
            setComicColorPalette(entry.comicColorPalette || 'vibrant');
            setStyleModifier(entry.styleModifier || 'default');
            setCameraAngle(entry.cameraAngle || 'default');
            setLightingStyle(entry.lightingStyle || 'default');
            resetImages(); 
        } else if (entry.mode === 'edit') { 
            setActiveEditFunction(entry.editFunction!);
            setReferenceImages(entry.referenceImages || []);
            if (entry.editFunction === 'style' && entry.styleStrength) { setStyleStrength(entry.styleStrength); }
        } else if (entry.mode === 'video') {
            setActiveVideoFunction(entry.videoFunction || 'prompt');
            setStartFrame(entry.startFrame || null);
            setStartFramePreview(entry.startFramePreviewUrl || null);
        }
    }, [history, resetDetectionState]);

    const handleCreateFunctionClick = (func: CreateFunction) => {
        setActiveCreateFunction(func);
        const options = styleOptions[func];
        setStyleModifier(options.length > 0 ? options[0].value : 'default');
    };

    const handleEditFunctionClick = (func: EditFunction) => {
        if (func !== activeEditFunction) setReferenceImages([]);
        setActiveEditFunction(func);
    };

    const handleVideoFunctionClick = (func: VideoFunction) => {
        if (func !== activeVideoFunction) { setStartFrame(null); setStartFramePreview(null); }
        setActiveVideoFunction(func);
    };

    const processSingleFile = useCallback((file: File, callback: (image: UploadedImage, previewUrl: string) => void) => {
        const id = `upload-${file.name}-${Date.now()}`;
        if (file.size > 10 * 1024 * 1024) {
            setUploadProgress(prev => [...prev, { id, name: file.name, progress: 100, status: 'error', message: 'Excede 10MB.' }]);
            setTimeout(() => setUploadProgress(p => p.filter(item => item.id !== id)), 5000);
            return;
        }
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
            setUploadProgress(prev => [...prev, { id, name: file.name, progress: 100, status: 'error', message: 'Tipo inválido.' }]);
            setTimeout(() => setUploadProgress(p => p.filter(item => item.id !== id)), 5000);
            return;
        }
        setUploadProgress(prev => [...prev, { id, name: file.name, progress: 0, status: 'uploading' }]);
        const reader = new FileReader();
        reader.onprogress = (event) => {
            if (event.lengthComputable) {
                const progress = Math.round((event.loaded / event.total) * 100);
                setUploadProgress(p => p.map(item => item.id === id ? { ...item, progress } : item));
            }
        };
        reader.onerror = () => {
            setUploadProgress(p => p.map(item => item.id === id ? { ...item, status: 'error', message: 'Falha ao ler.' } : item));
            setTimeout(() => setUploadProgress(p => p.filter(item => item.id !== id)), 5000);
        };
        reader.onload = () => {
            const dataUrl = reader.result as string;
            const uploadedImage: UploadedImage = { base64: dataUrl.split(',')[1], mimeType: file.type };
            callback(uploadedImage, dataUrl);
            setUploadProgress(p => p.map(item => item.id === id ? { ...item, status: 'success', progress: 100 } : item));
            setTimeout(() => setUploadProgress(p => p.filter(item => item.id !== id)), 1500);
        };
        reader.readAsDataURL(file);
    }, []);
    
    const handleDropOnCanvas = (files: FileList) => {
        if (mode !== 'edit' || !files || files.length === 0) return;

        const processMainImage = (file: File) => {
            processSingleFile(file, (uploadedImage, dataUrl) => {
                const initialEntry: HistoryEntry = { id: `hist-${Date.now()}`, imageUrl: dataUrl, prompt: '', mode: 'edit', editFunction: activeEditFunction, referenceImages: [] };
                resetDetectionState();
                setHistory([initialEntry]);
                setHistoryIndex(0);
                setReferenceImages([]);
                setPrompt('');
            });
        };

        if (generatedImage && isEditStateDirty()) {
            setConfirmationDialog({
                isOpen: true,
                title: 'Substituir Imagem Principal?',
                message: 'Isso substituirá a imagem atual e limpará o histórico de edições. Deseja continuar?',
                onConfirm: () => processMainImage(files[0]),
            });
        } else {
            processMainImage(files[0]);
        }
    };
    
    const handleRemoveReferenceImage = (indexToRemove: number) => {
        setReferenceImages(prev => prev.filter((_, index) => index !== indexToRemove));
        if (activeEditFunction === 'style') setPrompt('');
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); };
    const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); dragCounter.current++; if (dragCounter.current === 1) setIsDragging(true); };
    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); dragCounter.current--; if (dragCounter.current === 0) setIsDragging(false); };
    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault(); e.stopPropagation();
        setIsDragging(false); dragCounter.current = 0;
        if (e.dataTransfer.files) handleDropOnCanvas(e.dataTransfer.files);
    };

    const handleDetectObjects = async () => {
        if (!generatedImage || isDetectingObjects) return;
        setIsDetectingObjects(true); setError(null);
        try {
            const base64 = generatedImage.split(',')[1];
            const mimeType = generatedImage.match(/data:(image\/[^;]+);/)?.[1] || 'image/png';
            const detected = await detectObjects({ base64, mimeType });
            setDetectedObjects(detected);
        } catch (e: any) { setError(e.message); } finally { setIsDetectingObjects(false); }
    };

    const handleGenerateObjectMask = async (object: DetectedObject) => {
        if (!generatedImage) return;
        setError(null); setHighlightedObject(object);
        const newReferenceImages = [...referenceImages];
        const newRef: ReferenceImage = { image: { base64: '', mimeType: '' }, previewUrl: '', mask: null, isExtractingObject: true };
        newReferenceImages.push(newRef);
        const newIndex = newReferenceImages.length - 1;
        setReferenceImages(newReferenceImages);
        try {
            const base64 = generatedImage.split(',')[1];
            const mimeType = generatedImage.match(/data:(image\/[^;]+);/)?.[1] || 'image/png';
            const tempCanvas = document.createElement('canvas');
            const img = new Image();
            img.src = generatedImage;
            await new Promise(resolve => img.onload = resolve);
            tempCanvas.width = img.width; tempCanvas.height = img.height;
            const ctx = tempCanvas.getContext('2d');
            if (!ctx) throw new Error("Could not create canvas context");
            const { x1, y1, x2, y2 } = object.box;
            const cropX = x1 * img.width, cropY = y1 * img.height, cropW = (x2 - x1) * img.width, cropH = (y2 - y1) * img.height;
            ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
            const croppedDataUrl = tempCanvas.toDataURL(mimeType);
            const croppedImage: UploadedImage = { base64: croppedDataUrl.split(',')[1], mimeType: mimeType };
            const mask = await generateObjectMask(croppedImage);
            const maskUrl = `data:${mask.mimeType};base64,${mask.base64}`;
            setReferenceImages(prev => prev.map((ref, index) => index === newIndex ? { image: croppedImage, previewUrl: croppedDataUrl, mask: mask, maskedObjectPreviewUrl: maskUrl, isExtractingObject: false } : ref));
        } catch (e: any) {
            setError(e.message);
            setReferenceImages(prev => prev.filter((_, index) => index !== newIndex));
        } finally {
            setHighlightedObject(null);
        }
    };

    const applyFilter = (filterPrompt: string) => {
        if (!generatedImage) { setError("Por favor, gere ou envie uma imagem primeiro para aplicar um filtro."); return; }
        setPrompt(filterPrompt); handleSubmit(new Event('submit') as any); 
    };

    const handleBananaClick = async () => {
        if (mode !== 'create' || isLoading) return;

        setError(null);
        setIsLoading(true);
        setLoadingMessage('Gerando sua banana especial...');

        try {
            const easterEggPrompt = "Uma banana estilizada, de corpo inteiro, usando uma camiseta da seleção brasileira de futebol, em um fundo neutro.";
            
            const imageUrl = await generateImage(
                easterEggPrompt,
                activeCreateFunction,
                aspectRatio,
                negativePrompt,
                styleModifier,
                cameraAngle,
                lightingStyle,
                comicColorPalette
            );
            
            const newHistoryEntry: HistoryEntry = {
                id: `hist-${Date.now()}`,
                imageUrl,
                prompt: easterEggPrompt,
                negativePrompt,
                mode: 'create',
                createFunction: activeCreateFunction,
                aspectRatio,
                comicColorPalette: activeCreateFunction === 'comic' ? comicColorPalette : undefined,
                styleModifier,
                cameraAngle,
                lightingStyle
            };

            setHistory(prev => {
                const newHistory = prev.slice(0, historyIndex + 1);
                newHistory.push(newHistoryEntry);
                return newHistory;
            });
            setHistoryIndex(prev => prev + 1);
            
            setReferenceImages([]);
            resetDetectionState();
            editorRef.current?.clearMask();

        } catch (e: any) {
            setError(e.message || "A banana tropeçou! Ocorreu um erro.");
        } finally {
            setIsLoading(false);
        }
    };


    const handleSubmit = async (e: React.FormEvent<HTMLFormElement> | React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault(); setError(null);
        if (isLoading) return;
        let newHistoryEntry: HistoryEntry;
        try {
            if (mode === 'create') {
                if (!prompt) { setError("Por favor, insira um prompt para gerar uma imagem."); return; }
                setIsLoading(true); setLoadingMessage('Gerando sua imagem...');
                const imageUrl = await generateImage(prompt, activeCreateFunction, aspectRatio, negativePrompt, styleModifier, cameraAngle, lightingStyle, comicColorPalette);
                newHistoryEntry = { id: `hist-${Date.now()}`, imageUrl, prompt, negativePrompt, mode, createFunction: activeCreateFunction, aspectRatio, comicColorPalette: activeCreateFunction === 'comic' ? comicColorPalette : undefined, styleModifier, cameraAngle, lightingStyle };
            } else if (mode === 'edit') {
                if (!generatedImage) { setError("Por favor, envie uma imagem para começar a editar."); return; }
                const mainImageBase64 = generatedImage.split(',')[1];
                const mainImageMimeType = generatedImage.match(/data:(image\/[^;]+);/)?.[1] || 'image/png';
                const mainImage: UploadedImage = { base64: mainImageBase64, mimeType: mainImageMimeType };
                const maskData = editorRef.current?.getMaskData() || null;
                const originalSize = editorRef.current?.getOriginalImageSize() || null;
                if (!prompt && referenceImages.length === 0 && !maskData) { setError("Descreva sua edição, adicione uma imagem de referência ou selecione uma área para editar."); return; }
                setIsLoading(true); setLoadingMessage('Aplicando sua edição...');
                const resultImageUrl = await processImagesWithPrompt(prompt, mainImage, referenceImages, maskData, activeEditFunction, originalSize, styleStrength, negativePrompt);
                if (resultImageUrl.startsWith('A edição foi bloqueada')) { throw new Error(resultImageUrl); }
                newHistoryEntry = { id: `hist-${Date.now()}`, imageUrl: resultImageUrl, prompt, negativePrompt, mode, editFunction: activeEditFunction, referenceImages: [...referenceImages], styleStrength: activeEditFunction === 'style' ? styleStrength : undefined };
            } else if (mode === 'video') {
                if (!prompt) { setError("Por favor, insira um prompt para gerar um vídeo."); return; }
                if (activeVideoFunction === 'animation' && !startFrame) { setError("Por favor, envie uma imagem inicial para a animação."); return; }
                setIsLoading(true); setLoadingMessage('A geração de vídeo pode levar alguns minutos...');
                const videoUrl = await generateVideo(prompt, startFrame || undefined);
                newHistoryEntry = { id: `hist-${Date.now()}`, videoUrl, prompt, mode, videoFunction: activeVideoFunction, startFrame: startFrame || undefined, startFramePreviewUrl: startFramePreview || undefined };
            } else { return; }
            setHistory(prev => {
                const newHistory = prev.slice(0, historyIndex + 1);
                newHistory.push(newHistoryEntry);
                return newHistory;
            });
            setHistoryIndex(prev => prev + 1);
            setReferenceImages([]); resetDetectionState(); editorRef.current?.clearMask();
        } catch (e: any) { setError(e.message || "Ocorreu um erro desconhecido."); } finally { setIsLoading(false); }
    };
    
    useEffect(() => {
        [textareaRef, negativeTextareaRef].forEach(ref => {
            const textarea = ref.current;
            if (textarea) { textarea.style.height = 'auto'; textarea.style.height = `${textarea.scrollHeight}px`; }
        });
    }, [prompt, negativePrompt]);

    useEffect(() => { if (window.innerWidth < 1024) setShowMobileModal(true); }, []);

    const canUndo = historyIndex > 0;
    const canRedo = historyIndex < history.length - 1;

    const MainContentDisplay = () => {
        if (isLoading) {
            return (
                <div className="flex flex-col items-center justify-center h-full text-center text-zinc-400 p-8">
                    <Icons.Spinner className="h-10 w-10 mb-6 text-blue-500" />
                    <p className="text-lg font-semibold text-zinc-200 mb-2">{loadingMessage}</p>
                    <div className="flex items-center justify-center mt-2">
                        <div className="w-2 h-2 bg-zinc-500 rounded-full animate-pulse-dots dot-1"></div>
                        <div className="w-2 h-2 bg-zinc-500 rounded-full mx-2 animate-pulse-dots dot-2"></div>
                        <div className="w-2 h-2 bg-zinc-500 rounded-full animate-pulse-dots dot-3"></div>
                    </div>
                </div>
            );
        }
        if (generatedVideo) {
             return (
                <div className="w-full h-full flex items-center justify-center p-4">
                     <video key={generatedVideo} src={generatedVideo} controls autoPlay loop className="max-w-full max-h-full rounded-lg shadow-lg" />
                 </div>
             );
        }
        if (generatedImage) {
            return (
                <div className="w-full h-full relative" ref={placerContainerRef}>
                    <ImageEditor
                        ref={editorRef} key={generatedImage} src={generatedImage} activeEditFunction={mode === 'edit' ? activeEditFunction : null}
                        detectedObjects={detectedObjects} highlightedObject={highlightedObject} zoom={zoom}
                    />
                    {placingImageIndex !== null && referenceImages[placingImageIndex] && (
                        <ObjectPlacer 
                            src={referenceImages[placingImageIndex].maskedObjectPreviewUrl || referenceImages[placingImageIndex].previewUrl}
                            containerRef={placerContainerRef}
                            onCancel={() => setPlacingImageIndex(null)}
                            onConfirm={(placerTransform) => {
                                editorRef.current?.stampObjectOnMask({
                                    previewUrl: referenceImages[placingImageIndex].maskedObjectPreviewUrl || referenceImages[placingImageIndex].previewUrl,
                                    placerTransform, maskOpacity: 0.6,
                                });
                                setPlacingImageIndex(null);
                            }}
                        />
                    )}
                </div>
            );
        }
        return (
             <div className="flex flex-col items-center justify-center h-full text-center text-zinc-500 p-8 border-2 border-dashed border-zinc-800 rounded-lg">
                <Icons.Sparkles className="text-6xl text-zinc-700 mb-4" />
                <h2 className="text-xl font-bold text-zinc-400 mb-2">Bem-vindo ao Nano Banana Studio</h2>
                <p className="max-w-md">
                   {mode === 'create' && "Selecione uma ferramenta à esquerda e descreva sua imagem no painel à direita."}
                   {mode === 'edit' && "Arraste uma imagem para esta área para começar a editar."}
                   {mode === 'video' && "Selecione uma ferramenta de vídeo e use o painel à direita para gerar."}
                </p>
            </div>
        );
    };

    return (
        <>
            {showMobileModal && (
                <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 text-center">
                    <div className="bg-zinc-900 p-6 rounded-lg max-w-sm w-full shadow-xl ring-1 ring-white/10">
                        <h2 className="text-xl font-bold mb-4 text-zinc-100">Otimizado para Desktop</h2>
                        <p className="text-zinc-300">Para a melhor experiência, por favor, acesse este aplicativo em um computador desktop.</p>
                    </div>
                </div>
            )}
            <ConfirmationDialog isOpen={confirmationDialog.isOpen} title={confirmationDialog.title} message={confirmationDialog.message} onConfirm={handleConfirm} onCancel={closeConfirmationDialog} />

            <header className="app-header bg-zinc-900 border-b border-zinc-800 flex items-center justify-between px-4">
                <div className="flex items-center gap-4">
                    <button 
                        onClick={handleBananaClick}
                        className={`text-2xl transition-transform hover:scale-110 ${mode === 'create' && !isLoading ? 'cursor-pointer' : 'cursor-default opacity-50'}`}
                        title={mode === 'create' ? "Clique para uma surpresa!" : "Disponível apenas no modo CRIAR"}
                        disabled={isLoading || mode !== 'create'}
                    >
                        🍌
                    </button>
                    <div className="grid grid-cols-3 gap-1 bg-zinc-800 p-1 rounded-md">
                         <button onClick={() => handleModeToggle('create')} className={`px-4 py-1 text-xs font-bold rounded ${mode === 'create' ? 'bg-zinc-600 text-white' : 'hover:bg-zinc-700'}`}>CRIAR</button>
                         <button onClick={() => handleModeToggle('edit')} className={`px-4 py-1 text-xs font-bold rounded ${mode === 'edit' ? 'bg-zinc-600 text-white' : 'hover:bg-zinc-700'}`}>EDITAR</button>
                         <button onClick={() => handleModeToggle('video')} className={`px-4 py-1 text-xs font-bold rounded ${mode === 'video' ? 'bg-zinc-600 text-white' : 'hover:bg-zinc-700'}`}>VÍDEO</button>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => handleHistoryNavigation(historyIndex - 1)} disabled={!canUndo || isLoading} className="p-2 rounded-md hover:bg-zinc-800 disabled:opacity-40" title="Desfazer"><Icons.Undo /></button>
                    <button onClick={() => handleHistoryNavigation(historyIndex + 1)} disabled={!canRedo || isLoading} className="p-2 rounded-md hover:bg-zinc-800 disabled:opacity-40" title="Refazer"><Icons.Redo /></button>
                    {(generatedImage || generatedVideo) && (
                        <a href={generatedImage || generatedVideo || '#'} download={`nanobanana-${Date.now()}.${generatedImage ? 'png' : 'mp4'}`} className="text-sm font-semibold py-1.5 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors flex items-center gap-2 ml-2">
                            <Icons.Save /> Salvar
                        </a>
                    )}
                </div>
            </header>

            <aside className="app-toolbar bg-zinc-900 border-r border-zinc-800 flex flex-col items-center p-2 space-y-2">
                {mode === 'create' && CREATE_FUNCTIONS.map(f => <ToolbarButton key={f.id} data-function={f.id} name={f.name} icon={f.icon} isActive={activeCreateFunction === f.id} onClick={() => handleCreateFunctionClick(f.id)} />)}
                {mode === 'edit' && EDIT_FUNCTIONS.map(f => <ToolbarButton key={f.id} data-function={f.id} name={f.name} icon={f.icon} isActive={activeEditFunction === f.id} onClick={() => handleEditFunctionClick(f.id)} />)}
                {mode === 'video' && VIDEO_FUNCTIONS.map(f => <ToolbarButton key={f.id} data-function={f.id} name={f.name} icon={f.icon} isActive={activeVideoFunction === f.id} onClick={() => handleVideoFunctionClick(f.id)} />)}
            </aside>

            <main
                ref={mainContentRef}
                className="app-main flex flex-col bg-zinc-950 overflow-hidden"
                onDragEnter={mode === 'edit' ? handleDragEnter : undefined}
                onDragOver={mode === 'edit' ? handleDragOver : undefined}
                onDragLeave={mode === 'edit' ? handleDragLeave : undefined}
                onDrop={mode === 'edit' ? handleDrop : undefined}
            >
                <div className="flex-1 p-4 overflow-hidden relative">
                    <MainContentDisplay />
                    {isDragging && (
                         <div className="absolute inset-4 border-4 border-dashed border-blue-500 bg-blue-500/10 rounded-lg flex items-center justify-center pointer-events-none">
                             <div className="text-center">
                                 <Icons.UploadCloud className="text-5xl text-blue-400" />
                                 <p className="mt-2 text-lg font-semibold text-blue-300">Solte a imagem para editar</p>
                             </div>
                         </div>
                     )}
                </div>
                <footer className="h-8 bg-zinc-900 border-t border-zinc-800 shrink-0 flex items-center justify-between px-4 text-xs text-zinc-400">
                    <div>
                        {currentImageDimensions && <span>{Math.round(currentImageDimensions.w * zoom)} x {Math.round(currentImageDimensions.h * zoom)} px</span>}
                    </div>
                    {generatedImage && (
                        <div className="flex items-center gap-2">
                            <button onClick={() => handleZoom(1 / 1.25)} title="Reduzir Zoom" className="p-1 rounded-md hover:bg-zinc-700 disabled:opacity-50" disabled={isLoading || zoom <= 0.1}>
                                <Icons.ZoomOut className="!text-lg" />
                            </button>
                            <button onClick={handleFitToScreen} className="w-14 text-center text-sm font-mono rounded hover:bg-zinc-700 p-1" title="Ajustar à Tela">
                                {Math.round(zoom * 100)}%
                            </button>
                            <button onClick={() => handleZoom(1.25)} title="Aumentar Zoom" className="p-1 rounded-md hover:bg-zinc-700 disabled:opacity-50" disabled={isLoading || zoom >= 5}>
                                <Icons.ZoomIn className="!text-lg" />
                            </button>
                             <button onClick={handleFitToScreen} title="Ajustar à Tela" className="p-1 rounded-md hover:bg-zinc-700 disabled:opacity-50" disabled={isLoading || isFitToScreen}>
                                <Icons.FitScreen className="!text-lg" />
                            </button>
                        </div>
                    )}
                </footer>
            </main>

            <aside className="app-sidebar bg-zinc-900 border-l border-zinc-800 flex flex-col">
                <div className="flex-1 overflow-y-auto">
                    <PanelSection title="Prompt" icon={<Icons.Prompt />}>
                         <form onSubmit={handleSubmit} className="space-y-3">
                            <textarea
                                ref={textareaRef} value={prompt} onChange={(e) => setPrompt(e.target.value)}
                                placeholder={ mode === 'create' ? "Um astronauta surfando em um anel de saturno..." : mode === 'edit' ? "Adicione um chapéu de cowboy na pessoa..." : "Um close-up de uma gota de chuva..." }
                                rows={3} className="w-full bg-zinc-800 rounded-md p-2 text-sm text-zinc-300 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none transition-shadow" disabled={isLoading}
                            />
                             {(mode === 'create' || mode === 'edit') && (
                                <textarea
                                    ref={negativeTextareaRef} value={negativePrompt} onChange={(e) => setNegativePrompt(e.target.value)}
                                    placeholder="Prompt Negativo: evite baixa qualidade, texto..."
                                    rows={2} className="w-full bg-zinc-800 rounded-md p-2 text-sm text-zinc-300 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none transition-shadow" disabled={isLoading}
                                />
                            )}
                             <button type="submit" disabled={isLoading || (!prompt && mode !== 'edit')} className="w-full flex items-center justify-center gap-2 py-2.5 px-3 bg-blue-600 rounded-md text-white font-semibold hover:bg-blue-500 transition-colors disabled:bg-zinc-700 disabled:cursor-not-allowed">
                                 {isLoading ? <Icons.Spinner /> : <Icons.Sparkles className="!text-lg" />}
                                 <span>Gerar</span>
                             </button>
                        </form>
                         {error && <div className="mt-2 p-2 bg-red-900/50 border border-red-800 text-red-300 text-xs rounded-md flex items-start gap-2"><Icons.AlertCircle className="shrink-0 mt-0.5 !text-base" /><span>{error}</span><button onClick={() => setError(null)} className="ml-auto p-0.5 text-red-300 hover:text-white"><Icons.Close className="!text-base" /></button></div>}
                    </PanelSection>
                    
                    <PanelSection title="Configurações" icon={<Icons.Settings />} defaultOpen={mode !== 'edit'}>
                         {mode === 'create' && (
                            <div className="space-y-3">
                                {styleOptions[activeCreateFunction].length > 0 && (<div className="custom-select-wrapper"> <select value={styleModifier} onChange={(e) => setStyleModifier(e.target.value)} className="custom-select" aria-label="Estilo"><option value="default" disabled>Selecione um Estilo</option>{styleOptions[activeCreateFunction].map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></div>)}
                                <div className="custom-select-wrapper"><select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} className="custom-select" aria-label="Proporção">{ALL_SUPPORTED_ASPECT_RATIOS.map((group) => (<optgroup label={group.label} key={group.label}>{group.options.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}</optgroup>))}</select></div>
                                {activeCreateFunction === 'comic' && (<div className="flex items-center gap-1 bg-zinc-800 p-1 rounded-md"><button onClick={() => setComicColorPalette('vibrant')} className={`w-1/2 text-center text-xs font-semibold py-1 rounded ${comicColorPalette === 'vibrant' ? 'bg-zinc-600' : ''}`}>Vibrante</button><button onClick={() => setComicColorPalette('noir')} className={`w-1/2 text-center text-xs font-semibold py-1 rounded ${comicColorPalette === 'noir' ? 'bg-zinc-600' : ''}`}>Noir</button></div>)}
                                {(activeCreateFunction === 'free' || activeCreateFunction === 'comic') && (<><div className="custom-select-wrapper"><label className="block text-xs font-medium text-zinc-400 mb-1">Ângulo da Câmera</label><select value={cameraAngle} onChange={(e) => setCameraAngle(e.target.value)} className="custom-select">{cameraAngleOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></div><div className="custom-select-wrapper"><label className="block text-xs font-medium text-zinc-400 mb-1">Iluminação</label><select value={lightingStyle} onChange={(e) => setLightingStyle(e.target.value)} className="custom-select">{lightingStyleOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></div></>)}
                            </div>
                        )}
                        {mode === 'edit' && activeEditFunction === 'style' && (
                             <div className="flex items-center gap-3">
                                <Slider label="Força" value={styleStrength} min={10} max={100} onChange={(e) => setStyleStrength(Number(e.target.value))} 'aria-label'="Força do estilo" sliderWidthClass='w-full' />
                                <span className="text-sm font-semibold text-zinc-400 w-10 text-right">{styleStrength}%</span>
                             </div>
                        )}
                        {mode === 'edit' && activeEditFunction === 'compose' && (
                             <button onClick={handleDetectObjects} disabled={!generatedImage || isDetectingObjects} className="w-full text-sm font-semibold py-2 px-3 bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:cursor-not-allowed rounded-md transition-colors flex items-center justify-center gap-2">
                                {isDetectingObjects ? <Icons.Spinner /> : <Icons.Visibility />} {isDetectingObjects ? 'Detectando...' : 'Detectar Objetos'}
                             </button>
                        )}
                        {mode === 'video' && activeVideoFunction === 'animation' && (
                           <ImageUploadSlot id="start-frame-upload" label="Imagem Inicial" icon={<Icons.UploadCloud className="text-3xl" />} imagePreviewUrl={startFramePreview} onUpload={(file) => processSingleFile(file, (img, url) => { setStartFrame(img); setStartFramePreview(url); })} onRemove={() => {setStartFrame(null); setStartFramePreview(null);}} className="h-32" />
                        )}
                         {!isLoading && mode === 'edit' && !generatedImage && (
                             <p className="text-xs text-zinc-500 text-center">Arraste uma imagem para a área de trabalho para começar.</p>
                         )}
                    </PanelSection>
                    
                     {mode === 'edit' && (
                        <>
                        <PanelSection title="Camadas de Referência" icon={<Icons.Reference />}>
                            {activeEditFunction === 'compose' ? (
                                <>
                                    <div className="grid grid-cols-3 gap-2">
                                        {referenceImages.slice(0, 6).map((ref, index) => (
                                            <div key={index} className="relative group w-full aspect-square bg-zinc-800 rounded-md overflow-hidden">
                                                <img src={ref.previewUrl} alt={`Referência ${index + 1}`} className="w-full h-full object-contain" />
                                                <div className="absolute inset-0 bg-black/60 flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button onClick={() => setPlacingImageIndex(index)} className="p-1.5 bg-zinc-900/80 text-blue-400 rounded-full hover:bg-zinc-700" title="Posicionar"><Icons.AddPhoto /></button>
                                                    <button onClick={() => handleRemoveReferenceImage(index)} className="p-1.5 bg-zinc-900/80 text-red-400 rounded-full hover:bg-zinc-700" title="Remover"><Icons.Close /></button>
                                                </div>
                                            </div>
                                        ))}
                                        {referenceImages.length < 6 && <ImageUploadSlot id="ref-upload-compose" label="" icon={<Icons.Add />} imagePreviewUrl={null} onUpload={(file) => processSingleFile(file, (img, url) => setReferenceImages(prev => [...prev, { image: img, previewUrl: url, mask: null }]))} onRemove={() => {}} className="aspect-square" />}
                                    </div>
                                    <button onClick={() => editorRef.current?.clearMask()} className="w-full text-xs font-semibold py-1.5 mt-2 bg-zinc-800 hover:bg-zinc-700 rounded-md flex items-center justify-center gap-1.5"><Icons.Deselect className="!text-sm" /> Limpar Objetos</button>
                                    {detectedObjects.length > 0 && (
                                        <div className="max-h-24 overflow-y-auto space-y-1 pr-1 mt-2 border-t border-zinc-800 pt-2">{detectedObjects.map(obj => (<button key={obj.name} onClick={() => handleGenerateObjectMask(obj)} onMouseEnter={() => setHighlightedObject(obj)} onMouseLeave={() => setHighlightedObject(null)} className="w-full text-left text-xs p-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700">{obj.name}</button>))}</div>
                                    )}
                                </>
                            ) : (
                                <ImageUploadSlot id="ref-upload-style" label="Estilo" icon={<Icons.UploadCloud className="text-3xl" />} imagePreviewUrl={referenceImages[0]?.previewUrl || null} onUpload={(file) => processSingleFile(file, (img, url) => { setReferenceImages([{ image: img, previewUrl: url, mask: null }]); setIsAnalyzingStyle(true); analyzeImageStyle(img).then(desc => setPrompt(desc)).catch(() => setError("Falha ao analisar estilo.")).finally(() => setIsAnalyzingStyle(false)); })} onRemove={() => handleRemoveReferenceImage(0)} className="h-32" />
                            )}
                            {isAnalyzingStyle && <div className="text-xs text-zinc-400 mt-2 flex items-center"><Icons.Spinner className="mr-2"/>Analisando estilo...</div>}
                        </PanelSection>
                        <PanelSection title="Filtros Rápidos" icon={<Icons.Filter />} defaultOpen={false}>
                            <div className="grid grid-cols-2 gap-2">{FILTERS.map(filter => (<button key={filter.name} onClick={() => applyFilter(filter.prompt)} disabled={!generatedImage || isLoading} className="text-xs font-semibold p-2 bg-zinc-800 hover:bg-zinc-700 rounded-md disabled:opacity-50" title={filter.prompt}>{filter.name}</button>))}</div>
                        </PanelSection>
                        </>
                     )}

                    {history.length > 0 && (
                         <PanelSection title="Histórico" icon={<Icons.History />} defaultOpen={true}>
                             <div className="grid grid-cols-4 gap-2">
                                 {history.map((entry, index) => (
                                     <button key={entry.id} onClick={() => handleHistoryNavigation(index)} className={`relative w-full aspect-square rounded-md overflow-hidden ring-2 transition-all ${index === historyIndex ? 'ring-blue-500' : 'ring-transparent hover:ring-zinc-600'}`}>
                                        {(entry.imageUrl || entry.startFramePreviewUrl) && <img src={entry.imageUrl || entry.startFramePreviewUrl} alt={`History ${index + 1}`} className="w-full h-full object-cover" />}
                                        {entry.videoUrl && <div className="w-full h-full bg-black flex items-center justify-center"><Icons.Video className="text-zinc-500" /></div>}
                                         <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent"></div>
                                         <span className="absolute bottom-0.5 right-1 text-xs font-bold text-white bg-black/50 px-1 rounded">{index + 1}</span>
                                     </button>
                                 ))}
                             </div>
                         </PanelSection>
                     )}
                </div>
            </aside>
        </>
    );
}