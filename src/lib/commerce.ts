export const MIN_ORDER_KOP = 25_000;
export const MAX_LINE_QUANTITY = 20;
export const MAX_ORDER_LINES = 30;

export interface Discount {
  type: 'percent' | 'fixed';
  value: number;
}

export function toKop(amount: number) {
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

export function discounted(price: number, discount?: Discount | null) {
  const amount = Math.max(0, price);
  if (!discount || !Number.isFinite(discount.value) || discount.value <= 0) return amount;
  if (discount.type === 'percent') return Math.max(0, Math.round(amount * (1 - discount.value / 100)));
  if (discount.type === 'fixed') return Math.max(0, amount - toKop(discount.value));
  return amount;
}

export function unitPrice(product: { price: number; discount?: Discount | null }) {
  return discounted(toKop(product.price), product.discount);
}

const formatter = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 });
export const money = (kop: number) => formatter.format(kop / 100) + '\u00a0грн';
export const orderNumber = (id: string) => `#${id.slice(-6).toUpperCase()}`;
export const orderStatus = {
  new: 'Прийнято', processing: 'У роботі', shipped: 'Відправлено', completed: 'Виконано', cancelled: 'Скасовано',
} as const;
export type OrderStatus = keyof typeof orderStatus;
export const orderTransitions: Record<OrderStatus, readonly OrderStatus[]> = {
  new: ['processing', 'cancelled'], processing: ['shipped', 'cancelled'], shipped: ['completed', 'cancelled'],
  completed: [], cancelled: [],
};

export interface CheckoutLine { id: string; quantity: number; color?: string }
export interface Quote {
  subtotal: number;
  total: number;
  promo?: string;
  lines: { id: string; color: string; quantity: number; unitPrice: number }[];
}
