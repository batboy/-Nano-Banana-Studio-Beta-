
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
            {label && <span className="text-sm text-zinc-300 whitespace-nowrap">{label}</span>}
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

const FunctionButton: React.FC<{
  'data-function': string;
  isActive: boolean;
  onClick: (func: any) => void;
  icon: React.ReactNode;
  name: string;
}> = ({ 'data-function': dataFunction, isActive, onClick, icon, name }) => (
  <button
    data-function={dataFunction}
    onClick={() => onClick(dataFunction)}
    className={`flex flex-col items-center justify-center p-2 border rounded-md cursor-pointer transition-all duration-200 h-16 w-full text-center
      ${isActive ? 'border-blue-500 bg-blue-500/10 text-blue-400' : 'border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800/50 text-zinc-400'
    }`}
  >
    <div className="mb-1">{icon}</div>
    <div className="text-xs font-semibold">{name}</div>
  </button>
);

const PanelSection: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }> = ({ title, icon, children, defaultOpen = true }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className="border-b border-zinc-800">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-3 text-sm font-semibold text-zinc-300 hover:bg-zinc-800/50"
                title={`Expandir/recolher ${title}`}
            >
                <div className="flex items-center gap-2">
                    {icon}
                    <span>{title}</span>
                </div>
                <Icons.ChevronDown className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && <div className="p-3 space-y-4">{children}</div>}
        </div>
    );
};


interface ImageEditorProps {
  src: string;
  isSelectionEnabled: boolean;
  maskTool: 'brush' | 'eraser';
  brushSize: number;
  maskOpacity: number;
  onZoomChange: (zoom: number) => void;
  detectedObjects: DetectedObject[];
  highlightedObject: DetectedObject | null;
  onTransformChange: (transform: { scale: number; x: number; y: number; }) => void;
}

interface ImageEditorRef {
  getMaskData: () => UploadedImage | null;
  getMaskAsCanvas: () => HTMLCanvasElement | null;
  hasMaskData: () => boolean;
  getOriginalImageSize: () => { width: number, height: number } | null;
  clearMask: () => void;
  clearOverlays: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  setZoom: (zoom: number) => void;
  zoomToFit: () => void;
  stampObjectOnMask: (data: { previewUrl: string, placerTransform: any, maskOpacity: number, editorTransform: { scale: number, x: number, y: number } }) => void;
}

