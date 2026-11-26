import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { configuredStock, finishStock, giftPrice, MAX_LINE_QUANTITY, MAX_ORDER_LINES, unitPrice, variantKey } from '../lib/commerce';
import type { Discount, GiftSet } from '../lib/commerce';

export interface Product {
  id: string;
  title: string;
  price: number;
  imageUrl?: string | null;
  imageUrls?: string[] | null;
  description?: string;
  category?: string;
  dimensions?: string;
  material?: string;
  colors?: string[];
  discount?: Discount | null;
  technology?: 'fdm' | 'resin' | '';
  finish?: string;
  character?: string;
  available?: boolean;
  featured?: boolean;
  madeToOrder?: boolean;
  stock?: number | null;
  variantStock?: Record<string, number> | null;
  leadDays?: number | null;
  packageContents?: string;
  giftSet?: GiftSet | null;
}

export interface CartItem extends Product {
  quantity: number;
  selectedColor?: string;
  gift?: boolean;
  giftContents?: string;
  cartItemId: string;
  unitPrice?: number;
}

interface CartState {
  items: CartItem[];
  addItem: (product: Product, selectedColor?: string, gift?: boolean) => boolean;
  removeItem: (cartItemId: string) => void;
  updateQuantity: (cartItemId: string, quantity: number) => void;
  clearCart: () => void;
  getTotalPrice: () => number;
}

export function cartStockRemaining(product: Product, items: CartItem[], color = '') {
  let total = 0;
  let forFinish = 0;
  for (const item of items) {
    if (item.id !== product.id) continue;
    total += item.quantity;
    if ((item.selectedColor || '') === color) forFinish += item.quantity;
  }
  return Math.min((configuredStock(product.stock) ?? Infinity) - total, (finishStock(product, color) ?? Infinity) - forFinish);
}

export const useCartStore = create<CartState>()(
  persist((set, get) => ({
    items: [],
    addItem: (product, selectedColor, gift = false) => {
      const { items } = get();
      const cartItemId = variantKey(product.id, selectedColor, gift);
      const existing = items.find(item => item.cartItemId === cartItemId);
      if (product.available === false || (gift && !giftPrice(product)) || cartStockRemaining(product, items, selectedColor) <= 0
        || (existing ? existing.quantity >= MAX_LINE_QUANTITY : items.length >= MAX_ORDER_LINES)) return false;
      set({
        items: existing
          ? items.map(item => item === existing ? { ...item, ...product, quantity: item.quantity + 1 } : item)
          : [...items, { ...product, quantity: 1, selectedColor, cartItemId, ...(gift ? { gift } : {}) }],
      });
      return true;
    },
    removeItem: id => set(state => ({ items: state.items.filter(item => item.cartItemId !== id) })),
    updateQuantity: (id, quantity) => set(state => ({
      items: state.items.map(item => item.cartItemId === id ? { ...item, quantity: Math.min(MAX_LINE_QUANTITY, Math.max(1, quantity)) } : item),
    })),
    clearCart: () => set({ items: [] }),
    getTotalPrice: () => get().items.reduce((total, line) => total + (unitPrice(line) + (line.gift ? giftPrice(line) : 0)) * line.quantity, 0) / 100,
  }), { name: 'cart-storage' }),
);
