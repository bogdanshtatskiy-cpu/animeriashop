import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { ADMIN_UID } from '../src/lib/admin.js';
import { HttpError, type ApiRequest } from './http.js';

function adminApp() {
  const existing = getApps()[0];
  if (existing) return existing;
  const projectId = process.env.VITE_FIREBASE_PROJECT_ID;
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  return initializeApp({ projectId, credential: serviceAccount ? cert(JSON.parse(serviceAccount)) : applicationDefault() });
}

export const database = () => getFirestore(adminApp());

export async function requireAdmin(req: ApiRequest) {
  const token = req.headers.authorization?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!token) throw new HttpError(401, 'ADMIN_AUTH', 'Увійдіть як адміністратор.');
  const auth = getAuth(adminApp());
  const user = await auth.verifyIdToken(token, true).catch(() => null);
  if (!user) throw new HttpError(401, 'ADMIN_AUTH', 'Сеанс адміністратора завершився. Увійдіть знову.');
  if (user.uid !== ADMIN_UID) {
    throw new HttpError(403, 'ADMIN_AUTH', 'Доступ лише для адміністратора.');
  }
  return user;
}