const ImageEditor = forwardRef<ImageEditorRef, ImageEditorProps>(({ src, isSelectionEnabled, maskTool, brushSize, maskOpacity, onZoomChange, detectedObjects, highlightedObject, onTransformChange }, ref) => {
    const imageCanvasRef = useRef<HTMLCanvasElement>(null);
    const maskCanvasRef = useRef<HTMLCanvasElement>(null);
    const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const originalImageSizeRef = useRef<{ width: number, height: number }>({ width: 0, height: 0 });
    const miniMapCanvasRef = useRef<HTMLCanvasElement>(null);
    const isMiniMapPanningRef = useRef(false);

    const [isDrawing, setIsDrawing] = useState(false);
    const lastPositionRef = useRef<{ x: number, y: number } | null>(null);
    const [cursorPreview, setCursorPreview] = useState({ x: 0, y: 0, visible: false });
    
    const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
    const isPanningRef = useRef(false);
    const panStartRef = useRef({ x: 0, y: 0 });
    const zoomToFitScale = useRef<number>(1);
    const isSpacebarDownRef = useRef(false);
    
    const currentStrokePointsRef = useRef<{ x: number, y: number }[]>([]);

    useEffect(() => {
        onTransformChange(transform);
    }, [transform, onTransformChange]);

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
        onZoomChange(transform.scale * 100);
    }, [transform.scale, onZoomChange]);

    const getCoords = useCallback((e: React.MouseEvent<HTMLElement> | MouseEvent): [number, number] => {
        const canvas = maskCanvasRef.current;
        if (!canvas || canvas.width === 0) return [0, 0];
    
        const rect = canvas.getBoundingClientRect();
    
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
    
        const canvasX = (e.clientX - rect.left) * scaleX;
        const canvasY = (e.clientY - rect.top) * scaleY;
        
        return [canvasX, canvasY];
    }, []);

    const drawMiniMap = useCallback(() => {
        const miniMapCanvas = miniMapCanvasRef.current;
        const imageCanvas = imageCanvasRef.current;
        const container = containerRef.current;
        if (!miniMapCanvas || !imageCanvas || !container || imageCanvas.width === 0) return;

        const miniMapCtx = miniMapCanvas.getContext('2d');
        if (!miniMapCtx) return;
        
        const { width: imgWidth, height: imgHeight } = imageCanvas;
        const { clientWidth: containerWidth, clientHeight: containerHeight } = container;
        
        const miniMapContainerSize = 150;
        const aspectRatio = imgWidth / imgHeight;
        if (aspectRatio > 1) {
            miniMapCanvas.width = miniMapContainerSize;
            miniMapCanvas.height = miniMapContainerSize / aspectRatio;
        } else {
            miniMapCanvas.height = miniMapContainerSize;
            miniMapCanvas.width = miniMapContainerSize * aspectRatio;
        }
        
        miniMapCtx.clearRect(0, 0, miniMapCanvas.width, miniMapCanvas.height);
        miniMapCtx.drawImage(imageCanvas, 0, 0, miniMapCanvas.width, miniMapCanvas.height);
        
        const miniMapScale = miniMapCanvas.width / imgWidth;
        const rectX = -transform.x * miniMapScale;
        const rectY = -transform.y * miniMapScale;
        const rectWidth = (containerWidth / transform.scale) * miniMapScale;
        const rectHeight = (containerHeight / transform.scale) * miniMapScale;
        
        miniMapCtx.strokeStyle = '#a1a1aa'; // zinc-400
        miniMapCtx.lineWidth = 2;
        miniMapCtx.fillStyle = 'rgba(161, 161, 170, 0.2)'; // zinc-400 with alpha
        miniMapCtx.fillRect(rectX, rectY, rectWidth, rectHeight);
        miniMapCtx.strokeRect(rectX, rectY, rectWidth, rectHeight);
    }, [transform]);

    useEffect(() => {
        drawMiniMap();
    }, [transform, drawMiniMap]);

    const zoomToFit = useCallback(() => {
        const image = imageCanvasRef.current;
        const container = containerRef.current;
        if (!image || !container || image.width === 0) return;

        const { clientWidth: containerWidth, clientHeight: containerHeight } = container;
        const imageAspectRatio = image.width / image.height;
        const containerAspectRatio = containerWidth / containerHeight;
        
        const scale = imageAspectRatio > containerAspectRatio
            ? (containerWidth / image.width) * 0.95
            : (containerHeight / image.height) * 0.95;
            
        zoomToFitScale.current = scale;
            
        const x = (containerWidth - image.width * scale) / 2;
        const y = (containerHeight - image.height * scale) / 2;
        
        setTransform({ scale, x, y });
    }, []);

    useEffect(() => {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.src = src;
        image.onload = () => {
            originalImageSizeRef.current = { width: image.width, height: image.height };
            
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
            zoomToFit();
        };
    }, [src, zoomToFit, clearMask, clearOverlays]);

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
            ctx.lineWidth = isHighlighted ? 4 : 2;
            ctx.strokeRect(x, y, w, h);

            // Label
            const label = obj.name;
            ctx.font = 'bold 16px Inter, sans-serif';
            const textMetrics = ctx.measureText(label);
            const textWidth = textMetrics.width;
            const textHeight = 16;
            const padding = 4;

            ctx.fillStyle = isHighlighted ? '#facc15' : '#3b82f6';
            ctx.fillRect(x, y - (textHeight + padding), textWidth + padding * 2, textHeight + padding);
            
            ctx.fillStyle = '#18181b';
            ctx.fillText(label, x + padding, y - (padding / 2));
        });

    }, [detectedObjects, highlightedObject]);

    const floodFill = useCallback((canvas: HTMLCanvasElement, startX: number, startY: number, opacity: number) => {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
    
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const { width, height } = canvas;
        const data = imageData.data;
        
        const alpha = Math.round(opacity * 255);
        const fillColorRgba = [74, 222, 128, alpha]; // Green
        
        const startPixelPos = (startY * width + startX) * 4;
        
        if (data[startPixelPos + 3] > 10) return;
    
        const pixelStack = [[startX, startY]];
    
        while (pixelStack.length) {
            const newPos = pixelStack.pop();
            if (!newPos) continue;
            let [x, y] = newPos;
    
            let pixelPos = (y * width + x) * 4;
            while (y-- >= 0 && data[pixelPos + 3] < 10) {
                pixelPos -= width * 4;
            }
            pixelPos += width * 4;
            y++;
            
            let reachLeft = false;
            let reachRight = false;
    
            while (y++ < height - 1 && data[pixelPos + 3] < 10) {
                data[pixelPos] = fillColorRgba[0];
                data[pixelPos + 1] = fillColorRgba[1];
                data[pixelPos + 2] = fillColorRgba[2];
                data[pixelPos + 3] = fillColorRgba[3];
    
                if (x > 0) {
                    if (data[pixelPos - 4 + 3] < 10) {
                        if (!reachLeft) {
                            pixelStack.push([x - 1, y]);
                            reachLeft = true;
                        }
                    } else if (reachLeft) {
                        reachLeft = false;
                    }
                }
    
                if (x < width - 1) {
                    if (data[pixelPos + 4 + 3] < 10) {
                        if (!reachRight) {
                            pixelStack.push([x + 1, y]);
                            reachRight = true;
                        }
                    } else if (reachRight) {
                        reachRight = false;
                    }
                }
                
                pixelPos += width * 4;
            }
        }
        
        ctx.putImageData(imageData, 0, 0);
    }, []);

    const fillEnclosedArea = useCallback((points: {x: number, y: number}[]) => {
        const canvas = maskCanvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const centroid = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
        centroid.x /= points.length;
        centroid.y /= points.length;
        const seedX = Math.floor(centroid.x);
        const seedY = Math.floor(centroid.y);
    
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        if(!tempCtx) return;

        tempCtx.drawImage(canvas, 0, 0);

        tempCtx.beginPath();
        tempCtx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            tempCtx.lineTo(points[i].x, points[i].y);
        }
        tempCtx.closePath();
        tempCtx.lineWidth = brushSize;
        tempCtx.lineCap = 'round';
        tempCtx.lineJoin = 'round';
        tempCtx.strokeStyle = `rgba(74, 222, 128, ${maskOpacity})`; // Green
        tempCtx.stroke();
        
        floodFill(tempCanvas, seedX, seedY, maskOpacity);

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(tempCanvas, 0, 0);

    }, [brushSize, floodFill, maskOpacity]);

    const startDrawing = (e: React.MouseEvent<HTMLDivElement>) => {
        setIsDrawing(true);
        const [x, y] = getCoords(e);
        lastPositionRef.current = { x, y };
        currentStrokePointsRef.current = [{ x, y }];
    };

    const stopDrawing = () => {
        if (!isDrawing) return;
        setIsDrawing(false);
        lastPositionRef.current = null;
        
        if (maskTool === 'brush' && currentStrokePointsRef.current.length > 3) {
            const points = currentStrokePointsRef.current;
            const startPoint = points[0];
            const endPoint = points[points.length - 1];
            const distance = Math.sqrt(Math.pow(endPoint.x - startPoint.x, 2) + Math.pow(endPoint.y - startPoint.y, 2));

            const triggerDistance = 40;

            if (distance < triggerDistance) {
                fillEnclosedArea(points);
            }
        }
        currentStrokePointsRef.current = [];
    };

    const draw = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!isDrawing || !lastPositionRef.current) return;
        const ctx = maskCanvasRef.current?.getContext('2d');
        if (!ctx) return;
        
        const [currentX, currentY] = getCoords(e);
        currentStrokePointsRef.current.push({ x: currentX, y: currentY });

        ctx.lineWidth = brushSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (maskTool === 'brush') {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = `rgba(74, 222, 128, ${maskOpacity})`; // Green
        } else {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.strokeStyle = 'rgba(0,0,0,1)';
        }
        
        ctx.beginPath();
        ctx.moveTo(lastPositionRef.current.x, lastPositionRef.current.y);
        ctx.lineTo(currentX, currentY);
        ctx.stroke();

        lastPositionRef.current = { x: currentX, y: currentY };
    };

     const handleZoomSliderChange = useCallback((newScaleValue: number) => {
        const container = containerRef.current;
        if (!container) return;
        const { clientWidth, clientHeight } = container;

        const newScale = Math.max(0.2, Math.min(newScaleValue / 100, 5));
        
        const pointX = (clientWidth / 2 - transform.x) / transform.scale;
        const pointY = (clientHeight / 2 - transform.y) / transform.scale;
        
        const newX = clientWidth / 2 - pointX * newScale;
        const newY = clientHeight / 2 - pointY * newScale;

        setTransform({ scale: newScale, x: newX, y: newY });
    }, [transform]);
    
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
            zoomIn: () => handleZoomSliderChange(transform.scale * 100 * 1.2),
            zoomOut: () => handleZoomSliderChange(transform.scale * 100 / 1.2),
            setZoom: (zoom) => handleZoomSliderChange(zoom),
            zoomToFit,
            stampObjectOnMask: (data) => {
                const maskCanvas = maskCanvasRef.current;
                if (!maskCanvas) return;

                const ctx = maskCanvas.getContext('2d');
                if (!ctx) return;
                
                const { placerTransform, editorTransform } = data;
                
                const canvasX = (placerTransform.x - editorTransform.x) / editorTransform.scale;
                const canvasY = (placerTransform.y - editorTransform.y) / editorTransform.scale;
                const canvasWidth = placerTransform.width / editorTransform.scale;
                const canvasHeight = placerTransform.height / editorTransform.scale;
                
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

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.repeat || e.code !== 'Space' || isSpacebarDownRef.current) return;
            
            const activeEl = document.activeElement;
            if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
                return; 
            }

            e.preventDefault();
            isSpacebarDownRef.current = true;
            if (containerRef.current && !isPanningRef.current) {
                containerRef.current.style.cursor = 'grab';
            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.code !== 'Space') return;
            
            isSpacebarDownRef.current = false;
            if (containerRef.current && !isPanningRef.current) {
                containerRef.current.style.cursor = isSelectionEnabled ? 'none' : 'grab';
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [isSelectionEnabled]);
    
    const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
        if (!containerRef.current) return;
        e.preventDefault();
        const rect = containerRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const zoomFactor = 1.1;
        const newScale = e.deltaY < 0 ? transform.scale * zoomFactor : transform.scale / zoomFactor;
        const clampedScale = Math.max(0.2, Math.min(5, newScale));
        const pointX = (mouseX - transform.x) / transform.scale;
        const pointY = (mouseY - transform.y) / transform.scale;
        const newX = mouseX - pointX * clampedScale;
        const newY = mouseY - pointY * clampedScale;
        setTransform({ scale: clampedScale, x: newX, y: newY });
    };

    const handleContainerMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        if ((isSpacebarDownRef.current && e.button === 0) || e.button === 1 || e.button === 2) {
            e.preventDefault();
            isPanningRef.current = true;
            panStartRef.current = { x: e.clientX - transform.x, y: e.clientY - transform.y };
            if (containerRef.current) containerRef.current.style.cursor = 'grabbing';
        } 
        else if (e.button === 0 && isSelectionEnabled) {
            startDrawing(e);
        }
    };
    
    const stopPanning = useCallback(() => {
        if (!isPanningRef.current) return;
        isPanningRef.current = false;
        if (containerRef.current) {
            containerRef.current.style.cursor = isSpacebarDownRef.current 
                ? 'grab' 
                : isSelectionEnabled 
                    ? 'none' 
                    : 'grab';
        }
    }, [isSelectionEnabled]);

    const handleContainerMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
        if (isDrawing && e.button === 0) {
            stopDrawing();
        }
        stopPanning();
    };
    
    const handleContainerMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        const container = containerRef.current;
        if (!container) return;
        
        if (isPanningRef.current) {
            const x = e.clientX - panStartRef.current.x;
            const y = e.clientY - panStartRef.current.y;
            setTransform(prev => ({ ...prev, x, y }));
        } else {
            const rect = container.getBoundingClientRect();
            setCursorPreview({ x: e.clientX - rect.left, y: e.clientY - rect.top, visible: true });
            if (isDrawing) draw(e);
        }
    };
    
    const handleContainerMouseLeave = () => {
        if (isDrawing) {
            stopDrawing();
        }
        stopPanning();
        setCursorPreview(prev => ({ ...prev, visible: false }));
    };

    const handleMiniMapPan = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const miniMapCanvas = miniMapCanvasRef.current;
        const imageCanvas = imageCanvasRef.current;
        const container = containerRef.current;
        if (!miniMapCanvas || !imageCanvas || !container) return;

        const rect = miniMapCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const miniMapScale = miniMapCanvas.width / imageCanvas.width;
        
        const newX = -(mouseX / miniMapScale) * transform.scale + container.clientWidth / 2;
        const newY = -(mouseY / miniMapScale) * transform.scale + container.clientHeight / 2;

        setTransform(t => ({ ...t, x: newX, y: newY }));
    };

    const handleMiniMapMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        isMiniMapPanningRef.current = true;
        handleMiniMapPan(e);
    };
    
    const handleMiniMapMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (isMiniMapPanningRef.current) {
            handleMiniMapPan(e);
        }
    };
    
    const handleMiniMapMouseUp = () => {
        isMiniMapPanningRef.current = false;
    };


    useEffect(() => {
        const handleResize = () => zoomToFit();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [zoomToFit]);
    
    const showMiniMap = transform.scale > zoomToFitScale.current * 1.1;

    return (
        <div ref={containerRef} 
             className="w-full h-full relative overflow-hidden touch-none bg-zinc-900/50 rounded-lg"
             onWheel={handleWheel}
             onMouseDown={handleContainerMouseDown}
             onMouseMove={handleContainerMouseMove}
             onMouseUp={handleContainerMouseUp}
             onMouseLeave={handleContainerMouseLeave}
             onContextMenu={(e) => e.preventDefault()}
             style={{ cursor: isSelectionEnabled ? 'none' : 'grab' }}
             >
            <div 
                className="absolute top-0 left-0"
                style={{ 
                    transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                    transformOrigin: 'top left',
                }}
            >
                <canvas ref={imageCanvasRef} className="block" />
                <canvas
                    ref={maskCanvasRef}
                    className="absolute top-0 left-0 transition-opacity duration-200"
                    style={{ opacity: isSelectionEnabled ? maskOpacity : 0 }}
                />
                <canvas
                    ref={overlayCanvasRef}
                    className="absolute top-0 left-0 pointer-events-none"
                />
            </div>
            {isSelectionEnabled && cursorPreview.visible && (
                 <div
                    className="absolute pointer-events-none rounded-full border-2"
                    style={{
                        left: cursorPreview.x,
                        top: cursorPreview.y,
                        width: brushSize * transform.scale,
                        height: brushSize * transform.scale,
                        transform: 'translate(-50%, -50%)',
                        borderColor: maskTool === 'brush' ? 'rgba(74, 222, 128, 0.8)' : 'rgba(239, 68, 68, 0.8)',
                        boxShadow: '0 0 8px rgba(0, 0, 0, 0.5)',
                        transition: 'width 0.1s ease, height 0.1s ease',
                        ...(maskTool === 'eraser' && {
                             backgroundColor: 'rgba(239, 68, 68, 0.2)'
                        })
                    }}
                />
            )}
            
            {showMiniMap && (
                <div 
                    className="absolute top-4 right-4 bg-zinc-950/70 backdrop-blur-sm rounded-lg shadow-lg ring-1 ring-white/10 overflow-hidden"
                    onMouseLeave={handleMiniMapMouseUp}
                >
                    <canvas
                        ref={miniMapCanvasRef}
                        onMouseDown={handleMiniMapMouseDown}
                        onMouseMove={handleMiniMapMouseMove}
                        onMouseUp={handleMiniMapMouseUp}
                        className="cursor-pointer"
                        style={{ maxWidth: 150, maxHeight: 150 }}
                    />
                </div>
            )}
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
}> = ({ id, label, icon, imagePreviewUrl, onUpload, onRemove }) => {
    const [isDragging, setIsDragging] = useState(false);
    const dragCounter = useRef(0);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            onUpload(e.target.files[0]);
            e.target.value = ''; // Reset input to allow re-uploading the same file
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
            <div className="relative group w-full h-full bg-zinc-800 rounded-md overflow-hidden">
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
            className={`w-full h-full border-2 rounded-md transition-all duration-200 ${isDragging ? 'border-blue-500 bg-blue-500/10 border-solid' : 'border-zinc-800 border-dashed'}`}
        >
            <input type="file" id={id} className="hidden" accept="image/png, image/jpeg, image/webp" onChange={handleFileChange} />
            <label htmlFor={id} className="cursor-pointer flex flex-col items-center justify-center h-full text-center p-2 text-zinc-500 hover:text-zinc-400">
                {icon}
                <span className="text-xs font-semibold mt-1">{label}</span>
                <span className="text-xs mt-1">Arraste ou clique para enviar</span>
            </label>
        </div>
    );
};

