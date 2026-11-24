import { useMemo, useState } from 'react';
import { Award, BookOpen, Check, Crown, Flame, Lock, ShieldCheck, Trophy } from 'lucide-react';
import type { ReadingStreakSummary } from '../services/libraryService';

interface StreakBadgesProps {
  readingStreak?: ReadingStreakSummary;
  loading?: boolean;
}

interface StreakBadgeDefinition {
  id: string;
  title: string;
  somaliTitle: string;
  targetDays: number;
  description: string;
  icon: 'flame' | 'book' | 'award' | 'shield' | 'trophy' | 'crown';
  accentClass: string;
  medallionBgClass: string;
  unlockedBorderClass: string;
}

const STREAK_BADGES: StreakBadgeDefinition[] = [
  {
    id: 'first-step',
    title: 'Day-1 Reader',
    somaliTitle: 'Tallaabada Koowaad',
    targetDays: 1,
    description: 'Dhammaystir ugu yaraan 1 maalin oo akhris ah (15+ daqiiqo).',
    icon: 'flame',
    accentClass: 'text-[#9A3412] dark:text-[#FB923C]',
    medallionBgClass: 'bg-[#9A3412]/12 dark:bg-[#FB923C]/15',
    unlockedBorderClass: 'border-[#9A3412]/30 dark:border-[#FB923C]/35',
  },
  {
    id: 'three-day-habit',
    title: '3-Day Habit',
    somaliTitle: 'Caado Cusub',
    targetDays: 3,
    description: 'Akhri 3 maalmood oo xiriir ah adigoon kala goyn.',
    icon: 'book',
    accentClass: 'text-[#B45309] dark:text-[#FBBF24]',
    medallionBgClass: 'bg-[#B45309]/12 dark:bg-[#FBBF24]/15',
    unlockedBorderClass: 'border-[#B45309]/30 dark:border-[#FBBF24]/35',
  },
  {
    id: 'one-week-reader',
    title: '1-Week Reader',
    somaliTitle: 'Akhristaha Toddobaadka',
    targetDays: 7,
    description: 'Ilaali akhriska maalinlaha ah muddo 7 maalmood oo xiriir ah.',
    icon: 'award',
    accentClass: 'text-[#14532D] dark:text-[#4ADE80]',
    medallionBgClass: 'bg-[#14532D]/12 dark:bg-[#4ADE80]/15',
    unlockedBorderClass: 'border-[#14532D]/35 dark:border-[#4ADE80]/35',
  },
  {
    id: 'fortnight-scholar',
    title: '14-Day Scholar',
    somaliTitle: 'Aqoonyahan Joogto ah',
    targetDays: 14,
    description: 'Sii wad akhriskaaga maalin kasta muddo 14 maalmood oo xiriir ah.',
    icon: 'shield',
    accentClass: 'text-[#1E3A8A] dark:text-[#60A5FA]',
    medallionBgClass: 'bg-[#1E3A8A]/12 dark:bg-[#60A5FA]/15',
    unlockedBorderClass: 'border-[#1E3A8A]/30 dark:border-[#60A5FA]/35',
  },
  {
    id: 'monthly-marathoner',
    title: 'Monthly Marathoner',
    somaliTitle: 'Horyaalka Bisha',
    targetDays: 30,
    description: 'Gaar 30 maalmood oo xiriir ah oo akhris joogto ah.',
    icon: 'trophy',
    accentClass: 'text-[#78350F] dark:text-[#F59E0B]',
    medallionBgClass: 'bg-[#78350F]/12 dark:bg-[#F59E0B]/15',
    unlockedBorderClass: 'border-[#78350F]/35 dark:border-[#F59E0B]/35',
  },
  {
    id: 'century-legend',
    title: '100-Day Legend',
    somaliTitle: 'Xiddigga Maktabadda',
    targetDays: 100,
    description: 'Guul sare: 100 maalmood oo xiriir ah oo akhris joogto ah.',
    icon: 'crown',
    accentClass: 'text-[#14532D] dark:text-[#34D399]',
    medallionBgClass: 'bg-[#14532D]/15 dark:bg-[#34D399]/15',
    unlockedBorderClass: 'border-[#14532D]/40 dark:border-[#34D399]/40',
  },
];

function renderBadgeIcon(icon: StreakBadgeDefinition['icon'], className: string) {
  switch (icon) {
    case 'flame':
      return <Flame className={className} />;
    case 'book':
      return <BookOpen className={className} />;
    case 'award':
      return <Award className={className} />;
    case 'shield':
      return <ShieldCheck className={className} />;
    case 'trophy':
      return <Trophy className={className} />;
    case 'crown':
      return <Crown className={className} />;
  }
}

