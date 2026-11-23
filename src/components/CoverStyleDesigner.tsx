import { Check, Palette } from 'lucide-react';
import {
  buildCustomCoverUrl,
  COVER_FRAMES,
  COVER_ICONS,
  COVER_THEMES,
  resolveCoverDesign,
  type CoverIconId,
  type FrameStyle,
} from './BookCover';

interface CoverStyleDesignerProps {
  coverUrl: string;
  title: string;
  category: string;
  disabled?: boolean;
  onSelectCustomCover: (url: string) => void;
}

export function CoverStyleDesigner({
  coverUrl,
  title,
  category,
  disabled = false,
  onSelectCustomCover,
}: CoverStyleDesignerProps) {
  const current = resolveCoverDesign(category, title, coverUrl);

  const applySelection = (next: {
    themeId?: string;
    frameStyle?: FrameStyle;
    iconId?: CoverIconId;
  }) => {
    onSelectCustomCover(
      buildCustomCoverUrl({
        themeId: next.themeId ?? current.theme.id,
        frameStyle: next.frameStyle ?? current.frameStyle,
        iconId: next.iconId ?? current.iconId,
      })
    );
  };

  return (
    <div className="p-4 rounded-xl bg-[#F8F6F1]/80 dark:bg-[#141312] border border-[#E5E0D5] dark:border-[#2E2C29] space-y-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#1C1917] dark:text-[#F5F2EB]">
          <Palette className="w-3.5 h-3.5 text-[#14532D] dark:text-[#4ADE80]" />
          <span>Naqshadda Jaldiga (Midabbo, Frame &amp; Icons)</span>
        </div>
        <span className="text-[11px] text-[#78716C] dark:text-[#A8A29E]">
          1-gujis ku dooro
        </span>
      </div>

      {/* Colors */}
      <div>
        <p className="text-[11px] font-medium text-[#57534E] dark:text-[#A8A29E] mb-1.5">
          Midabka Jaldiga
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {COVER_THEMES.map((theme) => {
            const selected = current.theme.id === theme.id;
            return (
              <button
                key={theme.id}
                type="button"
                disabled={disabled}
                onClick={() => applySelection({ themeId: theme.id })}
                aria-label={theme.label}
                title={theme.label}
                className={`w-7 h-7 rounded-lg border-2 flex items-center justify-center transition-transform hover:scale-105 disabled:opacity-50 ${
                  theme.swatchClass
                } ${selected ? 'ring-2 ring-offset-2 ring-[#14532D] dark:ring-[#4ADE80] dark:ring-offset-[#141312]' : ''}`}
              >
                {selected && <Check className="w-3.5 h-3.5 text-white drop-shadow" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Frames */}
      <div>
        <p className="text-[11px] font-medium text-[#57534E] dark:text-[#A8A29E] mb-1.5">
          Qaabka Frame-ka
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {COVER_FRAMES.map((frame) => {
            const selected = current.frameStyle === frame.id;
            return (
              <button
                key={frame.id}
                type="button"
                disabled={disabled}
                onClick={() => applySelection({ frameStyle: frame.id })}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 ${
                  selected
                    ? 'bg-[#14532D] dark:bg-[#15803D] border-[#14532D] dark:border-[#15803D] text-white'
                    : 'bg-white dark:bg-[#1C1B19] border-[#D6CEBE] dark:border-[#383531] text-[#57534E] dark:text-[#D6D3CD] hover:text-[#1C1917] dark:hover:text-[#F5F2EB]'
                }`}
              >
                {frame.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Icons */}
      <div>
        <p className="text-[11px] font-medium text-[#57534E] dark:text-[#A8A29E] mb-1.5">
          Icon-ka Dhexda
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {COVER_ICONS.map(({ id, label, Icon }) => {
            const selected = current.iconId === id;
            return (
              <button
                key={id}
                type="button"
                disabled={disabled}
                onClick={() => applySelection({ iconId: id })}
                title={label}
                aria-label={label}
                className={`p-2 rounded-lg border transition-colors disabled:opacity-50 ${
                  selected
                    ? 'bg-[#14532D] dark:bg-[#15803D] border-[#14532D] dark:border-[#15803D] text-white'
                    : 'bg-white dark:bg-[#1C1B19] border-[#D6CEBE] dark:border-[#383531] text-[#57534E] dark:text-[#D6D3CD] hover:text-[#1C1917] dark:hover:text-[#F5F2EB]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