// Helper function to get image dimensions from a URL
const getImageDimensions = (url: string): Promise<{ width: number; height: number }> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            resolve({ width: img.width, height: img.height });
        };
        img.onerror = (err) => {
            reject(err);
        };
        img.src = url;
    });
};

// Helper function to calculate aspect ratio string and match common ratios
const getAspectRatioString = (width: number, height: number): string => {
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const commonDivisor = gcd(width, height);
    const w = width / commonDivisor;
    const h = height / commonDivisor;

    const commonRatios: { [key: string]: number } = {
        '1:1': 1,
        '16:9': 16/9,
        '9:16': 9/16,
        '4:3': 4/3,
        '3:4': 3/4,
    };

    const numericRatio = w / h;
    for (const key in commonRatios) {
        if (Math.abs(numericRatio - commonRatios[key]) < 0.02) {
            return key;
        }
    }
    
    return `${w}:${h}`; // Fallback to exact ratio
};

// Re-organize aspect ratios by category for better user experience in the dropdown.
const ALL_SUPPORTED_ASPECT_RATIOS = [
    { label: 'Quadrado', options: ['1:1'] },
    { label: 'Paisagem (Horizontal)', options: ['16:9', '4:3'] },
    { label: 'Retrato (Vertical)', options: ['9:16', '3:4'] },
];

// Flattened list for components that don't use groups.
const ASPECT_RATIOS = ALL_SUPPORTED_ASPECT_RATIOS.flatMap(group => group.options);

const FILTERS = [
    { name: 'Noir', prompt: "Aplique um filtro noir preto e branco de alto contraste e dramático à imagem, com sombras profundas e realces brilhantes." },
    { name: 'Sépia', prompt: "Converta a imagem para um tom sépia quente, dando-lhe uma aparência de fotografia antiga e vintage." },
    { name: 'Vívido', prompt: "Realce as cores da imagem para torná-las mais vibrantes e saturadas. Aumente ligeiramente o contraste geral." },
    { name: 'Sonhador', prompt: "Aplique um efeito etéreo e sonhador à imagem com foco suave, um brilho delicado e cores pastel ligeiramente dessaturadas." },
    { name: 'Cyberpunk', prompt: "Transforme a imagem com uma estética cyberpunk, apresentando azuis, rosas e roxos neon na iluminação, alto contraste e uma sensação futurista e urbana." },
    { name: 'Aquarela', prompt: "Converta a imagem para que pareça uma pintura em aquarela, com bordas suaves, cores mescladas e uma aparência de papel texturizado." },
    { name: 'Ilustração', prompt: "Transforme a imagem em uma ilustração digital, com contornos definidos, sombreamento estilizado e uma paleta de cores rica." },
    { name: 'Anime', prompt: "Converta a imagem para o estilo de anime japonês, com traços característicos, olhos grandes e expressivos, cabelos estilizados e cores vibrantes com sombreamento cel shading." },
    { name: '3D', prompt: "Renderize a imagem em um estilo de arte 3D, como se fosse de uma animação CGI, com superfícies suaves, iluminação realista e profundidade." },
];

