import { useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { normalizeGitHubAssetUrl } from '../services/githubHostService';

interface BookCoverProps {
  src?: string;
  title: string;
  author?: string;
  category?: string;
  className?: string;
}

const FALLBACK_PALETTES = [
  'from-[#14532D] via-[#1B4332] to-[#0B291B]',
  'from-[#78350F] via-[#92400E] to-[#451A03]',
  'from-[#1E3A8A] via-[#1E40AF] to-[#172554]',
  'from-[#374151] via-[#1F2937] to-[#111827]',
];

export function BookCover({ src, title, author, category, className = '' }: BookCoverProps) {
  const [hasError, setHasError] = useState(false);
  const resolvedSrc = src ? normalizeGitHubAssetUrl(src) : '';

  useEffect(() => {
    setHasError(false);
  }, [resolvedSrc]);

  const hash = Array.from(title || 'Maktabada').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const gradient = FALLBACK_PALETTES[hash % FALLBACK_PALETTES.length];

  if (!resolvedSrc || hasError) {
    return (
      <div
        className={`relative w-full aspect-[3/4] bg-gradient-to-br ${gradient} text-[#F8F6F1] flex flex-col justify-between p-5 select-none overflow-hidden ${className}`}
      >
        <div className="flex items-center justify-between text-[11px] tracking-widest uppercase text-white/75 font-sans">
          <span className="truncate">{category || 'Buug'}</span>
          <BookOpen className="w-4 h-4 shrink-0 opacity-80" />
        </div>
        <div className="my-auto py-3">
          <div className="w-8 h-px bg-white/35 mb-3" />
          <p className="font-serif text-lg leading-snug font-medium line-clamp-4 text-white">
            {title || 'Cinwaan La’aan'}
          </p>
        </div>
        <div className="text-xs text-white/75 truncate">
          {author || 'maktabada.so'}
        </div>
      </div>
    );
  }

  return (
    <div className={`relative w-full aspect-[3/4] bg-[#EFECE5] overflow-hidden ${className}`}>
      <img
        src={resolvedSrc}
        alt={`Jaldiga buugga ${title}`}
        referrerPolicy="no-referrer"
        onError={() => setHasError(true)}
        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
      />
    </div>
  );
}
