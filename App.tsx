import React, { useState, useCallback, useEffect, useRef } from 'react';
// FIX: Import `EditHistoryEntry` to resolve a type error when creating a new history entry for an edit operation.
import type { Mode, CreateFunction, UploadedImage, HistoryEntry, UploadProgress, VideoFunction, CreateState, VideoState, EditState, EditFunction, ReferenceLayer, EditHistoryEntry } from './types';
import { generateImage, generateVideo, editImage } from './services/geminiService';
import * as Icons from './Icons';

// --- Constants ---
const ALL_SUPPORTED_ASPECT_RATIOS = [
    { label: 'Quadrado', options: ['1:1'] },
    { label: 'Paisagem (Horizontal)', options: ['16:9', '4:3'] },
    { label: 'Retrato (Vertical)', options: ['9:16', '3:4'] },
];
const IMAGE_RESOLUTIONS = [
    { value: '1K', label: '1K (Padrão)' },
    { value: '2K', label: '2K (Alta Definição)' },
    { value: '4K', label: '4K (Ultra HD)' },
];
const VIDEO_RESOLUTIONS = [
    { value: '720p', label: '720p (HD)' },
    { value: '1080p', label: '1080p (Full HD)' },
];

const CREATE_FUNCTIONS: { id: CreateFunction, name: string, icon: React.ReactNode }[] = [
    { id: 'free', name: 'Livre', icon: <Icons.Image /> }, { id: 'sticker', name: 'Sticker', icon: <Icons.Sticker /> },
    { id: 'text', name: 'Texto / Logo', icon: <Icons.Type /> }, { id: 'comic', name: 'HQ', icon: <Icons.Comic /> },
];
const EDIT_FUNCTIONS: { id: EditFunction, name: string, icon: React.ReactNode }[] = [
    { id: 'montage', name: 'Montagem', icon: <Icons.Montage /> },
];
const VIDEO_FUNCTIONS: { id: VideoFunction, name: string, icon: React.ReactNode }[] = [
    { id: 'prompt', name: 'Prompt de Vídeo', icon: <Icons.Prompt /> }, { id: 'animation', name: 'Animar Imagem', icon: <Icons.Start /> },
];
const STYLE_OPTIONS: Record<Exclude<CreateFunction, 'montage'>, { value: string, label: string }[]> = {
    free: [],
    sticker: [ { value: 'cartoon', label: 'Desenho' }, { value: 'vintage', label: 'Vintage' }, { value: 'holographic', label: 'Holográfico' }, { value: 'embroidered patch', label: 'Bordado' } ],
    text: [ { value: 'minimalist', label: 'Minimalista' }, { value: 'corporate', label: 'Corporativo' }, { value: 'playful', label: 'Divertido' }, { value: 'geometric', label: 'Geométrico' } ],
    comic: [ { value: 'American comic book', label: 'Americano' }, { value: 'Japanese manga', label: 'Mangá' }, { value: 'franco-belgian comics (bande dessinée)', label: 'Franco-Belga' } ],
};
const CAMERA_ANGLE_OPTIONS = [ { value: 'default', label: 'Padrão' }, { value: 'eye-level', label: 'Nível do Olhar' }, { value: 'close-up', label: 'Close-up' }, { value: 'low angle', label: 'Ângulo Baixo' }, { value: 'high angle (bird\'s-eye view)', label: 'Plano Alto' }, { value: 'wide shot (long shot)', label: 'Plano Geral' } ];
const LIGHTING_STYLE_OPTIONS = [ { value: 'default', label: 'Padrão' }, { value: 'cinematic', label: 'Cinemática' }, { value: 'soft', label: 'Luz Suave' }, { value: 'dramatic', label: 'Dramática' }, { value: 'studio', label: 'Estúdio' }, { value: 'natural', label: 'Natural' } ];

const INITIAL_CREATE_STATE: CreateState = { createFunction: 'free', aspectRatio: '1:1', resolution: '1K', negativePrompt: '', styleModifier: 'default', cameraAngle: 'default', lightingStyle: 'default', comicColorPalette: 'vibrant' };
const INITIAL_VIDEO_STATE: VideoState = { videoFunction: 'prompt', videoResolution: '720p', startFrame: null, startFramePreviewUrl: null };
const INITIAL_EDIT_STATE: EditState = { editFunction: 'montage', background: null, backgroundPreviewUrl: null, references: [], activeReferenceId: null, negativePrompt: '' };

type PreMontageState = {
    background: UploadedImage | null;
    backgroundPreviewUrl: string | null;
    references: ReferenceLayer[];
} | null;

// --- Custom Hooks ---
const useAutoResizeTextarea = (value: string) => {
    const ref = useRef<HTMLTextAreaElement>(null);
    useEffect(() => {
        const textarea = ref.current;
        if (textarea) {
            textarea.style.height = 'auto';
            textarea.style.height = `${textarea.scrollHeight}px`;
        }
    }, [value]);
    return ref;
};

// --- Child Components ---
const ToolbarButton: React.FC<{ 'data-function': string; isActive: boolean; onClick: (func: any) => void; icon: React.ReactNode; name: string; }> = ({ 'data-function': dataFunction, isActive, onClick, icon, name }) => (
    <button 
        data-function={dataFunction} 
        onClick={() => onClick(dataFunction)} 
        title={name} 
        className={`relative flex items-center justify-center p-3 rounded-xl cursor-pointer transition-all duration-300 w-full aspect-square group ${isActive ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-lg shadow-blue-900/20 scale-105' : 'hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
    >
        {icon}
        {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 bg-white rounded-r-full shadow-[0_0_10px_rgba(255,255,255,0.5)]"></div>}
    </button>
);

const PanelSection: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; className?: string; }> = ({ title, icon, children, defaultOpen = true, className }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    return (
        <div className={`border-b border-zinc-800/50 ${className ?? ''}`.trim()}>
            <button onClick={() => setIsOpen(!isOpen)} className="w-full flex items-center justify-between p-3 text-xs font-bold text-zinc-300 hover:bg-zinc-800/30 transition-colors" aria-expanded={isOpen} title={`Expandir/recolher ${title}`}>
                <div className="flex items-center gap-2 text-blue-400">{icon}<span className="uppercase tracking-wider text-zinc-300">{title}</span></div>
                <Icons.ChevronDown className={`transition-transform duration-200 text-base ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && <div className="p-3 space-y-4 animate-fadeIn">{children}</div>}
        </div>
    );
};

