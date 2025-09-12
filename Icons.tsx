import React from 'react';

// Base component for all icons
const MaterialIcon: React.FC<{ iconName: string; className?: string } & React.HTMLAttributes<HTMLSpanElement>> = ({ iconName, className, ...props }) => (
  <span className={`material-symbols-outlined ${className || ''}`.trim()} {...props}>
    {iconName}
  </span>
);

export const Create = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="auto_awesome" {...props} />;
export const Edit = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="tune" {...props} />;
export const Save = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="download" {...props} />;
export const Undo = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="undo" {...props} />;
export const Redo = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="redo" {...props} />;
export const Sparkles = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="auto_awesome" {...props} />;
export const Image = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="image" {...props} />;
export const Sticker = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="sticky_note_2" {...props} />;
export const Type = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="type_specimen" {...props} />;
export const Comic = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="comic_bubble" {...props} />;
export const AspectRatio = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="aspect_ratio" {...props} />;
export const Sliders = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="tune" {...props} />;
export const Layers = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="layers" {...props} />;
export const Palette = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="palette" {...props} />;
export const Prompt = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="edit_note" {...props} />;
export const Reference = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="attachment" {...props} />;
export const History = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="history" {...props} />;
export const Brush = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="brush" {...props} />;
export const Eraser = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="ink_eraser" {...props} />;
export const Deselect = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="layers_clear" {...props} />;
export const ZoomOut = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="zoom_out" {...props} />;
export const ZoomIn = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="zoom_in" {...props} />;
export const FitScreen = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="fit_screen" {...props} />;
export const CheckCircle = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="check_circle" {...props} />;
export const AlertCircle = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="error" {...props} />;
export const UploadCloud = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="cloud_upload" {...props} />;
export const Select = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="interests" {...props} />;
export const Selection = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="highlight_alt" {...props} />;
export const ClearAll = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="delete_sweep" {...props} />;
export const Settings = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="settings" {...props} />;
export const Close = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="close" {...props} />;
export const Loader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={`flex justify-center items-center space-x-2 ${className || ''}`.trim()} {...props}>
      <div className="w-4 h-4 bg-blue-400 rounded-full animate-pulse-dots dot-1"></div>
      <div className="w-4 h-4 bg-blue-400 rounded-full animate-pulse-dots dot-2"></div>
      <div className="w-4 h-4 bg-blue-400 rounded-full animate-pulse-dots dot-3"></div>
    </div>
  );
