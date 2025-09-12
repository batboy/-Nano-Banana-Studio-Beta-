import React, { useState, useCallback, ChangeEvent, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import type { Mode, CreateFunction, EditFunction, UploadedImage, HistoryEntry, UploadProgress, ReferenceImage } from './types';
import { generateImage, processImagesWithPrompt } from './services/geminiService';
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
            {label && <span className="text-sm text-zinc-300 whitespace-nowrap">{label}:</span>}
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
      ${isActive ? 'border-blue-500 bg-blue-500/10 text-blue-400' : 'border-zinc-700 bg-zinc-800 hover:bg-zinc-700/50 text-zinc-400'
    }`}
  >
    <div className="mb-1">{icon}</div>
    <div className="text-xs font-semibold">{name}</div>
  </button>
);


interface ImageEditorProps {
  src: string;
  isSelectionEnabled: boolean;
  maskTool: 'brush' | 'eraser';
  brushSize: number;
  maskOpacity: number;
  onZoomChange: (zoom: number) => void;
}

interface ImageEditorRef {
  getMaskData: () => UploadedImage | null;
  hasMaskData: () => boolean;
  getOriginalImageSize: () => { width: number, height: number } | null;
  clearMask: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  setZoom: (zoom: number) => void;
  zoomToFit: () => void;
  stampObjectOnMask: (data: { previewUrl: string, transform: any, maskOpacity: number }) => void;
}

const ImageEditor = forwardRef<ImageEditorRef, ImageEditorProps>(({ src, isSelectionEnabled, maskTool, brushSize, maskOpacity, onZoomChange }, ref) => {
    const imageCanvasRef = useRef<HTMLCanvasElement>(null);
    const maskCanvasRef = useRef<HTMLCanvasElement>(null);
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
    
    const currentStrokePointsRef = useRef<{ x: number, y: number }[]>([]);

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
    
        // The ratio of the canvas's internal resolution to its displayed size
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
    
        // Calculate mouse position relative to the canvas element on the screen,
        // then scale it to the canvas's internal coordinate system.
        const canvasX = (e.clientX - rect.left) * scaleX;
        const canvasY = (e.clientY - rect.top) * scaleY;
        
        return [canvasX, canvasY];
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isSelectionEnabled) return;

            if (e.key === '[') {
                e.preventDefault();
                // This will need to be lifted up if brushSize is controlled by parent.
                // For now, let's assume parent will handle it.
            } else if (e.key === ']') {
                e.preventDefault();
                // This will need to be lifted up if brushSize is controlled by parent.
            }
        };

        window.addEventListener('keydown', handleKeyDown);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [isSelectionEnabled]);

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
            // eslint-disable-next-line
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
            if (!imageCanvas || !maskCanvas) return;

            imageCanvas.width = image.width;
            imageCanvas.height = image.height;
            maskCanvas.width = image.width;
            maskCanvas.height = image.height;

            const ctx = imageCanvas.getContext('2d');
            ctx?.drawImage(image, 0, 0);
            clearMask();
            zoomToFit();
        };
    }, [src, zoomToFit, clearMask]);

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

            // Use a fixed canvas-space distance to match the reference editor's behavior.
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
    
    useImperativeHandle(ref, () => ({
        getMaskData: () => {
            const maskCanvas = maskCanvasRef.current;
            if (!maskCanvas) return null;

            const previewCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
            if (!previewCtx) return null;
            const previewImageData = previewCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
            let hasMask = false;
            for (let i = 3; i < previewImageData.data.length; i += 4) {
                if (previewImageData.data[i] > 10) { 
                    hasMask = true;
                    break;
                }
            }
            if (!hasMask) return null;
            
            const imageData = previewCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
                if (data[i + 3] > 10) {
                    data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
                } else {
                    data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
                }
            }

            previewCtx.putImageData(imageData, 0, 0);

            const dataUrl = maskCanvas.toDataURL('image/png');
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
    }));
    
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
        if (e.button === 1 || e.button === 2) { // Middle or Right mouse button
            e.preventDefault();
            isPanningRef.current = true;
            panStartRef.current = { x: e.clientX - transform.x, y: e.clientY - transform.y };
            if (containerRef.current) containerRef.current.style.cursor = 'grabbing';
        } else if (e.button === 0 && isSelectionEnabled) {
            startDrawing(e);
        }
    };
    
    const handleContainerMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
        if (isPanningRef.current && (e.button === 1 || e.button === 2)) {
            isPanningRef.current = false;
            if (containerRef.current) containerRef.current.style.cursor = isSelectionEnabled ? 'none' : 'grab';
        } else if (e.button === 0 && isSelectionEnabled) {
            stopDrawing();
        }
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
        if (isPanningRef.current) isPanningRef.current = false;
        if (containerRef.current) containerRef.current.style.cursor = isSelectionEnabled ? 'none' : 'default';
        setCursorPreview(prev => ({ ...prev, visible: false }));
        if (isDrawing) stopDrawing();
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
             className="w-full h-full relative overflow-hidden touch-none bg-zinc-900/50"
             onWheel={handleWheel}
             onMouseDown={handleContainerMouseDown}
             onMouseMove={handleContainerMouseMove}
             onMouseUp={handleContainerMouseUp}
             onMouseLeave={handleContainerMouseLeave}
             onContextMenu={(e) => e.preventDefault()} // Prevent context menu on right-click pan
             >
            <div 
                className="absolute top-0 left-0"
                style={{ 
                    transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                    transformOrigin: 'top left',
                    cursor: isSelectionEnabled ? 'none' : 'grab'
                }}
            >
                <canvas ref={imageCanvasRef} className="block" />
                <canvas
                    ref={maskCanvasRef}
                    className="absolute top-0 left-0 transition-opacity duration-200"
                    style={{ opacity: isSelectionEnabled ? maskOpacity : 0 }}
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
                    className="absolute top-4 right-4 bg-zinc-900/70 backdrop-blur-sm rounded-lg shadow-lg ring-1 ring-white/10 overflow-hidden"
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

interface ReferenceMaskEditorProps {
    isOpen: boolean;
    imageSrc: string;
    onSave: (maskData: UploadedImage | null, maskedObjectPreviewUrl: string | null) => void;
    onClose: () => void;
}

const ReferenceMaskEditor: React.FC<ReferenceMaskEditorProps> = ({ isOpen, imageSrc, onSave, onClose }) => {
    const imageCanvasRef = useRef<HTMLCanvasElement>(null);
    const maskCanvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const [isDrawing, setIsDrawing] = useState(false);
    const lastPositionRef = useRef<{ x: number, y: number } | null >(null);
    const currentStrokePointsRef = useRef<{ x: number, y: number }[]>([]);

    const [brushSize, setBrushSize] = useState(40);
    const [maskOpacity, setMaskOpacity] = useState(0.7);
    const [maskTool, setMaskTool] = useState<'brush' | 'eraser'>('brush');
    const [cursorPreview, setCursorPreview] = useState({ x: 0, y: 0, visible: false });

    const getCoords = useCallback((e: React.MouseEvent<HTMLElement>): [number, number] => {
        const canvas = maskCanvasRef.current;
        if (!canvas || canvas.width === 0) return [0, 0];
        
        const rect = canvas.getBoundingClientRect();

        // Calculate the actual rendered dimensions due to 'object-fit: contain'
        const canvasRatio = canvas.width / canvas.height;
        const rectRatio = rect.width / rect.height;

        let renderedWidth, renderedHeight, offsetX, offsetY;

        if (canvasRatio > rectRatio) {
            // Image is wider than the container, so it's letterboxed vertically
            renderedWidth = rect.width;
            renderedHeight = rect.width / canvasRatio;
            offsetX = 0;
            offsetY = (rect.height - renderedHeight) / 2;
        } else {
            // Image is taller than the container, so it's letterboxed horizontally
            renderedHeight = rect.height;
            renderedWidth = rect.height * canvasRatio;
            offsetY = 0;
            offsetX = (rect.width - renderedWidth) / 2;
        }

        // Mouse position relative to the rendered image area
        const mouseX = e.clientX - rect.left - offsetX;
        const mouseY = e.clientY - rect.top - offsetY;
        
        // Scale mouse position from rendered dimensions to canvas's native resolution
        const scaleX = canvas.width / renderedWidth;
        const scaleY = canvas.height / renderedHeight;

        const x = mouseX * scaleX;
        const y = mouseY * scaleY;

        return [x, y];
    }, []);

    const clearMask = useCallback(() => {
        const canvas = maskCanvasRef.current;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx?.clearRect(0, 0, canvas.width, canvas.height);
        }
    }, []);

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
        tempCtx.strokeStyle = `rgba(74, 222, 128, ${maskOpacity})`;
        tempCtx.stroke();
        
        floodFill(tempCanvas, seedX, seedY, maskOpacity);

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(tempCanvas, 0, 0);

    }, [brushSize, floodFill, maskOpacity]);


    useEffect(() => {
        if (!isOpen || !imageSrc) return;
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.src = imageSrc;
        image.onload = () => {
            const imageCanvas = imageCanvasRef.current;
            const maskCanvas = maskCanvasRef.current;
            const container = containerRef.current;
            if (!imageCanvas || !maskCanvas || !container) return;

            // Set canvas resolution to image's native resolution
            const canvasW = image.width;
            const canvasH = image.height;

            [imageCanvas, maskCanvas].forEach(canvas => {
                canvas.width = canvasW;
                canvas.height = canvasH;
                 // Reset styles to let CSS handle fitting
                canvas.style.width = '100%';
                canvas.style.height = '100%';
                canvas.style.objectFit = 'contain';
            });

            const ctx = imageCanvas.getContext('2d');
            ctx?.drawImage(image, 0, 0, canvasW, canvasH);
            clearMask();
        };
    }, [isOpen, imageSrc, clearMask]);

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

            if (distance < 40) { // Using a fixed canvas-space distance
                fillEnclosedArea(points);
            }
        }
        currentStrokePointsRef.current = [];
    };

    const draw = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!isDrawing) return;
        const ctx = maskCanvasRef.current?.getContext('2d');
        if (!ctx || !lastPositionRef.current) return;

        const [x, y] = getCoords(e);
        currentStrokePointsRef.current.push({ x, y });

        ctx.lineWidth = brushSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = maskTool === 'brush' ? `rgba(74, 222, 128, ${maskOpacity})` : 'rgba(0,0,0,1)';
        ctx.globalCompositeOperation = maskTool === 'brush' ? 'source-over' : 'destination-out';
        
        ctx.beginPath();
        ctx.moveTo(lastPositionRef.current.x, lastPositionRef.current.y);
        ctx.lineTo(x, y);
        ctx.stroke();

        lastPositionRef.current = { x, y };
    };
    
    const handleSave = () => {
        const maskCanvas = maskCanvasRef.current;
        if (!maskCanvas) {
            onSave(null, null);
            return;
        }

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = maskCanvas.width;
        tempCanvas.height = maskCanvas.height;

        const ctx = tempCanvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
            onSave(null, null);
            return;
        }
        ctx.drawImage(maskCanvas, 0, 0);

        const imageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        let hasMask = false;
        for (let i = 3; i < imageData.data.length; i += 4) {
            if (imageData.data[i] > 10) {
                hasMask = true;
                break;
            }
        }

        if (!hasMask) {
            onSave(null, null);
            return;
        }

        const finalMaskData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        const data = finalMaskData.data;
        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] > 10) {
                data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
            } else {
                data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
            }
        }
        ctx.putImageData(finalMaskData, 0, 0);
        
        let maskedObjectPreviewUrl: string | null = null;
        const maskedObjectCanvas = document.createElement('canvas');
        maskedObjectCanvas.width = maskCanvas.width;
        maskedObjectCanvas.height = maskCanvas.height;
        const moCtx = maskedObjectCanvas.getContext('2d');
        if (moCtx) {
            const imageEl = new Image();
            imageEl.crossOrigin = "anonymous";
            imageEl.onload = () => {
                moCtx.drawImage(imageEl, 0, 0);
                moCtx.globalCompositeOperation = 'destination-in';
                moCtx.drawImage(tempCanvas, 0, 0);
                maskedObjectPreviewUrl = maskedObjectCanvas.toDataURL('image/png');

                const dataUrl = tempCanvas.toDataURL('image/png');
                const base64 = dataUrl.split(',')[1];
                onSave({ base64, mimeType: 'image/png' }, maskedObjectPreviewUrl);
            };
            imageEl.src = imageSrc;
        } else {
            const dataUrl = tempCanvas.toDataURL('image/png');
            const base64 = dataUrl.split(',')[1];
            onSave({ base64, mimeType: 'image/png' }, null);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <div className="bg-zinc-900 rounded-lg max-w-5xl w-full h-[90vh] flex flex-col p-4 ring-1 ring-white/10 shadow-2xl">
                <h2 className="text-xl font-bold mb-4 text-zinc-100 flex-shrink-0">Selecionar Elemento para Composição</h2>
                <div className="flex-1 flex gap-4 min-h-0">
                    <div 
                        ref={containerRef} 
                        className="flex-1 bg-zinc-950 rounded-md relative flex items-center justify-center overflow-hidden cursor-none"
                        onMouseDown={startDrawing}
                        onMouseMove={(e) => {
                            draw(e);
                            const container = containerRef.current;
                            if (!container) return;
                            const rect = container.getBoundingClientRect();
                            setCursorPreview({ x: e.clientX - rect.left, y: e.clientY - rect.top, visible: true });
                        }}
                        onMouseUp={stopDrawing}
                        onMouseLeave={() => {
                            stopDrawing();
                            setCursorPreview(p => ({ ...p, visible: false }));
                        }}
                    >
                        <canvas ref={imageCanvasRef} className="absolute inset-0 m-auto pointer-events-none" style={{ objectFit: 'contain', width: '100%', height: '100%' }} />
                        <canvas ref={maskCanvasRef} className="absolute inset-0 m-auto pointer-events-none" style={{ objectFit: 'contain', width: '100%', height: '100%' }} />
                        
                        {cursorPreview.visible && (
                             <div
                                className="absolute pointer-events-none rounded-full border"
                                style={{
                                    left: cursorPreview.x,
                                    top: cursorPreview.y,
                                    width: brushSize,
                                    height: brushSize,
                                    transform: 'translate(-50%, -50%)',
                                    borderColor: maskTool === 'brush' ? 'rgba(74, 222, 128, 0.8)' : 'rgba(239, 68, 68, 0.8)',
                                    backgroundColor: maskTool === 'brush' ? `rgba(74, 222, 128, ${maskOpacity * 0.3})` : 'rgba(239, 68, 68, 0.2)'
                                }}
                            />
                        )}
                    </div>
                    <div className="w-56 flex-shrink-0 flex flex-col gap-6 bg-zinc-800/50 p-4 rounded-md">
                        <div className="flex bg-zinc-800 p-1 rounded-md justify-center">
                            <button onClick={() => setMaskTool('brush')} title="Pincel" className={`p-2 rounded transition-colors w-full flex items-center justify-center ${maskTool === 'brush' ? 'bg-zinc-700' : 'hover:bg-zinc-700/50'}`}>
                                <Icons.Brush />
                            </button>
                            <button onClick={() => setMaskTool('eraser')} title="Borracha" className={`p-2 rounded transition-colors w-full flex items-center justify-center ${maskTool === 'eraser' ? 'bg-zinc-700' : 'hover:bg-zinc-700/50'}`}>
                                <Icons.Eraser />
                            </button>
                             <button onClick={clearMask} className="p-2 rounded hover:bg-zinc-700/50 transition-colors w-full flex items-center justify-center" title="Limpar Seleção">
                                <Icons.Deselect />
                            </button>
                        </div>
                         <div className="flex flex-col gap-2">
                            <label htmlFor="refBrushSize" className="text-sm text-zinc-300 whitespace-nowrap">Tamanho do Pincel</label>
                            <input id="refBrushSize" type="range" min="5" max="150" value={brushSize} onChange={e => setBrushSize(parseInt(e.target.value, 10))} className="w-full" aria-label="Tamanho do pincel" />
                        </div>
                        <div className="flex flex-col gap-2">
                            <label htmlFor="refMaskOpacity" className="text-sm text-zinc-300 whitespace-nowrap">Opacidade do Pincel</label>
                            <input id="refMaskOpacity" type="range" min="0.1" max="1" step="0.05" value={maskOpacity} onChange={e => setMaskOpacity(parseFloat(e.target.value))} className="w-full" aria-label="Opacidade do pincel" />
                        </div>
                        <div className="text-xs text-zinc-400 mt-auto">
                            <p className="font-semibold mb-1">Dica:</p>
                            <p>Pinte sobre a área que deseja usar na composição. Você não precisa ser perfeitamente preciso.</p>
                        </div>
                    </div>
                </div>
                <div className="flex justify-end gap-3 pt-4 flex-shrink-0">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-semibold rounded-md bg-zinc-800 hover:bg-zinc-700 transition-colors">
                        Cancelar
                    </button>
                    <button onClick={handleSave} className="px-4 py-2 text-sm font-semibold rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-colors">
                        Salvar Seleção
                    </button>
                </div>
            </div>
        </div>
    );
};

const ObjectPlacer = ({
    placingObjectState,
    onTransformChange,
    onConfirm,
    onCancel
}: any) => {
    const placerRef = useRef<HTMLDivElement>(null);
    const actionRef = useRef<any>(null);

    const handleMouseDown = (e: React.MouseEvent, action: string, cursor?: string) => {
        e.preventDefault();
        e.stopPropagation();

        const rect = placerRef.current!.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI);

        actionRef.current = {
            action,
            startX: e.clientX,
            startY: e.clientY,
            startWidth: placingObjectState.transform.width,
            startHeight: placingObjectState.transform.height,
            startLeft: placingObjectState.transform.x,
            startTop: placingObjectState.transform.y,
            startRotation: placingObjectState.transform.rotation,
            startAngle,
            aspectRatio: placingObjectState.transform.width / placingObjectState.transform.height,
        };

        if (cursor) {
            document.body.style.cursor = cursor;
        }

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    };

    const handleMouseMove = (e: MouseEvent) => {
        if (!actionRef.current) return;
        const { action, startX, startY, startLeft, startTop, startWidth, startHeight, startRotation, startAngle, aspectRatio } = actionRef.current;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        let newTransform = { ...placingObjectState.transform };

        switch(action) {
            case 'move':
                newTransform.x = startLeft + dx;
                newTransform.y = startTop + dy;
                break;
            case 'rotate': {
                 const rect = placerRef.current!.getBoundingClientRect();
                 const centerX = rect.left + rect.width / 2;
                 const centerY = rect.top + rect.height / 2;
                 const currentAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI);
                 newTransform.rotation = startRotation + (currentAngle - startAngle);
                break;
            }
            case 'resize-br': {
                const newWidth = startWidth + dx;
                const newHeight = newWidth / aspectRatio;
                newTransform.width = Math.max(20, newWidth);
                newTransform.height = Math.max(20, newHeight);
                break;
            }
        }
        onTransformChange(newTransform);
    };

    const handleMouseUp = () => {
        actionRef.current = null;
        document.body.style.cursor = 'default';
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
    };

    return (
        <div
            ref={placerRef}
            className="absolute z-30"
            style={{
                left: placingObjectState.transform.x,
                top: placingObjectState.transform.y,
                width: placingObjectState.transform.width,
                height: placingObjectState.transform.height,
                transform: `rotate(${placingObjectState.transform.rotation}deg)`,
                cursor: 'move',
            }}
            onMouseDown={(e) => handleMouseDown(e, 'move')}
        >
            <div className="absolute inset-0 border-2 border-dashed border-blue-400 pointer-events-none">
                <img src={placingObjectState.previewUrl} className="w-full h-full" alt="Object to place" />
            </div>
            
            <div
                className="absolute -top-6 left-1/2 -translate-x-1/2 w-4 h-4 bg-blue-400 rounded-full cursor-alias"
                onMouseDown={(e) => handleMouseDown(e, 'rotate', 'alias')}
            />
            <div
                className="absolute -bottom-2 -right-2 w-4 h-4 bg-blue-400 rounded-full cursor-se-resize border-2 border-zinc-900"
                onMouseDown={(e) => handleMouseDown(e, 'resize-br', 'se-resize')}
            />

             <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 flex gap-2" onMouseDown={e => e.stopPropagation()}>
                <button onClick={onCancel} className="px-3 py-1 text-sm rounded-md bg-zinc-800 hover:bg-zinc-700 transition-colors">Cancelar</button>
                <button onClick={onConfirm} className="px-3 py-1 text-sm rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-colors">Confirmar</button>
            </div>
        </div>
    );
};


function App() {
    const [prompt, setPrompt] = useState<string>('');
    const [mode, setMode] = useState<Mode>('create');
    const [activeCreateFunction, setActiveCreateFunction] = useState<CreateFunction>('free');
    const [activeEditFunction, setActiveEditFunction] = useState<EditFunction>('compose');
    const [aspectRatio, setAspectRatio] = useState<string>('1:1');
    const [styleIntensity, setStyleIntensity] = useState<number>(3);
    
    const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);

    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [historyIndex, setHistoryIndex] = useState<number>(-1);
    const generatedImage = history[historyIndex]?.imageUrl ?? null;

    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    
    const [showMobileModal, setShowMobileModal] = useState<boolean>(false);
    const editorRef = useRef<ImageEditorRef>(null);
    const mainContentRef = useRef<HTMLDivElement>(null);

    const [isDragging, setIsDragging] = useState<boolean>(false);
    const [dragTarget, setDragTarget] = useState<'main' | 'reference' | null>(null);
    const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([]);

    const [confirmationDialog, setConfirmationDialog] = useState({
        isOpen: false,
        title: '',
        message: '',
        onConfirm: () => {},
    });

    const [maskTool, setMaskTool] = useState<'brush' | 'eraser'>('brush');
    const [brushSize, setBrushSize] = useState(40);
    const [maskOpacity, setMaskOpacity] = useState(0.6);
    const [editorZoom, setEditorZoom] = useState(100);
    
    const [editingReferenceIndex, setEditingReferenceIndex] = useState<number | null>(null);

    const [isPlacingObject, setIsPlacingObject] = useState<boolean>(false);
    const [placingObjectState, setPlacingObjectState] = useState<any>(null);


    const closeConfirmationDialog = () => {
        setConfirmationDialog(prev => ({ ...prev, isOpen: false }));
    };

    const handleConfirm = () => {
        confirmationDialog.onConfirm();
        closeConfirmationDialog();
    };


    const resetImages = () => {
        setReferenceImages([]);
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

        const performSwitchToCreate = () => {
            setMode('create');
            resetImages();
            setHistory([]);
            setHistoryIndex(-1);
            setPrompt('');
        };

        if (newMode === 'create' && mode === 'edit' && history.length > 0) {
            setConfirmationDialog({
                isOpen: true,
                title: 'Sair do Modo de Edição?',
                message: 'Ao voltar para o modo de criação, a imagem atual e seu histórico de edições serão perdidos. Deseja continuar?',
                onConfirm: performSwitchToCreate
            });
            return;
        }

        if (newMode === 'create') {
            performSwitchToCreate();
        } else { // Switching to 'edit'
            setMode('edit');
            resetImages();
            if (generatedImage) {
                const currentEntry = history[historyIndex];
                setHistory([currentEntry]);
                setHistoryIndex(0);
                setPrompt(currentEntry.prompt);
            } else {
                setHistory([]);
                setHistoryIndex(-1);
                setPrompt('');
            }
        }
    };
    
    const handleHistoryNavigation = useCallback((index: number) => {
        if (index < 0 || index >= history.length) return;
        
        const entry = history[index];
        if (!entry) return;

        setHistoryIndex(index);
        setPrompt(entry.prompt);
        setMode(entry.mode);

        if (entry.mode === 'create') {
            setActiveCreateFunction(entry.createFunction!);
            setAspectRatio(entry.aspectRatio!);
            resetImages(); 
        } else { 
            setActiveEditFunction(entry.editFunction!);
            setReferenceImages(entry.referenceImages || []);
            setStyleIntensity(entry.styleIntensity ?? 3);
        }
    }, [history]);

    const handleCreateFunctionClick = (func: CreateFunction) => {
        setActiveCreateFunction(func);
    };

    const handleAspectRatioChange = (ratio: string) => {
        setAspectRatio(ratio);
    };

    const handleEditFunctionClick = (func: EditFunction) => {
        setActiveEditFunction(func);
    };
    
    const processUploadedFiles = useCallback((files: File[], target: 'main' | 'reference') => {
        let isMainImageSlotFilled = history.length > 0;
        const filesToProcess = [...files];

        if (target === 'main' && filesToProcess.length > 1) {
            filesToProcess.splice(1);
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

            reader.onload = () => {
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
                        styleIntensity: styleIntensity,
                    };
                    setHistory([initialEntry]);
                    setHistoryIndex(0);
                    setReferenceImages([]);
                    setPrompt('');
                    isMainImageSlotFilled = true;
                } else {
                    const newRefImage: ReferenceImage = { image: uploadedImage, previewUrl: dataUrl, mask: null };
                    setReferenceImages(prev => [...prev, newRefImage]);
                }

                setTimeout(() => setUploadProgress(p => p.filter(item => item.id !== id)), 1500);
            };
            
            reader.readAsDataURL(file);
        });
    }, [history.length, activeEditFunction, styleIntensity]);

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
        if (mode === 'edit') {
            setIsDragging(true);
            setDragTarget(target);
        }
    };

    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        setDragTarget(null);
    };
    
    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>, target: 'main' | 'reference') => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        setDragTarget(null);
        if (mode === 'edit' && activeEditFunction === 'compose') {
            const files = e.dataTransfer.files;
            if (files && files.length > 0) {
                handleImageUpload(files, target);
            }
        }
    };

    const handleMainCanvasDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        const refIndexStr = e.dataTransfer.getData('ref-index');
        
        if (mode === 'edit' && activeEditFunction === 'compose' && refIndexStr && mainContentRef.current) {
            const refIndex = parseInt(refIndexStr, 10);
            const refImage = referenceImages[refIndex];
            
            if (refImage?.maskedObjectPreviewUrl) {
                const editorRect = mainContentRef.current.getBoundingClientRect();
                const dropX = e.clientX - editorRect.left;
                const dropY = e.clientY - editorRect.top;

                const img = new Image();
                img.onload = () => {
                    const aspectRatio = img.naturalWidth / img.naturalHeight;
                    const initialWidth = 200;
                    const initialHeight = initialWidth / aspectRatio;

                    setPlacingObjectState({
                        previewUrl: refImage.maskedObjectPreviewUrl,
                        transform: {
                            x: dropX - initialWidth / 2,
                            y: dropY - initialHeight / 2,
                            width: initialWidth,
                            height: initialHeight,
                            rotation: 0,
                        },
                    });
                    setIsPlacingObject(true);
                };
                img.src = refImage.maskedObjectPreviewUrl;
            }
        } else {
             handleDrop(e, 'main');
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
            const result = await generateImage(easterEggPrompt, activeCreateFunction, aspectRatio);

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

    const generateImageHandler = useCallback(async () => {
        if (mode === 'create' && !prompt) {
            setError('Por favor, descreva sua ideia.');
            return;
        }
        if (mode === 'edit' && !generatedImage) {
             setError('Por favor, envie ou gere uma imagem para editar.');
             return;
        }

        setIsLoading(true);
        setError(null);
        
        try {
            let result: string | null = null;
            if (mode === 'create') {
                result = await generateImage(prompt, activeCreateFunction, aspectRatio);
            } else { 
                if (!generatedImage) throw new Error("Imagem para edição não encontrada.");
                
                const mask = editorRef.current?.getMaskData() ?? null;
                const originalSize = editorRef.current?.getOriginalImageSize() ?? null;
                const mainImageBase64 = generatedImage.split(',')[1];
                const mainImageMimeType = generatedImage.match(/data:(image\/[^;]+);/)?.[1] || 'image/png';
                const mainImage: UploadedImage = { base64: mainImageBase64, mimeType: mainImageMimeType };

                result = await processImagesWithPrompt(prompt, mainImage, referenceImages, mask, activeEditFunction, originalSize, styleIntensity);
            }

            if (result) {
                const newEntry: HistoryEntry = {
                    id: `hist-${Date.now()}`,
                    imageUrl: result,
                    prompt,
                    mode,
                    ...(mode === 'create'
                      ? { createFunction: activeCreateFunction, aspectRatio }
                      : { 
                          editFunction: activeEditFunction, 
                          referenceImages,
                          styleIntensity,
                        }),
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
    }, [prompt, mode, activeCreateFunction, activeEditFunction, aspectRatio, referenceImages, history, historyIndex, generatedImage, styleIntensity]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (!isLoading) {
                    generateImageHandler();
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [isLoading, generateImageHandler]);

    const handleUndo = () => {
        if (historyIndex > 0) {
            handleHistoryNavigation(historyIndex - 1);
        }
    };

    const handleRedo = () => {
        if (historyIndex < history.length - 1) {
            handleHistoryNavigation(historyIndex - 1);
        }
    };

    const handleSaveImage = () => {
        if (!generatedImage) return;
        const link = document.createElement('a');
        link.href = generatedImage;
        link.download = `nano-banana-studio-${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    useEffect(() => {
        if (window.innerWidth < 1024) {
            setShowMobileModal(true);
        }
    }, []);
    
    const getHistoryEntryTitle = (entry: HistoryEntry): string => {
        const functionNameMap: { [key: string]: string } = {
            free: 'Livre',
            sticker: 'Adesivo',
            text: 'Logo',
            comic: 'Quadrinho',
            style: 'Estilo',
            compose: 'Composição',
        };
    
        if (entry.mode === 'create') {
            return `Criar: ${functionNameMap[entry.createFunction!] || 'Ação'}`;
        }
        if (entry.editFunction) {
            return `Editar: ${functionNameMap[entry.editFunction] || 'Ação'}`;
        }
        return 'Imagem Carregada'; 
    };

    const isUndoDisabled = historyIndex <= 0;
    const isRedoDisabled = historyIndex >= history.length - 1;

    return (
        <div className="flex h-screen w-screen overflow-hidden bg-zinc-900 text-zinc-300 font-sans">
            <ConfirmationDialog
                isOpen={confirmationDialog.isOpen}
                title={confirmationDialog.title}
                message={confirmationDialog.message}
                onConfirm={handleConfirm}
                onCancel={closeConfirmationDialog}
            />
             <ReferenceMaskEditor
                isOpen={editingReferenceIndex !== null}
                imageSrc={editingReferenceIndex !== null ? referenceImages[editingReferenceIndex].previewUrl : ''}
                onClose={() => setEditingReferenceIndex(null)}
                onSave={(maskData, maskedObjectPreviewUrl) => {
                    if (editingReferenceIndex !== null) {
                    const updatedRefs = [...referenceImages];
                    updatedRefs[editingReferenceIndex].mask = maskData;
                    updatedRefs[editingReferenceIndex].maskedObjectPreviewUrl = maskedObjectPreviewUrl ?? undefined;
                    setReferenceImages(updatedRefs);
                    }
                    setEditingReferenceIndex(null);
                }}
            />
            {showMobileModal && (
                <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
                    <div className="bg-zinc-900 p-8 rounded-lg text-center max-w-sm">
                        <h2 className="text-2xl font-bold mb-4">Experiência Otimizada para Desktop</h2>
                        <p>Para aproveitar todos os recursos do 🍌 Nano Banana Studio (beta), por favor, acesse em um computador ou tablet com tela maior.</p>
                    </div>
                </div>
            )}
            
            {/* Vertical Toolbar */}
            <div className="w-16 bg-zinc-950/70 p-2 flex flex-col items-center space-y-2 border-r border-zinc-800">
                <div 
                    className="p-2 mb-2 cursor-pointer transition-transform duration-200 hover:scale-110"
                    onClick={handleEasterEggClick}
                    title="O que acontece se clicar aqui?"
                >
                    <span role="img" aria-label="banana icon" className="text-2xl">🍌</span>
                </div>
                <button onClick={() => handleModeToggle('create')} title="Criar" className={`w-full p-3 rounded-md transition-colors ${mode === 'create' ? 'bg-blue-500/20 text-blue-400' : 'text-zinc-400 hover:bg-zinc-800'}`}>
                    <Icons.Create />
                </button>
                <button onClick={() => handleModeToggle('edit')} title="Editar" className={`w-full p-3 rounded-md transition-colors ${mode === 'edit' ? 'bg-blue-500/20 text-blue-400' : 'text-zinc-400 hover:bg-zinc-800'}`}>
                    <Icons.Edit />
                </button>
            </div>

            {/* Left Panel */}
            <div className="w-[300px] bg-zinc-900 p-4 flex flex-col space-y-4 border-r border-zinc-800">
                <div className="flex-grow overflow-y-auto space-y-5 pr-2">
                    {mode === 'create' && (
                      <>
                        <div>
                            <h2 className="text-sm font-semibold text-zinc-400 mb-3 flex items-center gap-2"><Icons.Sparkles /> Função Criativa</h2>
                            <div className="grid grid-cols-2 gap-2">
                                <FunctionButton data-function="free" isActive={activeCreateFunction === 'free'} onClick={handleCreateFunctionClick} icon={<Icons.Image />} name="Livre" />
                                <FunctionButton data-function="sticker" isActive={activeCreateFunction === 'sticker'} onClick={handleCreateFunctionClick} icon={<Icons.Sticker />} name="Adesivo" />
                                <FunctionButton data-function="text" isActive={activeCreateFunction === 'text'} onClick={handleCreateFunctionClick} icon={<Icons.Type />} name="Logo" />
                                <FunctionButton data-function="comic" isActive={activeCreateFunction === 'comic'} onClick={handleCreateFunctionClick} icon={<Icons.Comic />} name="Quadrinho" />
                            </div>
                        </div>
                        <div>
                            <h2 className="text-sm font-semibold text-zinc-400 mb-3 flex items-center gap-2"><Icons.AspectRatio /> Proporção</h2>
                            <div className="grid grid-cols-5 gap-2">
                              {['1:1', '16:9', '9:16', '4:3', '3:4'].map(ratio => (
                                <button key={ratio} onClick={() => handleAspectRatioChange(ratio)} className={`py-2 text-xs font-semibold rounded-md transition-colors ${aspectRatio === ratio ? 'bg-blue-500 text-white' : 'bg-zinc-800 hover:bg-zinc-700'}`}>{ratio}</button>
                              ))}
                            </div>
                        </div>
                      </>
                    )}

                    {mode === 'edit' && (
                       <>
                        <div>
                            <h2 className="text-sm font-semibold text-zinc-400 mb-3 flex items-center gap-2"><Icons.Sliders /> Ferramentas de Edição</h2>
                            <div className="grid grid-cols-2 gap-2">
                                <FunctionButton data-function="style" isActive={activeEditFunction === 'style'} onClick={handleEditFunctionClick} icon={<Icons.Palette />} name="Estilo" />
                                <FunctionButton data-function="compose" isActive={activeEditFunction === 'compose'} onClick={handleEditFunctionClick} icon={<Icons.Layers />} name="Composição" />
                            </div>
                        </div>
                        {activeEditFunction === 'style' && (
                            <div className="pt-2">
                                <h3 className="text-sm font-semibold text-zinc-400 flex items-center gap-2 mb-3">
                                    <Icons.Contrast /> Intensidade do Estilo
                                </h3>
                                <div className="flex items-center gap-4 px-1">
                                    <input 
                                        type="range" 
                                        min="1" max="5" 
                                        step="1" 
                                        value={styleIntensity} 
                                        onChange={e => setStyleIntensity(parseInt(e.target.value, 10))} 
                                        className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer"
                                        aria-label="Intensidade do Estilo"
                                    />
                                    <span className="text-xs font-medium text-zinc-300 w-20 text-center">
                                        {['Sutil', 'Leve', 'Médio', 'Forte', 'Intenso'][styleIntensity - 1]}
                                    </span>
                                </div>
                            </div>
                        )}
                        <div className="space-y-3">
                            <h3 className="text-sm font-semibold text-zinc-400 flex items-center gap-2"><Icons.Reference /> Imagens de Referência</h3>
                           <div 
                            onDragEnter={(e) => handleDragEnter(e, 'reference')}
                            onDragLeave={handleDragLeave}
                            onDragOver={handleDragOver}
                            onDrop={(e) => handleDrop(e, 'reference')}
                            className={`p-4 border-2 border-dashed rounded-lg text-center transition-colors ${isDragging && dragTarget === 'reference' ? 'border-blue-500 bg-blue-500/10' : 'border-zinc-700 bg-transparent hover:border-zinc-600'}`}>
                            <label htmlFor="image-upload-reference" className="cursor-pointer text-xs text-zinc-400">
                               {history.length === 0 ? 'Envie a imagem principal e de referência aqui' : 'Envie imagens de referência'}<br/>
                               <span className="text-zinc-500">(Max 10MB por imagem)</span>
                            </label>
                            <input id="image-upload-reference" type="file" multiple accept="image/*" onChange={(e) => handleImageUpload(e.target.files, 'reference')} className="hidden" />
                          </div>
                          {uploadProgress.length > 0 && (
                            <div className="space-y-3 pt-2">
                                <div className="space-y-2">
                                    {uploadProgress.map(file => (
                                        <div key={file.id}>
                                            <div className="flex justify-between items-center text-xs text-zinc-400 mb-1">
                                                <span className="truncate max-w-[200px]">{file.name}</span>
                                                {file.status === 'uploading' && <span className="text-zinc-400">{file.progress}%</span>}
                                                {file.status === 'success' && <Icons.CheckCircle className="text-green-500" />}
                                                {file.status === 'error' && <Icons.AlertCircle className="text-red-500" />}
                                            </div>
                                            <div className={`w-full bg-zinc-800 rounded-full h-1.5 ${file.status === 'error' ? 'bg-red-500/30' : ''}`}>
                                                <div 
                                                    className={`h-1.5 rounded-full transition-all duration-300 ${file.status === 'error' ? 'bg-red-500' : 'bg-blue-500'}`}
                                                    style={{ width: `${file.progress}%` }}
                                                />
                                            </div>
                                            {file.status === 'error' && file.message && <p className="text-xs text-red-400 mt-1">{file.message}</p>}
                                        </div>
                                    ))}
                                </div>
                            </div>
                          )}
                          <div className="grid grid-cols-3 gap-2">
                            {referenceImages.map((ref, index) => (
                              <div key={index} className="relative group aspect-square bg-zinc-800/50 rounded">
                                {ref.maskedObjectPreviewUrl && activeEditFunction === 'compose' ? (
                                    <img 
                                        src={ref.maskedObjectPreviewUrl} 
                                        alt={`Masked object ${index}`} 
                                        className="w-full h-full object-contain rounded cursor-grab"
                                        draggable="true"
                                        onDragStart={(e) => e.dataTransfer.setData('ref-index', index.toString())}
                                    />
                                ) : (
                                    <img src={ref.previewUrl} alt={`Upload preview ${index}`} className="w-full h-full object-cover rounded" />
                                )}
                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>

                                {ref.mask && (
                                    <div className="absolute top-1 left-1 bg-green-500/80 text-white rounded-full p-0.5" title="Elemento selecionado">
                                        <Icons.CheckCircle className="w-4 h-4" style={{fontSize: '1rem'}} />
                                    </div>
                                )}

                                <button onClick={() => handleRemoveImage(index)} className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity z-10" title="Remover imagem">
                                  &times;
                                </button>
                                
                                {activeEditFunction === 'compose' && (
                                    <button onClick={() => setEditingReferenceIndex(index)} className="absolute bottom-1 left-1/2 -translate-x-1/2 bg-zinc-900/80 backdrop-blur-sm text-white rounded-full px-2 py-1 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-all z-10 hover:bg-blue-600" title="Selecionar elemento">
                                      <Icons.Select style={{fontSize: '1rem'}} />
                                    </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                       </>
                    )}

                    {history.length > 0 && (
                        <div className="space-y-3 pt-2">
                            <h3 className="text-sm font-semibold text-zinc-400 flex items-center gap-2"><Icons.History /> Histórico</h3>
                            <div className="h-48 overflow-y-auto space-y-2 pr-2">
                                {[...history].reverse().map((entry, revIndex) => {
                                    const originalIndex = history.length - 1 - revIndex;
                                    return (
                                        <div 
                                            key={entry.id} 
                                            onClick={() => handleHistoryNavigation(originalIndex)}
                                            className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-all ${
                                                originalIndex === historyIndex ? 'bg-zinc-700' : 'bg-zinc-800 hover:bg-zinc-700/70'
                                            }`}
                                        >
                                            <img src={entry.imageUrl} alt="History thumbnail" className="w-12 h-12 object-cover rounded-md flex-shrink-0" />
                                            <div className="flex-1 text-sm overflow-hidden">
                                                <p className="font-semibold text-zinc-200">{getHistoryEntryTitle(entry)}</p>
                                                <p className="text-zinc-400 truncate">{entry.prompt || (entry.mode === 'edit' ? 'Imagem base' : 'Sem prompt')}</p>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 bg-zinc-950 flex flex-col min-w-0">
                {/* Top Bar */}
                <div className="h-14 flex-shrink-0 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between px-6 z-10">
                    <div className="flex items-center gap-2">
                        <h1 className="text-md font-bold text-zinc-100">Nano Banana Studio</h1>
                         <span className="bg-zinc-800 text-zinc-300 text-xs font-semibold px-2 py-0.5 rounded-full">Beta</span>
                    </div>
                     <div className="flex items-center gap-2">
                        <button onClick={handleSaveImage} disabled={!generatedImage} className="bg-zinc-800 px-3 py-1.5 text-sm font-semibold rounded-md hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"><Icons.Save /> Salvar</button>
                        <button onClick={handleUndo} disabled={isUndoDisabled} className="bg-zinc-800 px-3 py-1.5 text-sm font-semibold rounded-md hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"><Icons.Undo /> Desfazer</button>
                        <button onClick={handleRedo} disabled={isRedoDisabled} className="bg-zinc-800 px-3 py-1.5 text-sm font-semibold rounded-md hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"><Icons.Redo /> Refazer</button>
                    </div>
                </div>
                
                {/* Canvas Area */}
                <div className="flex-1 relative min-h-0">
                    <div ref={mainContentRef} 
                         className="absolute inset-0 flex items-start justify-center p-8"
                         onDragOver={handleDragOver}
                         onDrop={handleMainCanvasDrop}
                         onDragEnter={(e) => handleDragEnter(e, 'main')}
                         onDragLeave={handleDragLeave}
                         >
                        {generatedImage ? (
                            <ImageEditor 
                                ref={editorRef} 
                                src={generatedImage}
                                isSelectionEnabled={mode === 'edit' && !isPlacingObject}
                                maskTool={maskTool}
                                brushSize={brushSize}
                                maskOpacity={maskOpacity}
                                onZoomChange={setEditorZoom}
                            />
                        ) : (
                            <div className="w-full max-w-6xl h-[700px]">
                                <div 
                                    className={`w-full h-full flex items-center justify-center transition-colors rounded-xl ${
                                    isDragging && dragTarget === 'main' ? 'bg-zinc-900/50 border-2 border-dashed border-blue-500' : 'border-2 border-dashed border-zinc-700'
                                    }`}>
                                    <label htmlFor="image-upload-main" className="cursor-pointer text-center text-zinc-500 p-8">
                                        <div className="mb-4">
                                        <Icons.UploadCloud className="mx-auto text-zinc-600 w-16 h-16" />
                                        </div>
                                        <h2 className="text-xl font-semibold text-zinc-300">
                                        {mode === 'create' ? 'Sua Arte Começa Aqui' : 'Arraste uma Imagem para Editar'}
                                        </h2>
                                        <p className="max-w-xs mt-2 text-zinc-400 text-sm">
                                            {mode === 'create' 
                                                ? 'Use o painel à esquerda para configurar e o campo abaixo para descrever sua visão.'
                                                : 'Arraste e solte uma imagem aqui ou use o painel à esquerda para começar.'
                                            }
                                        </p>
                                        <input id="image-upload-main" type="file" accept="image/*" onChange={(e) => mode === 'edit' && handleImageUpload(e.target.files, 'main')} className="hidden" />
                                    </label>
                                </div>
                            </div>
                        )}
                        {isPlacingObject && (
                            <ObjectPlacer 
                                placingObjectState={placingObjectState}
                                onTransformChange={(newTransform: any) => setPlacingObjectState((prev: any) => ({ ...prev, transform: newTransform }))}
                                onConfirm={() => {
                                    editorRef.current?.stampObjectOnMask({ 
                                        previewUrl: placingObjectState.previewUrl,
                                        transform: { placerTransform: placingObjectState.transform },
                                        maskOpacity,
                                    });
                                    setIsPlacingObject(false);
                                    setPlacingObjectState(null);
                                }}
                                onCancel={() => {
                                    setIsPlacingObject(false);
                                    setPlacingObjectState(null);
                                }}
                            />
                        )}
                         {isLoading && (
                            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center z-40 transition-opacity duration-300" aria-live="polite">
                                <Icons.Loader className="w-24 h-24 text-blue-400" />
                                <p className="text-zinc-300 font-semibold text-lg mt-6">
                                    {mode === 'create' ? 'Criando sua obra de arte...' : 'Aplicando magia na sua imagem...'}
                                </p>
                                <p className="text-zinc-400 text-sm mt-1">
                                    {mode === 'create' ? 'Isso pode demorar um pouco.' : 'Isso pode levar alguns instantes.'}
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Editor Controls Bar */}
                {generatedImage && mode === 'edit' && !isPlacingObject && (
                    <div className="flex-shrink-0 bg-zinc-900/95 backdrop-blur-sm border-t border-zinc-800 px-6 py-2 flex items-center justify-between gap-6">
                        {/* Left Group */}
                        <div className="flex items-center gap-6">
                            {/* Selection Tools Sub-Group */}
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2">
                                   <Icons.Selection className="text-zinc-400" />
                                    <span className="text-sm font-semibold text-zinc-300">Seleção:</span>
                                </div>
                                <div className="flex bg-zinc-800 p-1 rounded-md">
                                    <button onClick={() => setMaskTool('brush')} title="Pincel (B)" className={`p-1.5 rounded transition-colors ${maskTool === 'brush' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:bg-zinc-700/50'}`}>
                                        <Icons.Brush />
                                    </button>
                                    <button onClick={() => setMaskTool('eraser')} title="Borracha (E)" className={`p-1.5 rounded transition-colors ${maskTool === 'eraser' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:bg-zinc-700/50'}`}>
                                        <Icons.Eraser />
                                    </button>
                                    <button onClick={() => editorRef.current?.clearMask()} className="p-1.5 rounded text-zinc-400 hover:bg-zinc-700/50 transition-colors" title="Limpar Seleção (Esc)">
                                        <Icons.Deselect />
                                    </button>
                                </div>
                            </div>
                            {/* Sliders Sub-Group */}
                            <div className="flex items-center gap-4">
                                <Slider
                                    label="Tamanho"
                                    value={brushSize}
                                    min={5} max={100}
                                    onChange={e => {
                                        setBrushSize(parseInt(e.target.value, 10));
                                    }}
                                    aria-label="Tamanho do pincel"
                                />
                                <Slider
                                    label="Opacidade"
                                    value={maskOpacity}
                                    min={0.1} max={1} step={0.05}
                                    onChange={e => {
                                        setMaskOpacity(parseFloat(e.target.value));
                                    }}
                                    aria-label="Opacidade da máscara"
                                />
                            </div>
                        </div>

                        {/* Right Group */}
                        <div className="flex items-center gap-4">
                            {/* Zoom Sub-Group */}
                            <div className="flex items-center gap-2">
                                <button onClick={() => editorRef.current?.zoomOut()} title="Diminuir Zoom" className="p-1 rounded text-zinc-400 hover:bg-zinc-800 transition-colors">
                                    <Icons.ZoomOut />
                                </button>
                                <Slider
                                    value={editorZoom}
                                    min={20} max={500}
                                    onChange={e => editorRef.current?.setZoom(parseInt(e.target.value, 10))}
                                    aria-label="Zoom slider"
                                    sliderWidthClass="w-32"
                                />
                                <button onClick={() => editorRef.current?.zoomIn()} title="Aumentar Zoom" className="p-1 rounded text-zinc-400 hover:bg-zinc-800 transition-colors">
                                    <Icons.ZoomIn />
                                </button>
                                <span className="text-sm font-semibold text-zinc-300 min-w-[40px] text-center" title="Zoom Atual">
                                    {Math.round(editorZoom)}%
                                </span>
                            </div>
                            {/* Divider */}
                            <div className="h-6 w-px bg-zinc-700"></div>
                            {/* Fit Screen Sub-Group */}
                            <button onClick={() => editorRef.current?.zoomToFit()} title="Ajustar à Tela" className="p-1 rounded text-zinc-400 hover:bg-zinc-800 transition-colors">
                                <Icons.FitScreen />
                            </button>
                        </div>
                    </div>
                )}
                
                {/* Bottom Prompt Bar */}
                <div className="flex-shrink-0 p-4 bg-zinc-950 border-t border-zinc-800">
                    <div className="w-full max-w-4xl mx-auto">
                         {error && (
                            <div className="mb-3 p-3 bg-red-500/10 border border-red-500/20 rounded-md flex items-start space-x-3" role="alert">
                                <Icons.AlertCircle className="text-red-400 text-xl mt-0.5 flex-shrink-0" aria-hidden="true" />
                                <p className="text-sm text-red-300">{error}</p>
                            </div>
                        )}
                        <div className="relative">
                            <textarea
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                placeholder={mode === 'create' ? "Um astronauta surfando em uma onda cósmica, estilo van gogh..." : "Selecione uma área na imagem e descreva a alteração: ex. adicione óculos de sol..."}
                                className="w-full h-20 p-4 pr-32 bg-zinc-800 rounded-md text-zinc-200 placeholder-zinc-500 border border-zinc-700 focus:ring-2 focus:ring-blue-500 focus:outline-none transition resize-none"
                            />
                             <button
                                onClick={generateImageHandler}
                                disabled={isLoading || isPlacingObject}
                                className="absolute right-4 top-1/2 -translate-y-1/2 px-5 py-2.5 bg-blue-600 text-white font-bold rounded-md hover:bg-blue-500 transition-all duration-200 disabled:bg-zinc-700 disabled:text-zinc-400 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-blue-600/10 hover:shadow-xl hover:shadow-blue-500/20"
                            >
                                {isLoading ? 'Gerando...' : 'Gerar'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default App;