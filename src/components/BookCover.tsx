import { useEffect, useState, type ComponentType } from 'react';
import {
  Atom,
  BookOpen,
  Bookmark,
  Compass,
  Cpu,
  Feather,
  Globe,
  GraduationCap,
  HeartPulse,
  Landmark,
  Library,
  Moon,
  Scale,
  ScrollText,
} from 'lucide-react';
import { resolveBundledStarterAsset } from '../assets/starterAssets';
import { normalizeGitHubAssetUrl } from '../services/githubHostService';

export type FrameStyle = 'archival-corners' | 'classic-double' | 'medallion-arch' | 'modern-grid';

export type CoverIconId =
  | 'book'
  | 'feather'
  | 'landmark'
  | 'atom'
  | 'cpu'
  | 'moon'
  | 'scale'
  | 'scroll'
  | 'graduation'
  | 'heart'
  | 'compass'
  | 'library'
  | 'bookmark'
  | 'globe';

export interface CoverTheme {
  id: string;
  label: string;
  swatchClass: string;
  bg: string;
  frameBorder: string;
  innerBorder: string;
  corner: string;
  medallionBg: string;
  ornament: string;
  defaultFrame: FrameStyle;
}

export const COVER_THEMES: CoverTheme[] = [
  {
    id: 'emerald',
    label: 'Cagaar Dahabi',
    swatchClass: 'bg-[#14532D] border-[#E6C884]',
    bg: 'from-[#14532D] via-[#0F3F22] to-[#072112]',
    frameBorder: 'border-[#E6C884]/50',
    innerBorder: 'border-[#E6C884]/25',
    corner: 'border-[#F3D99B]',
    medallionBg: 'bg-[#0B2E19]/75 border-[#E6C884]/60',
    ornament: 'text-[#F3D99B]',
    defaultFrame: 'archival-corners',
  },
  {
    id: 'terracotta',
    label: 'Maariin Naxaas',
    swatchClass: 'bg-[#7C2D12] border-[#F3D19B]',
    bg: 'from-[#7C2D12] via-[#5E200C] to-[#300F05]',
    frameBorder: 'border-[#F3D19B]/50',
    innerBorder: 'border-[#F3D19B]/25',
    corner: 'border-[#F9E2BC]',
    medallionBg: 'bg-[#421507]/75 border-[#F3D19B]/60',
    ornament: 'text-[#F9E2BC]',
    defaultFrame: 'medallion-arch',
  },
  {
    id: 'indigo',
    label: 'Buluug Habeen',
    swatchClass: 'bg-[#172554] border-[#E6C386]',
    bg: 'from-[#172554] via-[#111D45] to-[#070E24]',
    frameBorder: 'border-[#E6C386]/50',
    innerBorder: 'border-[#E6C386]/25',
    corner: 'border-[#F3D9A6]',
    medallionBg: 'bg-[#0B1433]/75 border-[#E6C386]/60',
    ornament: 'text-[#F3D9A6]',
    defaultFrame: 'classic-double',
  },
  {
    id: 'obsidian',
    label: 'Bir & Teal',
    swatchClass: 'bg-[#1E293B] border-[#99F6E4]',
    bg: 'from-[#1E293B] via-[#131C2B] to-[#090E17]',
    frameBorder: 'border-[#99F6E4]/45',
    innerBorder: 'border-[#99F6E4]/22',
    corner: 'border-[#99F6E4]',
    medallionBg: 'bg-[#0D1522]/80 border-[#99F6E4]/55',
    ornament: 'text-[#99F6E4]',
    defaultFrame: 'modern-grid',
  },
  {
    id: 'teal',
    label: 'Cagaar-Buluug',
    swatchClass: 'bg-[#115E59] border-[#FDE68A]',
    bg: 'from-[#115E59] via-[#0C4642] to-[#052422]',
    frameBorder: 'border-[#FDE68A]/50',
    innerBorder: 'border-[#FDE68A]/25',
    corner: 'border-[#FDE68A]',
    medallionBg: 'bg-[#07312E]/75 border-[#FDE68A]/60',
    ornament: 'text-[#FDE68A]',
    defaultFrame: 'medallion-arch',
  },
  {
    id: 'burgundy',
    label: 'Guduud Boqortooyo',
    swatchClass: 'bg-[#6B1D2F] border-[#F3D5A5]',
    bg: 'from-[#6B1D2F] via-[#511423] to-[#290911]',
    frameBorder: 'border-[#F3D5A5]/50',
    innerBorder: 'border-[#F3D5A5]/25',
    corner: 'border-[#F9E3C0]',
    medallionBg: 'bg-[#380D17]/75 border-[#F3D5A5]/60',
    ornament: 'text-[#F9E3C0]',
    defaultFrame: 'classic-double',
  },
  {
    id: 'espresso',
    label: 'Bunni Diirran',
    swatchClass: 'bg-[#432818] border-[#E7CFA9]',
    bg: 'from-[#432818] via-[#311C10] to-[#1A0E07]',
    frameBorder: 'border-[#E7CFA9]/50',
    innerBorder: 'border-[#E7CFA9]/25',
    corner: 'border-[#F5E4C8]',
    medallionBg: 'bg-[#24140B]/75 border-[#E7CFA9]/60',
    ornament: 'text-[#F5E4C8]',
    defaultFrame: 'archival-corners',
  },
  {
    id: 'plum',
    label: 'Guduud-Madow',
    swatchClass: 'bg-[#3B1F3A] border-[#E9C2B5]',
    bg: 'from-[#3B1F3A] via-[#2A1429] to-[#150915]',
    frameBorder: 'border-[#E9C2B5]/50',
    innerBorder: 'border-[#E9C2B5]/25',
    corner: 'border-[#F5D8CE]',
    medallionBg: 'bg-[#1E0E1D]/75 border-[#E9C2B5]/60',
    ornament: 'text-[#F5D8CE]',
    defaultFrame: 'modern-grid',
  },
];

