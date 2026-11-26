export const orderSources = {
  threads: 'Threads', instagram: 'Instagram', telegram: 'Telegram', other: 'Інше',
} as const;

export const deliveryMethods = {
  'nova-poshta': 'Нова пошта', pickup: 'Самовивіз', courier: 'Кур’єр', other: 'Інше',
} as const;

export const paymentMethods = {
  cod: 'Післяплата', transfer: 'Переказ', cash: 'Готівка', other: 'Інше',
} as const;

export interface ManualOrderDetails {
  source: keyof typeof orderSources;
  delivery: keyof typeof deliveryMethods;
  payment: keyof typeof paymentMethods;
  paid: number;
  contact: string;
  note: string;
}
