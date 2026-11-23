import { useEffect, useState, type FormEvent } from 'react';
import {
  Bell,
  BellOff,
  BellRing,
  BookOpen,
  Check,
  Clock,
  Flame,
  ShieldCheck,
  Target,
  X,
} from 'lucide-react';
import { normalizeReminderTime } from '../services/dailyReminderService';

interface DailyNotificationModalProps {
  open: boolean;
  enabled: boolean;
  time: string;
  goalMinutes: number;
  todaySeconds: number;
  currentStreak: number;
  isLoggedIn: boolean;
  saving: boolean;
  errorMsg: string | null;
  permission: NotificationPermission | 'unsupported';
  activeBanner: { title: string; body: string } | null;
  onClose: () => void;
  onToggleEnabled: () => Promise<void>;
  onSaveTime: (nextTime: string) => Promise<void>;
  onRequestPermission: () => Promise<void>;
  onSendTestNotification: () => Promise<void>;
  onStartReading: () => void;
  onOpenProfile?: () => void;
}

function getOneMinuteFromNowHHMM(): string {
  const target = new Date(Date.now() + 60 * 1000);
  const hours = String(target.getHours()).padStart(2, '0');
  const minutes = String(target.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function DailyNotificationModal({
  open,
  enabled,
  time,
  goalMinutes,
  todaySeconds,
  currentStreak,
  isLoggedIn,
  saving,
  errorMsg,
  permission,
  activeBanner,
  onClose,
  onToggleEnabled,
  onSaveTime,
  onRequestPermission,
  onSendTestNotification,
  onStartReading,
  onOpenProfile,
}: DailyNotificationModalProps) {
  const [timeInput, setTimeInput] = useState<string>(normalizeReminderTime(time));
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setTimeInput(normalizeReminderTime(time));
  }, [time, open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const cleanInputTime = normalizeReminderTime(timeInput);
  const cleanSavedTime = normalizeReminderTime(time);
  const isTimeDirty = cleanInputTime !== cleanSavedTime;

  const todayMinutesWhole = Math.floor(todaySeconds / 60);
  const goalSeconds = goalMinutes * 60;
  const goalPercentage =
    goalSeconds > 0 ? Math.min(100, Math.round((todaySeconds / goalSeconds) * 100)) : 0;
  const remainingMinutes = Math.max(0, Math.ceil((goalSeconds - todaySeconds) / 60));
  const goalReached = todaySeconds >= goalSeconds;

  const presets = ['08:00', '13:00', '20:00', '21:30'];

  const handleFormSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await onSaveTime(cleanInputTime);
  };

  const handleQuickNextMinute = async () => {
    const nextMin = getOneMinuteFromNowHHMM();
    setTimeInput(nextMin);
    await onSaveTime(nextMin);
  };

  const handleTestClick = async () => {
    setTesting(true);
    try {
      await onSendTestNotification();
    } finally {
      setTesting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="daily-notification-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto bg-[#F8F6F1] dark:bg-[#161514] text-[#1C1917] dark:text-[#F5F2EB] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 px-6 py-4 bg-[#F8F6F1]/95 dark:bg-[#161514]/95 backdrop-blur-sm border-b border-[#E5E0D5] dark:border-[#2E2C29] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                enabled
                  ? 'bg-[#14532D] dark:bg-[#15803D] text-white'
                  : 'bg-[#EFECE5] dark:bg-[#292724] text-[#57534E] dark:text-[#A8A29E]'
              }`}
            >
              {enabled ? <BellRing className="w-5 h-5" /> : <Bell className="w-5 h-5" />}
            </div>
            <div className="min-w-0">
              <p className="text-[11px] tracking-widest uppercase text-[#78716C] dark:text-[#A8A29E]">
                Daily Notification
              </p>
              <h2
                id="daily-notification-modal-title"
                className="font-serif text-xl font-semibold text-[#1C1917] dark:text-[#F5F2EB] truncate"
              >
                Xasuusinta Akhriska Maalinlaha ah
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Xir daaqadda xasuusinta"
            className="p-2 rounded-lg text-[#57534E] dark:text-[#A8A29E] hover:text-[#1C1917] dark:hover:text-[#F5F2EB] hover:bg-[#EFECE5] dark:hover:bg-[#292724] transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Primary Enable/Disable Switch Card */}
          <div className="bg-white dark:bg-[#1F1E1C] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl p-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    enabled ? 'bg-[#15803D] dark:bg-[#4ADE80]' : 'bg-[#A8A29E]'
                  }`}
                />
                <span className="text-sm font-semibold text-[#1C1917] dark:text-[#F5F2EB]">
                  {enabled ? `Shidan · Maalin kasta ${cleanSavedTime}` : 'Xasuusintu way dansan tahay'}
                </span>
              </div>
              <p className="text-xs text-[#57534E] dark:text-[#A8A29E] mt-1">
                {enabled
                  ? 'Markii saacaddaadu gasho ayaad heli doontaa xasuusin haddii aadan weli gaarin hadafkaaga maanta.'
                  : 'Daar si aad maalin kasta u hesho xasuusin waqtiga aad doorato.'}
              </p>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label="Daar ama dami xasuusinta maalinlaha ah"
              disabled={saving}
              onClick={() => void onToggleEnabled()}
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14532D] disabled:opacity-60 ${
                enabled
                  ? 'bg-[#14532D] dark:bg-[#15803D] border-[#14532D] dark:border-[#15803D]'
                  : 'bg-[#EFECE5] dark:bg-[#2E2C29] border-[#D6CEBE] dark:border-[#383531]'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                  enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Today's Reading Goal & Streak Preview */}
          <div className="bg-white dark:bg-[#1F1E1C] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-medium text-[#1C1917] dark:text-[#F5F2EB]">
                <Target className="w-4 h-4 text-[#14532D] dark:text-[#4ADE80]" />
                <span>Hadafka Maanta: {todayMinutesWhole}/{goalMinutes} daqiiqo</span>
              </div>
              <div className="flex items-center gap-1 text-xs font-mono tabular-nums text-[#9A3412] dark:text-[#FB923C]">
                <Flame className="w-3.5 h-3.5" />
                <span>{currentStreak} maalmood</span>
              </div>
            </div>

            <div className="h-2 w-full bg-[#EFECE5] dark:bg-[#2E2C29] rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  goalReached
                    ? 'bg-[#14532D] dark:bg-[#22C55E]'
                    : 'bg-[#15803D] dark:bg-[#4ADE80]'
                }`}
                style={{ width: `${goalPercentage}%` }}
              />
            </div>

            <div className="flex items-center justify-between gap-2 text-xs text-[#57534E] dark:text-[#A8A29E]">
              <span>
                {goalReached
                  ? 'Hadafkaaga maanta waa la dhammaystiray!'
                  : `${remainingMinutes} daqiiqo oo kale ayaa kuu haray maanta.`}
              </span>
              {isLoggedIn && onOpenProfile && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenProfile();
                  }}
                  className="text-[#14532D] dark:text-[#4ADE80] font-medium hover:underline whitespace-nowrap shrink-0"
                >
                  Beddel Hadafka
                </button>
              )}
            </div>
          </div>

          {/* Schedule Time Picker */}
          <form
            onSubmit={handleFormSubmit}
            className="bg-white dark:bg-[#1F1E1C] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl p-4 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="modal-daily-reminder-time"
                className="text-xs font-semibold uppercase tracking-wider text-[#78716C] dark:text-[#A8A29E]"
              >
                Dooro Waqtiga Xasuusinta
              </label>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleQuickNextMinute()}
                className="text-xs font-medium text-[#14532D] dark:text-[#4ADE80] hover:underline disabled:opacity-50"
              >
                Deji +1 daqiiqo (Tijaabo)
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {presets.map((preset) => {
                const active = cleanInputTime === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setTimeInput(preset)}
                    className={`px-3 py-1.5 text-xs font-mono tabular-nums rounded-lg border transition-colors ${
                      active
                        ? 'bg-[#14532D] dark:bg-[#15803D] border-[#14532D] dark:border-[#15803D] text-white'
                        : 'bg-[#F8F6F1] dark:bg-[#242320] border-[#E5E0D5] dark:border-[#383531] text-[#1C1917] dark:text-[#F5F2EB] hover:border-[#14532D]'
                    }`}
                  >
                    {preset}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[140px]">
                <Clock className="w-4 h-4 text-[#78716C] dark:text-[#A8A29E] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="modal-daily-reminder-time"
                  type="time"
                  required
                  value={timeInput}
                  onChange={(e) => setTimeInput(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-[#F8F6F1] dark:bg-[#242320] border border-[#D6CEBE] dark:border-[#383531] rounded-lg text-sm font-mono tabular-nums text-[#1C1917] dark:text-[#F5F2EB] focus:outline-none focus:ring-2 focus:ring-[#14532D]/40 focus:border-[#14532D]"
                />
              </div>

              <button
                type="submit"
                disabled={saving || (!isTimeDirty && enabled)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-[#14532D] dark:bg-[#15803D] text-white rounded-lg hover:bg-[#0F3F22] dark:hover:bg-[#166534] transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{saving ? 'Kaydinaya...' : enabled ? 'Kaydi Waqtiga' : 'Daar & Kaydi'}</span>
              </button>
            </div>

            {!isLoggedIn && (
              <p className="text-[11px] text-[#78716C] dark:text-[#A8A29E]">
                Dejintaada waxaa lagu kaydinayaa browser-kaagan. Soo gal si loogu kaydiyo akoonkaaga Firebase meel kasta.
              </p>
            )}
          </form>

          {/* Browser / PWA Permission & Instant Test */}
          <div className="bg-white dark:bg-[#1F1E1C] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <ShieldCheck className="w-4 h-4 text-[#14532D] dark:text-[#4ADE80] mt-0.5 shrink-0" />
                <div className="text-xs">
                  <p className="font-medium text-[#1C1917] dark:text-[#F5F2EB]">
                    {permission === 'granted'
                      ? 'Browser Notifications: Waa La Oggolaaday'
                      : permission === 'denied'
                      ? 'Browser Notifications: Waa La Xannibay'
                      : permission === 'unsupported'
                      ? 'Browser-kan ma taageero Push Notifications'
                      : 'Browser Notifications: Weli Lama Oggolaan'}
                  </p>
                  <p className="text-[#57534E] dark:text-[#A8A29E] mt-0.5">
                    {permission === 'granted'
                      ? 'Waxaad heli doontaa ogeysiiska Browser/PWA iyo baaqa gudaha website-ka labadaba.'
                      : 'Xitaa haddii browser notification-ku xiran yahay, xasuusinta bogga sare ee website-ka si toos ah ayay kuu soo baxaysaa.'}
                  </p>
                </div>
              </div>

              {permission === 'default' && (
                <button
                  type="button"
                  onClick={() => void onRequestPermission()}
                  className="px-3 py-1.5 text-xs font-medium bg-[#EFECE5] dark:bg-[#292724] text-[#1C1917] dark:text-[#F5F2EB] rounded-lg hover:bg-[#E5E0D5] dark:hover:bg-[#383531] transition-colors whitespace-nowrap shrink-0"
                >
                  Oggolow
                </button>
              )}
            </div>

            <div className="pt-3 border-t border-[#EFECE5] dark:border-[#2E2C29] flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                disabled={testing}
                onClick={() => void handleTestClick()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-[#14532D] dark:bg-[#15803D] text-white rounded-lg hover:bg-[#0F3F22] dark:hover:bg-[#166534] transition-colors disabled:opacity-60 whitespace-nowrap"
              >
                <BellRing className="w-3.5 h-3.5" />
                <span>{testing ? 'Diraya...' : 'Dir Ogeysiis Tijaabo ah Hadda'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onClose();
                  onStartReading();
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-[#D6CEBE] dark:border-[#383531] text-[#1C1917] dark:text-[#F5F2EB] rounded-lg hover:bg-[#F8F6F1] dark:hover:bg-[#292724] transition-colors whitespace-nowrap"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Akhri Buug Hadda</span>
              </button>
            </div>
          </div>

          {activeBanner && (
            <div className="bg-[#14532D]/[0.07] dark:bg-[#15803D]/20 border border-[#14532D]/25 dark:border-[#22C55E]/30 rounded-xl p-4">
              <p className="text-xs font-semibold text-[#14532D] dark:text-[#4ADE80]">
                {activeBanner.title}
              </p>
              <p className="text-xs text-[#1C1917] dark:text-[#F5F2EB] mt-1">
                {activeBanner.body}
              </p>
            </div>
          )}

          {!enabled && !activeBanner && (
            <div className="flex items-center gap-2 text-xs text-[#78716C] dark:text-[#A8A29E] px-1">
              <BellOff className="w-3.5 h-3.5 shrink-0" />
              <span>Riix batoonka kore si aad u shiddo xasuusinta maalinlaha ah, ama tijaabi hadda.</span>
            </div>
          )}

          {errorMsg && (
            <p role="alert" className="text-xs text-[#991B1B] dark:text-[#FCA5A5]">
              {errorMsg}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