export const COVER_FRAMES: Array<{ id: FrameStyle; label: string }> = [
  { id: 'archival-corners', label: 'Geeso Dahabi' },
  { id: 'medallion-arch', label: 'Qaanso' },
  { id: 'classic-double', label: 'Laba Xarriiq' },
  { id: 'modern-grid', label: 'Xarriiq Casri' },
];

export const COVER_ICONS: Array<{
  id: CoverIconId;
  label: string;
  Icon: ComponentType<{ className?: string }>;
}> = [
  { id: 'book', label: 'Buug', Icon: BookOpen },
  { id: 'feather', label: 'Suugaan', Icon: Feather },
  { id: 'landmark', label: 'Taariikh', Icon: Landmark },
  { id: 'atom', label: 'Saynis', Icon: Atom },
  { id: 'cpu', label: 'Tiknoolaji', Icon: Cpu },
  { id: 'moon', label: 'Diin', Icon: Moon },
  { id: 'scale', label: 'Dhaqaale', Icon: Scale },
  { id: 'scroll', label: 'Qoraal', Icon: ScrollText },
  { id: 'graduation', label: 'Waxbarasho', Icon: GraduationCap },
  { id: 'heart', label: 'Caafimaad', Icon: HeartPulse },
];

const EXTRA_ICONS: Record<CoverIconId, ComponentType<{ className?: string }>> = {
  book: BookOpen,
  feather: Feather,
  landmark: Landmark,
  atom: Atom,
  cpu: Cpu,
  moon: Moon,
  scale: Scale,
  scroll: ScrollText,
  graduation: GraduationCap,
  heart: HeartPulse,
  compass: Compass,
  library: Library,
  bookmark: Bookmark,
  globe: Globe,
};

export const MAKTABADA_COVER_SCHEME = 'maktabada-cover://';

