import React, { useState, useCallback, ChangeEvent, useEffect, useRef, useImperativeHandle, forwardRef, useMemo } from 'react';
import type { Mode, CreateFunction, EditFunction, UploadedImage, HistoryEntry, UploadProgress, ReferenceImage, DetectedObject, VideoFunction } from './types';
import { generateImage, processImagesWithPrompt, analyzeImageStyle, detectObjects, generateVideo } from './services/geminiService';
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
  stampObjectOnMask: (data: { previewUrl: string, transform: any, maskOpacity: number }) => void;
}

const ImageEditor = forwardRef<ImageEditorRef, ImageEditorProps>(({ src, isSelectionEnabled, maskTool, brushSize, maskOpacity, onZoomChange, detectedObjects, highlightedObject }, ref) => {
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
    
    // FIX: Restructured to allow `getMaskData` to call `getMaskAsCanvas`.
    // The previous implementation of calling through `ref.current` was incorrect as the ref
    // is not yet assigned during handle creation and fails if the ref is a callback.
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
            stampObjectOnMask: (data: { previewUrl: string, transform: any, maskOpacity: number }) => {
                const maskCanvas = maskCanvasRef.current;
                if (!maskCanvas) return;

                const ctx = maskCanvas.getContext('2d');
                if (!ctx) return;
                
                const { placerTransform } = data.transform;
                
                const canvasX = (placerTransform.x - transform.x) / transform.scale;
                const canvasY = (placerTransform.y - transform.y) / transform.scale;
                const canvasWidth = placerTransform.width / transform.scale;
                const canvasHeight = placerTransform.height / transform.scale;
                
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

const compositeImageWithMask = (
    originalImageUrl: string,
    aiResultUrl: string,
    maskUrl: string
): Promise<string> => {
    return new Promise((resolve, reject) => {
        const originalImage = new Image();
        const aiResultImage = new Image();
        const maskImage = new Image();

        originalImage.crossOrigin = "anonymous";
        aiResultImage.crossOrigin = "anonymous";
        maskImage.crossOrigin = "anonymous";

        let loadedCount = 0;
        const totalImages = 3;

        const onImageLoad = () => {
            loadedCount++;
            if (loadedCount === totalImages) {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = originalImage.naturalWidth;
                    canvas.height = originalImage.naturalHeight;
                    const ctx = canvas.getContext('2d');

                    if (!ctx) {
                        return reject(new Error("Não foi possível criar o contexto do canvas"));
                    }

                    // Passo 1: Desenhe o resultado da IA
                    ctx.drawImage(aiResultImage, 0, 0);

                    // Passo 2: Use a máscara para "recortar" a área de interesse do resultado da IA.
                    ctx.globalCompositeOperation = 'destination-in';
                    ctx.drawImage(maskImage, 0, 0);
                    
                    // Passo 3: Desenhe a imagem original por trás do recorte.
                    ctx.globalCompositeOperation = 'destination-over';
                    ctx.drawImage(originalImage, 0, 0);

                    // Redefinir a operação de composição
                    ctx.globalCompositeOperation = 'source-over';

                    resolve(canvas.toDataURL('image/png'));
                } catch (e) {
                    reject(e);
                }
            }
        };
        
        const onImageError = (e: Event | string) => {
            // FIX: The onerror handler for an image can receive an Event or a string.
            // We must check the type of `e` before accessing `e.currentTarget` to avoid a runtime error.
            if (e instanceof Event) {
                const target = e.currentTarget as HTMLImageElement | null;
                reject(new Error(`Falha ao carregar uma imagem para composição: ${target?.src}`));
            } else {
                reject(new Error(`Falha ao carregar uma imagem para composição: ${e.toString()}`));
            }
        };

        originalImage.onload = onImageLoad;
        aiResultImage.onload = onImageLoad;
        maskImage.onload = onImageLoad;

        originalImage.onerror = onImageError;
        aiResultImage.onerror = onImageError;
        maskImage.onerror = onImageError;

        originalImage.src = originalImageUrl;
        aiResultImage.src = aiResultUrl;
        maskImage.src = maskUrl;
    });
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

const mapImageAspectRatioToVideo = (width: number, height: number): '16:9' | '9:16' => {
    const ratio = width / height;
    // Mapeie para a proporção de vídeo suportada mais próxima.
    // O modelo VEO não suporta 1:1, então mapeamos imagens quadradas para 16:9.
    if (ratio >= 1) { // Paisagem ou quadrado
        return '16:9';
    } else { // Retrato
        return '9:16';
    }
};

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
    
    // Video mode state
    const [activeVideoFunction, setActiveVideoFunction] = useState<VideoFunction>('prompt');
    const [startFrame, setStartFrame] = useState<UploadedImage | null>(null);
    const [startFramePreview, setStartFramePreview] = useState<string | null>(null);
    const [videoAspectRatioInfo, setVideoAspectRatioInfo] = useState<{width: number; height: number; ratio: string; mappedRatio: '16:9' | '9:16' } | null>(null);
    const [videoFitMode, setVideoFitMode] = useState<'crop' | 'fill'>('crop');


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
    
    // Refs
    const editorRef = useRef<ImageEditorRef>(null);
    const mainContentRef = useRef<HTMLDivElement>(null);
    const dragCounter = useRef(0);
    const dragLeaveTimeout = useRef<number | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const currentEntry = history[historyIndex] ?? null;
    const generatedImage = currentEntry?.imageUrl ?? null;
    const generatedVideo = currentEntry?.videoUrl ?? null;

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
                title: 'Iniciar Nova Edição?',
                message: 'Isso substituirá a imagem atual e descartará todas as edições não salvas. Deseja continuar?',
                onConfirm: () => processUploadedFiles(Array.from(files), target)
            });
            return;
        }
        
        processUploadedFiles(Array.from(files), target);
    }, [mode, generatedImage, isEditStateDirty, processUploadedFiles]);


    const handleRemoveImage = (indexToRemove: number) => {
        setReferenceImages(prev => prev.filter((_, index) => index !== indexToRemove));
    };
    
    const handleDragEnter = (e: React.DragEvent<HTMLDivElement>, target: 'main' | 'reference') => {
        e.preventDefault();
        e.stopPropagation();
        if (dragLeaveTimeout.current) {
            clearTimeout(dragLeaveTimeout.current);
            dragLeaveTimeout.current = null;
        }
        dragCounter.current++;
        if (mode === 'edit' && dragCounter.current > 0) {
            setIsDragging(true);
            setDragTarget(target);
        }
    };

    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter.current--;
        if (dragCounter.current === 0) {
            dragLeaveTimeout.current = window.setTimeout(() => {
                setIsDragging(false);
                setDragTarget(null);
            }, 100);
        }
    };
    
    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>, target: 'main' | 'reference') => {
        e.preventDefault();
        e.stopPropagation();
        if (dragLeaveTimeout.current) {
            clearTimeout(dragLeaveTimeout.current);
            dragLeaveTimeout.current = null;
        }
        dragCounter.current = 0;
        setIsDragging(false);
        setDragTarget(null);
        if (mode === 'edit') {
            const files = e.dataTransfer.files;
            if (files && files.length > 0) {
                handleImageUpload(files, target);
            }
        }
    };

    const handleEasterEggClick = useCallback(async () => {
        if (isLoading || mode !== 'create') {
            return;
        }

        setIsLoading(true);
        setError(null);
        const easterEggPrompt = "um gorila com roupa do brasil comendo uma banana";
        setPrompt(easterEggPrompt);

        try {
            const result = await generateImage(easterEggPrompt, 'free', aspectRatio, '', 'default', 'default', 'default', 'vibrant');

            if (result) {
                const newEntry: HistoryEntry = {
                    id: `hist-${Date.now()}`,
                    imageUrl: result,
                    prompt: easterEggPrompt,
                    mode: 'create',
                    createFunction: activeCreateFunction,
                    aspectRatio,
                };

                const newHistory = history.slice(0, historyIndex + 1);
                setHistory([...newHistory, newEntry]);
                setHistoryIndex(newHistory.length);
            }

        } catch (error: any) {
            setError(error.message || 'Ocorreu um erro desconhecido.');
        } finally {
            setIsLoading(false);
        }
    }, [isLoading, mode, activeCreateFunction, aspectRatio, history, historyIndex]);

    const createPaddedImage = (
        image: UploadedImage,
        targetRatioString: '16:9' | '9:16'
    ): Promise<UploadedImage> => {
        return new Promise((resolve, reject) => {
            const img = new window.Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
                const targetRatio = targetRatioString === '16:9' ? 16 / 9 : 9 / 16;
                const canvas = document.createElement('canvas');
                
                const canvasWidth = 1920;
                const canvasHeight = Math.round(canvasWidth / targetRatio);
                canvas.width = canvasWidth;
                canvas.height = canvasHeight;

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    return reject(new Error("Não foi possível criar o contexto do canvas"));
                }

                // 1. Preencha o fundo com preto
                ctx.fillStyle = 'black';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // 2. Desenhe a imagem centralizada em primeiro plano
                const imgRatio = img.width / img.height;
                let drawWidth, drawHeight;

                if (imgRatio > targetRatio) { // Imagem mais larga que o canvas
                    drawWidth = canvas.width;
                    drawHeight = drawWidth / imgRatio;
                } else { // Imagem mais alta ou com a mesma proporção
                    drawHeight = canvas.height;
                    drawWidth = drawHeight * imgRatio;
                }

                const x = (canvas.width - drawWidth) / 2;
                const y = (canvas.height - drawHeight) / 2;

                ctx.drawImage(img, x, y, drawWidth, drawHeight);

                const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
                const base64 = dataUrl.split(',')[1];
                resolve({ base64, mimeType: 'image/jpeg' });
            };
            img.onerror = () => reject(new Error("Falha ao carregar a imagem para preenchimento"));
            img.src = `data:${image.mimeType};base64,${image.base64}`;
        });
    };

    const handleGenerate = useCallback(async () => {
        if (!prompt && mode !== 'edit' && activeVideoFunction !== 'animation') {
            setError('Por favor, descreva sua ideia.');
            return;
        }
        if (mode === 'edit' && !generatedImage) {
             setError('Por favor, envie ou gere uma imagem para editar.');
             return;
        }
        if (mode === 'video' && activeVideoFunction === 'animation' && !startFrame) {
            setError('Por favor, envie um frame inicial para a animação.');
            return;
        }

        setIsLoading(true);
        setError(null);
        
        try {
            let result: string | null = null;
            let newEntry: HistoryEntry | null = null;

            if (mode === 'create') {
                result = await generateImage(prompt, activeCreateFunction, aspectRatio, negativePrompt, styleModifier, cameraAngle, lightingStyle, comicColorPalette);
                if (result) {
                    newEntry = {
                        id: `hist-${Date.now()}`,
                        imageUrl: result,
                        prompt,
                        mode,
                        negativePrompt,
                        createFunction: activeCreateFunction, 
                        aspectRatio,
                        comicColorPalette: activeCreateFunction === 'comic' ? comicColorPalette : undefined,
                    };
                }
            } else if (mode === 'edit') { 
                if (!generatedImage) throw new Error("Imagem para edição não encontrada.");
                
                const maskData = editorRef.current?.getMaskData() ?? null;
                const originalSize = editorRef.current?.getOriginalImageSize() ?? null;
                const mainImageBase64 = generatedImage.split(',')[1];
                const mainImageMimeType = generatedImage.match(/data:(image\/[^;]+);/)?.[1] || 'image/png';
                const mainImage: UploadedImage = { base64: mainImageBase64, mimeType: mainImageMimeType };
                
                const aiResultUrl = await processImagesWithPrompt(
                    prompt,
                    mainImage,
                    referenceImages,
                    maskData,
                    activeEditFunction,
                    originalSize,
                    styleStrength,
                    negativePrompt
                );

                if (aiResultUrl) {
                    if (activeEditFunction === 'compose' && maskData) {
                        const maskUrl = `data:image/png;base64,${maskData.base64}`;
                        result = await compositeImageWithMask(generatedImage, aiResultUrl, maskUrl);
                    } else {
                        result = aiResultUrl;
                    }
                }
                 if (result) {
                    newEntry = {
                        id: `hist-${Date.now()}`,
                        imageUrl: result,
                        prompt,
                        mode,
                        negativePrompt,
                        editFunction: activeEditFunction, 
                        referenceImages,
                        styleStrength: activeEditFunction === 'style' ? styleStrength : undefined,
                    };
                }
            } else if (mode === 'video') {
                const aspectRatioToUse = videoAspectRatioInfo ? videoAspectRatioInfo.mappedRatio : undefined;
                let frameToUse = startFrame;

                if (activeVideoFunction === 'animation' && startFrame && videoFitMode === 'fill' && videoAspectRatioInfo) {
                    setLoadingMessage('Preparando imagem para animação...');
                    frameToUse = await createPaddedImage(startFrame, videoAspectRatioInfo.mappedRatio);
                }

                if (activeVideoFunction === 'animation') {
                    if (!frameToUse) {
                        throw new Error('Frame inicial não encontrado para animação.');
                    }
                    result = await generateVideo(prompt, frameToUse, aspectRatioToUse);
                } else {
                    result = await generateVideo(prompt);
                }
                
                if (result) {
                    newEntry = {
                        id: `hist-${Date.now()}`,
                        videoUrl: result,
                        prompt,
                        mode,
                        videoFunction: activeVideoFunction,
                        ...(activeVideoFunction === 'animation' && {
                            startFrame,
                            startFramePreviewUrl: startFramePreview,
                        })
                    };
                }
            }

            if (newEntry) {
                const newHistory = history.slice(0, historyIndex + 1);
                setHistory([...newHistory, newEntry]);
                setHistoryIndex(newHistory.length);
                editorRef.current?.clearMask();
                resetDetectionState();
            }

        } catch (error: any) {
            setError(error.message || 'Ocorreu um erro desconhecido.');
        } finally {
            setIsLoading(false);
        }
    }, [prompt, mode, activeCreateFunction, activeEditFunction, aspectRatio, referenceImages, history, historyIndex, generatedImage, styleStrength, negativePrompt, styleModifier, cameraAngle, lightingStyle, comicColorPalette, resetDetectionState, activeVideoFunction, startFrame, startFramePreview, videoAspectRatioInfo, videoFitMode]);
    
    const autoResizeTextarea = useCallback(() => {
        const textarea = textareaRef.current;
        if (textarea) {
            textarea.style.height = 'auto';
            const scrollHeight = textarea.scrollHeight;
            textarea.style.height = `${scrollHeight}px`;
        }
    }, []);

    const handleDetectObjects = async () => {
        if (!generatedImage || isDetectingObjects) return;

        setIsDetectingObjects(true);
        setError(null);
        resetDetectionState();

        try {
            const mainImageBase64 = generatedImage.split(',')[1];
            const mainImageMimeType = generatedImage.match(/data:(image\/[^;]+);/)?.[1] || 'image/png';
            const mainImage: UploadedImage = { base64: mainImageBase64, mimeType: mainImageMimeType };

            const objects = await detectObjects(mainImage);
            setDetectedObjects(objects);
        } catch (error: any) {
            setError(error.message || "Falha na detecção de objetos.");
        } finally {
            setIsDetectingObjects(false);
        }
    };
    
    const handleDetectedObjectClick = (object: DetectedObject) => {
        setPrompt(prev => {
            const trimmedPrev = prev.trim();
            // Capitalize the first letter of the object name for better sentence structure
            const objectName = object.name.charAt(0).toUpperCase() + object.name.slice(1);
            return trimmedPrev ? `${trimmedPrev}, ${objectName.toLowerCase()}` : objectName;
        });
        textareaRef.current?.focus();
        // Use a timeout to ensure the state update has rendered before resizing
        setTimeout(autoResizeTextarea, 0);
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                if (prompt.trim() !== '' || activeVideoFunction === 'animation') {
                    e.preventDefault();
                }
                if (!isLoading) {
                    handleGenerate();
                }
            }
        };

        const textarea = textareaRef.current;
        textarea?.addEventListener('keydown', handleKeyDown);

        return () => {
            textarea?.removeEventListener('keydown', handleKeyDown);
        };
    }, [isLoading, handleGenerate, prompt, activeVideoFunction]);

    const handleUndo = () => {
        if (historyIndex > 0) {
            handleHistoryNavigation(historyIndex - 1);
        }
    };

    const handleRedo = () => {
        if (historyIndex < history.length - 1) {
            // FIX: Corrected redo logic to navigate to the next state (historyIndex + 1) instead of the previous one.
            handleHistoryNavigation(historyIndex + 1);
        }
    };

    const handleSaveMedia = () => {
        const urlToSave = generatedVideo || generatedImage;
        if (!urlToSave) return;
        
        const link = document.createElement('a');
        link.href = urlToSave;
        const extension = generatedVideo ? 'mp4' : 'png';
        link.download = `nano-banana-studio-${Date.now()}.${extension}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const performClearAll = () => {
        // Common resets for all modes
        setHistory([]);
        setHistoryIndex(-1);
        setPrompt('');
        setReferenceImages([]);
        setError(null);
        editorRef.current?.clearMask();
        resetDetectionState();
        
        // Reset mode-specific settings to defaults
        setActiveCreateFunction('free');
        setAspectRatio('1:1');
        setNegativePrompt('');
        setStyleModifier('default');
        setCameraAngle('default');
        setLightingStyle('default');
        setComicColorPalette('vibrant');
        setActiveEditFunction('compose');
        setStyleStrength(100);
        setMaskTool('brush');
        setBrushSize(40);
        setMaskOpacity(0.6);
        setActiveVideoFunction('prompt');
        setStartFrame(null);
        setStartFramePreview(null);
    };

    const handleClearAll = () => {
        if (history.length > 0) {
            setConfirmationDialog({
                isOpen: true,
                title: 'Limpar Tudo?',
                message: 'Tem certeza de que deseja limpar a mídia atual, as referências e o histórico? Esta ação não pode ser desfeita.',
                onConfirm: performClearAll,
            });
        }
    };

    const finalPromptPreview = useMemo(() => {
        if (mode !== 'create' || !prompt) return null;
    
        const promptParts: string[] = [];
    
        switch (activeCreateFunction) {
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
                promptParts.push(`A cinematic, photorealistic image of ${prompt}`);
                promptParts.push("hyper-detailed, 8K resolution");
                break;
        }
    
        if (cameraAngle !== 'default') {
            promptParts.push(`${cameraAngle} shot`);
        }
        if (lightingStyle !== 'default') {
            promptParts.push(`${lightingStyle} lighting`);
        }
    
        let finalPrompt = promptParts.join(', ');

        if (negativePrompt) {
            finalPrompt += `. Evite o seguinte: ${negativePrompt}`;
        }

        return finalPrompt;
    }, [mode, prompt, activeCreateFunction, styleModifier, cameraAngle, lightingStyle, negativePrompt, comicColorPalette]);

    useEffect(() => {
        if (window.innerWidth < 1024) {
            setShowMobileModal(true);
        }
    }, []);
    
    useEffect(() => {
        const options = styleOptions[activeCreateFunction];
        if (options.length > 0) {
            setStyleModifier(options[0].value);
        } else {
            setStyleModifier('default');
        }
    }, [activeCreateFunction]);

    useEffect(() => {
        if (mode === 'video' && activeVideoFunction === 'animation' && startFramePreview) {
          const img = new Image();
          img.onload = () => {
            const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
            const commonDivisor = gcd(img.width, img.height);
            const ratio = `${img.width / commonDivisor}:${img.height / commonDivisor}`;
            const mappedRatio = mapImageAspectRatioToVideo(img.width, img.height);
            setVideoAspectRatioInfo({ width: img.width, height: img.height, ratio, mappedRatio });
          };
          img.src = startFramePreview;
        } else {
          setVideoAspectRatioInfo(null);
        }
      }, [mode, activeVideoFunction, startFramePreview]);
    
    const getHistoryEntryTitle = (entry: HistoryEntry): string => {
        const functionNameMap: { [key: string]: string } = {
            free: 'Livre',
            sticker: 'Adesivo',
            text: 'Logo',
            comic: 'Quadrinho',
            compose: 'Composição',
            style: 'Estilo',
            prompt: 'A Partir de Prompt',
            animation: 'Animar Imagem'
        };
    
        if (entry.mode === 'create') {
            return `Criar Imagem: ${functionNameMap[entry.createFunction!] || 'Ação'}`;
        }
        if (entry.mode === 'edit' && entry.editFunction) {
            return `Editar Imagem: ${functionNameMap[entry.editFunction] || 'Ação'}`;
        }
        if (entry.mode === 'video') {
            return `Gerar Vídeo: ${functionNameMap[entry.videoFunction!] || 'Ação'}`;
        }
        return 'Mídia Carregada'; 
    };

    const getPromptPlaceholder = useCallback(() => {
        switch (mode) {
            case 'create':
                return 'Descreva sua visão em detalhes: estilo, cores, cena, etc.';
            case 'edit':
                switch (activeEditFunction) {
                    case 'compose':
                        return 'Para edições locais, selecione uma área. Para edições globais, descreva a transformação. Ex: "Faça parecer uma pintura a óleo".';
                    case 'style':
                        return 'Opcional: Descreva como aplicar o estilo ou deixe em branco.';
                    default:
                        return 'Descreva a edição desejada.';
                }
            case 'video':
                 if (activeVideoFunction === 'animation') {
                    return 'Descreva como a imagem inicial deve ser animada (ex: "zoom in lentamente", "adicione chuva caindo").';
                }
                return 'Descreva a cena do vídeo que você quer criar.';
            default:
                return 'Descreva sua ideia.';
        }
    }, [mode, activeEditFunction, activeVideoFunction]);

    useEffect(() => {
        let interval: number;
        if (isLoading) {
            const videoMessages = [
                "Iniciando a geração do vídeo...",
                "A mágica do vídeo leva um tempinho...",
                "Renderizando os frames...",
                "Finalizando os últimos detalhes..."
            ];
            const imageMessages = ["Gerando sua imagem...", "A mágica está acontecendo..."];

            const messages = mode === 'video' ? videoMessages : imageMessages;
            let msgIndex = 0;
            
            setLoadingMessage(messages[msgIndex]);
            
            interval = window.setInterval(() => {
                msgIndex = (msgIndex + 1) % messages.length;
                setLoadingMessage(messages[msgIndex]);
            }, 4000);
        }
        return () => window.clearInterval(interval);
    }, [isLoading, mode]);

    const isUndoDisabled = historyIndex <= 0;
    const isRedoDisabled = historyIndex >= history.length - 1;
    const isMediaAvailable = !!generatedImage || !!generatedVideo;

    return (
        <div className="flex h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-300 font-sans">
            <ConfirmationDialog
                isOpen={confirmationDialog.isOpen}
                title={confirmationDialog.title}
                message={confirmationDialog.message}
                onConfirm={handleConfirm}
                onCancel={closeConfirmationDialog}
            />
            {showMobileModal && (
                <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
                    <div className="bg-zinc-900 p-8 rounded-lg text-center max-w-sm">
                        <h2 className="text-2xl font-bold mb-4">Experiência Otimizada para Desktop</h2>
                        <p>Para aproveitar todos os recursos do 🍌 Nano Banana Studio (beta), por favor, acesse em um computador ou tablet com tela maior.</p>
                    </div>
                </div>
            )}
            
            {/* Left Toolbar */}
            <div className="w-16 bg-zinc-950 p-2 flex flex-col items-center space-y-2 border-r border-zinc-800">
                <div 
                    className="p-2 mb-2 cursor-pointer transition-transform duration-200 hover:scale-110"
                    onClick={handleEasterEggClick}
                    title="O que acontece se clicar aqui?"
                >
                    <span role="img" aria-label="banana icon" className="text-2xl">🍌</span>
                </div>
                <button onClick={() => handleModeToggle('create')} title="Criar Imagem" className={`w-full p-3 rounded-md transition-colors ${mode === 'create' ? 'bg-blue-500/20 text-blue-400' : 'text-zinc-400 hover:bg-zinc-800'}`}>
                    <Icons.Create />
                </button>
                <button onClick={() => handleModeToggle('edit')} title="Editar Imagem" className={`w-full p-3 rounded-md transition-colors ${mode === 'edit' ? 'bg-blue-500/20 text-blue-400' : 'text-zinc-400 hover:bg-zinc-800'}`}>
                    <Icons.Edit />
                </button>
                 <button onClick={() => handleModeToggle('video')} title="Gerar Vídeo" className={`w-full p-3 rounded-md transition-colors ${mode === 'video' ? 'bg-blue-500/20 text-blue-400' : 'text-zinc-400 hover:bg-zinc-800'}`}>
                    <Icons.Video />
                </button>
            </div>

            {/* Consolidated Left Panel */}
            <div className="w-[320px] bg-zinc-900 flex flex-col border-r border-zinc-800">
                {/* Properties Area */}
                <div className="flex-grow overflow-y-auto">
                    {mode === 'create' && (
                        <>
                            <PanelSection title="Função Criativa" icon={<Icons.Sparkles />}>
                                <div className="grid grid-cols-4 gap-2">
                                    <FunctionButton data-function="free" isActive={activeCreateFunction === 'free'} onClick={handleCreateFunctionClick} icon={<Icons.Image />} name="Livre" />
                                    <FunctionButton data-function="sticker" isActive={activeCreateFunction === 'sticker'} onClick={handleCreateFunctionClick} icon={<Icons.Sticker />} name="Adesivo" />
                                    <FunctionButton data-function="text" isActive={activeCreateFunction === 'text'} onClick={handleCreateFunctionClick} icon={<Icons.Type />} name="Logo" />
                                    <FunctionButton data-function="comic" isActive={activeCreateFunction === 'comic'} onClick={handleCreateFunctionClick} icon={<Icons.Comic />} name="Quadrinho" />
                                </div>
                            </PanelSection>
                            <PanelSection title="Proporção" icon={<Icons.AspectRatio />}>
                                <div className="flex gap-2">
                                    {['1:1', '16:9', '9:16', '4:3', '3:4'].map(ratio => (
                                        <button key={ratio} onClick={() => handleAspectRatioChange(ratio)} className={`flex-1 text-center py-2 border rounded-md transition-colors text-sm ${aspectRatio === ratio ? 'border-blue-500 bg-blue-500/10 text-blue-400' : 'border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800/50'}`}>
                                            {ratio}
                                        </button>
                                    ))}
                                </div>
                            </PanelSection>
                            <PanelSection title="Configurações Avançadas" icon={<Icons.Settings />}>
                                <div className="space-y-4">
                                    {styleOptions[activeCreateFunction].length > 0 && (
                                        <div className="flex flex-col gap-2">
                                            <label htmlFor="style-modifier-select" className="text-sm text-zinc-300">Estilo</label>
                                            <div className="custom-select-wrapper">
                                                <select id="style-modifier-select" value={styleModifier} onChange={(e) => setStyleModifier(e.target.value)} className="custom-select" aria-label="Modificador de estilo">
                                                    {styleOptions[activeCreateFunction].map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                                </select>
                                            </div>
                                        </div>
                                    )}
                                    {activeCreateFunction === 'comic' && (
                                        <div className="flex flex-col gap-2">
                                            <label className="text-sm text-zinc-300">Paleta de Cores</label>
                                            <div className="flex gap-2">
                                                <button onClick={() => setComicColorPalette('vibrant')} className={`flex-1 text-center py-2 border rounded-md transition-colors text-sm ${comicColorPalette === 'vibrant' ? 'border-blue-500 bg-blue-500/10 text-blue-400' : 'border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800/50'}`}>
                                                    Vibrante
                                                </button>
                                                <button onClick={() => setComicColorPalette('noir')} className={`flex-1 text-center py-2 border rounded-md transition-colors text-sm ${comicColorPalette === 'noir' ? 'border-blue-500 bg-blue-500/10 text-blue-400' : 'border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800/50'}`}>
                                                    Noir
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                    {activeCreateFunction === 'free' && (
                                        <>
                                            <div className="flex flex-col gap-2">
                                                <label htmlFor="camera-angle-select" className="text-sm text-zinc-300">Ângulo da Câmera</label>
                                                <div className="custom-select-wrapper">
                                                    <select id="camera-angle-select" value={cameraAngle} onChange={(e) => setCameraAngle(e.target.value)} className="custom-select" aria-label="Ângulo da câmera">
                                                        {cameraAngleOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                                    </select>
                                                </div>
                                            </div>
                                            <div className="flex flex-col gap-2">
                                                <label htmlFor="lighting-style-select" className="text-sm text-zinc-300">Estilo de Iluminação</label>
                                                <div className="custom-select-wrapper">
                                                    <select id="lighting-style-select" value={lightingStyle} onChange={(e) => setLightingStyle(e.target.value)} className="custom-select" aria-label="Estilo de iluminação">
                                                        {lightingStyleOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                                    </select>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                    {finalPromptPreview && (
                                        <div className="text-xs text-zinc-400 p-2 bg-zinc-800/50 rounded-md">
                                            <p className="font-semibold mb-1">Prompt Final:</p>
                                            <p>{finalPromptPreview}</p>
                                        </div>
                                    )}
                                </div>
                            </PanelSection>
                        </>
                    )}
                    {mode === 'edit' && (
                        <>
                            <PanelSection title="Função de Edição" icon={<Icons.Layers />}>
                                <div className="grid grid-cols-2 gap-2">
                                    <FunctionButton data-function="compose" isActive={activeEditFunction === 'compose'} onClick={handleEditFunctionClick} icon={<Icons.Layers />} name="Composição" />
                                    <FunctionButton data-function="style" isActive={activeEditFunction === 'style'} onClick={handleEditFunctionClick} icon={<Icons.Palette />} name="Estilo" />
                                </div>
                            </PanelSection>

                            <PanelSection title="Análise de Imagem" icon={<Icons.Visibility />}>
                                <button
                                    onClick={handleDetectObjects}
                                    disabled={!generatedImage || isDetectingObjects}
                                    className="w-full flex items-center justify-center gap-2 p-2 text-sm font-semibold rounded-md bg-zinc-800 hover:bg-zinc-700 transition-colors disabled:bg-zinc-800/50 disabled:cursor-not-allowed"
                                >
                                    {isDetectingObjects ? (
                                        <>
                                            <Icons.Spinner className="h-4 w-4" />
                                            <span>Analisando...</span>
                                        </>
                                    ) : (
                                        <>
                                            <Icons.Visibility />
                                            <span>Detectar Objetos</span>
                                        </>
                                    )}
                                </button>
                                {detectedObjects.length > 0 && (
                                    <div className="mt-4 space-y-2 max-h-48 overflow-y-auto">
                                        <h4 className="text-sm font-semibold text-zinc-300">Objetos Encontrados:</h4>
                                        {detectedObjects.map((obj, index) => (
                                            <div
                                                key={`${obj.name}-${index}`}
                                                className="p-2 bg-zinc-800/50 rounded-md text-sm text-zinc-300 cursor-pointer hover:bg-zinc-700/50"
                                                onMouseEnter={() => setHighlightedObject(obj)}
                                                onMouseLeave={() => setHighlightedObject(null)}
                                                onClick={() => handleDetectedObjectClick(obj)}
                                                title={`Adicionar "${obj.name}" ao prompt`}
                                            >
                                                {obj.name}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </PanelSection>
                            
                            {activeEditFunction === 'style' && (
                                <PanelSection title="Intensidade do Estilo" icon={<Icons.Sliders />}>
                                    <Slider
                                        value={styleStrength}
                                        min={10} max={100}
                                        onChange={(e) => setStyleStrength(parseInt(e.target.value, 10))}
                                        aria-label="Intensidade do estilo"
                                        sliderWidthClass="w-full"
                                    />
                                </PanelSection>
                            )}
                            
                            <PanelSection title="Referências" icon={<Icons.Reference />}>
                                {isAnalyzingStyle && (
                                    <div className="flex items-center gap-2 p-2 mb-3 rounded-md bg-zinc-800/50 text-sm text-zinc-300">
                                        <Icons.Spinner className="h-4 w-4" />
                                        <span>Analisando estilo da imagem...</span>
                                    </div>
                                )}
                                <div onDragEnter={(e) => handleDragEnter(e, 'reference')} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, 'reference')}>
                                    <div className={`border-2 rounded-md transition-all duration-200 ${dragTarget === 'reference' ? 'border-blue-500 bg-blue-500/10 border-solid scale-105' : 'border-zinc-800 border-dashed'}`}>
                                        <input type="file" id="reference-upload" className="hidden" multiple accept="image/png, image/jpeg, image/webp" onChange={(e) => handleImageUpload(e.target.files, 'reference')} disabled={mode !== 'edit'} />
                                        <label htmlFor="reference-upload" className={`${mode !== 'edit' ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} flex items-center justify-center gap-2 text-center p-2`}>
                                            <Icons.UploadCloud className="text-xl text-zinc-500" />
                                            <span className="text-xs">Arraste ou clique para enviar</span>
                                        </label>
                                    </div>
                                    {mode === 'edit' && activeEditFunction === 'style' && <p className="text-xs text-zinc-500 text-center mt-2">(Máximo de 1 imagem de estilo)</p>}
                                    <div className="mt-4 grid grid-cols-3 gap-2">
                                        {referenceImages.map((ref, index) => (
                                            <div
                                                key={index}
                                                className="relative group aspect-square bg-zinc-800 rounded-md overflow-hidden"
                                            >
                                                <img
                                                    src={ref.previewUrl}
                                                    alt={`Reference ${index + 1}`}
                                                    className="w-full h-full object-cover transition-transform group-hover:scale-105"
                                                />
                                                <div className="absolute inset-0 bg-black/60 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                                    <button
                                                        onClick={() => handleRemoveImage(index)}
                                                        className="p-2 bg-zinc-900/80 text-red-400 rounded-full hover:bg-zinc-700 transition-colors"
                                                        title="Remover"
                                                    >
                                                        <Icons.Close />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </PanelSection>
                        </>
                    )}
                     {mode === 'video' && (
                        <>
                            <PanelSection title="Função de Vídeo" icon={<Icons.Video />}>
                               <div className="grid grid-cols-2 gap-2">
                                    <FunctionButton data-function="prompt" isActive={activeVideoFunction === 'prompt'} onClick={handleVideoFunctionClick} icon={<Icons.Prompt />} name="A Partir de Prompt" />
                                    <FunctionButton data-function="animation" isActive={activeVideoFunction === 'animation'} onClick={handleVideoFunctionClick} icon={<Icons.Image />} name="Animar Imagem" />
                                </div>
                            </PanelSection>
                            
                            {activeVideoFunction === 'prompt' &&
                                <PanelSection title="Geração de Vídeo" icon={<Icons.Sparkles />}>
                                     <p className="text-sm text-zinc-400">Descreva a cena, os personagens e a ação que você deseja ver no vídeo. A IA dará vida à sua imaginação.</p>
                                </PanelSection>
                            }

                            {activeVideoFunction === 'animation' && (
                                <>
                                    <PanelSection title="Imagem Inicial" icon={<Icons.Start />}>
                                        <div className="space-y-4 h-48">
                                            <ImageUploadSlot
                                                id="start-frame-upload"
                                                label="Frame Inicial"
                                                icon={<Icons.Start />}
                                                imagePreviewUrl={startFramePreview}
                                                onUpload={(file) => processSingleFile(file, (img, url) => { setStartFrame(img); setStartFramePreview(url); })}
                                                onRemove={() => { setStartFrame(null); setStartFramePreview(null); }}
                                            />
                                        </div>
                                    </PanelSection>
                                    {videoAspectRatioInfo && (
                                        <PanelSection title="Proporção do Vídeo" icon={<Icons.AspectRatio />}>
                                            <div className="p-3 bg-zinc-800 rounded-md space-y-4">
                                                <div className="text-center">
                                                    <p className="text-xs text-zinc-400">Proporção Original</p>
                                                    <p className="text-sm font-semibold text-zinc-200">{videoAspectRatioInfo.ratio} ({`${videoAspectRatioInfo.width}x${videoAspectRatioInfo.height}`})</p>
                                                </div>
                                                <div>
                                                    <label className="text-sm font-semibold text-zinc-300">Modo de Ajuste</label>
                                                    <div className="flex gap-2 mt-2">
                                                        <button onClick={() => setVideoFitMode('crop')} className={`flex-1 text-center py-2 border rounded-md transition-colors text-sm ${videoFitMode === 'crop' ? 'border-blue-500 bg-blue-500/10 text-blue-400' : 'border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800/50'}`}>
                                                            Cortar
                                                        </button>
                                                        <button onClick={() => setVideoFitMode('fill')} className={`flex-1 text-center py-2 border rounded-md transition-colors text-sm ${videoFitMode === 'fill' ? 'border-blue-500 bg-blue-500/10 text-blue-400' : 'border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800/50'}`}>
                                                            Ajustar
                                                        </button>
                                                    </div>
                                                     <p className="text-xs text-zinc-500 mt-2 text-center">
                                                        {videoFitMode === 'crop'
                                                            ? `A imagem será cortada para preencher o vídeo ${videoAspectRatioInfo.mappedRatio}.`
                                                            : `A imagem caberá no vídeo ${videoAspectRatioInfo.mappedRatio} e o espaço restante será preenchido com preto.`}
                                                    </p>
                                                </div>
                                            </div>
                                        </PanelSection>
                                    )}
                                </>
                            )}
                        </>
                    )}
                </div>

                {/* History Area */}
                <div className="flex-shrink-0 border-t border-zinc-800 bg-zinc-900/50">
                    <PanelSection title="Histórico" icon={<Icons.History />} defaultOpen={false}>
                        <div className="max-h-56 overflow-y-auto space-y-2">
                            {history.length === 0 ? (
                                <p className="text-xs text-zinc-500 text-center py-4">Nenhuma ação registrada.</p>
                            ) : (
                                [...history].reverse().map((entry, revIndex) => {
                                    const index = history.length - 1 - revIndex;
                                    const isVideoAnimation = entry.mode === 'video' && entry.videoFunction === 'animation';
                                    return (
                                    <button key={entry.id} onClick={() => handleHistoryNavigation(index)} className={`w-full flex items-center gap-3 p-2 rounded-md text-left transition-colors ${historyIndex === index ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'}`}>
                                        {entry.imageUrl ? (
                                             <img src={entry.imageUrl} alt="" className="w-10 h-10 object-cover rounded-md flex-shrink-0 bg-zinc-700" />
                                        ) : isVideoAnimation && entry.startFramePreviewUrl ? (
                                            <div className="w-10 h-10 relative flex-shrink-0">
                                                <img src={entry.startFramePreviewUrl} alt="Start frame" className="w-full h-full object-cover rounded-md bg-zinc-700" />
                                            </div>
                                        ) : (
                                            <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center bg-zinc-700 rounded-md">
                                                <Icons.Video className="text-zinc-400" />
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-semibold truncate">{getHistoryEntryTitle(entry)}</p>
                                            <p className="text-xs text-zinc-400 truncate">{entry.prompt || (isVideoAnimation ? 'Animação de imagem' : 'Mídia inicial')}</p>
                                        </div>
                                    </button>
                                )})
                            )}
                        </div>
                    </PanelSection>
                </div>

                {/* Negative Prompt Area */}
                { (mode === 'create' || (mode === 'edit' && activeEditFunction === 'compose')) && (
                    <div className="border-b border-zinc-800 p-3 space-y-3">
                        <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
                            <Icons.Block />
                            <span>Prompt Negativo (Opcional)</span>
                        </h3>
                         <textarea
                            id="negative-prompt-input"
                            value={negativePrompt}
                            onChange={(e) => setNegativePrompt(e.target.value)}
                            placeholder="Ex: texto, marcas d'água, baixa qualidade..."
                            className="w-full bg-zinc-800 p-2 rounded-md text-sm placeholder-zinc-500 focus:ring-1 focus:ring-blue-500 focus:outline-none resize-none"
                            rows={2}
                            aria-label="Prompt Negativo"
                        />
                    </div>
                )}

                 {/* Prompt Area */}
                <div className="flex-shrink-0 p-4">
                    <div className="w-full flex flex-col gap-3">
                         {error && (
                            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm p-3 rounded-md flex items-start gap-2">
                                <Icons.AlertCircle className="mt-0.5" />
                                <span>{error}</span>
                            </div>
                        )}
                        <div className="flex flex-col gap-2">
                             <label htmlFor="main-prompt-input" className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
                                <Icons.Prompt />
                                <span>Prompt Principal</span>
                            </label>
                            <textarea
                                id="main-prompt-input"
                                ref={textareaRef}
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                onInput={autoResizeTextarea}
                                placeholder={ getPromptPlaceholder() }
                                className="w-full bg-zinc-800 p-3 rounded-lg text-sm placeholder-zinc-500 focus:ring-1 focus:ring-blue-500 focus:outline-none resize-none pr-4 min-h-[90px] max-h-96 transition-height duration-200"
                                rows={3}
                                aria-label="Prompt principal"
                            />
                        </div>
                        <button 
                            onClick={handleGenerate} 
                            disabled={isLoading} 
                            title="Gerar (Ctrl+Enter)" 
                            className="w-full h-12 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold rounded-lg hover:from-blue-500 hover:to-indigo-500 transition-all duration-300 flex items-center justify-center gap-2 disabled:from-zinc-700 disabled:to-zinc-600 disabled:cursor-not-allowed transform active:scale-[0.99] shadow-lg hover:shadow-blue-500/30 disabled:shadow-none focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-zinc-900 focus:ring-blue-500"
                        >
                            <span>{mode === 'video' ? 'Gerar Vídeo' : 'Gerar'}</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div 
                ref={mainContentRef}
                className="flex-1 flex flex-col bg-zinc-950 relative" 
                onDragEnter={(e) => handleDragEnter(e, 'main')}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, 'main')}
            >
                {isDragging && dragTarget === 'main' && (
                    <div className="absolute inset-0 bg-zinc-950/80 backdrop-blur-sm z-40 flex items-center justify-center pointer-events-none p-8">
                        <div className="w-full h-full flex items-center justify-center border-2 border-dashed border-blue-500 rounded-xl bg-blue-500/10">
                            <div className="text-center">
                                <Icons.UploadCloud className="mx-auto text-6xl text-blue-400" />
                                <p className="mt-4 text-lg font-semibold text-blue-300">Solte para iniciar uma nova edição</p>
                            </div>
                        </div>
                    </div>
                )}
                
                {/* Canvas Area */}
                 <div className="relative flex-1 flex flex-col bg-zinc-950 min-h-0 p-4">
                     {isLoading && (
                        <div className="absolute inset-0 bg-zinc-950/80 backdrop-blur-sm z-40 flex items-center justify-center p-8">
                            <div className="text-center">
                                <Icons.Spinner className="h-12 w-12 mx-auto mb-4" />
                                <h3 className="text-xl font-semibold text-zinc-200">{loadingMessage}</h3>
                                <div className="flex justify-center items-center space-x-2 mt-4">
                                    <div className="w-3 h-3 bg-blue-400 rounded-full animate-pulse-dots dot-1"></div>
                                    <div className="w-3 h-3 bg-blue-400 rounded-full animate-pulse-dots dot-2"></div>
                                    <div className="w-3 h-3 bg-blue-400 rounded-full animate-pulse-dots dot-3"></div>
                                </div>
                            </div>
                        </div>
                    )}
                    <div className="flex-1 min-h-0">
                        {generatedVideo ? (
                             <div className="w-full h-full flex items-center justify-center">
                                <video key={generatedVideo} src={generatedVideo} controls autoPlay loop className="max-w-full max-h-full rounded-lg outline-none">
                                    Seu navegador não suporta a tag de vídeo.
                                </video>
                            </div>
                        ) : generatedImage ? (
                            <ImageEditor
                                ref={editorRef}
                                src={generatedImage}
                                isSelectionEnabled={mode === 'edit' && activeEditFunction === 'compose'}
                                maskTool={maskTool}
                                brushSize={brushSize}
                                maskOpacity={maskOpacity}
                                onZoomChange={setEditorZoom}
                                detectedObjects={detectedObjects}
                                highlightedObject={highlightedObject}
                            />
                        ) : (
                            <div className="w-full h-full flex justify-center">
                                {mode === 'create' && (
                                    <div className="w-full h-full flex justify-center items-center border-2 border-dashed border-zinc-800 rounded-xl bg-zinc-900/50">
                                        <div className="text-center text-zinc-500">
                                            <Icons.Sparkles className="mx-auto text-6xl" />
                                            <h2 className="mt-4 text-lg font-semibold text-zinc-400">Pronto para criar algo incrível?</h2>
                                            <p className="mt-1 text-sm">Descreva sua ideia e clique em "Gerar".</p>
                                        </div>
                                    </div>
                                )}
                                {mode === 'edit' && (
                                    <label htmlFor="main-upload" className="w-full h-full flex justify-center items-center border-2 border-dashed border-zinc-800 rounded-xl cursor-pointer group hover:border-blue-500 transition-colors bg-zinc-900/50 hover:bg-blue-500/5">
                                        <input type="file" id="main-upload" className="hidden" accept="image/png, image/jpeg, image/webp" onChange={(e) => handleImageUpload(e.target.files, 'main')} />
                                        <div className="text-center text-zinc-500">
                                            <Icons.UploadCloud className="mx-auto text-6xl text-zinc-400 group-hover:text-blue-500 transition-colors" />
                                            <h2 className="mt-4 text-lg font-semibold text-zinc-400">Comece a Editar</h2>
                                            <p className="mt-1 text-sm">Arraste e solte uma imagem aqui, ou <span className="font-semibold text-blue-400">clique para enviar</span>.</p>
                                        </div>
                                    </label>
                                )}
                                 {mode === 'video' && (
                                    <div className="w-full h-full flex justify-center items-center border-2 border-dashed border-zinc-800 rounded-xl bg-zinc-900/50">
                                        <div className="text-center text-zinc-500">
                                            <Icons.Video className="mx-auto text-6xl" />
                                            <h2 className="mt-4 text-lg font-semibold text-zinc-400">Pronto para criar um vídeo?</h2>
                                            <p className="mt-1 text-sm">Descreva sua cena e clique em "Gerar Vídeo".</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    
                    {mode === 'edit' && activeEditFunction === 'compose' && generatedImage && (
                         <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-zinc-900/80 backdrop-blur-sm p-2 rounded-lg shadow-lg flex items-center gap-4 ring-1 ring-white/10">
                            <div className="flex bg-zinc-800 p-1 rounded-md items-center">
                                <button onClick={() => setMaskTool('brush')} className={`p-2 rounded transition-colors ${maskTool === 'brush' ? 'bg-zinc-700' : 'hover:bg-zinc-700/50'}`} title="Pincel"> <Icons.Brush /> </button>
                                <button onClick={() => setMaskTool('eraser')} className={`p-2 rounded transition-colors ${maskTool === 'eraser' ? 'bg-zinc-700' : 'hover:bg-zinc-700/50'}`} title="Borracha"> <Icons.Eraser /> </button>
                                <div className="w-px h-6 bg-zinc-700 mx-1" />
                                <button onClick={() => editorRef.current?.clearMask()} className="p-2 rounded transition-colors hover:bg-zinc-700/50" title="Limpar Seleção"> <Icons.Deselect /> </button>
                            </div>
                            <div className="w-px h-8 bg-zinc-700" />
                            <div className="flex items-center gap-3"> <span className="text-sm">Tamanho</span> <Slider value={brushSize} min={5} max={100} onChange={(e) => setBrushSize(parseInt(e.target.value, 10))} aria-label="Tamanho do Pincel" sliderWidthClass="w-32" /> </div>
                             <div className="w-px h-8 bg-zinc-700" />
                             <div className="flex items-center gap-3"> <span className="text-sm">Opacidade</span> <Slider value={maskOpacity * 100} min={10} max={100} onChange={(e) => setMaskOpacity(parseInt(e.target.value, 10) / 100)} aria-label="Opacidade da Máscara" sliderWidthClass="w-32" /> </div>
                         </div>
                    )}

                    {uploadProgress.length > 0 && (
                        <div className="absolute bottom-0 left-0 right-0 p-4 space-y-2 z-40">
                            {uploadProgress.map(up => (
                                <div key={up.id} className="bg-zinc-800 p-3 rounded-lg shadow-lg">
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-sm font-medium truncate pr-4">{up.name}</span>
                                        {up.status === 'success' && <Icons.CheckCircle className="text-green-400" />}
                                        {up.status === 'error' && <Icons.AlertCircle className="text-red-400" />}
                                    </div>
                                    {up.status === 'error' && <p className="text-xs text-red-400 mb-2">{up.message}</p>}
                                    <div className="w-full bg-zinc-700 rounded-full h-1.5">
                                        <div className={`h-1.5 rounded-full transition-all duration-300 ${up.status === 'success' ? 'bg-green-500' : up.status === 'error' ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${up.progress}%` }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Bottom Toolbar */}
                <div className="flex-shrink-0 h-12 bg-zinc-900 flex items-center justify-between px-4 border-t border-zinc-800">
                    <div className="flex items-center gap-1">
                        <button onClick={handleUndo} disabled={isUndoDisabled} className="p-2 disabled:text-zinc-600 disabled:cursor-not-allowed hover:bg-zinc-800 rounded-md" title="Desfazer (Ctrl+Z)"> <Icons.Undo /> </button>
                        <button onClick={handleRedo} disabled={isRedoDisabled} className="p-2 disabled:text-zinc-600 disabled:cursor-not-allowed hover:bg-zinc-800 rounded-md" title="Refazer (Ctrl+Y)"> <Icons.Redo /> </button>
                        <div className="w-px h-6 bg-zinc-800 mx-2" />
                         <button onClick={handleClearAll} className="p-2 hover:bg-zinc-800 rounded-md" title="Limpar Tudo"> <Icons.ClearAll /> </button>
                        <button onClick={handleSaveMedia} disabled={!isMediaAvailable} className="p-2 disabled:text-zinc-600 disabled:cursor-not-allowed hover:bg-zinc-800 rounded-md" title="Salvar Mídia"> <Icons.Save /> </button>
                    </div>
                    { mode !== 'video' && (
                        <div className="flex items-center text-sm">
                            <button onClick={() => editorRef.current?.zoomOut()} className="p-2 hover:bg-zinc-800 rounded-md" title="Diminuir Zoom"> <Icons.ZoomOut /> </button>
                            <div className="w-14 text-center cursor-pointer" onClick={() => editorRef.current?.zoomToFit()} title="Ajustar à Tela"> {Math.round(editorZoom)}% </div>
                            <button onClick={() => editorRef.current?.zoomIn()} className="p-2 hover:bg-zinc-800 rounded-md" title="Aumentar Zoom"> <Icons.ZoomIn /> </button>
                            <div className="w-px h-6 bg-zinc-700 mx-2" />
                            <button onClick={() => editorRef.current?.zoomToFit()} className="p-2 hover:bg-zinc-800 rounded-md" title="Ajustar à Tela"> <Icons.FitScreen /> </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}