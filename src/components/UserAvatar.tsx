import { useEffect, useState } from 'react';

interface UserAvatarProps {
  src?: string | null;
  name: string;
  sizeClass?: string;
  textClass?: string;
  className?: string;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'A';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function UserAvatar({
  src,
  name,
  sizeClass = 'w-8 h-8',
  textClass = 'text-xs',
  className = '',
}: UserAvatarProps) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [src]);

  const cleanSrc = typeof src === 'string' ? src.trim() : '';

  return (
    <span
      className={`${sizeClass} rounded-full overflow-hidden bg-[#14532D] text-white flex items-center justify-center font-serif font-semibold shrink-0 select-none ${className}`}
    >
      {cleanSrc && !hasError ? (
        <img
          src={cleanSrc}
          alt={`Sawirka ${name || 'isticmaalaha'}`}
          referrerPolicy="no-referrer"
          onError={() => setHasError(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <span className={textClass}>{getInitials(name || 'A')}</span>
      )}
    </span>
  );
}
