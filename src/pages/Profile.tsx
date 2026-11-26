import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, ClipboardCopy, Package, RefreshCw, Settings, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { money, orderNumber, orderStatus, toKop } from '../lib/commerce';
import { inTelegram, telegramLink, telegramUser } from '../lib/telegram';
import type { Order } from '../store/useOrdersStore';

type HistoryOrder = Pick<Order, 'id' | 'status' | 'createdAt' | 'items' | 'totalPrice' | 'ttn'>;
const date = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Kyiv' });

export default function Profile() {
  const user = telegramUser();
  const [orders, setOrders] = useState<HistoryOrder[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copyState, setCopyState] = useState('');
  const canOrder = inTelegram();

  const load = useCallback(async (signal?: AbortSignal, next?: string) => {
    setLoading(true);
    setError('');
    try {
      const result = await api<{ orders: HistoryOrder[]; cursor?: string }>('my_orders', { cursor: next }, { signal });
      if (signal?.aborted) return;
      setOrders(previous => next ? [...previous.filter(order => !result.orders.some(entry => entry.id === order.id)), ...result.orders] : result.orders);
      setCursor(result.cursor);
    } catch (error) {
      if (!signal?.aborted) setError(error instanceof ApiError ? error.message : 'Не вдалося завантажити замовлення.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canOrder) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [canOrder, load]);

  const copy = async (ttn: string) => {
    try { await navigator.clipboard.writeText(ttn); setCopyState('Номер ТТН скопійовано.'); }
    catch { setCopyState('Скопіюйте номер ТТН вручну.'); }
  };

  return <>
    <div className="page-heading"><h1>Профіль</h1><p>Дані та історія покупок</p></div>
    <section className="panel profile-card">
      <span className="profile-avatar"><UserRound size={25} strokeWidth={1.5} /></span>
      <div><h2>{user ? [user.first_name, user.last_name].filter(Boolean).join(' ') : 'Гість'}</h2>
        <p>{user?.username ? '@' + user.username : canOrder ? 'Акаунт Telegram' : 'Відкрийте магазин у Telegram, щоб переглянути замовлення.'}</p></div>
      {(!canOrder && telegramLink()) && <a className="button secondary" href={telegramLink()}>У Telegram <ArrowRight size={17} /></a>}
      {user && String(user.id) === String(import.meta.env.VITE_ADMIN_TELEGRAM_ID) && <Link to="/admin" className="button secondary"><Settings size={17} /> Керування</Link>}
    </section>
    {canOrder && <section className="history" aria-labelledby="history-title">
      <div className="section-heading"><h2 id="history-title">Мої замовлення</h2><button type="button" className="icon-button" disabled={loading} aria-label="Оновити історію" onClick={() => void load()}><RefreshCw size={18} /></button></div>
      {error && <p className="feedback" role="alert">{error}</p>}
      {loading && !orders.length && <p className="muted" role="status">Завантажуємо замовлення…</p>}
      {!loading && !error && !orders.length && <div className="empty-state"><Package size={30} strokeWidth={1.4} /><h3>Замовлень поки немає</h3><Link to="/" className="button primary">До каталогу</Link></div>}
      <div className="history-grid">
        {orders.map(order => <article className="panel history-card" key={order.id}>
          <div className="history-heading"><div><h3>{orderNumber(order.id)}</h3>{order.createdAt > 0 && <time dateTime={new Date(order.createdAt).toISOString()}>{date.format(order.createdAt)}</time>}</div><span className={'status-pill status-' + order.status}>{orderStatus[order.status] ?? 'Невідомо'}</span></div>
          <ul>{Array.isArray(order.items) && order.items.map((item, index) => <li key={item.cartItemId ?? index}><span>{item.title}{item.selectedColor ? ' / ' + item.selectedColor : ''}{item.gift && ' · Подарунковий набір'}</span><strong>× {item.quantity}</strong></li>)}</ul>
          <div className="history-total"><strong>{money(toKop(order.totalPrice))}</strong>{order.ttn && <button type="button" className="button secondary" onClick={() => void copy(order.ttn!)} aria-label={'Скопіювати ТТН ' + order.ttn}>
            <ClipboardCopy size={15} /> {order.ttn}
          </button>}</div>
        </article>)}
      </div>
      <p className="sr-only" role="status">{copyState}</p>
      {cursor && <button type="button" className="button secondary" disabled={loading} onClick={() => void load(undefined, cursor)}>Показати ще</button>}
    </section>}
  </>;
}
