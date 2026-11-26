import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';

import { app } from './lib/firebase-app';

export const db = getFirestore(app);
if (import.meta.env.DEV && import.meta.env.VITE_FIRESTORE_EMULATOR_HOST) {
  const [host, port] = import.meta.env.VITE_FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(db, host, Number(port));
}
