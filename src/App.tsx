import { lazy, Suspense, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Heart, LayoutGrid, ShoppingBag, UserRound } from 'lucide-react';
import Catalog from './pages/Catalog';
import { telegram } from './lib/telegram';
import { useCartStore } from './store/useCartStore';
import { useFavoritesStore } from './store/useFavoritesStore';
import { useProductsStore } from './store/useProductsStore';

const Cart = lazy(() => import('./pages/Cart'));
const Profile = lazy(() => import('./pages/Profile'));
const Admin = lazy(() => import('./pages/Admin'));
const Favorites = lazy(() => import('./pages/Favorites'));

const links = [
  { to: '/', label: 'Каталог', Icon: LayoutGrid },
  { to: '/favorites', label: 'Обране', Icon: Heart },
  { to: '/cart', label: 'Кошик', Icon: ShoppingBag },
  { to: '/profile', label: 'Профіль', Icon: UserRound },
];

export default function App() {
  const count = useCartStore(state => state.items.reduce((total, item) => total + item.quantity, 0));
  const watchProducts = useProductsStore(state => state.watchProducts);
  const loadFavorites = useFavoritesStore(state => state.loadFavorites);
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const activeTab = links.findIndex(({ to }) => to === (pathname.replace(/\/+$/, '') || '/'));
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const app = telegram();
    app?.ready();
    app?.expand();
    if (app?.isVersionAtLeast('6.1')) {
      app.setHeaderColor('#101611');
      app.setBackgroundColor('#101611');
    }
    if (app?.isVersionAtLeast('7.10')) app.setBottomBarColor?.('#101611');
    const applyInsets = () => {
      const root = document.documentElement;
      for (const side of ['top', 'right', 'bottom', 'left'] as const) {
        const inset = Math.max(0, (app?.safeAreaInset?.[side] ?? 0) + (app?.contentSafeAreaInset?.[side] ?? 0));
        root.style.setProperty('--tg-inset-' + side, inset + 'px');
      }
    };
    applyInsets();
    app?.onEvent('safeAreaChanged', applyInsets);
    app?.onEvent('contentSafeAreaChanged', applyInsets);
    void loadFavorites();
    const stop = watchProducts();
    return () => {
      app?.offEvent('safeAreaChanged', applyInsets);
      app?.offEvent('contentSafeAreaChanged', applyInsets);
      stop();
    };
  }, [watchProducts, loadFavorites]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => setKeyboardOpen(Boolean(viewport && viewport.height < window.innerHeight * 0.76 && viewport.scale <= 1.05));
    resize();
    viewport?.addEventListener('resize', resize);
    return () => viewport?.removeEventListener('resize', resize);
  }, []);

  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  useEffect(() => {
    const app = telegram();
    if (!app?.initData || !app.BackButton) return;
    const button = app.BackButton;
    const params = new URLSearchParams(search);
    const product = params.has('productId');
    if (pathname === '/' && !product) {
      button.hide();
      return;
    }
    const goBack = () => {
      if (product) {
        params.delete('productId');
        navigate({ pathname, search: params.toString() }, { replace: true });
      } else {
        navigate(pathname === '/admin' ? '/profile' : '/');
      }
    };
    button.show();
    button.onClick(goBack);
    return () => { button.offClick(goBack); button.hide(); };
  }, [pathname, search, navigate]);

  return (
    <>
      <a className="skip-link" href="#main-content">До вмісту</a>
      <header className="shop-header">
        <div className="shell header-inner">
          <Link className="brand" to="/" aria-label="Animeria — до каталогу">
            <img src="/logo.png" alt="" width="46" height="46" />
            <span><strong>Animeria</strong><small>МАЙСТЕРНЯ 3D-ДРУКУ</small></span>
          </Link>
          <Link className="header-bag icon-button" to="/cart" aria-label={count ? 'Кошик, позицій: ' + count : 'Кошик'}>
            <ShoppingBag size={21} strokeWidth={1.65} />
            {count > 0 && <span className="nav-count">{count > 99 ? '99+' : count}</span>}
          </Link>
        </div>
      </header>
      <main className="shell shop-main" id="main-content">
        <Suspense fallback={<div className="empty-state" role="status">Завантажуємо…</div>}>
          <div className="route-frame" key={pathname}>
            <Routes>
              <Route path="/" element={<Catalog />} />
              <Route path="/cart" element={<Cart />} />
              <Route path="/favorites" element={<Favorites />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="*" element={<div className="empty-state"><h1>Сторінку не знайдено</h1><Link to="/" className="button primary">До каталогу</Link></div>} />
            </Routes>
          </div>
        </Suspense>
      </main>
      {!keyboardOpen && <nav className="glass-nav" aria-label="Розділи магазину" style={{ '--active-tab': Math.max(0, activeTab) } as CSSProperties}>
        <span aria-hidden="true" className="glass-indicator" data-visible={activeTab >= 0} />
        {links.map(({ to, label, Icon }) => (
          <NavLink end={to === '/'} key={to} to={to} className="glass-tab">
            <span className="nav-icon"><Icon size={21} strokeWidth={1.65} />{to === '/cart' && count > 0 && <span className="nav-count">{count > 99 ? '99+' : count}</span>}</span>
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>}
    </>
  );
}
