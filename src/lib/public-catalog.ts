import { collection, connectFirestoreEmulator, getDocs, getFirestore } from 'firebase/firestore/lite';
import type { Product } from '../store/useCartStore';
import { app } from './firebase-app';

const db = getFirestore(app);
if (import.meta.env.DEV && import.meta.env.VITE_FIRESTORE_EMULATOR_HOST) {
  const [host, port] = import.meta.env.VITE_FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(db, host, Number(port));
}

export async function getPublicProducts() {
  const snapshot = await getDocs(collection(db, 'products'));
  return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Product));
}
