import { create } from 'zustand';
import type { Product } from './useCartStore';

interface ProductsState {
  products: Product[];
  loading: boolean;
  error: boolean;
  refreshProducts: () => Promise<void>;
  watchProducts: () => () => void;
}

let inFlight: Promise<void> | undefined;

export const useProductsStore = create<ProductsState>((set, get) => ({
  products: [], loading: true, error: false,
  refreshProducts: () => {
    if (inFlight) return inFlight;
    inFlight = import('../lib/public-catalog')
      .then(({ getPublicProducts }) => getPublicProducts())
      .then(products => { set({ products, loading: false, error: false }); })
      .catch(() => { set({ loading: false, error: true }); })
      .finally(() => { inFlight = undefined; });
    return inFlight;
  },
  watchProducts: () => {
    const refresh = () => { if (!document.hidden) void get().refreshProducts(); };
    void get().refreshProducts();
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  },
}));