export function isCustomCoverUrl(rawSrc?: string): boolean {
  return Boolean(rawSrc && rawSrc.trim().startsWith(MAKTABADA_COVER_SCHEME));
}

export function buildCustomCoverUrl(opts: {
  themeId: string;
  frameStyle: FrameStyle;
  iconId: CoverIconId;
}): string {
  const params = new URLSearchParams({
    theme: opts.themeId,
    frame: opts.frameStyle,
    icon: opts.iconId,
  });
  return `${MAKTABADA_COVER_SCHEME}?${params.toString()}`;
}

export function parseCustomCoverUrl(rawSrc?: string): {
  themeId?: string;
  frameStyle?: FrameStyle;
  iconId?: CoverIconId;
} | null {
  if (!isCustomCoverUrl(rawSrc)) return null;
  const trimmed = (rawSrc || '').trim();
  const qIndex = trimmed.indexOf('?');
  const rawQuery = qIndex >= 0 ? trimmed.slice(qIndex + 1) : trimmed.slice(MAKTABADA_COVER_SCHEME.length);
  const params = new URLSearchParams(rawQuery);
  const theme = params.get('theme') || undefined;
  const frameRaw = params.get('frame') as FrameStyle | null;
  const iconRaw = params.get('icon') as CoverIconId | null;
  return {
    themeId: theme,
    frameStyle:
      frameRaw && COVER_FRAMES.some((f) => f.id === frameRaw) ? frameRaw : undefined,
    iconId: iconRaw && iconRaw in EXTRA_ICONS ? iconRaw : undefined,
  };
}

interface BookCoverProps {
  src?: string;
  title: string;
  author?: string;
  category?: string;
  size?: 'xs' | 'sm' | 'md';
  preferStyledFallback?: boolean;
  className?: string;
}

const LEGACY_STARTER_COVER_MAP: Record<string, string> = {
  '/src/assets/images/cover_taariikhda_soomaaliya_1795275336344.jpg':
    '/src/assets/images/art_taariikhda_geeska_1795420922526.jpg',
  '/src/assets/images/cover_sayniska_xiddigiska_1795275336746.jpg':
    '/src/assets/images/art_xiddigiska_soomaali_1795427946263.jpg',
  '/src/assets/images/art_xiddigiska_dhaqanka_1795420923302.jpg':
    '/src/assets/images/art_xiddigiska_soomaali_1795427946263.jpg',
  '/src/assets/images/cover_suugaanta_soomaaliyeed_1795275336487.jpg':
    '/src/assets/images/art_suugaanta_maansada_1795420923125.jpg',
  '/src/assets/images/cover_tignoolajiyada_casriga_1795275335465.jpg':
    '/src/assets/images/art_tignoolajiyada_webka_1795420923395.jpg',
};