const ImageUploadSlot: React.FC<{ id: string; label: string; icon: React.ReactNode; imagePreviewUrl: string | null; onUpload: (file: File) => void; onRemove?: () => void; className?: string; isMultiple?: boolean; }> = ({ id, label, icon, imagePreviewUrl, onUpload, onRemove, className = '', isMultiple = false }) => {
    const [isDragging, setIsDragging] = useState(false);
    const dragCounter = useRef(0);
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files) { Array.from(e.target.files).forEach(onUpload); e.target.value = ''; } };
    const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); dragCounter.current++; setIsDragging(true); };
    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); dragCounter.current--; if (dragCounter.current === 0) setIsDragging(false); };
    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); dragCounter.current = 0; if (e.dataTransfer.files) Array.from(e.dataTransfer.files).forEach(onUpload); };

    if (imagePreviewUrl && onRemove) {
        return (
            <div className={`relative group w-full h-full bg-zinc-900 border border-zinc-700 rounded-lg overflow-hidden ${className}`}>
                <div className="absolute inset-0 flex items-center justify-center p-1 min-w-0 min-h-0">
                    <img src={imagePreviewUrl} alt={label} className="max-w-full max-h-full object-contain min-w-0" />
                </div>
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 backdrop-blur-sm">
                    <button onClick={onRemove} className="p-2 bg-zinc-800 text-red-400 rounded-full hover:bg-zinc-700 transition-colors border border-zinc-600" title="Remover Imagem"><Icons.Close /></button>
                </div>
            </div>
        );
    }

    return (
        <div onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={(e) => e.preventDefault()} onDrop={handleDrop} className={`w-full h-full border-2 rounded-lg transition-all duration-200 flex ${className} ${isDragging ? 'border-blue-500 bg-blue-500/10 border-solid scale-[0.98]' : 'border-zinc-700 border-dashed hover:border-zinc-500 hover:bg-zinc-800/50'}`}>
            <input type="file" id={id} className="hidden" accept="image/png, image/jpeg, image/webp" onChange={handleFileChange} multiple={isMultiple} />
            <label htmlFor={id} className="cursor-pointer flex flex-col items-center justify-center h-full w-full text-center p-2 text-zinc-500 hover:text-zinc-300 transition-colors">
                <div className="mb-2 p-2 bg-zinc-800 rounded-full">{icon}</div>
                <span className="text-xs font-semibold">{label}</span>
            </label>
        </div>
    );
};


