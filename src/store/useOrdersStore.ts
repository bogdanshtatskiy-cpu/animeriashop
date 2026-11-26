import { create } from 'zustand';
import { collection, getDocs, limit, onSnapshot, orderBy, query, startAfter, where } from 'firebase/firestore';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import type { OrderStatus } from '../lib/commerce';
import type { CartItem } from './useCartStore';

export interface Notice {
  state: 'pending' | 'sending' | 'sent' | 'failed';
  leaseUntil?: number;
  error?: { error_code?: number; description: string };
}

export interface Order {
  id: string;
  userId: number;
  username?: string;
  firstName: string;
  lastName?: string;
  items: CartItem[];
  totalPrice: number;
  shippingDetails?: { phone: string; city: string; branch: string };
  status: OrderStatus;
  ttn?: string;
  createdAt: number;
  promoCode?: string;
  adminNotice?: Notice;
  customerNotice?: Notice;
}

type Stats = { income: number; count: number };
interface OrdersState {
  orders: Order[];
  archivedOrders: Order[];
  loading: boolean;
  archivedLoading: boolean;
  hasMoreArchived: boolean;
  lastArchivedDoc: QueryDocumentSnapshot<DocumentData> | null;
  error: string;
  subscribeToActiveOrders: () => () => void;
  loadArchivedOrders: (reset?: boolean) => Promise<void>;
  getStats: (days: number) => Promise<Stats>;
}

const orderDoc = (entry: QueryDocumentSnapshot<DocumentData>) => ({ ...entry.data(), id: entry.id } as Order);
const queryError = (error: unknown) => error instanceof Error && /requires an index/i.test(error.message)
  ? 'Індекс Firestore ще не готовий. Перевірте розділ Firestore → Indexes.'
  : 'Не вдалося завантажити замовлення. Спробуйте оновити сторінку.';

export const useOrdersStore = create<OrdersState>((set, get) => ({
  orders: [], archivedOrders: [], loading: true, archivedLoading: false, hasMoreArchived: false, lastArchivedDoc: null, error: '',
  subscribeToActiveOrders: () => {
    set({ loading: true, orders: [], archivedOrders: [], lastArchivedDoc: null, hasMoreArchived: false, error: '' });
    return onSnapshot(
      query(collection(db, 'orders'), where('status', 'in', ['new', 'processing', 'shipped']), orderBy('createdAt', 'desc')),
      snapshot => set({ orders: snapshot.docs.map(orderDoc), loading: false }),
      error => set({ error: queryError(error), loading: false }),
    );
  },
  loadArchivedOrders: async (reset = false) => {
    const { archivedLoading, lastArchivedDoc, archivedOrders } = get();
    if (archivedLoading) return;
    set({ archivedLoading: true, error: '' });
    try {
      const base = query(collection(db, 'orders'), where('status', 'in', ['completed', 'cancelled']), orderBy('createdAt', 'desc'), limit(20));
      const snapshot = await getDocs(!reset && lastArchivedDoc ? query(base, startAfter(lastArchivedDoc)) : base);
      const combined = [...(reset ? [] : archivedOrders), ...snapshot.docs.map(orderDoc)];
      set({
        archivedOrders: [...new Map(combined.map(order => [order.id, order])).values()],
        lastArchivedDoc: snapshot.docs.at(-1) ?? null, hasMoreArchived: snapshot.size === 20, archivedLoading: false,
      });
    } catch (error) { set({ error: queryError(error), archivedLoading: false }); }
  },
  getStats: async days => {
    const threshold = Date.now() - days * 86_400_000;
    const snapshot = await getDocs(query(collection(db, 'orders'), where('status', '==', 'completed'), where('createdAt', '>=', threshold)));
    return { income: snapshot.docs.reduce((income, entry) => income + Number(entry.get('totalPrice') || 0), 0), count: snapshot.size };
  },
}));
