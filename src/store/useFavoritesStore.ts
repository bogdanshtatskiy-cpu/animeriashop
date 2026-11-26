import { create } from 'zustand';
import { api } from '../lib/api';
import { inTelegram, telegramUser } from '../lib/telegram';

function storageKey() {
  return 'animeria-favorites-' + (telegramUser()?.id ?? 'guest');
}

function readCache(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey()) ?? '[]');
    return Array.isArray(value) ? value.filter(id => typeof id === 'string') : [];
  } catch { return []; }
}

function writeCache(items: string[]) {
  try { localStorage.setItem(storageKey(), JSON.stringify(items)); } catch { /* storage unavailable */ }
}

interface FavoritesState {
  favorites: string[];
  pending: string[];
  loading: boolean;
  error: string;
  loadFavorites: () => Promise<void>;
  toggleFavorite: (productId: string) => Promise<void>;
}

const setFavorite = (items: string[], id: string, enabled: boolean) =>
  enabled ? [...new Set([...items, id])] : items.filter(item => item !== id);

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  favorites: readCache(), pending: [], loading: false, error: '',
  loadFavorites: async () => {
    if (!inTelegram() || get().loading) return;
    set({ loading: true, error: '' });
    try {
      const { items } = await api<{ items: string[] }>('favorites', { action: 'read' });
      set({ favorites: items });
      writeCache(items);
    } catch {
      set({ error: 'Не вдалося синхронізувати обране.' });
    } finally { set({ loading: false }); }
  },
  toggleFavorite: async id => {
    const { favorites, pending, loading } = get();
    if (loading || pending.includes(id)) return;
    const previous = favorites.includes(id);
    const next = setFavorite(favorites, id, !previous);
    if (!inTelegram()) {
      set({ favorites: next });
      writeCache(next);
      return;
    }
    set({ favorites: next, pending: [...pending, id], error: '' });
    try {
      await api('favorites', { action: 'set', id, selected: !previous });
    } catch {
      set(state => ({ favorites: setFavorite(state.favorites, id, previous), error: 'Не вдалося зберегти зміни в обраному.' }));
    } finally {
      set(state => ({ pending: state.pending.filter(item => item !== id) }));
      writeCache(get().favorites);
    }
  },
}));
