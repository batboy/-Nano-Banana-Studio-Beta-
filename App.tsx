import React, { useState, useCallback, ChangeEvent, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import type { Mode, CreateFunction, EditFunction, UploadedImage, HistoryEntry, UploadProgress } from './types';
import { generateImage, processImagesWithPrompt } from './services/geminiService';

const Icons = {
    Save: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>,
    Undo: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>,
    Redo: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 14 5-5-5-5"/><path d="M20 9h-10.5a5.5 5.5 0 0 0-5.5 5.5v0a5.5 5.5 0 0 0 5.5 5.5H13"/></svg>,
    // Create mode icons
    Freeform: () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/><path d="M18 5h6m-3-3v6"/><path d="M5 18l4-6 4 6H5z"/><path d="M11 18l4-4 4 4h-8z"/></svg>,
};


const FunctionCard: React.FC<{
  'data-function': string;
  isActive: boolean;
  onClick: (func: any) => void;
  icon: React.ReactNode;
  name: string;
}> = ({ 'data-function': dataFunction, isActive, onClick, icon, name }) => (
  <div
    data-function={dataFunction}
    onClick={() => onClick(dataFunction)}
    className={`function-card flex flex-col items-center justify-center p-2 border rounded-lg cursor-pointer transition-all duration-200 h-20 ${
      isActive ? 'border-gray-500 bg-gray-800 scale-105' : 'border-gray-700 bg-gray-900 hover:bg-gray-800'
    }`}
  >
    <div className="text-gray-300 mb-1">{icon}</div>
    <div className="text-xs font-semibold text-center text-gray-300">{name}</div>
  </div>
);


interface ImageEditorProps {
  src: string;
  activeEditFunction: EditFunction;
}

interface ImageEditorRef {
  getMaskData: () => UploadedImage | null;
  getOriginalImageSize: () => { width: number, height: number } | null;
}

const ImageEditor = forwardRef<ImageEditorRef, ImageEditorProps>(({ src, activeEditFunction }, ref) => {
    const imageCanvasRef = useRef<HTMLCanvasElement>(null);
    const maskCanvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const originalImageSizeRef = useRef<{ width: number, height: number }>({ width: 0, height: 0 });
    const miniMapCanvasRef = useRef<HTMLCanvasElement>(null);
    const isMiniMapPanningRef = useRef(false);

    const [isDrawing, setIsDrawing] = useState(false);
    const [maskTool, setMaskTool] = useState<'brush' | 'eraser'>('brush');
    const [maskOpacity, setMaskOpacity] = useState<number>(0.6);
    const [brushSize, setBrushSize] = useState(40);
    // FIX: Corrected useRef initialization syntax. The parenthesis was misplaced, causing a syntax error.
    const lastPositionRef = useRef<{ x: number, y: number } | null>(null);
    const [cursorPreview, setCursorPreview] = useState({ x: 0, y: 0, visible: false });
    
    const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
    const isPanningRef = useRef(false);
    const panStartRef = useRef({ x: 0, y: 0 });
    const zoomToFitScale = useRef<number>(1);
    
    const currentStrokePointsRef = useRef<{ x: number, y: number }[]>([]);

    const clearMask = () => {
        const canvas = maskCanvasRef.current;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx?.clearRect(0, 0, canvas.width, canvas.height);
        }
    };
    
    const getCoords = useCallback((e: React.MouseEvent<HTMLElement> | MouseEvent): [number, number] => {
        const container = containerRef.current;
        if (!container) return [0, 0];
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const canvasX = (x - transform.x) / transform.scale;
        const canvasY = (y - transform.y) / transform.scale;
        
        return [canvasX, canvasY];
    }, [transform.scale, transform.x, transform.y]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (activeEditFunction !== 'add-remove') return;

            if (e.key === '[') {
                e.preventDefault();
                setBrushSize(prev => Math.max(5, prev - 5));
            } else if (e.key === ']') {
                e.preventDefault();
                setBrushSize(prev => Math.min(100, prev + 5));
            }
        };

        window.addEventListener('keydown', handleKeyDown);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [activeEditFunction]);

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
        
        miniMapCtx.strokeStyle = '#9ca3af'; // gray-400
        miniMapCtx.lineWidth = 2;
        miniMapCtx.fillStyle = 'rgba(156, 163, 175, 0.2)'; // gray-400 with alpha
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
    }, [src, zoomToFit]);

    const floodFill = useCallback((canvas: HTMLCanvasElement, startX: number, startY: number, opacity: number) => {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
    
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const { width, height } = canvas;
        const data = imageData.data;
        
        const alpha = Math.round(opacity * 255);
        const fillColorRgba = [255, 255, 255, alpha];
        
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
        tempCtx.strokeStyle = `rgba(255, 255, 255, ${maskOpacity})`;
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

            if (distance < 30) {
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
            ctx.strokeStyle = `rgba(255, 255, 255, ${maskOpacity})`;
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
        getOriginalImageSize: () => {
            return originalImageSizeRef.current.width > 0 ? originalImageSizeRef.current : null;
        }
    }));
    
    const canDraw = activeEditFunction === 'add-remove';

    const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
        if (!containerRef.current) return;
        e.preventDefault();
        const rect = containerRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const zoomFactor = 1.1;
        const newScale = e.deltaY < 0 ? transform.scale * zoomFactor : transform.scale / zoomFactor;
        const clampedScale = Math.max(0.2, Math.min(newScale, 5));
        const pointX = (mouseX - transform.x) / transform.scale;
        const pointY = (mouseY - transform.y) / transform.scale;
        const newX = mouseX - pointX * clampedScale;
        const newY = mouseY - pointY * clampedScale;
        setTransform({ scale: clampedScale, x: newX, y: newY });
    };

    const handleContainerMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.button === 1) {
            e.preventDefault();
            isPanningRef.current = true;
            panStartRef.current = { x: e.clientX - transform.x, y: e.clientY - transform.y };
            if (containerRef.current) containerRef.current.style.cursor = 'grabbing';
        } else if (e.button === 0 && canDraw) {
            startDrawing(e);
        }
    };
    
    const handleContainerMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
        if (isPanningRef.current && e.button === 1) {
            isPanningRef.current = false;
            if (containerRef.current) containerRef.current.style.cursor = canDraw ? 'none' : 'grab';
        } else if (e.button === 0 && canDraw) {
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
        if (containerRef.current) containerRef.current.style.cursor = canDraw ? 'none' : 'default';
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

    const handleZoomSliderChange = (newScaleValue: number) => {
        const container = containerRef.current;
        if (!container) return;
        const { clientWidth, clientHeight } = container;

        const newScale = Math.max(0.2, Math.min(newScaleValue / 100, 5));
        
        const pointX = (clientWidth / 2 - transform.x) / transform.scale;
        const pointY = (clientHeight / 2 - transform.y) / transform.scale;
        
        const newX = clientWidth / 2 - pointX * newScale;
        const newY = clientHeight / 2 - pointY * newScale;

        setTransform({ scale: newScale, x: newX, y: newY });
    };

    useEffect(() => {
        window.addEventListener('resize', zoomToFit);
        return () => window.removeEventListener('resize', zoomToFit);
    }, [zoomToFit]);
    
    const showMiniMap = transform.scale > zoomToFitScale.current * 1.1;

    return (
        <div ref={containerRef} 
             className="w-full h-full relative overflow-hidden touch-none bg-black/20"
             onWheel={handleWheel}
             onMouseDown={handleContainerMouseDown}
             onMouseMove={handleContainerMouseMove}
             onMouseUp={handleContainerMouseUp}
             onMouseLeave={handleContainerMouseLeave}>
            <div 
                className="absolute top-0 left-0"
                style={{ 
                    transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                    transformOrigin: 'top left',
                    cursor: canDraw ? 'none' : 'grab'
                }}
            >
                <canvas ref={imageCanvasRef} className="block" />
                <canvas
                    ref={maskCanvasRef}
                    className="absolute top-0 left-0 transition-opacity duration-200"
                    style={{ opacity: canDraw ? maskOpacity : 0 }}
                />
            </div>
            {canDraw && cursorPreview.visible && (
                 <div
                    className="absolute pointer-events-none rounded-full border-2"
                    style={{
                        left: cursorPreview.x,
                        top: cursorPreview.y,
                        width: brushSize * transform.scale,
                        height: brushSize * transform.scale,
                        transform: 'translate(-50%, -50%)',
                        borderColor: 'rgba(255, 255, 255, 0.8)',
                        boxShadow: '0 0 8px rgba(0, 0, 0, 0.5)',
                        transition: 'width 0.1s ease, height 0.1s ease',
                        ...(maskTool === 'eraser' && {
                            backgroundColor: 'rgba(0, 0, 0, 0.2)'
                        })
                    }}
                />
            )}
            
            {showMiniMap && (
                <div 
                    className="absolute top-4 right-4 bg-gray-900/70 backdrop-blur-sm rounded-lg shadow-lg ring-1 ring-white/10 overflow-hidden"
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

            <div className="absolute bottom-4 inset-x-0 flex items-stretch justify-center gap-4">
                {canDraw && (
                    <div className="bg-gray-900/90 backdrop-blur-sm p-2 rounded-xl flex items-center gap-3 shadow-lg ring-1 ring-white/10">
                        <div className="flex bg-gray-950/70 p-1 rounded-md">
                            <button onClick={() => setMaskTool('brush')} title="Pincel" className={`p-2 rounded transition-colors ${maskTool === 'brush' ? 'bg-gray-700' : 'hover:bg-gray-800'}`}>
                                <span className="material-symbols-outlined text-xl">brush</span>
                            </button>
                            <button onClick={() => setMaskTool('eraser')} title="Borracha" className={`p-2 rounded transition-colors ${maskTool === 'eraser' ? 'bg-gray-700' : 'hover:bg-gray-800'}`}>
                                <span className="material-symbols-outlined text-xl">ink_eraser</span>
                            </button>
                            <button onClick={clearMask} className="p-2 rounded hover:bg-gray-800 transition-colors" title="Limpar Seleção">
                            <span className="material-symbols-outlined text-xl text-gray-400 hover:text-gray-300">deselect</span>
                            </button>
                        </div>
                        <div className="h-8 w-px bg-gray-700"></div>
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-300 whitespace-nowrap">Tamanho:</span>
                            <input type="range" min="5" max="100" value={brushSize} onChange={e => setBrushSize(parseInt(e.target.value, 10))} className="w-24" />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-300">Opacidade:</span>
                            <input type="range" min="0.1" max="1" step="0.05" value={maskOpacity} onChange={e => setMaskOpacity(parseFloat(e.target.value))} className="w-24" />
                        </div>
                    </div>
                )}
                <div className="bg-gray-900/90 backdrop-blur-sm p-2 rounded-xl flex items-center gap-2 shadow-lg ring-1 ring-white/10">
                    <button onClick={() => handleZoomSliderChange(transform.scale * 100 / 1.2)} title="Diminuir Zoom" className="p-2 rounded hover:bg-gray-800 transition-colors">
                        <span className="material-symbols-outlined text-xl">zoom_out</span>
                    </button>
                    <div className="flex items-center gap-2 w-32">
                        <input 
                            type="range" 
                            min="20"
                            max="500"
                            step="1"
                            value={transform.scale * 100}
                            onChange={e => handleZoomSliderChange(parseInt(e.target.value, 10))}
                            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                            aria-label="Zoom slider"
                        />
                    </div>
                    <button onClick={() => handleZoomSliderChange(transform.scale * 100 * 1.2)} title="Aumentar Zoom" className="p-2 rounded hover:bg-gray-800 transition-colors">
                        <span className="material-symbols-outlined text-xl">zoom_in</span>
                    </button>
                    <button onClick={() => handleZoomSliderChange(100)} className="text-sm font-semibold px-2 hover:bg-gray-800 rounded transition-colors min-w-[50px] text-center" title="Resetar Zoom (100%)">
                        {Math.round(transform.scale * 100)}%
                    </button>
                    <div className="h-8 w-px bg-gray-700"></div>
                    <button onClick={zoomToFit} title="Ajustar à Tela" className="p-2 rounded hover:bg-gray-800 transition-colors">
                        <span className="material-symbols-outlined text-xl">fit_screen</span>
                    </button>
                </div>
            </div>
        </div>
    );
});

function App() {
    const [prompt, setPrompt] = useState<string>('');
    const [mode, setMode] = useState<Mode>('create');
    const [activeCreateFunction, setActiveCreateFunction] = useState<CreateFunction>('free');
    const [activeEditFunction, setActiveEditFunction] = useState<EditFunction>('add-remove');
    const [aspectRatio, setAspectRatio] = useState<string>('1:1');
    const [styleIntensity, setStyleIntensity] = useState<number>(3);
    
    const [images, setImages] = useState<UploadedImage[]>([]);
    const [imagePreviews, setImagePreviews] = useState<string[]>([]);

    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [historyIndex, setHistoryIndex] = useState<number>(-1);
    const generatedImage = history[historyIndex]?.imageUrl ?? null;

    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    
    const [showMobileModal, setShowMobileModal] = useState<boolean>(false);
    const editorRef = useRef<ImageEditorRef>(null);

    const [isDragging, setIsDragging] = useState<boolean>(false);
    const [dragTarget, setDragTarget] = useState<'main' | 'reference' | null>(null);
    const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([]);

    const resetImages = () => {
        setImages([]);
        setImagePreviews([]);
    };

    const handleModeToggle = (newMode: Mode) => {
        if (newMode === mode) return;

        setMode(newMode);
        resetImages();
        
        if (newMode === 'create') {
            setHistory([]);
            setHistoryIndex(-1);
        } else { 
            if (generatedImage) {
                 const currentEntry = history[historyIndex];
                 setHistory([currentEntry]);
                 setHistoryIndex(0);
            } else {
                 setHistory([]);
                 setHistoryIndex(-1);
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
            setImages(entry.referenceImages || []);
            setImagePreviews(entry.referenceImagePreviews || []);
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

    const handleImageUpload = useCallback((files: FileList | null, target: 'main' | 'reference') => {
        if (!files || files.length === 0 || mode !== 'edit') return;

        let isMainImageSlotFilled = history.length > 0;
        const filesToProcess = Array.from(files);

        // If the target is the main canvas, only process the first file.
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
                        referenceImagePreviews: [],
                        styleIntensity: styleIntensity,
                    };
                    setHistory([initialEntry]);
                    setHistoryIndex(0);
                    setImages([]);
                    setImagePreviews([]);
                    isMainImageSlotFilled = true;
                } else {
                    setImages(prev => [...prev, uploadedImage]);
                    setImagePreviews(prev => [...prev, dataUrl]);
                }

                setTimeout(() => setUploadProgress(p => p.filter(item => item.id !== id)), 1500);
            };
            
            reader.readAsDataURL(file);
        });
    }, [mode, history.length, activeEditFunction, styleIntensity]);


    const handleRemoveImage = (indexToRemove: number) => {
        setImages(prev => prev.filter((_, index) => index !== indexToRemove));
        setImagePreviews(prev => prev.filter((_, index) => index !== indexToRemove));
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
        if (mode === 'edit') {
            const files = e.dataTransfer.files;
            if (files && files.length > 0) {
                handleImageUpload(files, target);
            }
        }
    };

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
                const referenceImages = images;

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
                          referenceImages: images, 
                          referenceImagePreviews: imagePreviews,
                          styleIntensity,
                        }),
                };
        
                const newHistory = history.slice(0, historyIndex + 1);
                setHistory([...newHistory, newEntry]);
                setHistoryIndex(newHistory.length);
            }

        } catch (e: any) {
            setError(e.message || 'Ocorreu um erro desconhecido.');
        } finally {
            setIsLoading(false);
        }
    }, [prompt, mode, activeCreateFunction, activeEditFunction, aspectRatio, images, imagePreviews, history, historyIndex, generatedImage, styleIntensity]);

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
            // FIX: Corrected redo logic to increment the history index instead of decrementing.
            handleHistoryNavigation(historyIndex + 1);
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
            text: 'Texto',
            comic: 'Quadrinho',
            'add-remove': 'Pincel Mágico',
            style: 'Estilo',
            compose: 'Unir',
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
        <div className="flex h-screen font-sans">
            {showMobileModal && (
                <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
                    <div className="bg-gray-900 p-8 rounded-lg text-center max-w-sm">
                        <h2 className="text-2xl font-bold mb-4">Experiência Otimizada para Desktop</h2>
                        <p>Para aproveitar todos os recursos do 🍌 Nano Banana Studio (beta), por favor, acesse em um computador ou tablet com tela maior.</p>
                    </div>
                </div>
            )}
            {/* Left Panel */}
            <div className="w-[380px] bg-gray-900 p-6 flex flex-col space-y-6 overflow-y-auto">
                <div className="flex items-center space-x-3">
                    <h1 className="text-xl font-bold text-gray-100">🍌 Nano Banana Studio</h1>
                    <span className="bg-gray-800 text-gray-300 text-xs font-semibold px-2.5 py-0.5 rounded-full">Beta</span>
                </div>

                <div className="flex space-x-2">
                    <button onClick={() => handleModeToggle('create')} className={`w-1/2 py-2 text-sm font-semibold rounded-lg ${mode === 'create' ? 'bg-gray-700 text-gray-100' : 'bg-gray-800/50 text-gray-400 hover:bg-gray-800'} transition-all`}>Criação</button>
                    <button onClick={() => handleModeToggle('edit')} className={`w-1/2 py-2 text-sm font-semibold rounded-lg ${mode === 'edit' ? 'bg-gray-700 text-gray-100' : 'bg-gray-800/50 text-gray-400 hover:bg-gray-800'} transition-all`}>Edição</button>
                </div>
                
                {mode === 'create' && (
                  <>
                    <h2 className="text-md font-semibold text-gray-400 pt-2 flex items-center gap-2"><span className="material-symbols-outlined text-xl">auto_awesome</span> Função Criativa</h2>
                    <div className="grid grid-cols-2 gap-3">
                        <FunctionCard data-function="free" isActive={activeCreateFunction === 'free'} onClick={handleCreateFunctionClick} icon={<Icons.Freeform />} name="Livre" />
                        <FunctionCard data-function="sticker" isActive={activeCreateFunction === 'sticker'} onClick={handleCreateFunctionClick} icon={<span className="material-symbols-outlined text-2xl">sticky_note_2</span>} name="Adesivo" />
                        <FunctionCard data-function="text" isActive={activeCreateFunction === 'text'} onClick={handleCreateFunctionClick} icon={<span className="material-symbols-outlined text-2xl">text_format</span>} name="Texto" />
                        <FunctionCard data-function="comic" isActive={activeCreateFunction === 'comic'} onClick={handleCreateFunctionClick} icon={<span className="material-symbols-outlined text-2xl">view_quilt</span>} name="Quadrinho" />
                    </div>

                    <h2 className="text-md font-semibold text-gray-400 pt-2 flex items-center gap-2"><span className="material-symbols-outlined text-xl">aspect_ratio</span> Proporção</h2>
                    <div className="grid grid-cols-5 gap-3">
                      {['1:1', '16:9', '9:16', '4:3', '3:4'].map(ratio => (
                        <button key={ratio} onClick={() => handleAspectRatioChange(ratio)} className={`py-2 text-sm font-semibold rounded-lg transition-colors ${aspectRatio === ratio ? 'bg-gray-700' : 'bg-gray-800 hover:bg-gray-700'}`}>{ratio}</button>
                      ))}
                    </div>
                  </>
                )}

                {mode === 'edit' && (
                   <>
                    <h2 className="text-md font-semibold text-gray-400 pt-2 flex items-center gap-2"><span className="material-symbols-outlined text-xl">tune</span> Ferramentas de Edição</h2>
                    <div className="grid grid-cols-3 gap-3">
                        <FunctionCard data-function="add-remove" isActive={activeEditFunction === 'add-remove'} onClick={handleEditFunctionClick} icon={<span className="material-symbols-outlined text-2xl">auto_fix_high</span>} name="Pincel Mágico" />
                        <FunctionCard data-function="style" isActive={activeEditFunction === 'style'} onClick={handleEditFunctionClick} icon={<span className="material-symbols-outlined text-2xl">palette</span>} name="Estilo" />
                        <FunctionCard data-function="compose" isActive={activeEditFunction === 'compose'} onClick={handleEditFunctionClick} icon={<span className="material-symbols-outlined text-2xl">extension</span>} name="Unir" />
                    </div>
                    {activeEditFunction === 'style' && (
                        <div className="space-y-3 pt-4">
                            <h3 className="text-md font-semibold text-gray-400 flex items-center gap-2">
                                <span className="material-symbols-outlined text-xl">contrast</span> Intensidade do Estilo
                            </h3>
                            <div className="flex items-center gap-4 px-1">
                                <input 
                                    type="range" 
                                    min="1" max="5" 
                                    step="1" 
                                    value={styleIntensity} 
                                    onChange={e => setStyleIntensity(parseInt(e.target.value, 10))} 
                                    className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                                    aria-label="Intensidade do Estilo"
                                />
                                <span className="text-sm font-medium text-gray-300 w-24 text-center">
                                    {['Sutil', 'Leve', 'Médio', 'Forte', 'Intenso'][styleIntensity - 1]}
                                </span>
                            </div>
                        </div>
                    )}
                   </>
                )}

                <div className="flex-grow flex flex-col space-y-4 pt-2">
                    <h2 className="text-md font-semibold text-gray-400 flex items-center gap-2"><span className="material-symbols-outlined text-xl">subject</span> Instruções</h2>
                    <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder={mode === 'create' ? "Ex: Um astronauta surfando..." : "Ex: Adicione óculos de sol no gato..."}
                        className="w-full h-32 p-3 bg-gray-800 rounded-lg text-gray-200 placeholder-gray-500 border border-gray-700 focus:ring-2 focus:ring-amber-500 focus:outline-none transition"
                    />
                  
                  {mode === 'edit' && (
                    <div className="space-y-3">
                        <h3 className="text-md font-semibold text-gray-400 flex items-center gap-2"><span className="material-symbols-outlined text-xl">photo_library</span> Imagens de Referência</h3>
                       <div 
                        onDragEnter={(e) => handleDragEnter(e, 'reference')}
                        onDragLeave={handleDragLeave}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, 'reference')}
                        className={`p-4 border-2 border-dashed rounded-lg text-center transition-colors ${isDragging && dragTarget === 'reference' ? 'border-gray-500 bg-gray-800/50' : 'border-gray-700 bg-transparent hover:border-gray-600'}`}>
                        <label htmlFor="image-upload-reference" className="cursor-pointer text-sm text-gray-400">
                           {history.length === 0 ? 'Envie a imagem principal e de referência aqui' : 'Envie imagens de referência'}<br/>
                           <span className="text-xs text-gray-500">(Max 10MB por imagem)</span>
                        </label>
                        <input id="image-upload-reference" type="file" multiple accept="image/*" onChange={(e) => handleImageUpload(e.target.files, 'reference')} className="hidden" />
                      </div>
                      {uploadProgress.length > 0 && (
                        <div className="space-y-3 pt-2">
                            <div className="space-y-2">
                                {uploadProgress.map(file => (
                                    <div key={file.id}>
                                        <div className="flex justify-between items-center text-xs text-gray-400 mb-1">
                                            <span className="truncate max-w-[200px]">{file.name}</span>
                                            {file.status === 'uploading' && <span className="text-gray-400">{file.progress}%</span>}
                                            {file.status === 'success' && <span className="material-symbols-outlined text-gray-400 text-base">check_circle</span>}
                                            {file.status === 'error' && <span className="material-symbols-outlined text-gray-400 text-base">error</span>}
                                        </div>
                                        <div className="w-full bg-gray-800 rounded-full h-1.5">
                                            <div 
                                                className="h-1.5 rounded-full bg-gray-500 transition-all duration-300"
                                                style={{ width: file.status === 'error' ? '100%' : `${file.progress}%` }}
                                            />
                                        </div>
                                        {file.status === 'error' && file.message && <p className="text-xs text-gray-400 mt-1">{file.message}</p>}
                                    </div>
                                ))}
                            </div>
                        </div>
                      )}
                      <div className="grid grid-cols-5 gap-2">
                        {imagePreviews.map((src, index) => (
                          <div key={index} className="relative group aspect-square">
                            <img src={src} alt={`Upload preview ${index}`} className="w-full h-full object-cover rounded" />
                            <button onClick={() => handleRemoveImage(index)} className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                              &times;
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                    {history.length > 0 && (
                        <div className="space-y-3 pt-2">
                            <h3 className="text-md font-semibold text-gray-400 flex items-center gap-2"><span className="material-symbols-outlined text-xl">history</span> Histórico</h3>
                            <div className="h-36 overflow-y-auto space-y-2 pr-2">
                                {[...history].reverse().map((entry, revIndex) => {
                                    const originalIndex = history.length - 1 - revIndex;
                                    return (
                                        <div 
                                            key={entry.id} 
                                            onClick={() => handleHistoryNavigation(originalIndex)}
                                            className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-all ${
                                                originalIndex === historyIndex ? 'bg-gray-700' : 'bg-gray-800 hover:bg-gray-700/70'
                                            }`}
                                        >
                                            <img src={entry.imageUrl} alt="History thumbnail" className="w-12 h-12 object-cover rounded-md flex-shrink-0" />
                                            <div className="flex-1 text-sm overflow-hidden">
                                                <p className="font-semibold text-gray-200">{getHistoryEntryTitle(entry)}</p>
                                                <p className="text-gray-400 truncate">{entry.prompt || (entry.mode === 'edit' ? 'Imagem base' : 'Sem prompt')}</p>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}

                </div>
                 
                <button
                    onClick={generateImageHandler}
                    disabled={isLoading}
                    className="w-full py-3 bg-amber-500 text-gray-900 font-bold rounded-lg hover:bg-amber-400 transition-all duration-200 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed flex items-center justify-center shadow-lg shadow-amber-500/10 hover:shadow-xl hover:shadow-amber-500/20"
                >
                    {isLoading && mode === 'create' ? (
                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                    ) : 'Gerar Imagem'}
                </button>
                {error && <p className="text-sm text-gray-300 text-center">{error}</p>}

            </div>

            {/* Right Panel */}
            <div className="flex-1 bg-black flex flex-col items-center justify-center p-8 relative">
                <div className="absolute top-10 left-10 flex items-center gap-2 z-10">
                    <button onClick={handleSaveImage} disabled={!generatedImage} className="bg-gray-900 px-3 py-2 text-sm font-semibold rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"><Icons.Save /> Salvar</button>
                    <button onClick={handleUndo} disabled={isUndoDisabled} className="bg-gray-900 px-3 py-2 text-sm font-semibold rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"><Icons.Undo /> Desfazer</button>
                    <button onClick={handleRedo} disabled={isRedoDisabled} className="bg-gray-900 px-3 py-2 text-sm font-semibold rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"><Icons.Redo /> Refazer</button>
                </div>

                <div className="relative w-full h-full">
                    <div className="w-full h-full flex items-center justify-center overflow-hidden">
                        {generatedImage ? (
                            <ImageEditor 
                              ref={editorRef} 
                              src={generatedImage}
                              activeEditFunction={activeEditFunction}
                            />
                        ) : (
                             <div 
                                onDragEnter={(e) => handleDragEnter(e, 'main')}
                                onDragLeave={handleDragLeave}
                                onDragOver={handleDragOver}
                                onDrop={(e) => handleDrop(e, 'main')}
                                className={`w-full h-full flex items-center justify-center transition-colors rounded-xl ${
                                  isDragging && dragTarget === 'main' ? 'bg-gray-900/50 border-2 border-dashed border-gray-500' : 'border-2 border-dashed border-gray-700'
                                }`}>
                                <label htmlFor="image-upload-main" className="cursor-pointer text-center text-gray-500 p-8">
                                    <div className="mb-4">
                                       <span className="material-symbols-outlined text-gray-600" style={{ fontSize: 64 }}>add_photo_alternate</span>
                                    </div>
                                    <h2 className="text-2xl font-semibold text-gray-300">
                                      {mode === 'create' ? 'Sua Arte Começa Aqui' : 'Sua Imagem Principal'}
                                    </h2>
                                    <p className="max-w-xs mt-2 text-gray-400">
                                        {mode === 'create' 
                                            ? 'Use o painel à esquerda para descrever sua visão e dar vida às suas ideias.'
                                            : 'Arraste e solte uma imagem aqui ou use o painel à esquerda para começar a editar.'
                                        }
                                    </p>
                                    <input id="image-upload-main" type="file" accept="image/*" onChange={(e) => mode === 'edit' && handleImageUpload(e.target.files, 'main')} className="hidden" />
                                 </label>
                            </div>
                        )}
                    </div>
                     {isLoading && mode === 'edit' && (
                        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center rounded-xl z-20 transition-opacity duration-300" aria-live="polite">
                            <svg className="animate-spin h-10 w-10 text-gray-400 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <p className="text-gray-300 font-semibold text-lg">Aplicando magia na sua imagem...</p>
                            <p className="text-gray-400 text-sm mt-1">Isso pode levar alguns instantes.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default App;