export default function App() {
    // Main state
    const [prompt, setPrompt] = useState<string>('');
    const [mode, setMode] = useState<Mode>('create');
    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [historyIndex, setHistoryIndex] = useState<number>(-1);
    
    // Create mode state
    const [activeCreateFunction, setActiveCreateFunction] = useState<CreateFunction>('free');
    const [aspectRatio, setAspectRatio] = useState<string>('1:1');
    const [negativePrompt, setNegativePrompt] = useState<string>('');
    const [styleModifier, setStyleModifier] = useState<string>('default');
    const [cameraAngle, setCameraAngle] = useState<string>('default');
    const [lightingStyle, setLightingStyle] = useState<string>('default');
    const [comicColorPalette, setComicColorPalette] = useState<'vibrant' | 'noir'>('vibrant');


    // Edit mode state
    const [activeEditFunction, setActiveEditFunction] = useState<EditFunction>('compose');
    const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
    const [styleStrength, setStyleStrength] = useState<number>(100);
    const [detectedObjects, setDetectedObjects] = useState<DetectedObject[]>([]);
    const [highlightedObject, setHighlightedObject] = useState<DetectedObject | null>(null);
    const [currentImageAspectRatio, setCurrentImageAspectRatio] = useState<string | null>(null);
    const [placingImageIndex, setPlacingImageIndex] = useState<number | null>(null);

    
    // Video mode state
    const [activeVideoFunction, setActiveVideoFunction] = useState<VideoFunction>('prompt');
    const [startFrame, setStartFrame] = useState<UploadedImage | null>(null);
    const [startFramePreview, setStartFramePreview] = useState<string | null>(null);


    // UI & Loading state
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [loadingMessage, setLoadingMessage] = useState<string>('Gerando sua mídia...');
    const [isAnalyzingStyle, setIsAnalyzingStyle] = useState<boolean>(false);
    const [isDetectingObjects, setIsDetectingObjects] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [showMobileModal, setShowMobileModal] = useState<boolean>(false);
    const [isDragging, setIsDragging] = useState<boolean>(false);
    const [dragTarget, setDragTarget] = useState<'main' | 'reference' | null>(null);
    const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([]);
    
    // Dialogs & Modals state
    const [confirmationDialog, setConfirmationDialog] = useState({ isOpen: false, title: '', message: '', onConfirm: () => {} });
    
    // Editor-specific state
    const [maskTool, setMaskTool] = useState<'brush' | 'eraser'>('brush');
    const [brushSize, setBrushSize] = useState(40);
    const [maskOpacity, setMaskOpacity] = useState(0.6);
    const [editorZoom, setEditorZoom] = useState(100);
    const [editorTransform, setEditorTransform] = useState({ scale: 1, x: 0, y: 0 });
    
    // Refs
    const editorRef = useRef<ImageEditorRef>(null);
    const mainContentRef = useRef<HTMLDivElement>(null);
    const placerContainerRef = useRef<HTMLDivElement>(null);
    const dragCounter = useRef(0);
    const dragLeaveTimeout = useRef<number | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

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
                    {/* Handlers */}
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
                 {/* Toolbar */}
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-zinc-900/80 backdrop-blur-sm p-2 rounded-lg shadow-lg flex items-center gap-2 ring-1 ring-white/10 pointer-events-auto">
                    <button onClick={onCancel} className="px-3 py-2 text-sm font-semibold rounded-md bg-zinc-800 hover:bg-zinc-700 transition-colors flex items-center gap-2">
                        <Icons.Close /> Cancelar
                    </button>
                    <button onClick={() => onConfirm(transform)} className="px-3 py-2 text-sm font-semibold rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-colors flex items-center gap-2">
                        <Icons.Check /> Aplicar
                    </button>
                </div>
            </div>
        );
    };

    const styleOptions: Record<CreateFunction, { value: string, label: string }[]> = {
        free: [],
        sticker: [
            { value: 'cartoon', label: 'Desenho' },
            { value: 'vintage', label: 'Vintage' },
            { value: 'holographic', label: 'Holográfico' },
            { value: 'embroidered patch', label: 'Bordado' },
        ],
        text: [
            { value: 'minimalist', label: 'Minimalista' },
            { value: 'corporate', label: 'Corporativo' },
            { value: 'playful', label: 'Divertido' },
            { value: 'geometric', label: 'Geométrico' },
        ],
        comic: [
            { value: 'American comic book', label: 'Americano' },
            { value: 'Japanese manga', label: 'Mangá' },
            { value: 'franco-belgian comics (bande dessinée)', label: 'Franco-Belga' },
        ],
    };

    const cameraAngleOptions = [
        { value: 'default', label: 'Padrão' },
        { value: 'eye-level', label: 'Nível do Olhar' },
        { value: 'close-up', label: 'Close-up' },
        { value: 'low angle', label: 'Ângulo Baixo' },
        { value: 'high angle (bird\'s-eye view)', label: 'Plano Alto' },
        { value: 'wide shot (long shot)', label: 'Plano Geral' },
    ];
    
    const lightingStyleOptions = [
        { value: 'default', label: 'Padrão' },
        { value: 'cinematic', label: 'Cinemática' },
        { value: 'soft', label: 'Luz Suave' },
        { value: 'dramatic', label: 'Dramática' },
        { value: 'studio', label: 'Estúdio' },
        { value: 'natural', label: 'Natural' },
    ];
    
    const closeConfirmationDialog = () => {
        setConfirmationDialog(prev => ({ ...prev, isOpen: false }));
    };

    const handleConfirm = () => {
        confirmationDialog.onConfirm();
        closeConfirmationDialog();
    };

    const resetDetectionState = useCallback(() => {
        setDetectedObjects([]);
        setHighlightedObject(null);
        editorRef.current?.clearOverlays();
    }, []);

    useEffect(() => {
        if (generatedImage) {
            getImageDimensions(generatedImage).then(({ width, height }) => {
                setCurrentImageAspectRatio(getAspectRatioString(width, height));
            }).catch(err => {
                console.error("Could not get image dimensions:", err);
                setCurrentImageAspectRatio(null);
            });
        } else {
            setCurrentImageAspectRatio(null);
        }
    }, [generatedImage]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (mode !== 'edit' || activeEditFunction !== 'compose') return;

            const activeEl = document.activeElement;
            if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return;

            const step = 5;

            if (e.key === '[') {
                e.preventDefault();
                setBrushSize(prev => Math.max(5, prev - step));
            } else if (e.key === ']') {
                e.preventDefault();
                setBrushSize(prev => Math.min(100, prev + step));
            }
        };

        window.addEventListener('keydown', handleKeyDown);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [mode, activeEditFunction]);


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
    
        const performHardSwitch = () => {
            setMode(newMode);
            resetImages();
            setHistory([]);
            setHistoryIndex(-1);
            setPrompt('');
            setNegativePrompt('');
        };
    
        const performSwitchToEdit = () => {
            setMode('edit');
            resetImages();
            if (latestImage) {
                const currentEntry = history[historyIndex];
                setHistory([currentEntry]);
                setHistoryIndex(0);
                setPrompt(currentEntry.prompt);
                setNegativePrompt(currentEntry.negativePrompt || '');
            } else {
                setHistory([]);
                setHistoryIndex(-1);
                setPrompt('');
                setNegativePrompt('');
            }
        };
    
        const performSwitchToVideoWithAnimation = () => {
            if (!latestImage) {
                // If there's no image, fall back to a standard switch to video mode
                setMode('video');
                resetImages();
                setHistory([]);
                setHistoryIndex(-1);
                setPrompt('');
                setNegativePrompt('');
                setActiveVideoFunction('prompt');
                return;
            }
    
            // If there IS an image, set up the animation state while preserving history
            setMode('video');
            resetImages(); // Clears ref images, but we set start frame next
            setPrompt('');
            setNegativePrompt('');
            setActiveVideoFunction('animation');
    
            const base64 = latestImage.split(',')[1];
            const mimeType = latestImage.match(/data:(image\/[^;]+);/)?.[1] || 'image/png';
            setStartFrame({ base64, mimeType });
            setStartFramePreview(latestImage);
        };
    
        if (mode === 'edit' && history.length > 0 && newMode !== 'edit') {
            const isContinuingToVideo = newMode === 'video';
            
            const onConfirmAction = isContinuingToVideo
                ? performSwitchToVideoWithAnimation
                : performHardSwitch;
            
            const dialogMessage = isContinuingToVideo
                ? "Isso irá transferir sua imagem atual para o modo de vídeo para animação, preservando seu histórico. Deseja continuar?"
                : "Ao sair do modo de edição, a imagem atual e seu histórico de edições serão perdidos. Deseja continuar?";
            
            const dialogTitle = isContinuingToVideo
                ? 'Mudar para o Modo de Vídeo?'
                : 'Sair do Modo de Edição?';

            setConfirmationDialog({
                isOpen: true,
                title: dialogTitle,
                message: dialogMessage,
                onConfirm: onConfirmAction,
            });
            return;
        }
    
        if (newMode === 'edit') {
            performSwitchToEdit();
        } else if (newMode === 'video') {
            performSwitchToVideoWithAnimation();
        } else {
            performHardSwitch();
        }
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
            resetImages(); 
        } else if (entry.mode === 'edit') { 
            setActiveEditFunction(entry.editFunction!);
            setReferenceImages(entry.referenceImages || []);
            if (entry.editFunction === 'style' && entry.styleStrength) {
                setStyleStrength(entry.styleStrength);
            }
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

    const handleAspectRatioChange = (ratio: string) => {
        setAspectRatio(ratio);
    };

    const handleEditFunctionClick = (func: EditFunction) => {
        if (func !== activeEditFunction) {
            setReferenceImages([]);
        }
        setActiveEditFunction(func);
    };

    const handleVideoFunctionClick = (func: VideoFunction) => {
        if (func !== activeVideoFunction) {
            setStartFrame(null);
            setStartFramePreview(null);
        }
        setActiveVideoFunction(func);
    };

    const processSingleFile = useCallback((file: File, callback: (image: UploadedImage, previewUrl: string) => void) => {
        const id = `upload-${file.name}-${Date.now()}`;

        if (file.size > 10 * 1024 * 1024) {
            setUploadProgress(prev => [...prev, { id, name: file.name, progress: 100, status: 'error', message: 'Excede o limite de 10MB.' }]);
            setTimeout(() => setUploadProgress(p => p.filter(item => item.id !== id)), 5000);
            return;
        }
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
            setUploadProgress(prev => [...prev, { id, name: file.name, progress: 100, status: 'error', message: 'Tipo de arquivo inválido.' }]);
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
            setUploadProgress(p => p.map(item => item.id === id ? { ...item, status: 'error', message: 'Falha ao ler o arquivo.' } : item));
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
    
    const processUploadedFiles = useCallback((files: File[], target: 'main' | 'reference') => {
        let isMainImageSlotFilled = history.length > 0;
        const filesToProcess = [...files];

        if (target === 'main' && filesToProcess.length > 1) {
            filesToProcess.splice(1);
        }
        
        if (target === 'reference' && activeEditFunction === 'style') {
            if (filesToProcess.length > 1) {
                filesToProcess.splice(1);
            }
        }

        filesToProcess.forEach((file, index) => {
            const id = `upload-${file.name}-${Date.now()}-${Math.random()}`;
            const isMainImageTarget = (target === 'main') || (target === 'reference' && !isMainImageSlotFilled && index === 0);

            if (file.size > 10 * 1024 * 1024) {
                setUploadProgress(prev => [...prev, { id, name: file.name, progress: 100, status: 'error', message: 'Excede o limite de 10MB.' }]);
                setTimeout(() => setUploadProgress(p => p.filter(item => item.id !== id)), 5000);
                return;
            }
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
                setUploadProgress(prev => [...prev, { id, name: file.name, progress: 100, status: 'error', message: 'Tipo de arquivo inválido.' }]);
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
                setUploadProgress(p => p.map(item => item.id === id ? { ...item, status: 'error', message: 'Falha ao ler o arquivo.' } : item));
                setTimeout(() => setUploadProgress(p => p.filter(item => item.id !== id)), 5000);
            };

            reader.onload = async () => {
                setUploadProgress(p => p.map(item => item.id === id ? { ...item, status: 'success', progress: 100 } : item));
                
                const dataUrl = reader.result as string;
                const uploadedImage: UploadedImage = { base64: dataUrl.split(',')[1], mimeType: file.type };
                
                if (isMainImageTarget) {
                    const initialEntry: HistoryEntry = {
                        id: `hist-${Date.now()}`,
                        imageUrl: dataUrl,
                        prompt: '',
                        mode: 'edit',
                        editFunction: activeEditFunction,
                        referenceImages: [],
                    };
                    resetDetectionState();
                    setHistory([initialEntry]);
                    setHistoryIndex(0);
                    setReferenceImages([]);
                    setPrompt('');
                    isMainImageSlotFilled = true;
                } else {
                    const newRefImage: ReferenceImage = { image: uploadedImage, previewUrl: dataUrl, mask: null };
                    if (activeEditFunction === 'style') {
                        setReferenceImages([newRefImage]);
                        setIsAnalyzingStyle(true);
                        setError(null);
                        try {
                            const styleDescription = await analyzeImageStyle(uploadedImage);
                            if (styleDescription) {
                                setPrompt(styleDescription);
                            }
                        } catch (analysisError) {
                            console.error("Style analysis failed:", analysisError);
                            setError("Não foi possível analisar o estilo da imagem de referência.");
                        } finally {
                            setIsAnalyzingStyle(false);
                        }
                    } else {
                        setReferenceImages(prev => [...prev, newRefImage]);
                    }
                }

                setTimeout(() => setUploadProgress(p => p.filter(item => item.id !== id)), 1500);
            };
            
            reader.readAsDataURL(file);
        });
    }, [history.length, activeEditFunction, resetDetectionState]);

    const handleImageUpload = useCallback((files: FileList | null, target: 'main' | 'reference') => {
        if (!files || files.length === 0 || mode !== 'edit') return;

        if (target === 'main' && generatedImage && isEditStateDirty()) {
             setConfirmationDialog({
                isOpen: true,
                title: 'Substituir Imagem Principal?',
                message: 'Isso substituirá a imagem atual e limpará o histórico de edições. Deseja continuar?',
                onConfirm: () => processUploadedFiles(Array.from(files), target)
            });
        } else {
            processUploadedFiles(Array.from(files), target);
        }
    }, [mode, generatedImage, isEditStateDirty, processUploadedFiles]);

    const handleRemoveReferenceImage = (indexToRemove: number) => {
        setReferenceImages(prev => prev.filter((_, index) => index !== indexToRemove));
        if (activeEditFunction === 'style') {
            setPrompt('');
        }
    };
    
    const handleRemoveStartFrame = () => {
        setStartFrame(null);
        setStartFramePreview(null);
    };

    const handleClearAllImages = () => {
        if (isEditStateDirty()) {
            setConfirmationDialog({
                isOpen: true,
                title: 'Limpar Tudo?',
                message: 'Isso removerá a imagem principal e todas as referências, limpando o histórico. Deseja continuar?',
                onConfirm: () => {
                    setHistory([]);
                    setHistoryIndex(-1);
                    setReferenceImages([]);
                    setPrompt('');
                    setNegativePrompt('');
                    resetDetectionState();
                }
            });
        } else {
            setHistory([]);
            setHistoryIndex(-1);
            setReferenceImages([]);
            setPrompt('');
            setNegativePrompt('');
            resetDetectionState();
        }
    };
    
    const handleRemoveMainImage = () => {
         if (isEditStateDirty()) {
             setConfirmationDialog({
                isOpen: true,
                title: 'Remover Imagem Principal?',
                message: 'Isso removerá a imagem principal e todas as suas edições. Deseja continuar?',
                onConfirm: () => {
                    setHistory([]);
                    setHistoryIndex(-1);
                    setPrompt('');
                    setNegativePrompt('');
                    resetDetectionState();
                }
            });
         } else {
            setHistory([]);
            setHistoryIndex(-1);
            setPrompt('');
            setNegativePrompt('');
            resetDetectionState();
         }
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        if (!isDragging) setIsDragging(true);
        if (dragLeaveTimeout.current) {
            clearTimeout(dragLeaveTimeout.current);
            dragLeaveTimeout.current = null;
        }
    };

    const handleDragEnter = (e: React.DragEvent<HTMLDivElement>, target: 'main' | 'reference') => {
        e.preventDefault();
        dragCounter.current++;
        setDragTarget(target);
    };

    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        dragCounter.current--;
        if (dragCounter.current === 0) {
            setDragTarget(null);
            dragLeaveTimeout.current = window.setTimeout(() => {
                setIsDragging(false);
            }, 100);
        }
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>, target: 'main' | 'reference') => {
        e.preventDefault();
        setIsDragging(false);
        setDragTarget(null);
        dragCounter.current = 0;
        if (e.dataTransfer.files) {
            handleImageUpload(e.dataTransfer.files, target);
        }
    };

    const handleDetectObjects = async () => {
        if (!generatedImage || isDetectingObjects) return;

        setIsDetectingObjects(true);
        setError(null);
        try {
            const base64 = generatedImage.split(',')[1];
            const mimeType = generatedImage.match(/data:(image\/[^;]+);/)?.[1] || 'image/png';
            const detected = await detectObjects({ base64, mimeType });
            setDetectedObjects(detected);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setIsDetectingObjects(false);
        }
    };

    const handleGenerateObjectMask = async (object: DetectedObject) => {
        if (!generatedImage) return;

        setError(null);
        setHighlightedObject(object);

        const newReferenceImages = [...referenceImages];
        const newRef: ReferenceImage = { 
            image: { base64: '', mimeType: '' }, 
            previewUrl: '',
            mask: null,
            isExtractingObject: true,
        };
        newReferenceImages.push(newRef);
        const newIndex = newReferenceImages.length - 1;
        setReferenceImages(newReferenceImages);

        try {
            const base64 = generatedImage.split(',')[1];
            const mimeType = generatedImage.match(/data:(image\/[^;]+);/)?.[1] || 'image/png';
            const fullImage: UploadedImage = { base64, mimeType };

            const tempCanvas = document.createElement('canvas');
            const img = new Image();
            img.src = generatedImage;
            await new Promise(resolve => img.onload = resolve);
            tempCanvas.width = img.width;
            tempCanvas.height = img.height;
            const ctx = tempCanvas.getContext('2d');
            if (!ctx) throw new Error("Could not create canvas context");
            
            const { x1, y1, x2, y2 } = object.box;
            const cropX = x1 * img.width;
            const cropY = y1 * img.height;
            const cropW = (x2 - x1) * img.width;
            const cropH = (y2 - y1) * img.height;

            ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
            const croppedDataUrl = tempCanvas.toDataURL(mimeType);
            const croppedImage: UploadedImage = {
                base64: croppedDataUrl.split(',')[1],
                mimeType: mimeType,
            };

            const mask = await generateObjectMask(croppedImage);
            const maskUrl = `data:${mask.mimeType};base64,${mask.base64}`;

            setReferenceImages(prev => prev.map((ref, index) => {
                if (index === newIndex) {
                    return {
                        image: croppedImage,
                        previewUrl: croppedDataUrl,
                        mask: mask,
                        maskedObjectPreviewUrl: maskUrl,
                        isExtractingObject: false,
                    };
                }
                return ref;
            }));

        } catch (e: any) {
            setError(e.message);
            setReferenceImages(prev => prev.filter((_, index) => index !== newIndex));
        } finally {
            setHighlightedObject(null);
        }
    };

    const applyFilter = (filterPrompt: string) => {
        if (!generatedImage) {
            setError("Por favor, gere ou envie uma imagem primeiro para aplicar um filtro.");
            return;
        }
        setPrompt(filterPrompt);
        handleSubmit(new Event('submit') as any); 
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement> | React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        setError(null);
        if (isLoading) return;

        let newHistoryEntry: HistoryEntry;

        try {
            if (mode === 'create') {
                if (!prompt) {
                    setError("Por favor, insira um prompt para gerar uma imagem.");
                    return;
                }
                setIsLoading(true);
                setLoadingMessage('Gerando sua imagem...');

                const imageUrl = await generateImage(
                    prompt, 
                    activeCreateFunction, 
                    aspectRatio, 
                    negativePrompt,
                    styleModifier,
                    cameraAngle,
                    lightingStyle,
                    comicColorPalette
                );
                
                newHistoryEntry = {
                    id: `hist-${Date.now()}`,
                    imageUrl,
                    prompt,
                    negativePrompt,
                    mode,
                    createFunction: activeCreateFunction,
                    aspectRatio,
                    comicColorPalette: activeCreateFunction === 'comic' ? comicColorPalette : undefined,
                };

            } else if (mode === 'edit') {
                if (!generatedImage) {
                    setError("Por favor, envie uma imagem para começar a editar.");
                    return;
                }

                const mainImageBase64 = generatedImage.split(',')[1];
                const mainImageMimeType = generatedImage.match(/data:(image\/[^;]+);/)?.[1] || 'image/png';
                const mainImage: UploadedImage = { base64: mainImageBase64, mimeType: mainImageMimeType };

                const maskData = editorRef.current?.getMaskData() || null;
                const originalSize = editorRef.current?.getOriginalImageSize() || null;

                if (!prompt && referenceImages.length === 0 && !maskData) {
                    setError("Descreva sua edição, adicione uma imagem de referência ou selecione uma área para editar.");
                    return;
                }
                
                setIsLoading(true);
                setLoadingMessage('Aplicando sua edição...');

                const resultImageUrl = await processImagesWithPrompt(
                    prompt,
                    mainImage,
                    referenceImages,
                    maskData,
                    activeEditFunction,
                    originalSize,
                    styleStrength,
                    negativePrompt
                );

                if (resultImageUrl.startsWith('A edição foi bloqueada')) {
                   throw new Error(resultImageUrl);
                }

                newHistoryEntry = {
                    id: `hist-${Date.now()}`,
                    imageUrl: resultImageUrl,
                    prompt,
                    negativePrompt,
                    mode,
                    editFunction: activeEditFunction,
                    referenceImages: [...referenceImages], // Deep copy might be needed if masks are mutable
                    styleStrength: activeEditFunction === 'style' ? styleStrength : undefined,
                };
                
            } else if (mode === 'video') {
                if (!prompt) {
                    setError("Por favor, insira um prompt para gerar um vídeo.");
                    return;
                }
                if (activeVideoFunction === 'animation' && !startFrame) {
                     setError("Por favor, envie uma imagem inicial para a animação.");
                     return;
                }
                
                setIsLoading(true);
                setLoadingMessage('A geração de vídeo pode levar alguns minutos. Estamos trabalhando nisso...');
                
                const videoUrl = await generateVideo(prompt, startFrame || undefined);

                newHistoryEntry = {
                    id: `hist-${Date.now()}`,
                    videoUrl,
                    prompt,
                    mode,
                    videoFunction: activeVideoFunction,
                    startFrame: startFrame || undefined,
                    startFramePreviewUrl: startFramePreview || undefined,
                };

            } else {
                return;
            }

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
            setError(e.message || "Ocorreu um erro desconhecido.");
        } finally {
            setIsLoading(false);
        }
    };
    
    // Auto-resize textarea
    useEffect(() => {
        const textarea = textareaRef.current;
        if (textarea) {
            textarea.style.height = 'auto';
            textarea.style.height = `${textarea.scrollHeight}px`;
        }
    }, [prompt, negativePrompt]);

    useEffect(() => {
        if (window.innerWidth < 768) {
            setShowMobileModal(true);
        }
    }, []);

    // Derived state for easier rendering
    const canUndo = historyIndex > 0;
    const canRedo = historyIndex < history.length - 1;
    const isEditing = mode === 'edit';
    const isSelectionEnabled = isEditing && activeEditFunction === 'compose';
    const showAdvancedCreateControls = activeCreateFunction === 'free' || activeCreateFunction === 'comic';


    const MainContentDisplay = () => {
        if (isLoading) {
            return (
                <div className="flex flex-col items-center justify-center h-full text-center text-zinc-400 p-8">
                    {/* FIX: Use Icons.Spinner as it is imported under the Icons namespace */}
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
                     <video
                        key={generatedVideo}
                        src={generatedVideo}
                        controls
                        autoPlay
                        loop
                        className="max-w-full max-h-full rounded-lg shadow-lg"
                     />
                 </div>
             );
        }

        if (generatedImage) {
            return (
                <div className="w-full h-full relative" ref={placerContainerRef}>
                    <ImageEditor
                        ref={editorRef}
                        key={generatedImage}
                        src={generatedImage}
                        isSelectionEnabled={isSelectionEnabled}
                        maskTool={maskTool}
                        brushSize={brushSize}
                        maskOpacity={maskOpacity}
                        onZoomChange={setEditorZoom}
                        detectedObjects={detectedObjects}
                        highlightedObject={highlightedObject}
                        onTransformChange={setEditorTransform}
                    />
                    {placingImageIndex !== null && referenceImages[placingImageIndex] && (
                        <ObjectPlacer 
                            src={referenceImages[placingImageIndex].maskedObjectPreviewUrl || referenceImages[placingImageIndex].previewUrl}
                            containerRef={placerContainerRef}
                            onCancel={() => setPlacingImageIndex(null)}
                            onConfirm={(placerTransform) => {
                                editorRef.current?.stampObjectOnMask({
                                    previewUrl: referenceImages[placingImageIndex].maskedObjectPreviewUrl || referenceImages[placingImageIndex].previewUrl,
                                    placerTransform,
                                    maskOpacity,
                                    editorTransform,
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
                <Icons.Sparkles className="text-5xl text-zinc-600 mb-4" />
                <h2 className="text-xl font-bold text-zinc-400 mb-2">Bem-vindo ao Nano Banana Studio</h2>
                <p className="max-w-md">
                   {mode === 'create' && "Use a barra de prompt abaixo para descrever a imagem que você deseja criar. Seja criativo e detalhado!"}
                   {mode === 'edit' && "Arraste uma imagem para esta área ou use o painel à esquerda para começar a editar."}
                   {mode === 'video' && "Descreva a cena para gerar um vídeo ou envie uma imagem inicial para animá-la."}
                </p>
            </div>
        );
    };

    return (
        <div className="h-screen w-screen bg-zinc-900 text-zinc-200 flex flex-col md:flex-row overflow-hidden">
            {/* Mobile View Blocker */}
            {showMobileModal && (
                <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 text-center">
                    <div className="bg-zinc-900 p-6 rounded-lg max-w-sm w-full shadow-xl ring-1 ring-white/10">
                        <h2 className="text-xl font-bold mb-4 text-zinc-100">Otimizado para Desktop</h2>
                        <p className="text-zinc-300">
                            Para a melhor experiência, por favor, acesse este aplicativo em um computador desktop.
                        </p>
                    </div>
                </div>
            )}
             {/* Confirmation Dialog */}
            <ConfirmationDialog 
                isOpen={confirmationDialog.isOpen}
                title={confirmationDialog.title}
                message={confirmationDialog.message}
                onConfirm={handleConfirm}
                onCancel={closeConfirmationDialog}
            />

            {/* Left Panel */}
            <aside className="w-full md:w-80 bg-zinc-950 flex flex-col shrink-0 border-r border-zinc-800">
                {/* Header */}
                <header className="p-3 border-b border-zinc-800 flex items-center justify-between">
                    <h1 className="text-lg font-bold">🍌 Nano Banana</h1>
                    <div className="flex items-center gap-1">
                        <button 
                            onClick={() => handleHistoryNavigation(historyIndex - 1)}
                            disabled={!canUndo || isLoading}
                            className="p-1.5 rounded-md hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Desfazer (Cmd/Ctrl + Z)"
                        >
                            <Icons.Undo />
                        </button>
                         <button 
                            onClick={() => handleHistoryNavigation(historyIndex + 1)}
                            disabled={!canRedo || isLoading}
                            className="p-1.5 rounded-md hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Refazer (Cmd/Ctrl + Shift + Z)"
                        >
                            <Icons.Redo />
                        </button>
                    </div>
                </header>
                
                {/* Mode Toggles */}
                <div className="p-3 border-b border-zinc-800">
                    <div className="grid grid-cols-3 gap-2">
                        <FunctionButton data-function="create" isActive={mode === 'create'} onClick={() => handleModeToggle('create')} icon={<Icons.Create />} name="Criar" />
                        <FunctionButton data-function="edit" isActive={mode === 'edit'} onClick={() => handleModeToggle('edit')} icon={<Icons.Edit />} name="Editar" />
                        <FunctionButton data-function="video" isActive={mode === 'video'} onClick={() => handleModeToggle('video')} icon={<Icons.Video />} name="Vídeo" />
                    </div>
                </div>

                {/* Controls Section (scrollable) */}
                <div className="flex-1 overflow-y-auto">
                    {mode === 'create' && (
                        <>
                            <PanelSection title="Função" icon={<Icons.Sparkles />}>
                                <div className="grid grid-cols-2 gap-2">
                                    <FunctionButton data-function="free" isActive={activeCreateFunction === 'free'} onClick={handleCreateFunctionClick} icon={<Icons.Image />} name="Livre" />
                                    <FunctionButton data-function="sticker" isActive={activeCreateFunction === 'sticker'} onClick={handleCreateFunctionClick} icon={<Icons.Sticker />} name="Sticker" />
                                    <FunctionButton data-function="text" isActive={activeCreateFunction === 'text'} onClick={handleCreateFunctionClick} icon={<Icons.Type />} name="Texto" />
                                    <FunctionButton data-function="comic" isActive={activeCreateFunction === 'comic'} onClick={handleCreateFunctionClick} icon={<Icons.Comic />} name="HQ" />
                                </div>
                            </PanelSection>
                            <PanelSection title="Configurações" icon={<Icons.Settings />}>
                                {styleOptions[activeCreateFunction].length > 0 && (
                                     <div className="custom-select-wrapper">
                                        <select
                                            value={styleModifier}
                                            onChange={(e) => setStyleModifier(e.target.value)}
                                            className="custom-select"
                                            aria-label="Estilo do sticker"
                                        >
                                            <option value="default" disabled>Selecione um Estilo</option>
                                            {styleOptions[activeCreateFunction].map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                        </select>
                                    </div>
                                )}
                                <div className="custom-select-wrapper">
                                    <select
                                        value={aspectRatio}
                                        onChange={(e) => handleAspectRatioChange(e.target.value)}
                                        className="custom-select"
                                        aria-label="Proporção da imagem"
                                    >
                                        {ALL_SUPPORTED_ASPECT_RATIOS.map((group) => (
                                            <optgroup label={group.label} key={group.label}>
                                                {group.options.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
                                            </optgroup>
                                        ))}
                                    </select>
                                </div>
                                {activeCreateFunction === 'comic' && (
                                    <div className="flex items-center gap-2 bg-zinc-800 p-1 rounded-md">
                                        <button 
                                            onClick={() => setComicColorPalette('vibrant')}
                                            className={`w-1/2 text-center text-xs font-semibold px-2 py-1.5 rounded-md transition-colors ${comicColorPalette === 'vibrant' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-700/50'}`}
                                        >
                                            Vibrante
                                        </button>
                                        <button
                                             onClick={() => setComicColorPalette('noir')}
                                             className={`w-1/2 text-center text-xs font-semibold px-2 py-1.5 rounded-md transition-colors ${comicColorPalette === 'noir' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-700/50'}`}
                                        >
                                            Noir
                                        </button>
                                    </div>
                                )}
                            </PanelSection>
                            {showAdvancedCreateControls && (
                                <PanelSection title="Avançado" icon={<Icons.Sliders />} defaultOpen={false}>
                                    <div className="space-y-4">
                                         <div className="custom-select-wrapper">
                                            <label className="block text-sm font-medium text-zinc-400 mb-1">Ângulo da Câmera</label>
                                            <select value={cameraAngle} onChange={(e) => setCameraAngle(e.target.value)} className="custom-select">
                                                {cameraAngleOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                            </select>
                                        </div>
                                         <div className="custom-select-wrapper">
                                            <label className="block text-sm font-medium text-zinc-400 mb-1">Iluminação</label>
                                            <select value={lightingStyle} onChange={(e) => setLightingStyle(e.target.value)} className="custom-select">
                                                {lightingStyleOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                </PanelSection>
                            )}
                        </>
                    )}

                    {mode === 'edit' && (
                        <>
                            <PanelSection title="Função de Edição" icon={<Icons.Layers />}>
                               <div className="grid grid-cols-2 gap-2">
                                    <FunctionButton data-function="compose" isActive={activeEditFunction === 'compose'} onClick={handleEditFunctionClick} icon={<Icons.Layers />} name="Compor" />
                                    <FunctionButton data-function="style" isActive={activeEditFunction === 'style'} onClick={handleEditFunctionClick} icon={<Icons.Palette />} name="Estilizar" />
                                </div>
                            </PanelSection>
                            
                            <PanelSection title="Imagens de Referência" icon={<Icons.Reference />}>
                                {activeEditFunction === 'compose' ? (
                                    <div className="grid grid-cols-2 gap-2 h-32">
                                        {referenceImages.slice(0, 4).map((ref, index) => (
                                            <div key={index} className="relative group w-full h-full bg-zinc-800 rounded-md overflow-hidden">
                                                <img src={ref.previewUrl} alt={`Referência ${index + 1}`} className="w-full h-full object-contain" />
                                                <div className="absolute inset-0 bg-black/60 flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                                    <button onClick={() => setPlacingImageIndex(index)} className="p-2 bg-zinc-900/80 text-blue-400 rounded-full hover:bg-zinc-700 transition-colors" title="Posicionar Objeto">
                                                        <Icons.AddPhoto />
                                                    </button>
                                                    <button onClick={() => handleRemoveReferenceImage(index)} className="p-2 bg-zinc-900/80 text-red-400 rounded-full hover:bg-zinc-700 transition-colors" title="Remover">
                                                        <Icons.Close />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                        {referenceImages.length < 4 && (
                                            <ImageUploadSlot
                                                id="ref-upload-compose"
                                                label="Referência"
                                                icon={<Icons.UploadCloud className="text-3xl" />}
                                                imagePreviewUrl={null}
                                                onUpload={(file) => processUploadedFiles([file], 'reference')}
                                                onRemove={() => {}}
                                            />
                                        )}
                                    </div>
                                ) : (
                                    <div className="h-32">
                                        <ImageUploadSlot
                                            id="ref-upload-style"
                                            label="Estilo"
                                            icon={<Icons.UploadCloud className="text-3xl" />}
                                            imagePreviewUrl={referenceImages[0]?.previewUrl || null}
                                            onUpload={(file) => processUploadedFiles([file], 'reference')}
                                            onRemove={() => handleRemoveReferenceImage(0)}
                                        />
                                    </div>
                                )}
                                {/* FIX: Use Icons.Spinner as it is imported under the Icons namespace */}
                                {isAnalyzingStyle && <div className="text-sm text-zinc-400 mt-2 flex items-center"><Icons.Spinner className="mr-2"/>Analisando estilo...</div>}
                            </PanelSection>
                            
                            {activeEditFunction === 'style' && (
                                <PanelSection title="Intensidade do Estilo" icon={<Icons.Sliders />}>
                                    <div className="flex items-center gap-3">
                                        <Slider
                                            label="Força"
                                            value={styleStrength}
                                            min={10} max={100}
                                            onChange={(e) => setStyleStrength(Number(e.target.value))}
                                            'aria-label'="Força do estilo"
                                            sliderWidthClass='w-full'
                                        />
                                        <span className="text-sm font-semibold text-zinc-400 w-10 text-right">{styleStrength}%</span>
                                    </div>
                                </PanelSection>
                            )}

                             {isSelectionEnabled && (
                                <PanelSection title="Seleção" icon={<Icons.Selection />}>
                                    <div className="flex items-center gap-2 bg-zinc-900 p-1 rounded-md">
                                        <button 
                                            onClick={() => setMaskTool('brush')}
                                            className={`w-1/2 flex items-center justify-center gap-1 text-xs font-semibold px-2 py-1.5 rounded-md transition-colors ${maskTool === 'brush' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-700/50'}`}
                                        >
                                            <Icons.Brush /> Pincel
                                        </button>
                                        <button
                                             onClick={() => setMaskTool('eraser')}
                                             className={`w-1/2 flex items-center justify-center gap-1 text-xs font-semibold px-2 py-1.5 rounded-md transition-colors ${maskTool === 'eraser' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-700/50'}`}
                                        >
                                             <Icons.Eraser /> Borracha
                                        </button>
                                    </div>
                                    <div className="space-y-2">
                                        <div className="text-sm text-zinc-300">Tamanho ({brushSize})</div>
                                        <Slider value={brushSize} min={5} max={100} onChange={(e) => setBrushSize(Number(e.target.value))} 'aria-label'="Tamanho do pincel" sliderWidthClass='w-full' />
                                    </div>
                                    <div className="space-y-2">
                                        <div className="text-sm text-zinc-300">Opacidade ({Math.round(maskOpacity * 100)}%)</div>
                                        <Slider value={maskOpacity} min={0.1} max={1} step={0.05} onChange={(e) => setMaskOpacity(Number(e.target.value))} 'aria-label'="Opacidade da máscara" sliderWidthClass='w-full' />
                                    </div>
                                    <button
                                        onClick={() => editorRef.current?.clearMask()}
                                        className="w-full text-sm font-semibold py-2 px-3 bg-zinc-800 hover:bg-zinc-700 rounded-md transition-colors flex items-center justify-center gap-2"
                                    >
                                        <Icons.Deselect /> Limpar Seleção
                                    </button>
                                </PanelSection>
                            )}
                             {activeEditFunction === 'compose' && (
                                <PanelSection title="Detecção de Objetos" icon={<Icons.Visibility />}>
                                    <button 
                                        onClick={handleDetectObjects} 
                                        disabled={!generatedImage || isDetectingObjects}
                                        className="w-full text-sm font-semibold py-2 px-3 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed rounded-md transition-colors flex items-center justify-center gap-2">
                                        {/* FIX: Use Icons.Spinner as it is imported under the Icons namespace */}
                                        {isDetectingObjects ? <Icons.Spinner /> : <Icons.Visibility />}
                                        {isDetectingObjects ? 'Detectando...' : 'Detectar Objetos'}
                                    </button>
                                    {detectedObjects.length > 0 && (
                                        <div className="max-h-32 overflow-y-auto space-y-1 pr-2 mt-2">
                                            {detectedObjects.map(obj => (
                                                <button 
                                                    key={obj.name}
                                                    onClick={() => handleGenerateObjectMask(obj)}
                                                    onMouseEnter={() => setHighlightedObject(obj)}
                                                    onMouseLeave={() => setHighlightedObject(null)}
                                                    className="w-full text-left text-xs p-2 rounded-md bg-zinc-800 hover:bg-zinc-700 focus:ring-1 focus:ring-blue-500 outline-none"
                                                >
                                                    {obj.name}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </PanelSection>
                            )}
                            <PanelSection title="Filtros Rápidos" icon={<Icons.Filter />} defaultOpen={false}>
                                <div className="grid grid-cols-3 gap-2">
                                    {FILTERS.map(filter => (
                                        <button
                                            key={filter.name}
                                            onClick={() => applyFilter(filter.prompt)}
                                            disabled={!generatedImage || isLoading}
                                            className="text-xs font-semibold p-2 bg-zinc-800 hover:bg-zinc-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                            title={filter.prompt}
                                        >
                                            {filter.name}
                                        </button>
                                    ))}
                                </div>
                            </PanelSection>
                        </>
                    )}
                    
                    {mode === 'video' && (
                         <>
                            {/* FIX: The Movie icon does not exist. The correct icon is Video. */}
                            <PanelSection title="Função de Vídeo" icon={<Icons.Video />}>
                               <div className="grid grid-cols-2 gap-2">
                                    <FunctionButton data-function="prompt" isActive={activeVideoFunction === 'prompt'} onClick={handleVideoFunctionClick} icon={<Icons.Prompt />} name="Prompt" />
                                    <FunctionButton data-function="animation" isActive={activeVideoFunction === 'animation'} onClick={handleVideoFunctionClick} icon={<Icons.Start />} name="Animação" />
                                </div>
                            </PanelSection>
                            
                             {activeVideoFunction === 'animation' && (
                                 <PanelSection title="Imagem Inicial" icon={<Icons.Image />}>
                                     <div className="h-32">
                                         <ImageUploadSlot
                                            id="start-frame-upload"
                                            label="Imagem Inicial"
                                            icon={<Icons.UploadCloud className="text-3xl" />}
                                            imagePreviewUrl={startFramePreview}
                                            onUpload={(file) => processSingleFile(file, (img, url) => { setStartFrame(img); setStartFramePreview(url); })}
                                            onRemove={handleRemoveStartFrame}
                                        />
                                     </div>
                                 </PanelSection>
                             )}
                        </>
                    )}

                    {/* History Panel */}
                    {history.length > 1 && (
                         <PanelSection title="Histórico" icon={<Icons.History />} defaultOpen={false}>
                             <div className="grid grid-cols-4 gap-2">
                                 {history.map((entry, index) => (
                                     <button
                                         key={entry.id}
                                         onClick={() => handleHistoryNavigation(index)}
                                         className={`relative w-full aspect-square rounded-md overflow-hidden ring-2 transition-all duration-200
                                            ${index === historyIndex ? 'ring-blue-500' : 'ring-transparent hover:ring-zinc-600'}`}
                                     >
                                        {(entry.imageUrl || entry.startFramePreviewUrl) && (
                                             <img 
                                                src={entry.imageUrl || entry.startFramePreviewUrl} 
                                                alt={`History ${index + 1}`} 
                                                className="w-full h-full object-cover" 
                                            />
                                        )}
                                        {entry.videoUrl && (
                                            <div className="w-full h-full bg-black flex items-center justify-center">
                                                {/* FIX: The Movie icon does not exist. The correct icon is Video. */}
                                                <Icons.Video className="text-zinc-500" />
                                            </div>
                                        )}
                                         <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent"></div>
                                         <span className="absolute bottom-1 right-1 text-xs font-bold text-white bg-black/50 px-1 rounded">
                                             {index + 1}
                                         </span>
                                     </button>
                                 ))}
                             </div>
                         </PanelSection>
                     )}
                </div>
            </aside>

            {/* Main Content */}
            <main
                ref={mainContentRef}
                className="flex-1 flex flex-col bg-zinc-900 overflow-hidden"
                onDragEnter={(e) => mode === 'edit' && handleDragEnter(e, 'main')}
                onDragOver={mode === 'edit' ? handleDragOver : undefined}
                onDragLeave={mode === 'edit' ? handleDragLeave : undefined}
                onDrop={(e) => mode === 'edit' && handleDrop(e, 'main')}
            >
                {/* Main Viewport Header */}
                <div className="p-2 flex items-center justify-between border-b border-zinc-800 shrink-0">
                    <div className="flex items-center gap-2">
                        {isEditing && (
                            <>
                                <button onClick={() => editorRef.current?.zoomOut()} className="p-1.5 rounded-md hover:bg-zinc-800" title="Reduzir Zoom (-)"><Icons.ZoomOut /></button>
                                <div className="custom-select-wrapper w-24">
                                    <select 
                                        value={Math.round(editorZoom)}
                                        onChange={(e) => editorRef.current?.setZoom(Number(e.target.value))}
                                        className="custom-select !text-center !pr-8"
                                    >
                                        {[25, 50, 75, 100, 150, 200, 300, 400].map(z => <option key={z} value={z}>{z}%</option>)}
                                    </select>
                                </div>
                                <button onClick={() => editorRef.current?.zoomIn()} className="p-1.5 rounded-md hover:bg-zinc-800" title="Aumentar Zoom (+)"><Icons.ZoomIn /></button>
                                <button onClick={() => editorRef.current?.zoomToFit()} className="p-1.5 rounded-md hover:bg-zinc-800" title="Ajustar à Tela"><Icons.FitScreen /></button>
                                {currentImageAspectRatio && <span className="text-sm text-zinc-400 ml-2 py-1 px-2 bg-zinc-800 rounded-md">{currentImageAspectRatio}</span>}
                            </>
                        )}
                    </div>
                     <div className="flex items-center gap-2">
                        {isEditing && (
                            <button 
                                onClick={handleClearAllImages}
                                disabled={history.length === 0}
                                className="text-sm font-semibold py-1.5 px-3 bg-zinc-800 hover:bg-zinc-700 rounded-md transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Icons.ClearAll /> Limpar Tudo
                            </button>
                        )}
                        {(generatedImage || generatedVideo) && (
                             <a
                                href={generatedImage || generatedVideo || '#'}
                                download={`nanobanana-${Date.now()}.${generatedImage ? 'png' : 'mp4'}`}
                                className="text-sm font-semibold py-1.5 px-3 bg-zinc-600 hover:bg-zinc-500 rounded-md transition-colors flex items-center gap-2"
                             >
                                 <Icons.Save /> Salvar
                             </a>
                         )}
                     </div>
                </div>

                <div className="flex-1 p-4 overflow-hidden relative"
                >
                    <MainContentDisplay />
                    {isDragging && dragTarget === 'main' && (
                         <div className="absolute inset-4 border-4 border-dashed border-blue-500 bg-blue-500/10 rounded-lg flex items-center justify-center pointer-events-none">
                             <div className="text-center">
                                 <Icons.UploadCloud className="text-5xl text-blue-400" />
                                 <p className="mt-2 text-lg font-semibold text-blue-300">Solte a imagem aqui</p>
                             </div>
                         </div>
                     )}
                </div>

                {/* Prompt Bar */}
                <div className="p-3 border-t border-zinc-800 shrink-0">
                    <form onSubmit={handleSubmit} className="bg-zinc-800 p-2 rounded-lg flex items-start gap-2 shadow-inner">
                        <div className="flex-1 space-y-2">
                            <textarea
                                ref={textareaRef}
                                value={prompt}
                                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setPrompt(e.target.value)}
                                placeholder={
                                    mode === 'create' ? "Um astronauta andando de skate em Marte, arte digital..." :
                                    mode === 'edit' ? "Adicione um chapéu de cowboy, mude o fundo para uma praia..." :
                                    "Um close-up de uma gota de chuva caindo em uma folha..."
                                }
                                rows={1}
                                className="w-full bg-transparent p-2 text-zinc-200 placeholder-zinc-500 focus:outline-none resize-none"
                                disabled={isLoading}
                            />
                            {(mode === 'create' || mode === 'edit') && (
                                 <textarea
                                    value={negativePrompt}
                                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setNegativePrompt(e.target.value)}
                                    placeholder="Prompt Negativo: evite má qualidade, texto, marcas d'água..."
                                    rows={1}
                                    className="w-full bg-zinc-900/50 rounded-md p-2 text-sm text-zinc-300 placeholder-zinc-500 focus:outline-none resize-none"
                                    disabled={isLoading}
                                />
                            )}
                        </div>
                        <button
                            type="submit"
                            disabled={isLoading || (!prompt && mode !== 'edit')}
                            className="p-3 bg-blue-600 rounded-md text-white hover:bg-blue-500 transition-colors disabled:bg-blue-800 disabled:cursor-not-allowed self-end"
                            title="Gerar (Enter)"
                        >
                            {/* FIX: Use Icons.Spinner as it is imported under the Icons namespace */}
                            {isLoading ? <Icons.Spinner /> : <Icons.Send />}
                        </button>
                    </form>
                    {error && (
                        <div className="mt-2 p-2 bg-red-900/50 border border-red-800 text-red-300 text-sm rounded-md flex items-center gap-2">
                            <Icons.AlertCircle />
                            <span>{error}</span>
                            <button onClick={() => setError(null)} className="ml-auto p-1 text-red-300 hover:text-white"><Icons.Close /></button>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
