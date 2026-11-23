import { BLUEPRINT_LIMITS } from '../types';

const REMINDER_SETTINGS_PREFIX = 'maktabada_daily_reminder_settings_';
const REMINDER_SENT_DATE_PREFIX = 'maktabada_daily_reminder_sent_';
const REMINDER_DISMISSED_DATE_PREFIX = 'maktabada_daily_reminder_dismissed_';

export interface DailyReminderSettings {
  enabled: boolean;
  time: string;
}

export function normalizeReminderTime(raw?: string): string {
  const trimmed = (raw || '').trim();
  if (BLUEPRINT_LIMITS.user.reminderTimePattern.test(trimmed)) {
    return trimmed;
  }
  return BLUEPRINT_LIMITS.user.reminderTimeDefault;
}

export function readCachedDailyReminder(uid?: string): DailyReminderSettings {
  const fallback: DailyReminderSettings = {
    enabled: false,
    time: BLUEPRINT_LIMITS.user.reminderTimeDefault,
  };
  try {
    const raw = window.localStorage.getItem(`${REMINDER_SETTINGS_PREFIX}${uid || 'guest'}`);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { enabled?: unknown; time?: unknown };
    return {
      enabled: Boolean(parsed.enabled),
      time: normalizeReminderTime(typeof parsed.time === 'string' ? parsed.time : undefined),
    };
  } catch {
    return fallback;
  }
}

export function writeCachedDailyReminder(
  uid: string | undefined,
  settings: DailyReminderSettings
): void {
  try {
    window.localStorage.setItem(
      `${REMINDER_SETTINGS_PREFIX}${uid || 'guest'}`,
      JSON.stringify({
        enabled: Boolean(settings.enabled),
        time: normalizeReminderTime(settings.time),
      })
    );
  } catch {
    // Ignore storage quota/private mode errors
  }
}

export function getLocalTimeHHMM(date: Date = new Date()): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function getLastReminderSentDate(uid?: string): string {
  try {
    return window.localStorage.getItem(`${REMINDER_SENT_DATE_PREFIX}${uid || 'guest'}`) || '';
  } catch {
    return '';
  }
}

export function markReminderSentDate(uid: string | undefined, dateKey: string): void {
  try {
    window.localStorage.setItem(`${REMINDER_SENT_DATE_PREFIX}${uid || 'guest'}`, dateKey);
  } catch {
    // Ignore storage restrictions
  }
}

export function getReminderDismissedDate(uid?: string): string {
  try {
    return window.localStorage.getItem(`${REMINDER_DISMISSED_DATE_PREFIX}${uid || 'guest'}`) || '';
  } catch {
    return '';
  }
}

export function markReminderDismissedDate(uid: string | undefined, dateKey: string): void {
  try {
    window.localStorage.setItem(`${REMINDER_DISMISSED_DATE_PREFIX}${uid || 'guest'}`, dateKey);
  } catch {
    // Ignore storage restrictions
  }
}

export function isBrowserNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getBrowserNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!isBrowserNotificationSupported()) {
    return 'unsupported';
  }
  return window.Notification.permission;
}

export async function requestBrowserNotificationPermission(): Promise<
  NotificationPermission | 'unsupported'
> {
  if (!isBrowserNotificationSupported()) {
    return 'unsupported';
  }
  if (window.Notification.permission === 'granted') {
    return 'granted';
  }
  try {
    return await window.Notification.requestPermission();
  } catch {
    return window.Notification.permission;
  }
}

export async function showDailyReadingBrowserNotification(params: {
  title: string;
  body: string;
  tag?: string;
}): Promise<boolean> {
  if (getBrowserNotificationPermission() !== 'granted') {
    return false;
  }

  const options: NotificationOptions = {
    body: params.body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: params.tag || 'maktabada-daily-reading-reminder',
  };

  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration && typeof registration.showNotification === 'function') {
        await registration.showNotification(params.title, options);
        return true;
      }
    }
  } catch {
    // Fall back to standard Notification constructor below
  }

  try {
    const notification = new window.Notification(params.title, options);
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    return true;
  } catch {
    return false;
  }
}