export function StreakBadges({ readingStreak, loading = false }: StreakBadgesProps) {
  const [selectedBadgeId, setSelectedBadgeId] = useState<string | null>(null);

  const currentStreak = readingStreak?.currentStreak ?? 0;
  const longestStreak = readingStreak?.longestStreak ?? 0;
  const bestStreak = Math.max(currentStreak, longestStreak);

  const { unlockedCount, nextBadge } = useMemo(() => {
    const unlocked = STREAK_BADGES.filter((b) => bestStreak >= b.targetDays);
    const upcoming = STREAK_BADGES.find((b) => bestStreak < b.targetDays) || null;
    return {
      unlockedCount: unlocked.length,
      nextBadge: upcoming,
    };
  }, [bestStreak]);

  const selectedBadge = useMemo(
    () => STREAK_BADGES.find((b) => b.id === selectedBadgeId) || nextBadge || STREAK_BADGES[0],
    [selectedBadgeId, nextBadge]
  );

  const nextProgressPct = nextBadge
    ? Math.min(100, Math.round((currentStreak / nextBadge.targetDays) * 100))
    : 100;

  return (
    <div
      aria-label="Reading Streak Badges"
      className="mb-3 bg-white dark:bg-[#1F1E1C] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl p-4"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-xs tracking-widest uppercase text-[#78716C] dark:text-[#A8A29E]">
            Reading Badges
          </p>
          <p className="text-sm font-medium text-[#1C1917] dark:text-[#F5F2EB] mt-0.5">
            Abaalmarinnada Joogtaynta Akhriska
          </p>
        </div>

        <span className="font-mono text-xs tabular-nums text-[#14532D] dark:text-[#4ADE80] shrink-0">
          {loading ? '...' : `${unlockedCount}/${STREAK_BADGES.length} La Furay`}
        </span>
      </div>

      {/* Next Badge Progress Strip */}
      {!loading && nextBadge && (
        <div className="mb-3.5 pb-3.5 border-b border-[#EFECE5] dark:border-[#2E2C29]">
          <div className="flex items-center justify-between gap-2 text-xs mb-1.5">
            <span className="text-[#57534E] dark:text-[#A8A29E] truncate">
              Xiga: <strong className="text-[#1C1917] dark:text-[#F5F2EB]">{nextBadge.title}</strong>
            </span>
            <span className="font-mono tabular-nums text-[#78716C] dark:text-[#A8A29E] shrink-0">
              {currentStreak}/{nextBadge.targetDays} maalmood
            </span>
          </div>
          <div
            className="h-1.5 w-full bg-[#EFECE5] dark:bg-[#2E2C29] rounded-full overflow-hidden"
            aria-hidden="true"
          >
            <svg
              className="w-full h-full block"
              viewBox="0 0 100 6"
              preserveAspectRatio="none"
            >
              <rect
                x="0"
                y="0"
                width={nextProgressPct}
                height="6"
                rx="3"
                className="fill-[#14532D] dark:fill-[#4ADE80] transition-all duration-300"
              />
            </svg>
          </div>
        </div>
      )}

      {/* Badge Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {STREAK_BADGES.map((badge) => {
          const unlocked = !loading && bestStreak >= badge.targetDays;
          const isSelected = selectedBadge?.id === badge.id;

          return (
            <button
              key={badge.id}
              type="button"
              onClick={() => setSelectedBadgeId(badge.id)}
              aria-pressed={isSelected}
              className={`group text-left rounded-xl p-3 border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14532D] ${
                unlocked
                  ? `bg-[#F8F6F1]/75 dark:bg-[#242320] ${badge.unlockedBorderClass} hover:bg-[#EFECE5]/70 dark:hover:bg-[#292724]`
                  : 'bg-[#F8F6F1]/40 dark:bg-[#191816] border-dashed border-[#D6CEBE] dark:border-[#2E2C29] hover:border-[#A8A29E] dark:hover:border-[#4A4640]'
              } ${isSelected ? 'ring-1 ring-[#14532D]/40 dark:ring-[#4ADE80]/40' : ''}`}
            >
              <div className="flex items-start justify-between gap-2 mb-2.5">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-150 group-hover:scale-[1.03] ${
                    unlocked
                      ? `${badge.medallionBgClass} ${badge.accentClass}`
                      : 'bg-[#EFECE5] dark:bg-[#292724] text-[#A8A29E] dark:text-[#78716C]'
                  }`}
                >
                  {renderBadgeIcon(badge.icon, 'w-5 h-5')}
                </div>

                {unlocked ? (
                  <span
                    title="La Furay"
                    className="inline-flex items-center gap-0.5 text-[10px] font-medium text-[#14532D] dark:text-[#4ADE80]"
                  >
                    <Check className="w-3 h-3" />
                    <span>Furmay</span>
                  </span>
                ) : (
                  <span
                    title="Xiran"
                    className="inline-flex items-center gap-0.5 text-[10px] font-mono tabular-nums text-[#78716C] dark:text-[#A8A29E]"
                  >
                    <Lock className="w-3 h-3" />
                    <span>{badge.targetDays}d</span>
                  </span>
                )}
              </div>

              <p
                className={`text-xs font-semibold leading-snug truncate ${
                  unlocked
                    ? 'text-[#1C1917] dark:text-[#F5F2EB]'
                    : 'text-[#57534E] dark:text-[#A8A29E]'
                }`}
              >
                {badge.title}
              </p>
              <p className="text-[11px] text-[#78716C] dark:text-[#A8A29E] truncate mt-0.5">
                {badge.somaliTitle}
              </p>
            </button>
          );
        })}
      </div>

      {/* Selected Badge Details Footer */}
      {selectedBadge && (
        <div className="mt-3 pt-3 border-t border-[#EFECE5] dark:border-[#2E2C29] flex flex-wrap items-center justify-between gap-2 text-xs">
          <p className="text-[#57534E] dark:text-[#A8A29E] leading-relaxed">
            <strong className="text-[#1C1917] dark:text-[#F5F2EB]">{selectedBadge.title}:</strong>{' '}
            {selectedBadge.description}
          </p>
          <span className="font-mono tabular-nums text-[11px] text-[#78716C] dark:text-[#A8A29E] shrink-0">
            {bestStreak >= selectedBadge.targetDays
              ? `Guul: ${selectedBadge.targetDays}+ maalmood`
              : `${Math.max(1, selectedBadge.targetDays - currentStreak)} maalmood ayaa haray`}
          </span>
        </div>
      )}
    </div>
  );
}
