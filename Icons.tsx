import React from 'react';

// Base component for all icons
const MaterialIcon: React.FC<{ iconName: string; className?: string } & React.HTMLAttributes<HTMLSpanElement>> = ({ iconName, className, ...props }) => (
  <span className={`material-symbols-outlined text-lg ${className || ''}`.trim()} {...props}>
    {iconName}
  </span>
);

export const Create = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="auto_awesome" {...props} />;
export const Edit = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="tune" {...props} />;
export const Video = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="movie" {...props} />;
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
export const CheckCircle = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="check_circle" {...props} />;
export const AlertCircle = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="error" {...props} />;
export const UploadCloud = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="cloud_upload" {...props} />;
export const Select = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="interests" {...props} />;
export const Selection = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="highlight_alt" {...props} />;
export const ClearAll = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="delete_sweep" {...props} />;
export const Settings = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="settings" {...props} />;
export const Block = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="block" {...props} />;
export const Close = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="close" {...props} />;
export const Send = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="send" {...props} />;
export const ChevronDown = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="expand_more" {...props} />;
export const Transform = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="auto_fix_high" {...props} />;
export const Visibility = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="visibility" {...props} />;
export const Start = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="start" {...props} />;
export const ContentCut = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="content_cut" {...props} />;
export const AddPhoto = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="add_photo_alternate" {...props} />;
export const Check = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="check" {...props} />;
export const RotateRight = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="rotate_right" {...props} />;
export const Filter = (props: React.HTMLAttributes<HTMLSpanElement>) => <MaterialIcon iconName="photo_filter" {...props} />;


export const Spinner = ({ className, ...props }: React.HTMLAttributes<SVGSVGElement>) => (
    <svg 
        className={`animate-spin h-5 w-5 text-white ${className || ''}`.trim()} 
        xmlns="http://www.w3.org/2000/svg" 
        fill="none" 
        viewBox="0 0 24 24"
        {...props}
    >
        <circle 
            className="opacity-25" 
            cx="12" 
            cy="12" 
            r="10" 
            stroke="currentColor" 
            strokeWidth="4"
        ></circle>
        <path 
            className="opacity-75" 
            fill="currentColor" 
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        ></path>
    </svg>
);