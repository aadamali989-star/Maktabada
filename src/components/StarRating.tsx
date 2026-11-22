import { useState } from 'react';
import { Star } from 'lucide-react';

interface StarRatingProps {
  ratingSum?: number;
  ratingCount?: number;
  userRating?: number;
  disabled?: boolean;
  darkSurface?: boolean;
  variant?: 'card' | 'detail';
  onRate?: (rating: number) => void;
}

export function StarRating({
  ratingSum = 0,
  ratingCount = 0,
  userRating = 0,
  disabled = false,
  darkSurface = false,
  variant = 'card',
  onRate,
}: StarRatingProps) {
  const [hoverStar, setHoverStar] = useState<number>(0);

  const safeCount = Math.max(0, ratingCount);
  const safeSum = Math.max(0, ratingSum);
  const average = safeCount > 0 ? safeSum / safeCount : 0;
  const displayFill = hoverStar > 0 ? hoverStar : userRating > 0 ? userRating : Math.round(average);

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 ${
        variant === 'detail' ? 'py-1' : ''
      }`}
    >
      <div
        className="flex items-center gap-0.5"
        onMouseLeave={() => setHoverStar(0)}
        role="group"
        aria-label="Qiimaynta buugga"
      >
        {[1, 2, 3, 4, 5].map((star) => {
          const isFilled = star <= displayFill;
          const isUserChoice = hoverStar === 0 && userRating > 0 && star <= userRating;
          return (
            <button
              key={star}
              type="button"
              disabled={disabled || !onRate}
              onMouseEnter={() => {
                if (!disabled && onRate) setHoverStar(star);
              }}
              onClick={() => onRate?.(star)}
              aria-label={`Qiimee ${star} xiddig`}
              title={`Qiimee ${star} / 5`}
              className={`p-1 rounded transition-transform duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14532D] ${
                onRate && !disabled
                  ? 'cursor-pointer hover:scale-110 active:scale-95'
                  : 'cursor-default'
              }`}
            >
              <Star
                className={`${variant === 'detail' ? 'w-4 h-4' : 'w-3.5 h-3.5'} transition-colors ${
                  isFilled
                    ? isUserChoice || hoverStar > 0
                      ? darkSurface
                        ? 'fill-[#F59E0B] text-[#F59E0B]'
                        : 'fill-[#92400E] text-[#92400E] dark:fill-[#F59E0B] dark:text-[#F59E0B]'
                      : darkSurface
                      ? 'fill-[#D97706] text-[#D97706]'
                      : 'fill-[#B45309] text-[#B45309] dark:fill-[#D97706] dark:text-[#D97706]'
                    : darkSurface
                    ? 'text-[#57534E]'
                    : 'text-[#D6CEBE] dark:text-[#57534E]'
                }`}
              />
            </button>
          );
        })}
      </div>

      <div
        className={`flex items-center gap-1.5 text-xs whitespace-nowrap ${
          darkSurface ? 'text-[#A8A29E]' : 'text-[#78716C] dark:text-[#A8A29E]'
        }`}
      >
        {safeCount > 0 ? (
          <>
            <span
              className={`font-mono font-medium tabular-nums ${
                darkSurface ? 'text-[#F5F5F4]' : 'text-[#1C1917] dark:text-[#F5F2EB]'
              }`}
            >
              {average.toFixed(1)}
            </span>
            <span className="font-mono tabular-nums">({safeCount})</span>
          </>
        ) : (
          <span>Weli lama qiimayn</span>
        )}
        {userRating > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <span
              className={`font-medium tabular-nums ${
                darkSurface ? 'text-[#FBBF24]' : 'text-[#92400E] dark:text-[#FBBF24]'
              }`}
            >
              {variant === 'detail' ? `Qiimayntaada: ${userRating}/5` : `Adiga: ${userRating}`}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
