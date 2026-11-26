import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { MAX_LINE_QUANTITY, MAX_ORDER_LINES, unitPrice } from '../lib/commerce';
import type { Discount } from '../lib/commerce';

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
}

export interface CartItem extends Product {
  quantity: number;
  selectedColor?: string;
  cartItemId: string;
  unitPrice?: number;
}

interface CartState {
  items: CartItem[];
  addItem: (product: Product, selectedColor?: string) => boolean;
  removeItem: (cartItemId: string) => void;
  updateQuantity: (cartItemId: string, quantity: number) => void;
  clearCart: () => void;
  getTotalPrice: () => number;
}

const sameVariant = (item: CartItem, id: string, color?: string) => item.id === id && (item.selectedColor || '') === (color || '');

export const useCartStore = create<CartState>()(
  persist((set, get) => ({
    items: [],
    addItem: (product, selectedColor) => {
      const { items } = get();
      const existing = items.find(item => sameVariant(item, product.id, selectedColor));
      const totalUnits = items.filter(item => item.id === product.id).reduce((sum, item) => sum + item.quantity, 0);
      if (product.available === false || (typeof product.stock === 'number' && totalUnits >= product.stock)
        || (existing ? existing.quantity >= MAX_LINE_QUANTITY : items.length >= MAX_ORDER_LINES)) return false;
      const cartItemId = JSON.stringify([product.id, selectedColor || '']);
      set({
        items: existing
          ? items.map(item => item === existing ? { ...item, ...product, quantity: item.quantity + 1 } : item)
          : [...items, { ...product, quantity: 1, selectedColor, cartItemId }],
      });
      return true;
    },
    removeItem: id => set(state => ({ items: state.items.filter(item => item.cartItemId !== id) })),
    updateQuantity: (id, quantity) => set(state => ({
      items: state.items.map(item => item.cartItemId === id ? { ...item, quantity: Math.min(MAX_LINE_QUANTITY, Math.max(1, quantity)) } : item),
    })),
    clearCart: () => set({ items: [] }),
    getTotalPrice: () => get().items.reduce((total, line) => total + unitPrice(line) * line.quantity, 0) / 100,
  }), { name: 'cart-storage' }),
);
