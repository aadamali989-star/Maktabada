import { useEffect, useState } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export function PWAInstallButton() {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  useEffect(() => {
    if (!showIOSGuide) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowIOSGuide(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [showIOSGuide]);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        aria-label="Ku shub App-ka mobilka ama kombiyuutarka"
        title="Ku shub App (Install App)"
        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#14532D] dark:bg-[#15803D] text-white rounded-lg hover:bg-[#0F3F22] dark:hover:bg-[#166534] transition-colors whitespace-nowrap shrink-0"
      >
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span className="hidden sm:inline">Ku Shub App</span>
        <span className="sm:hidden">App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          aria-label="Ku shub iPhone ama iPad"
          title="Ku shub iOS"
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-[#D6CEBE] dark:border-[#383531] bg-white dark:bg-[#1C1B19] text-[#1C1917] dark:text-[#F5F2EB] rounded-lg hover:bg-[#EFECE5] dark:hover:bg-[#292724] transition-colors whitespace-nowrap shrink-0"
        >
          <Smartphone className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden sm:inline">Ku Shub iOS</span>
          <span className="sm:hidden">App</span>
        </button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[2px] p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-install-title"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowIOSGuide(false);
            }}
          >
            <div className="w-full max-w-sm bg-[#F8F6F1] dark:bg-[#1C1B19] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl p-6 shadow-xl relative">
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                aria-label="Xir tilmaanta"
                className="absolute top-4 right-4 p-1.5 rounded-lg text-[#57534E] dark:text-[#A8A29E] hover:bg-[#EFECE5] dark:hover:bg-[#292724]"
              >
                <X className="w-4 h-4" />
              </button>

              <h3
                id="ios-install-title"
                className="font-serif text-lg font-semibold text-[#1C1917] dark:text-[#F5F2EB] pr-6"
              >
                Ku Shub iPhone / iPad
              </h3>
              <ol className="mt-3 space-y-2 text-sm text-[#57534E] dark:text-[#D6D3CD] leading-relaxed list-decimal list-inside">
                <li>
                  Riix calaamadda{' '}
                  <span className="inline-flex items-center gap-1 font-medium text-[#1C1917] dark:text-[#F5F2EB]">
                    <Share className="w-3.5 h-3.5 inline" /> Share
                  </span>{' '}
                  ee hoose ama sare ee Safari.
                </li>
                <li>
                  Hoos u rog oo dooro{' '}
                  <strong className="text-[#1C1917] dark:text-[#F5F2EB]">
                    Add to Home Screen
                  </strong>
                  .
                </li>
              </ol>

              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full py-2 text-xs font-medium bg-[#14532D] dark:bg-[#15803D] text-white rounded-lg hover:bg-[#0F3F22] dark:hover:bg-[#166534] transition-colors"
              >
                Fahmay
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}