function resolveCoverImageUrl(rawSrc?: string): string {
  const trimmed = (rawSrc || '').trim();
  if (!trimmed || isCustomCoverUrl(trimmed)) return '';
  if (trimmed.startsWith('data:image/') || trimmed.startsWith('blob:')) {
    return trimmed;
  }

  const bundled = resolveBundledStarterAsset(trimmed);
  if (bundled) {
    return bundled;
  }

  const mapped = LEGACY_STARTER_COVER_MAP[trimmed] || trimmed;

  const gdriveFileMatch = mapped.match(/drive\.google\.com\/file\/d\/([^/?#]+)/i);
  if (gdriveFileMatch?.[1]) {
    return `https://lh3.googleusercontent.com/d/${gdriveFileMatch[1]}=w800`;
  }
  const gdriveIdMatch = mapped.match(/drive\.google\.com\/(?:open|uc)\?[^#]*\bid=([^&#]+)/i);
  if (gdriveIdMatch?.[1]) {
    return `https://lh3.googleusercontent.com/d/${gdriveIdMatch[1]}=w800`;
  }

  return normalizeGitHubAssetUrl(mapped);
}

const FALLBACK_ICON_KEYS: CoverIconId[] = ['book', 'library', 'scroll', 'compass', 'bookmark', 'globe'];

export function resolveCoverDesign(
  category: string | undefined,
  title: string,
  customSrc?: string
): { theme: CoverTheme; frameStyle: FrameStyle; Icon: ComponentType<{ className?: string }>; iconId: CoverIconId } {
  const parsed = parseCustomCoverUrl(customSrc);
  const cat = (category || '').toLowerCase();
  const titleHash = Array.from(title || 'Maktabada').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const frameStyles: FrameStyle[] = [
    'archival-corners',
    'medallion-arch',
    'classic-double',
    'modern-grid',
  ];

  let autoTheme: CoverTheme;
  let autoIconId: CoverIconId;

  if (cat.includes('taariikh') || cat.includes('history') || cat.includes('siyaasad')) {
    autoTheme = COVER_THEMES[titleHash % 2 === 0 ? 1 : 6];
    autoIconId = titleHash % 3 === 0 ? 'compass' : 'landmark';
  } else if (cat.includes('caafimaad') || cat.includes('health') || cat.includes('dawo')) {
    autoTheme = COVER_THEMES[titleHash % 2 === 0 ? 4 : 2];
    autoIconId = 'heart';
  } else if (cat.includes('saynis') || cat.includes('science') || cat.includes('xiddig') || cat.includes('xisaab')) {
    autoTheme = COVER_THEMES[titleHash % 2 === 0 ? 2 : 3];
    autoIconId = titleHash % 3 === 0 ? 'compass' : 'atom';
  } else if (cat.includes('suugaan') || cat.includes('gabay') || cat.includes('maanso') || cat.includes('sheeko')) {
    autoTheme = COVER_THEMES[titleHash % 2 === 0 ? 0 : 7];
    autoIconId = titleHash % 3 === 0 ? 'scroll' : 'feather';
  } else if (cat.includes('tignoolaji') || cat.includes('tech') || cat.includes('software') || cat.includes('barnaamij')) {
    autoTheme = COVER_THEMES[titleHash % 2 === 0 ? 3 : 2];
    autoIconId = 'cpu';
  } else if (cat.includes('diin') || cat.includes('islaam') || cat.includes('fiqi') || cat.includes('axkaam')) {
    autoTheme = COVER_THEMES[titleHash % 2 === 0 ? 4 : 0];
    autoIconId = titleHash % 2 === 0 ? 'moon' : 'book';
  } else if (cat.includes('dhaqaal') || cat.includes('ganacsi') || cat.includes('sharci') || cat.includes('maaliyad')) {
    autoTheme = COVER_THEMES[titleHash % 2 === 0 ? 5 : 1];
    autoIconId = 'scale';
  } else if (cat.includes('waxbarasho') || cat.includes('bulsho') || cat.includes('luqad')) {
    autoTheme = COVER_THEMES[titleHash % 2 === 0 ? 6 : 0];
    autoIconId = 'graduation';
  } else {
    autoTheme = COVER_THEMES[titleHash % COVER_THEMES.length];
    autoIconId = FALLBACK_ICON_KEYS[titleHash % FALLBACK_ICON_KEYS.length];
  }

  const matchedTheme = parsed?.themeId
    ? COVER_THEMES.find((t) => t.id === parsed.themeId) || autoTheme
    : autoTheme;
  const frameStyle =
    parsed?.frameStyle ||
    frameStyles[(titleHash + matchedTheme.defaultFrame.length) % frameStyles.length];
  const iconId = parsed?.iconId || autoIconId;
  const Icon = EXTRA_ICONS[iconId] || BookOpen;

  return {
    theme: matchedTheme,
    frameStyle,
    Icon,
    iconId,
  };
}

export function BookCover({
  src,
  title,
  author,
  category,
  size = 'md',
  preferStyledFallback = false,
  className = '',
}: BookCoverProps) {
  const resolvedSrc = preferStyledFallback ? '' : resolveCoverImageUrl(src);
  const [failedSrc, setFailedSrc] = useState<string>('');

  useEffect(() => {
    setFailedSrc('');
  }, [resolvedSrc]);

  const hasError = Boolean(resolvedSrc && failedSrc === resolvedSrc);
  const aspectClass = className.includes('aspect-') ? '' : 'aspect-[3/4]';
  const { theme, frameStyle, Icon } = resolveCoverDesign(category, title, src);

  const showImage = Boolean(resolvedSrc && !hasError);

  const renderStyledLayer = () => {
    if (size === 'xs') {
      return (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-gradient-to-r from-black/45 via-white/10 to-transparent"
          />
          <div
            className={`relative h-full w-full border ${theme.frameBorder} ${
              frameStyle === 'medallion-arch' ? 'rounded-t-lg' : 'rounded-[1px]'
            } flex items-center justify-center`}
          >
            {frameStyle === 'archival-corners' && (
              <>
                <span aria-hidden="true" className={`pointer-events-none absolute -top-px -left-px w-1.5 h-1.5 border-t border-l ${theme.corner}`} />
                <span aria-hidden="true" className={`pointer-events-none absolute -top-px -right-px w-1.5 h-1.5 border-t border-r ${theme.corner}`} />
                <span aria-hidden="true" className={`pointer-events-none absolute -bottom-px -left-px w-1.5 h-1.5 border-b border-l ${theme.corner}`} />
                <span aria-hidden="true" className={`pointer-events-none absolute -bottom-px -right-px w-1.5 h-1.5 border-b border-r ${theme.corner}`} />
              </>
            )}
            <div className={`w-6 h-6 rounded-full border ${theme.medallionBg} flex items-center justify-center`}>
              <Icon className={`w-3.5 h-3.5 ${theme.ornament}`} />
            </div>
          </div>
        </>
      );
    }

    if (size === 'sm') {
      return (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 w-2 bg-gradient-to-r from-black/45 via-white/10 to-transparent"
          />
          <div
            className={`relative h-full w-full border ${theme.frameBorder} ${
              frameStyle === 'medallion-arch' ? 'rounded-t-2xl' : 'rounded-[2px]'
            } p-2 pl-2.5 flex flex-col items-center justify-between text-center`}
          >
            {frameStyle === 'classic-double' && (
              <div aria-hidden="true" className={`pointer-events-none absolute inset-1 border ${theme.innerBorder}`} />
            )}
            {frameStyle === 'archival-corners' && (
              <>
                <span aria-hidden="true" className={`pointer-events-none absolute -top-px -left-px w-2 h-2 border-t-2 border-l-2 ${theme.corner}`} />
                <span aria-hidden="true" className={`pointer-events-none absolute -top-px -right-px w-2 h-2 border-t-2 border-r-2 ${theme.corner}`} />
                <span aria-hidden="true" className={`pointer-events-none absolute -bottom-px -left-px w-2 h-2 border-b-2 border-l-2 ${theme.corner}`} />
                <span aria-hidden="true" className={`pointer-events-none absolute -bottom-px -right-px w-2 h-2 border-b-2 border-r-2 ${theme.corner}`} />
              </>
            )}
            <div className={`w-8 h-8 rounded-full border ${theme.medallionBg} flex items-center justify-center mt-1 shrink-0`}>
              <Icon className={`w-4 h-4 ${theme.ornament}`} />
            </div>
            <p className="font-serif text-[11px] leading-tight font-semibold line-clamp-2 text-white">
              {title || 'Buug'}
            </p>
            <span className="text-[9px] uppercase tracking-wider text-white/70 truncate max-w-full">
              {category || 'maktabada'}
            </span>
          </div>
        </>
      );
    }

    return (
      <>
        {/* Hardcover left book-spine groove */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-3.5 bg-gradient-to-r from-black/45 via-white/12 to-transparent"
        />

        {/* Subtle outer hardcover edge */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
        />

        {/* Ornamental Frame Container */}
        <div
          className={`relative h-full w-full border ${theme.frameBorder} ${
            frameStyle === 'medallion-arch' ? 'rounded-t-[1.85rem]' : 'rounded-[2px]'
          } p-4 pl-5 flex flex-col justify-between`}
        >
          {/* Classic Double Inner Frame */}
          {frameStyle === 'classic-double' && (
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute inset-1.5 border ${theme.innerBorder}`}
            />
          )}

          {/* Modern Grid Spine Accent */}
          {frameStyle === 'modern-grid' && (
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute inset-y-2 left-2.5 w-px border-l ${theme.innerBorder}`}
            />
          )}

          {/* Archival Corner Brackets */}
          {frameStyle === 'archival-corners' && (
            <>
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute -top-px -left-px w-3.5 h-3.5 border-t-2 border-l-2 ${theme.corner}`}
              />
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute -top-px -right-px w-3.5 h-3.5 border-t-2 border-r-2 ${theme.corner}`}
              />
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute -bottom-px -left-px w-3.5 h-3.5 border-b-2 border-l-2 ${theme.corner}`}
              />
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute -bottom-px -right-px w-3.5 h-3.5 border-b-2 border-r-2 ${theme.corner}`}
              />
            </>
          )}

          {/* Top Category Kicker */}
          <div className="flex items-center justify-between gap-2 text-[10px] tracking-[0.18em] uppercase text-white/80 font-sans">
            <span className="truncate">{category || 'Buug'}</span>
            <span aria-hidden="true" className={`w-1.5 h-1.5 rotate-45 border ${theme.corner} shrink-0`} />
          </div>

          {/* Framed Icon Medallion & Title */}
          <div className="my-auto py-2">
            <div className="flex items-center gap-2.5 mb-3">
              <div
                className={`w-11 h-11 rounded-full border ${theme.medallionBg} flex items-center justify-center shadow-inner shrink-0`}
              >
                <Icon className={`w-5 h-5 ${theme.ornament}`} />
              </div>
              <div aria-hidden="true" className={`flex-1 h-px border-t ${theme.innerBorder}`} />
            </div>

            <p className="font-serif text-lg leading-snug font-semibold line-clamp-4 text-white tracking-tight">
              {title || 'Cinwaan La’aan'}
            </p>
          </div>

          {/* Author Footer */}
          <div className={`pt-2 border-t ${theme.innerBorder} flex items-center justify-between gap-2 text-xs text-white/80`}>
            <span className="truncate">{author || 'maktabada.so'}</span>
          </div>
        </div>
      </>
    );
  };

  const paddingClass = size === 'xs' ? 'p-1' : size === 'sm' ? 'p-2' : 'p-3.5';

  return (
    <div
      className={`relative w-full ${aspectClass} bg-gradient-to-br ${theme.bg} text-[#F8F6F1] ${paddingClass} select-none overflow-hidden ${className}`}
    >
      {renderStyledLayer()}

      {showImage && (
        <>
          <img
            key={resolvedSrc}
            src={resolvedSrc}
            alt={`Jaldiga buugga ${title}`}
            referrerPolicy="no-referrer"
            decoding="async"
            loading="eager"
            onLoad={(e) => {
              if (e.currentTarget.naturalWidth === 0) {
                setFailedSrc(resolvedSrc);
              }
            }}
            onError={() => setFailedSrc(resolvedSrc)}
            className="absolute inset-0 w-full h-full object-cover object-center transition-transform duration-300 group-hover:scale-[1.02]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_rgba(28,25,23,0.10)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 w-3 bg-gradient-to-r from-black/28 via-white/12 to-transparent"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/20"
          />
        </>
      )}
    </div>
  );
}
