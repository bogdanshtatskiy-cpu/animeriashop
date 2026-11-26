type Insets = { top: number; right: number; bottom: number; left: number };
interface TelegramApp {
  initData: string;
  initDataUnsafe?: { user?: { id: number; first_name: string; last_name?: string; username?: string; photo_url?: string }; start_param?: string };
  contentSafeAreaInset?: Insets;
  viewportHeight?: number;
  safeAreaInset?: Insets;
  ready(): void;
  expand(): void;
  isVersionAtLeast(version: string): boolean;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  setBottomBarColor?(color: string): void;
  onEvent(event: string, handler: () => void): void;
  offEvent(event: string, handler: () => void): void;
  BackButton?: { show(): void; hide(): void; onClick(handler: () => void): void; offClick(handler: () => void): void };
  HapticFeedback?: { impactOccurred(style: 'light'): void };
}

declare global {
  interface Window { Telegram?: { WebApp?: TelegramApp } }
}
export const telegram = () => window.Telegram?.WebApp;
export const telegramUser = () => telegram()?.initDataUnsafe?.user;
export const inTelegram = () => Boolean(telegram()?.initData);
export const haptic = () => {
  const app = telegram();
  if (app?.isVersionAtLeast('6.1')) app.HapticFeedback?.impactOccurred('light');
};

export function telegramLink(productId?: string) {
  const bot = import.meta.env.VITE_TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, '');
  if (!bot || !/^[\w]{5,32}$/.test(bot)) return '';
  return 'https://t.me/' + bot + (productId && /^[\w-]{1,128}$/.test(productId) ? '?startapp=p_' + productId : '');
}
