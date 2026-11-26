import { lazy, Suspense, useEffect, useState } from 'react';
import { LogOut, Package, ShoppingBag, Tag } from 'lucide-react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { Link } from 'react-router-dom';
import { auth } from '../firebase-admin-client';
import { ADMIN_UID } from '../lib/admin';
const AdminOrders = lazy(() => import('./admin/AdminOrders'));
const AdminProducts = lazy(() => import('./admin/AdminProducts'));
const AdminPromos = lazy(() => import('./admin/AdminPromos'));

const tabs = [
  { id: 'products', label: 'Вироби', Icon: Package },
  { id: 'orders', label: 'Замовлення', Icon: ShoppingBag },
  { id: 'promos', label: 'Промокоди', Icon: Tag },
] as const;

export default function Admin() {
  const [user, setUser] = useState<User | null | undefined>();
  const [tab, setTab] = useState<typeof tabs[number]['id']>('products');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => onAuthStateChanged(auth, account => {
    setUser(account?.uid === ADMIN_UID ? account : null);
    if (account && account.uid !== ADMIN_UID) {
      setError('Цей обліковий запис не має доступу до керування.');
      void signOut(auth);
    }
  }), []);

  if (user === undefined) return <div className="empty-state" role="status">Перевіряємо доступ…</div>;
  if (!user) return <div className="panel login-panel">
    <h1>Вхід до майстерні</h1>
    <form className="admin-form" onSubmit={async event => {
      event.preventDefault();
      setError('');
      setBusy(true);
      const fields = new FormData(event.currentTarget);
      try { await signInWithEmailAndPassword(auth, String(fields.get('email')).trim(), String(fields.get('password'))); }
      catch { setError('Не вдалося увійти. Перевірте адресу і пароль.'); }
      finally { setBusy(false); }
    }}>
      <label className="field-label">Email<input type="email" className="field" name="email" required autoComplete="username" /></label>
      <label className="field-label">Пароль<input type="password" className="field" name="password" required autoComplete="current-password" /></label>
      {error && <p className="feedback" role="alert">{error}</p>}
      <button className="button primary" type="submit" disabled={busy}>{busy ? 'Входимо…' : 'Увійти'}</button>
      <Link className="button secondary" to="/">До магазину</Link>
    </form>
  </div>;

  return <>
    <div className="page-heading admin-heading"><div><h1>Майстерня</h1><p>Керування магазином</p></div>
      <button className="button secondary" type="button" onClick={() => void signOut(auth)}><LogOut size={17} /> Вийти</button></div>
    <div className="category-strip admin-tabs" role="group" aria-label="Розділи майстерні">
      {tabs.map(({ id, label, Icon }) => <button type="button" className="filter-pill" key={id} aria-pressed={tab === id} onClick={() => setTab(id)}><Icon size={17} />{label}</button>)}
    </div>
    <Suspense fallback={<div className="empty-state" role="status">Завантажуємо…</div>}>
      {tab === 'products' && <AdminProducts />}
      {tab === 'orders' && <AdminOrders user={user} />}
      {tab === 'promos' && <AdminPromos />}
    </Suspense>
  </>;
}
