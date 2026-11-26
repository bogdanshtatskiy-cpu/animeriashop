import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { app } from './lib/firebase-app';

export const auth = getAuth(app);
if (import.meta.env.DEV && import.meta.env.VITE_FIREBASE_AUTH_EMULATOR) {
  connectAuthEmulator(auth, 'http://' + import.meta.env.VITE_FIREBASE_AUTH_EMULATOR, { disableWarnings: true });
}
