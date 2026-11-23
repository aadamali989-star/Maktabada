export type UserRole = 'user' | 'admin';

export type BookFileType = 'pdf' | 'epub' | 'txt' | 'article';

export type ReaderTheme = 'light' | 'sepia' | 'dark';

export type AppSection = 'library' | 'favorites' | 'offline' | 'admin';

export interface OfflineBookRecord {
  book: Book;
  savedAt: number;
  sizeBytes: number;
}

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  bio?: string;
  avatarUrl?: string;
  dailyReadingGoalMinutes?: number;
  dailyReminderEnabled?: boolean;
  dailyReminderTime?: string;
  favorites: string[];
  online: boolean;
  lastSeen: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface PresenceRecord {
  online: boolean;
  lastSeen: number | unknown | null;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  category: string;
  description: string;
  coverUrl: string;
  fileUrl: string;
  fileName: string;
  fileType: BookFileType;
  allowDownload: boolean;
  published: boolean;
  contentText: string;
  createdBy: string;
  ratingSum?: number;
  ratingCount?: number;
  createdAt: unknown;
  updatedAt: unknown;
  isStarter?: boolean;
}

export interface BookRating {
  userId: string;
  bookId: string;
  rating: number;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface ReadingProgress {
  userId: string;
  bookId: string;
  percentage: number;
  currentPage: number;
  totalPages: number;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface DailyReadingLog {
  userId: string;
  dateKey: string;
  secondsRead: number;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface BookComment {
  id: string;
  userId: string;
  bookId: string;
  authorName: string;
  text: string;
  published: boolean;
  createdAt: unknown;
  updatedAt: unknown;
}

// Validation boundaries synced verbatim with firebase-blueprint.json & firestore.rules
export const BLUEPRINT_LIMITS = {
  idPattern: /^[a-zA-Z0-9_-]+$/,
  idMaxLength: 128,
  user: {
    nameMin: 1,
    nameMax: 120,
    emailMin: 3,
    emailMax: 180,
    bioMax: 400,
    avatarUrlMax: 12000,
    favoritesMax: 100,
    dailyGoalMin: 5,
    dailyGoalMax: 480,
    dailyGoalDefault: 15,
    reminderTimePattern: /^([01][0-9]|2[0-3]):[0-5][0-9]$/,
    reminderTimeDefault: '20:00',
  },
  book: {
    titleMin: 1,
    titleMax: 180,
    authorMin: 1,
    authorMax: 120,
    categoryMin: 1,
    categoryMax: 80,
    descriptionMax: 2000,
    urlMax: 2000,
    coverUrlMax: 120000,
    fileNameMax: 255,
    contentTextMax: 50000,
    ratingMin: 1,
    ratingMax: 5,
  },
  progress: {
    percentageMin: 0,
    percentageMax: 100,
    pageMin: 1,
    pageMax: 10000,
  },
  readingLog: {
    dateKeyPattern: /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/,
    secondsMin: 0,
    secondsMax: 86400,
    streakThresholdSeconds: 900,
  },
  comment: {
    authorNameMin: 1,
    authorNameMax: 120,
    textMin: 1,
    textMax: 1500,
  },
} as const;