const HistoryCard: React.FC<{ entry: HistoryEntry; index: number; isActive: boolean; onClick: (index: number) => void; }> = ({ entry, index, isActive, onClick }) => (
    <button
        key={entry.id}
        onClick={() => onClick(index)}
        className={`relative w-full aspect-square rounded-lg overflow-hidden ring-2 transition-all duration-200 ${isActive ? 'ring-blue-500 scale-95 shadow-md' : 'ring-transparent hover:ring-zinc-600 hover:scale-[0.98]'}`}
        aria-label={`Histórico item ${index + 1}`}
    >
        {(entry.mode === 'create' || entry.mode === 'edit') && <img src={entry.imageUrl} alt={entry.prompt} className="w-full h-full object-cover" />}
        {entry.mode === 'video' && (
            entry.startFramePreviewUrl ? (
                <img src={entry.startFramePreviewUrl} alt={entry.prompt} className="w-full h-full object-cover" />
            ) : (
                <div className="w-full h-full bg-zinc-900 flex items-center justify-center flex-col gap-1">
                    <Icons.Video className="text-zinc-600 text-2xl" />
                    <span className="text-[10px] text-zinc-600 font-mono">VEO 3.1</span>
                </div>
            )
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent opacity-60"></div>
        <span className="absolute bottom-1 right-1 text-[10px] font-bold text-white bg-zinc-900/80 px-1.5 py-0.5 rounded border border-zinc-700">{index + 1}</span>
    </button>
);


// --- Sidebar Component ---
const Sidebar: React.FC<{
    mode: Mode;
    createState: CreateState;
    setCreateState: React.Dispatch<React.SetStateAction<CreateState>>;
    videoState: VideoState;
    setVideoState: React.Dispatch<React.SetStateAction<VideoState>>;
    editState: EditState;
    setEditState: React.Dispatch<React.SetStateAction<EditState>>;
    prompt: string;
    setPrompt: (p: string) => void;
    isLoading: boolean;
    error: string | null;
    setError: (e: string | null) => void;
    history: HistoryEntry[];
    historyIndex: number;
    handleHistoryNavigation: (index: number) => void;
    handleSubmit: (e: React.FormEvent) => void;
    processSingleFile: (file: File, callback: (image: UploadedImage, previewUrl: string) => void) => void;
    preMontageState: PreMontageState;
    setPreMontageState: (state: PreMontageState) => void;
}> = (props) => {
    const { mode, createState, setCreateState, videoState, setVideoState, editState, setEditState, prompt, setPrompt, isLoading, error, setError, history, historyIndex, handleHistoryNavigation, handleSubmit, processSingleFile } = props;

    const textareaRef = useAutoResizeTextarea(prompt);
    
    const negativePromptValue = mode === 'create' ? createState.negativePrompt : (mode === 'edit' ? editState.negativePrompt : '');
    const negativeTextareaRef = useAutoResizeTextarea(negativePromptValue);
    const handleNegativePromptChange = (value: string) => {
        if (mode === 'create') setCreateState(s => ({ ...s, negativePrompt: value }));
        else if (mode === 'edit') setEditState(s => ({ ...s, negativePrompt: value }));
    };

    const renderCreateControls = () => {
        const { createFunction, aspectRatio, resolution, styleModifier, cameraAngle, lightingStyle, comicColorPalette } = createState;
        return (
            <div className="space-y-4">
                <div className="bg-zinc-900/50 p-2 rounded-lg border border-zinc-800">
                     <label className="block text-xs font-medium text-blue-400 mb-1.5">Qualidade (Gemini 3)</label>
                     <div className="custom-select-wrapper">
                        <select value={resolution} onChange={(e) => setCreateState(s => ({ ...s, resolution: e.target.value as any }))} className="custom-select !bg-zinc-900 !border-zinc-700 focus:!border-blue-500" aria-label="Resolução">
                            {IMAGE_RESOLUTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                        </select>
                    </div>
                </div>

                {STYLE_OPTIONS[createFunction].length > 0 && (
                    <div>
                        <label className="block text-xs font-medium text-zinc-400 mb-1">Estilo</label>
                        <div className="custom-select-wrapper">
                            <select value={styleModifier} onChange={(e) => setCreateState(s => ({ ...s, styleModifier: e.target.value }))} className="custom-select" aria-label="Estilo">
                                <option value="default" disabled>Selecione um Estilo</option>
                                {STYLE_OPTIONS[createFunction].map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                            </select>
                        </div>
                    </div>
                )}
                 <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">Proporção</label>
                    <div className="custom-select-wrapper">
                        <select value={aspectRatio} onChange={(e) => setCreateState(s => ({ ...s, aspectRatio: e.target.value }))} className="custom-select" aria-label="Proporção">
                            {ALL_SUPPORTED_ASPECT_RATIOS.map((group) => (
                                <optgroup label={group.label} key={group.label}>{group.options.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}</optgroup>
                            ))}
                        </select>
                    </div>
                </div>
                {(createFunction === 'free' || createFunction === 'comic') && (
                    <div className="grid grid-cols-2 gap-3 pt-2 border-t border-zinc-800/50">
                        <div className="col-span-2">
                            <label className="block text-xs font-medium text-zinc-400 mb-1">Iluminação</label>
                            <div className="custom-select-wrapper"><select value={lightingStyle} onChange={(e) => setCreateState(s => ({ ...s, lightingStyle: e.target.value }))} className="custom-select" aria-label="Iluminação">{LIGHTING_STYLE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></div>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-zinc-400 mb-1">Ângulo</label>
                            <div className="custom-select-wrapper"><select value={cameraAngle} onChange={(e) => setCreateState(s => ({ ...s, cameraAngle: e.target.value }))} className="custom-select" aria-label="Ângulo da Câmera">{CAMERA_ANGLE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></div>
                        </div>
                        {createFunction === 'comic' && (
                           <div>
                               <label className="block text-xs font-medium text-zinc-400 mb-1">Paleta</label>
                               <div className="flex items-center h-[calc(100%-1.125rem)] gap-1 bg-zinc-800 p-1 rounded-md">
                                   <button onClick={() => setCreateState(s => ({ ...s, comicColorPalette: 'vibrant' }))} className={`w-1/2 text-center text-xs font-semibold py-1 rounded transition-colors ${comicColorPalette === 'vibrant' ? 'bg-zinc-600 text-white' : 'hover:bg-zinc-700 text-zinc-300'}`}>Vibrante</button>
                                   <button onClick={() => setCreateState(s => ({ ...s, comicColorPalette: 'noir' }))} className={`w-1/2 text-center text-xs font-semibold py-1 rounded transition-colors ${comicColorPalette === 'noir' ? 'bg-zinc-600 text-white' : 'hover:bg-zinc-700 text-zinc-300'}`}>Noir</button>
                               </div>
                           </div>
                       )}
                    </div>
                )}
            </div>
        );
    };

    const handleAddReference = (image: UploadedImage, previewUrl: string) => {
        const newRef: ReferenceLayer = {
            id: `ref-${Date.now()}`,
            image,
            previewUrl,
            x: 50, y: 50,
            width: 200, height: 200,
            rotation: 0,
            zIndex: editState.references.length,
        };
        setEditState(s => ({ ...s, references: [...s.references, newRef], activeReferenceId: newRef.id }));
    };

    const handleRemoveReference = (id: string) => {
        setEditState(s => ({...s, references: s.references.filter(r => r.id !== id) }));
    }

    const handleBringToFront = (id: string) => {
        const maxZ = Math.max(-1, ...editState.references.map(r => r.zIndex));
        setEditState(s => ({
            ...s,
            references: s.references.map(r => r.id === id ? { ...r, zIndex: maxZ + 1 } : r)
        }));
    };

    const renderEditControls = () => {
        const { backgroundPreviewUrl, references } = editState;
        const handleBackgroundUpload = (file: File) => {
            processSingleFile(file, (img, url) => {
                setEditState(s => ({ ...s, background: img, backgroundPreviewUrl: url, references: [] }));
            });
        };
        const handleBackgroundRemove = () => {
            setEditState(s => ({ ...s, background: null, backgroundPreviewUrl: null, references: [] }));
        };
        
        return (
             <div className="space-y-4">
                <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">Imagens de Base</label>
                    <div className="flex items-stretch gap-3 h-24">
                        <div className="w-1/2">
                            <ImageUploadSlot id="bg-upload" label="Fundo" icon={<Icons.Wallpaper className="text-2xl" />} imagePreviewUrl={backgroundPreviewUrl} onUpload={handleBackgroundUpload} onRemove={handleBackgroundRemove} className="h-full" />
                        </div>
                        <div className="w-1/2">
                            <ImageUploadSlot id="ref-upload" label="Referência" icon={<Icons.AddPhoto className="text-2xl" />} imagePreviewUrl={null} onUpload={(file) => processSingleFile(file, handleAddReference)} className="h-full" isMultiple={true}/>
                        </div>
                    </div>
                </div>
                
                {references.length > 0 && (
                    <div className="space-y-2">
                        <h4 className="text-xs font-medium text-zinc-400">Camadas</h4>
                        <ul className="max-h-32 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                            {references.slice().sort((a,b) => b.zIndex - a.zIndex).map(ref => (
                                <li key={ref.id} className={`flex items-center gap-2 p-1.5 rounded-md transition-colors border border-transparent ${editState.activeReferenceId === ref.id ? 'bg-blue-900/30 border-blue-800' : 'bg-zinc-800 hover:bg-zinc-700'}`}>
                                    <img src={ref.previewUrl} className="w-8 h-8 object-cover rounded bg-zinc-950" alt="ref thumbnail"/>
                                    <span className="flex-1 text-xs text-zinc-300 truncate">Camada {ref.zIndex}</span>
                                    <button onClick={() => handleBringToFront(ref.id)} title="Trazer para frente" className="p-1 hover:bg-zinc-600 rounded text-zinc-400 hover:text-zinc-200"><Icons.BringToFront className="!text-base" /></button>
                                    <button onClick={() => handleRemoveReference(ref.id)} title="Remover" className="p-1 text-zinc-500 hover:text-red-400 hover:bg-zinc-600 rounded"><Icons.Delete className="!text-base" /></button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        )
    };
    
    return (
        <aside className="app-sidebar bg-zinc-950 border-l border-zinc-800 flex flex-col overflow-hidden shadow-xl z-10">
            <div className="flex-1 overflow-y-auto min-h-0 custom-scrollbar">
                <PanelSection title="Configurações" icon={<Icons.Settings />} defaultOpen={true}>
                    {mode === 'create' && renderCreateControls()}
                    {mode === 'edit' && renderEditControls()}
                    {mode === 'video' && (
                        <div className="space-y-4">
                             <div className="bg-zinc-900/50 p-2 rounded-lg border border-zinc-800">
                                <label className="block text-xs font-medium text-blue-400 mb-1.5">Qualidade (Veo 3.1)</label>
                                <div className="custom-select-wrapper">
                                    <select value={videoState.videoResolution} onChange={(e) => setVideoState(s => ({ ...s, videoResolution: e.target.value as any }))} className="custom-select !bg-zinc-900 !border-zinc-700 focus:!border-blue-500" aria-label="Resolução de Vídeo">
                                        {VIDEO_RESOLUTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                    </select>
                                </div>
                            </div>
                            {videoState.videoFunction === 'animation' && (
                                <div className="h-32">
                                    <ImageUploadSlot id="start-frame-upload" label="Imagem Inicial" icon={<Icons.UploadCloud className="text-3xl" />} imagePreviewUrl={videoState.startFramePreviewUrl} onUpload={(file) => processSingleFile(file, (img, url) => setVideoState(s => ({ ...s, startFrame: img, startFramePreviewUrl: url })))} onRemove={() => setVideoState(s => ({ ...s, startFrame: null, startFramePreviewUrl: null }))} className="h-full" />
                                </div>
                            )}
                        </div>
                    )}
                </PanelSection>
                {history.length > 0 && (
                     <PanelSection title="Histórico" icon={<Icons.History />} defaultOpen={true}>
                         <div className="grid grid-cols-4 gap-2">
                             {history.map((entry, index) => (
                                 <HistoryCard 
                                    key={entry.id}
                                    entry={entry}
                                    index={index}
                                    isActive={index === historyIndex}
                                    onClick={handleHistoryNavigation}
                                 />
                             ))}
                         </div>
                     </PanelSection>
                 )}
            </div>
            <div className="shrink-0 border-t border-zinc-800 bg-zinc-900/50 p-3 space-y-3">
                {(mode === 'create' || mode === 'edit') && (
                    <div className="relative">
                        <div className="absolute -top-2 left-2 bg-zinc-950 px-1 text-[10px] font-bold text-zinc-500">NEGATIVO</div>
                         <textarea ref={negativeTextareaRef} value={negativePromptValue} onChange={(e) => handleNegativePromptChange(e.target.value)} placeholder="O que evitar..." rows={1} className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-300 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-red-900 focus:border-red-900 resize-none transition-all" disabled={isLoading} />
                    </div>
                )}
                <div>
                     <form onSubmit={handleSubmit} className="space-y-3">
                        <textarea ref={textareaRef} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={ mode === 'create' ? "Descreva sua imaginação em detalhes..." : (mode === 'edit' ? "Descreva as alterações..." : "Descreva a cena do vídeo...") } rows={3} className="w-full bg-zinc-800 rounded-lg p-3 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-600/50 resize-none transition-shadow shadow-inner" disabled={isLoading} />
                         <button type="submit" disabled={isLoading || (mode === 'edit' && editState.references.length > 0) || !prompt.trim()} className="w-full flex items-center justify-center gap-2 py-3 px-3 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-lg text-white font-bold hover:from-blue-500 hover:to-indigo-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-900/30 active:scale-[0.98]">
                             {isLoading ? <Icons.Spinner /> : <Icons.Sparkles className="!text-lg" />}<span>{mode === 'create' ? 'Gerar 3.0' : (mode === 'video' ? 'Gerar Veo' : 'Editar')}</span>
                         </button>
                    </form>
                     {error && <div className="mt-2 p-2 bg-red-950/50 border border-red-900/50 text-red-300 text-xs rounded-lg flex items-start gap-2 animate-fadeIn"><Icons.AlertCircle className="shrink-0 mt-0.5 !text-base text-red-500" /><span>{error}</span><button onClick={() => setError(null)} className="ml-auto p-0.5 text-red-400 hover:text-white"><Icons.Close className="!text-base" /></button></div>}
                </div>
            </div>
        </aside>
    );
};

// --- Interactive Canvas Components ---
const ReferenceItem: React.FC<{
    item: ReferenceLayer;
    isSelected: boolean;
    onSelect: (id: string, e: React.MouseEvent) => void;
    onUpdate: (id: string, updates: Partial<ReferenceLayer>) => void;
}> = ({ item, isSelected, onSelect, onUpdate }) => {
    const ref = useRef<HTMLDivElement>(null);
    // Use a ref to hold the latest item state to avoid stale closures in event listeners
    const itemStateRef = useRef(item);
    useEffect(() => {
        itemStateRef.current = item;
    }, [item]);

    // Effect for handling dragging logic
    useEffect(() => {
        const handle = ref.current;
        if (!isSelected || !handle) return;

        const onDragMouseDown = (e: MouseEvent) => {
            // Do not start a drag if a resize handle was the target
            if ((e.target as HTMLElement).dataset.resizeHandle) return;
            e.stopPropagation();

            const startMouse = { x: e.clientX, y: e.clientY };
            const initialPos = { x: itemStateRef.current.x, y: itemStateRef.current.y };
            
            const onDragMouseMove = (moveEvent: MouseEvent) => {
                const dx = moveEvent.clientX - startMouse.x;
                const dy = moveEvent.clientY - startMouse.y;
                onUpdate(itemStateRef.current.id, { x: initialPos.x + dx, y: initialPos.y + dy });
            };

            const onDragMouseUp = () => {
                window.removeEventListener('mousemove', onDragMouseMove);
                window.removeEventListener('mouseup', onDragMouseUp);
            };

            window.addEventListener('mousemove', onDragMouseMove);
            window.addEventListener('mouseup', onDragMouseUp);
        };
        
        handle.addEventListener('mousedown', onDragMouseDown);
        
        return () => {
            handle.removeEventListener('mousedown', onDragMouseDown);
        };
    }, [isSelected, onUpdate]);

    // Handler for starting a resize operation
    const handleResizeMouseDown = (e: React.MouseEvent, handleName: string) => {
        e.stopPropagation();
        e.preventDefault();

        const startMouse = { x: e.clientX, y: e.clientY };
        const { x, y, width, height } = itemStateRef.current;
        const aspectRatio = width / height;

        const onResizeMouseMove = (moveEvent: MouseEvent) => {
            const dx = moveEvent.clientX - startMouse.x;
            const dy = moveEvent.clientY - startMouse.y;
            const updates: Partial<ReferenceLayer> = {};

            let newWidth: number;

            // Determine new width based on the primary axis of mouse movement to feel natural
            if (Math.abs(dx) > Math.abs(dy)) {
                newWidth = width + (handleName.includes('w') ? -dx : dx);
            } else {
                const heightChange = height + (handleName.includes('n') ? -dy : dy);
                newWidth = heightChange * aspectRatio;
            }
            
            newWidth = Math.max(20, newWidth);
            const newHeight = newWidth / aspectRatio;
            
            updates.width = newWidth;
            updates.height = newHeight;

            // Adjust position for handles on the top or left edges
            if (handleName.includes('n')) {
                updates.y = y + (height - newHeight);
            }
            if (handleName.includes('w')) {
                updates.x = x + (width - newWidth);
            }
            
            onUpdate(itemStateRef.current.id, updates);
        };

        const onResizeMouseUp = () => {
            window.removeEventListener('mousemove', onResizeMouseMove);
            window.removeEventListener('mouseup', onResizeMouseUp);
        };

        window.addEventListener('mousemove', onResizeMouseMove);
        window.addEventListener('mouseup', onResizeMouseUp);
    };

    const resizeHandles = [
        { name: 'nw', className: 'cursor-nwse-resize -top-1.5 -left-1.5' },
        { name: 'ne', className: 'cursor-nesw-resize -top-1.5 -right-1.5' },
        { name: 'sw', className: 'cursor-nesw-resize -bottom-1.5 -left-1.5' },
        { name: 'se', className: 'cursor-nwse-resize -bottom-1.5 -right-1.5' },
    ];
    
    return (
        <div
            ref={ref}
            onMouseDown={(e) => onSelect(item.id, e)}
            className="absolute"
            style={{
                left: `${item.x}px`,
                top: `${item.y}px`,
                width: `${item.width}px`,
                height: `${item.height}px`,
                transform: `rotate(${item.rotation}deg)`,
                zIndex: item.zIndex,
                cursor: 'pointer',
            }}
        >
            <img src={item.previewUrl} alt={`ref-${item.id}`} className="w-full h-full object-contain pointer-events-none select-none" />
            {isSelected && (
                <>
                    <div className="absolute -inset-0.5 border-2 border-blue-500 pointer-events-none" style={{ cursor: 'move' }}></div>
                    {resizeHandles.map(handle => (
                         <div
                            key={handle.name}
                            data-resize-handle={handle.name}
                            onMouseDown={(e) => handleResizeMouseDown(e, handle.name)}
                            className={`absolute w-3 h-3 bg-white border border-blue-500 rounded-full ${handle.className}`}
                         />
                    ))}
                </>
            )}
        </div>
    );
};

const InteractiveCanvas: React.FC<{
    editState: EditState;
    setEditState: React.Dispatch<React.SetStateAction<EditState>>;
    canvasRef: React.RefObject<HTMLDivElement>;
    onConfirm: () => void;
    onCancel: () => void;
}> = ({ editState, setEditState, canvasRef, onConfirm, onCancel }) => {
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const containerRef = useRef<HTMLDivElement>(null);
    const isPanningRef = useRef(false);
    const lastMousePosRef = useRef({ x: 0, y: 0 });
    const isSpacebarDownRef = useRef(false);

    const handleSelect = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditState(s => ({ ...s, activeReferenceId: id }));
    };

    const handleDeselect = () => {
        setEditState(s => ({ ...s, activeReferenceId: null }));
    };

    const handleUpdate = useCallback((id: string, updates: Partial<ReferenceLayer>) => {
        setEditState(s => ({
            ...s,
            references: s.references.map(ref => (ref.id === id ? { ...ref, ...updates } : ref)),
        }));
    }, [setEditState]);

    const fitToScreen = useCallback(() => {
        const container = containerRef.current;
        const content = canvasRef.current;
        const bgImage = content?.querySelector('img');

        if (!container || !content || !bgImage || bgImage.clientWidth === 0 || bgImage.clientHeight === 0) {
            return;
        }

        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;
        const contentWidth = bgImage.clientWidth;
        const contentHeight = bgImage.clientHeight;

        if (contentWidth === 0 || contentHeight === 0) return;

        const scaleX = containerWidth / contentWidth;
        const scaleY = containerHeight / contentHeight;

        const newZoom = Math.min(scaleX, scaleY) * 0.9; // 90% padding
        const newPanX = (containerWidth - contentWidth * newZoom) / 2;
        const newPanY = (containerHeight - contentHeight * newZoom) / 2;

        setZoom(newZoom);
        setPan({ x: newPanX, y: newPanY });
    }, [canvasRef]);

    useEffect(() => {
        setTimeout(fitToScreen, 50);
    }, [fitToScreen, editState.backgroundPreviewUrl]);

    const handleZoom = (direction: 'in' | 'out') => {
        const container = containerRef.current;
        if (!container) return;
    
        const { width, height } = container.getBoundingClientRect();
        const centerX = width / 2;
        const centerY = height / 2;
    
        // Position on content before zoom
        const contentX = (centerX - pan.x) / zoom;
        const contentY = (centerY - pan.y) / zoom;
    
        const zoomFactor = 1.2;
        const newZoom = direction === 'in' ? zoom * zoomFactor : zoom / zoomFactor;
        const clampedZoom = Math.max(0.1, Math.min(newZoom, 10)); // Clamp zoom level
    
        // New pan to keep the content point under the cursor
        const newPanX = centerX - contentX * clampedZoom;
        const newPanY = centerY - contentY * clampedZoom;
    
        setZoom(clampedZoom);
        setPan({ x: newPanX, y: newPanY });
    };

    // Effect for spacebar panning
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.target as HTMLElement).tagName.match(/INPUT|TEXTAREA/)) return;
            if (e.code === 'Space' && !isSpacebarDownRef.current) {
                e.preventDefault();
                isSpacebarDownRef.current = true;
                if (!isPanningRef.current) {
                    container.style.cursor = 'grab';
                }
            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.code === 'Space') {
                isSpacebarDownRef.current = false;
                if (!isPanningRef.current) {
                    container.style.cursor = 'default';
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            if (container) container.style.cursor = 'default';
        };
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();

                if (editState.activeReferenceId) {
                    const moveAmount = e.shiftKey ? 10 : 1;
                    let dx = 0;
                    let dy = 0;

                    switch (e.key) {
                        case 'ArrowUp': dy = -moveAmount; break;
                        case 'ArrowDown': dy = moveAmount; break;
                        case 'ArrowLeft': dx = -moveAmount; break;
                        case 'ArrowRight': dx = moveAmount; break;
                    }
                    
                    const activeRef = editState.references.find(r => r.id === editState.activeReferenceId);
                    if (activeRef) {
                        handleUpdate(editState.activeReferenceId, {
                            x: activeRef.x + dx,
                            y: activeRef.y + dy,
                        });
                    }
                } else { // Pan canvas if no item is selected
                    const panAmount = e.shiftKey ? 50 : 10;
                    let dx = 0;
                    let dy = 0;
                    switch (e.key) {
                        case 'ArrowUp': dy = panAmount; break;
                        case 'ArrowDown': dy = -panAmount; break;
                        case 'ArrowLeft': dx = panAmount; break;
                        case 'ArrowRight': dx = -panAmount; break;
                    }
                    setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [editState.activeReferenceId, editState.references, handleUpdate]);
    
    const handleMouseDownCapture = (e: React.MouseEvent) => {
        if (isSpacebarDownRef.current) {
            e.preventDefault();
            e.stopPropagation();
            isPanningRef.current = true;
            lastMousePosRef.current = { x: e.clientX, y: e.clientY };
            (e.currentTarget as HTMLElement).style.cursor = 'grabbing';
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isPanningRef.current) return;
        const dx = e.clientX - lastMousePosRef.current.x;
        const dy = e.clientY - lastMousePosRef.current.y;
        setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
        lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseUp = (e: React.MouseEvent) => {
        if (isPanningRef.current) {
            isPanningRef.current = false;
            (e.currentTarget as HTMLElement).style.cursor = isSpacebarDownRef.current ? 'grab' : 'default';
        }
    };

    return (
        <div
            ref={containerRef}
            className="relative w-full h-full flex items-center justify-center p-4 bg-[#050505] overflow-hidden"
            onMouseDownCapture={handleMouseDownCapture}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onClick={handleDeselect}
        >
            <div className="absolute top-4 right-4 z-10 flex flex-col items-center gap-2 p-1.5 bg-zinc-900/80 rounded-lg backdrop-blur-sm shadow-xl border border-zinc-800">
                <button onClick={() => handleZoom('in')} className="p-2 hover:bg-zinc-700 rounded-md transition-colors text-zinc-300" title="Aumentar Zoom"><Icons.ZoomIn /></button>
                <span className="text-xs font-semibold text-zinc-300 w-12 text-center select-none">{Math.round(zoom * 100)}%</span>
                <button onClick={() => handleZoom('out')} className="p-2 hover:bg-zinc-700 rounded-md transition-colors text-zinc-300" title="Diminuir Zoom"><Icons.ZoomOut /></button>
                <div className="h-px w-5 bg-zinc-700 my-1"></div>
                <button onClick={fitToScreen} className="p-2 hover:bg-zinc-700 rounded-md transition-colors text-zinc-300" title="Ajustar à Tela"><Icons.FitScreen /></button>
            </div>
            <div
                className="transition-transform duration-100 ease-out"
                style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
            >
                <div ref={canvasRef} className="relative select-none" style={{ touchAction: 'none' }} onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
                    <img src={editState.backgroundPreviewUrl!} alt="Fundo" className="block max-w-full max-h-full object-contain pointer-events-none select-none" />
                    {editState.references.map(ref => (
                        <ReferenceItem
                            key={ref.id}
                            item={ref}
                            isSelected={editState.activeReferenceId === ref.id}
                            onSelect={handleSelect}
                            onUpdate={handleUpdate}
                        />
                    ))}
                </div>
            </div>
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center justify-center gap-4 py-3 px-5 bg-zinc-900/90 rounded-full backdrop-blur-md shadow-2xl border border-zinc-800/50">
                <button onClick={onCancel} className="py-2 px-4 text-sm font-semibold text-zinc-300 hover:bg-zinc-800 rounded-full transition-colors flex items-center gap-2"><Icons.Close /> Cancelar</button>
                <button onClick={onConfirm} className="py-2 px-6 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-full transition-colors flex items-center gap-2 shadow-lg shadow-blue-900/50 disabled:opacity-50 disabled:cursor-not-allowed"><Icons.Check /> Confirmar Montagem</button>
            </div>
        </div>
    );
};

const ImageDisplayWithActions: React.FC<{ imageUrl: string; prompt: string; }> = ({ imageUrl, prompt }) => {
    const handleDownload = () => {
        const link = document.createElement('a');
        link.href = imageUrl;
        // Create a user-friendly filename from the prompt
        const filename = (prompt || 'imagem')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, '') // remove special chars
            .replace(/\s+/g, '-') // replace spaces with hyphens
            .slice(0, 50); // limit length
        link.download = `${filename || 'nano-banana-studio'}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="relative w-full h-full flex items-center justify-center p-6 group bg-[#09090b]">
             <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-zinc-900/40 to-zinc-950 pointer-events-none"></div>
            <img key={imageUrl} src={imageUrl} alt={prompt} className="max-w-full max-h-full object-contain rounded-lg shadow-2xl ring-1 ring-white/10 z-10" />
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-all duration-300 z-20 translate-y-4 group-hover:translate-y-0">
                <button 
                    onClick={handleDownload}
                    className="flex items-center gap-2 py-2.5 px-6 bg-white text-black font-semibold rounded-full hover:bg-zinc-200 transition-colors shadow-xl transform hover:scale-105"
                    title="Baixar imagem"
                >
                    <Icons.Save className="text-black" />
                    <span>Baixar Original</span>
                </button>
            </div>
        </div>
    );
};

// --- Main Content Display Component (Stable) ---
const MainContentDisplay: React.FC<{
    isLoading: boolean;
    loadingMessage: string;
    currentEntry: HistoryEntry | null;
    mode: Mode;
    editState: EditState;
    setEditState: React.Dispatch<React.SetStateAction<EditState>>;
    canvasRef: React.RefObject<HTMLDivElement>;
    onConfirm: () => void;
    onCancel: () => void;
}> = ({ isLoading, loadingMessage, currentEntry, mode, editState, setEditState, canvasRef, onConfirm, onCancel }) => {
    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center text-zinc-400 p-8 bg-zinc-950">
                <div className="relative mb-8">
                    <div className="absolute inset-0 bg-blue-500 blur-2xl opacity-20 animate-pulse"></div>
                    <Icons.Spinner className="h-12 w-12 text-blue-500 relative z-10" />
                </div>
                <p className="text-xl font-semibold text-zinc-100 mb-2 animate-pulse">{loadingMessage}</p>
                <div className="flex items-center justify-center mt-4 gap-2">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
                    <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                    <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                </div>
            </div>
        );
    }

    if (currentEntry?.mode === 'video') {
        return (
            <div className="w-full h-full flex items-center justify-center p-4 bg-[#09090b]">
                 <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-indigo-900/10 via-zinc-950 to-zinc-950 pointer-events-none"></div>
                <video key={currentEntry.videoUrl} src={currentEntry.videoUrl} controls autoPlay loop className="max-w-full max-h-full rounded-lg shadow-2xl ring-1 ring-white/10 z-10" />
            </div>
        );
    }
    
    const imageToShow = currentEntry?.mode === 'edit' ? currentEntry.imageUrl : (currentEntry?.mode === 'create' ? currentEntry.imageUrl : null);

    if (mode === 'edit' && editState.backgroundPreviewUrl) {
        if (editState.references.length > 0) {
            return <InteractiveCanvas editState={editState} setEditState={setEditState} canvasRef={canvasRef} onConfirm={onConfirm} onCancel={onCancel} />;
        }
         // Show the latest generated image if available, otherwise the background.
        const displayUrl = imageToShow || editState.backgroundPreviewUrl;
        const displayPrompt = currentEntry?.prompt || 'Imagem editada';
        return <ImageDisplayWithActions imageUrl={displayUrl} prompt={displayPrompt} />;
    }

    if (imageToShow) {
        return <ImageDisplayWithActions imageUrl={imageToShow} prompt={currentEntry.prompt} />;
    }

    let placeholderText = "Selecione uma ferramenta à esquerda e descreva sua imagem no painel à direita.";
    if (mode === 'video') {
        placeholderText = "Crie vídeos impressionantes com Veo 3.1. Selecione uma ferramenta e comece.";
    } else if (mode === 'edit') {
        placeholderText = "Envie uma imagem de fundo e referências, depois descreva as edições no painel à direita.";
    }

    return (
        <div className="flex flex-col items-center justify-center flex-1 text-center text-zinc-500 p-8 m-4">
             <div className="p-6 rounded-2xl bg-zinc-900/30 border border-zinc-800/50 mb-6 shadow-inner">
                <Icons.Sparkles className="text-6xl text-zinc-700 mb-0" />
             </div>
            <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400 mb-3">Nano Banana Studio <span className="text-sm font-mono text-zinc-600 ml-2">v3.0</span></h2>
            <p className="max-w-md text-zinc-400 leading-relaxed">{placeholderText}</p>
        </div>
    );
};


// --- Main App Component ---
export default function App() {
    const [prompt, setPrompt] = useState('');
    const [mode, setMode] = useState<Mode>('create');
    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    
    const [createState, setCreateState] = useState<CreateState>(INITIAL_CREATE_STATE);
    const [videoState, setVideoState] = useState<VideoState>(INITIAL_VIDEO_STATE);
    const [editState, setEditState] = useState<EditState>(INITIAL_EDIT_STATE);
    const [preMontageState, setPreMontageState] = useState<PreMontageState>(null);

    const [isLoading, setIsLoading] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState('Gerando sua mídia...');
    const [error, setError] = useState<string | null>(null);
    const [showMobileModal, setShowMobileModal] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([]);
        
    const currentEntry = history[historyIndex] ?? null;
    const editCanvasRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (window.innerWidth < 1024) {
            setShowMobileModal(true);
        }
    }, []);

    const handleModeToggle = (newMode: Mode) => {
        if (newMode === mode) return;
        setMode(newMode);
        setHistory([]);
        setHistoryIndex(-1);
        setPrompt('');
        setError(null);
        setCreateState(INITIAL_CREATE_STATE);
        setVideoState(INITIAL_VIDEO_STATE);
        setEditState(INITIAL_EDIT_STATE);
        setPreMontageState(null);
    };
    
    const handleHistoryNavigation = useCallback((index: number) => {
        if (index < 0 || index >= history.length) return;
        setPreMontageState(null);
        const entry = history[index];
        setHistoryIndex(index);
        setPrompt(entry.prompt);
        setMode(entry.mode);
        if (entry.mode === 'create') {
            const { id, imageUrl, ...rest } = entry;
            setCreateState(rest);
            setVideoState(INITIAL_VIDEO_STATE);
            setEditState(INITIAL_EDIT_STATE);
        } else if (entry.mode === 'video') {
            const { id, videoUrl, ...rest } = entry;
            setVideoState(rest);
            setCreateState(INITIAL_CREATE_STATE);
            setEditState(INITIAL_EDIT_STATE);
        } else if (entry.mode === 'edit') {
            const { id, imageUrl, ...rest } = entry;
            setEditState({ ...INITIAL_EDIT_STATE, ...rest });
            setCreateState(INITIAL_CREATE_STATE);
            setVideoState(INITIAL_VIDEO_STATE);
        }
    }, [history]);

    const handleCreateFunctionClick = (func: CreateFunction) => {
        setCreateState(s => ({ ...s, createFunction: func, styleModifier: STYLE_OPTIONS[func][0]?.value || 'default' }));
    };

    const handleVideoFunctionClick = (func: VideoFunction) => {
        if (func !== videoState.videoFunction) {
            setVideoState({ ...INITIAL_VIDEO_STATE, videoFunction: func });
        }
    };
    
    const handleEditFunctionClick = (func: EditFunction) => {
        if (func !== editState.editFunction) {
            setEditState({ ...INITIAL_EDIT_STATE, editFunction: func });
        }
    };

    const processSingleFile = useCallback((file: File, callback: (image: UploadedImage, previewUrl: string) => void) => {
        const id = `upload-${file.name}-${Date.now()}`;
        if (file.size > 10 * 1024 * 1024) { setUploadProgress(prev => [...prev, { id, name: file.name, progress: 100, status: 'error', message: 'Excede 10MB.' }]); setTimeout(() => setUploadProgress(p => p.filter(item => item.id !== id)), 5000); return; }
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setUploadProgress(prev => [...prev, { id, name: file.name, progress: 100, status: 'error', message: 'Tipo inválido.' }]); setTimeout(() => setUploadProgress(p => p.filter(item => item.id !== id)), 5000); return; }
        setUploadProgress(prev => [...prev, { id, name: file.name, progress: 0, status: 'uploading' }]);
        const reader = new FileReader();
        reader.onprogress = (event) => { if (event.lengthComputable) setUploadProgress(p => p.map(item => item.id === id ? { ...item, progress: Math.round((event.loaded / event.total) * 100) } : item)); };
        reader.onerror = () => { setUploadProgress(p => p.map(item => item.id === id ? { ...item, status: 'error', message: 'Falha ao ler.' } : item)); setTimeout(() => setUploadProgress(p => p.filter(item => item.id !== id)), 5000); };
        reader.onload = () => {
            const dataUrl = reader.result as string;
            callback({ base64: dataUrl.split(',')[1], mimeType: file.type }, dataUrl);
            setUploadProgress(p => p.map(item => item.id === id ? { ...item, status: 'success', progress: 100 } : item));
            setTimeout(() => setUploadProgress(p => p.filter(item => item.id !== id)), 1500);
        };
        reader.readAsDataURL(file);
    }, []);

    const flattenEditCanvas = async (): Promise<UploadedImage> => {
        const canvasContainer = editCanvasRef.current;

        if (!canvasContainer || !editState.background || !editState.backgroundPreviewUrl) {
            throw new Error("A tela de edição ou a imagem de fundo não estão disponíveis.");
        }

        const imgElement = canvasContainer.querySelector('img');
        if (!imgElement) {
            throw new Error("A imagem de fundo não foi encontrada na tela.");
        }
        
        // Use the image's clientWidth, which is its rendered size without transforms.
        const renderedWidth = imgElement.clientWidth;
        const renderedHeight = imgElement.clientHeight;

        if (renderedWidth === 0 || renderedHeight === 0) {
            throw new Error("As dimensões da imagem de fundo não puderam ser calculadas.");
        }

        // Load the background image to get its natural dimensions
        const bgImg = new Image();
        bgImg.src = editState.backgroundPreviewUrl;
        await new Promise<void>((resolve, reject) => { 
            bgImg.onload = () => resolve(); 
            bgImg.onerror = () => reject(new Error("Não foi possível carregar a imagem de fundo."));
        });

        // Create canvas with natural dimensions
        const canvas = document.createElement('canvas');
        canvas.width = bgImg.naturalWidth;
        canvas.height = bgImg.naturalHeight;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bgImg, 0, 0);

        // Calculate scale factor between rendered size and natural size
        const scaleX = canvas.width / renderedWidth;
        const scaleY = canvas.height / renderedHeight;

        const sortedRefs = [...editState.references].sort((a, b) => a.zIndex - b.zIndex);
        
        for (const ref of sortedRefs) {
            const refImg = new Image();
            refImg.src = ref.previewUrl;
            await new Promise((resolve, reject) => { refImg.onload = resolve; refImg.onerror = reject; });
            
            // ref.x/y are relative to the container, which is what we need.
            // Scale the position and size of the reference layer to the full-size canvas.
            const canvasX = ref.x * scaleX;
            const canvasY = ref.y * scaleY;
            const canvasWidth = ref.width * scaleX;
            const canvasHeight = ref.height * scaleY;
            
            ctx.save();
            // Translate to the center of the reference image for rotation
            ctx.translate(canvasX + canvasWidth / 2, canvasY + canvasHeight / 2);
            ctx.rotate(ref.rotation * Math.PI / 180);
            // Draw the image centered on the new origin
            ctx.drawImage(refImg, -canvasWidth / 2, -canvasHeight / 2, canvasWidth, canvasHeight);
            ctx.restore();
        }

        const dataUrl = canvas.toDataURL('image/png');
        return { base64: dataUrl.split(',')[1], mimeType: 'image/png' };
    };

    const handleConfirmMontage = async () => {
        setIsLoading(true);
        setLoadingMessage('Finalizando a montagem...');
        setError(null);

        const currentReferences = [...editState.references];
        
        try {
            const flattenedImage = await flattenEditCanvas();
            setEditState(s => ({ ...s, references: [] }));

            setLoadingMessage('Processando com Gemini Flash 2.5...');
            const API_PROMPT = "Integre os objetos das camadas de referência à imagem de fundo de forma realista. Remova o fundo dos objetos, ajuste a iluminação, sombras e cores para que a composição pareça natural e coesa, como se fosse uma única foto.";
            const resultUrl = await editImage(API_PROMPT, flattenedImage);
            const newBgImage = { base64: resultUrl.split(',')[1], mimeType: 'image/png' };
            const userFacingPrompt = 'Montagem automática de imagem';

            const newEntry: EditHistoryEntry = {
                id: `hist-${Date.now()}`,
                prompt: userFacingPrompt,
                mode: 'edit',
                imageUrl: resultUrl,
                editFunction: editState.editFunction,
                background: editState.background,
                backgroundPreviewUrl: editState.backgroundPreviewUrl,
                references: currentReferences,
                negativePrompt: editState.negativePrompt,
            };
            
            const newHistory = history.slice(0, historyIndex + 1).concat(newEntry);
            setHistory(newHistory);
            setHistoryIndex(newHistory.length - 1);
            setPrompt(userFacingPrompt);
            setEditState(s => ({...s, background: newBgImage, backgroundPreviewUrl: resultUrl, references: []}));

        } catch (e: any) {
            setError(e.message || "Ocorreu um erro desconhecido ao editar a imagem.");
            setEditState(s => ({ ...s, references: currentReferences })); // Restore on error
        } finally {
            setIsLoading(false);
            setLoadingMessage('Gerando sua mídia...');
        }
    };
    
    const handleCancelMontage = () => {
        setEditState(s => ({ ...s, references: [], activeReferenceId: null }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isLoading || (mode === 'edit' && editState.references.length > 0)) return;

        setError(null);
        setIsLoading(true);

        const currentPrompt = prompt.trim();
        if (!currentPrompt) {
             if (mode === 'video' && videoState.videoFunction === 'animation' && videoState.startFrame) {
                // Allow animation without prompt
             } else {
                setError("Por favor, insira um prompt.");
                setIsLoading(false);
                return;
             }
        }
        
        try {
            let newEntry: HistoryEntry | null = null;
            if (mode === 'create') {
                setLoadingMessage(`Criando sua imagem em ${createState.resolution}...`);
                const resultUrl = await generateImage({ prompt: currentPrompt, ...createState });
                newEntry = { id: `hist-${Date.now()}`, prompt: currentPrompt, mode, imageUrl: resultUrl, ...createState };
            } else if (mode === 'video') {
                if (videoState.videoFunction === 'animation' && !videoState.startFrame) throw new Error("Por favor, envie uma imagem para animar.");
                setLoadingMessage(`Renderizando com Veo 3.1 (${videoState.videoResolution})...`);
                const resultUrl = await generateVideo(currentPrompt, videoState.videoFunction === 'animation' ? videoState.startFrame! : undefined, videoState.videoResolution);
                newEntry = { id: `hist-${Date.now()}`, prompt: currentPrompt, mode, videoUrl: resultUrl, ...videoState };
            } else if (mode === 'edit') {
                 if (!editState.background) throw new Error("Por favor, envie uma imagem de fundo para editar.");
                setLoadingMessage('Aplicando edições com IA...');
                const resultUrl = await editImage(currentPrompt, editState.background);
                const newBgImage = { base64: resultUrl.split(',')[1], mimeType: 'image/png' };
                newEntry = { id: `hist-${Date.now()}`, prompt: currentPrompt, mode, imageUrl: resultUrl, editFunction: editState.editFunction, background: newBgImage, backgroundPreviewUrl: resultUrl, references: [], negativePrompt: editState.negativePrompt };
                setEditState(s => ({...s, background: newBgImage, backgroundPreviewUrl: resultUrl, references: []}));
            }

            if (newEntry) {
                const newHistory = history.slice(0, historyIndex + 1).concat(newEntry);
                setHistory(newHistory);
                setHistoryIndex(newHistory.length - 1);
            }
        } catch (e: any) {
            setError(e.message || "Ocorreu um erro desconhecido.");
        } finally {
            setIsLoading(false);
            setLoadingMessage('Gerando sua mídia...');
        }
    };

    return (
        <>
            {showMobileModal && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
                    <div className="bg-zinc-900 rounded-lg p-6 text-center max-w-sm border border-zinc-700 shadow-2xl">
                        <h2 className="text-xl font-bold text-zinc-100 mb-2">Experiência Otimizada para Desktop</h2>
                        <p className="text-zinc-400">Para utilizar todo o poder do Gemini 3 no Nano Banana Studio, recomendamos um computador.</p>
                        <button onClick={() => setShowMobileModal(false)} className="mt-4 py-2 px-4 bg-blue-600 text-white rounded-md font-semibold">Entendi</button>
                    </div>
                </div>
            )}
            <header className="app-header bg-zinc-950/90 backdrop-blur-md border-b border-zinc-800 flex items-center justify-between px-6 z-20 relative">
                 <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-blue-600/50 to-transparent"></div>
                <h1 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
                    <span>🍌 Nano Banana Studio</span>
                    <span className="text-[10px] font-bold tracking-wider text-white bg-gradient-to-r from-blue-600 to-purple-600 px-2 py-0.5 rounded-full uppercase shadow-lg shadow-blue-900/40">Gemini 3.0</span>
                </h1>
            </header>
            <nav className="app-toolbar bg-zinc-950 border-r border-zinc-800 flex flex-col items-center p-3 gap-3 z-20">
                <ToolbarButton data-function="create" isActive={mode === 'create'} onClick={() => handleModeToggle('create')} icon={<Icons.Create />} name="Criar" />
                <ToolbarButton data-function="edit" isActive={mode === 'edit'} onClick={() => handleModeToggle('edit')} icon={<Icons.Edit />} name="Editar" />
                <ToolbarButton data-function="video" isActive={mode === 'video'} onClick={() => handleModeToggle('video')} icon={<Icons.Video />} name="Vídeo" />
            </nav>
            <main className="app-main flex flex-col bg-zinc-950 p-0 relative">
                 <div className="h-12 shrink-0 bg-zinc-950/50 border-b border-zinc-800 flex items-center px-4 z-10 text-sm gap-2">
                     {mode === 'create' && CREATE_FUNCTIONS.map(f => <button key={f.id} onClick={() => handleCreateFunctionClick(f.id)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${createState.createFunction === f.id ? 'bg-zinc-100 text-black' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}>{f.icon}{f.name}</button>)}
                     {mode === 'edit' && EDIT_FUNCTIONS.map(f => <button key={f.id} onClick={() => handleEditFunctionClick(f.id)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${editState.editFunction === f.id ? 'bg-zinc-100 text-black' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}>{f.icon}{f.name}</button>)}
                     {mode === 'video' && VIDEO_FUNCTIONS.map(f => <button key={f.id} onClick={() => handleVideoFunctionClick(f.id)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${videoState.videoFunction === f.id ? 'bg-zinc-100 text-black' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}>{f.icon}{f.name}</button>)}
                 </div>
                 <div className="flex-1 min-h-0 relative">
                     <MainContentDisplay isLoading={isLoading} loadingMessage={loadingMessage} currentEntry={currentEntry} mode={mode} editState={editState} setEditState={setEditState} canvasRef={editCanvasRef} onConfirm={handleConfirmMontage} onCancel={handleCancelMontage} />
                 </div>
            </main>
            <Sidebar {...{ mode, createState, setCreateState, videoState, setVideoState, editState, setEditState, prompt, setPrompt, isLoading, error, setError, history, historyIndex, handleHistoryNavigation, handleSubmit, processSingleFile, preMontageState, setPreMontageState }} />
        </>
    );
}