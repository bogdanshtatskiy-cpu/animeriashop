import { useEffect, useState } from 'react';
import { ArrowRight, Phone, RefreshCw, Truck } from 'lucide-react';
import type { User } from 'firebase/auth';
import { api } from '../../lib/api';
import { money, orderNumber, orderStatus, orderTransitions, toKop } from '../../lib/commerce';
import type { OrderStatus } from '../../lib/commerce';
import { useOrdersStore } from '../../store/useOrdersStore';
import type { Notice, Order } from '../../store/useOrdersStore';

const formatDate = new Intl.DateTimeFormat('uk-UA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Kyiv' });
const needsRetry = (notice?: Notice) => Boolean(notice && notice.state !== 'sent');

export default function AdminOrders({ user }: { user: User }) {
  const { orders, archivedOrders, loading, archivedLoading, hasMoreArchived, error, subscribeToActiveOrders, loadArchivedOrders, getStats } = useOrdersStore();
  const [archive, setArchive] = useState(false);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof getStats>>[]>();
  const [statsError, setStatsError] = useState(false);
  const [transition, setTransition] = useState<{ id: string; status: OrderStatus }>();
  const [ttn, setTtn] = useState('');
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState<{ id: string; message: string; failed: boolean }>();
  useEffect(() => subscribeToActiveOrders(), [subscribeToActiveOrders]);
  useEffect(() => {
    if (!archive) return;
    let active = true;
    void loadArchivedOrders(true);
    Promise.all([getStats(7), getStats(30)]).then(entries => {
      if (active) { setStats(entries); setStatsError(false); }
    }).catch(() => { if (active) setStatsError(true); });
    return () => { active = false; };
  }, [archive, getStats, loadArchivedOrders]);

  const orderAction = async (id: string, action: 'admin-retry' | 'customer-retry' | OrderStatus) => {
    if (busy) return;
    setBusy(id);
    setFeedback(undefined);
    try {
      const token = await user.getIdToken();
      const retry = action === 'admin-retry' || action === 'customer-retry';
      const result = await api<{ sent: boolean; telegram?: Notice['error'] }>(
        action === 'admin-retry' ? 'notify' : 'notify_client',
        retry ? { orderId: id, action: 'retry' } : { orderId: id, action: 'status', status: action, ttn },
        { token },
      );
      setTransition(undefined);
      setTtn('');
      setFeedback({
        id, failed: !result.sent, message: result.sent ? (retry ? 'Сповіщення надіслано.' : 'Статус оновлено. Сповіщення надіслано.')
          : 'Статус збережено. Telegram: ' + (result.telegram?.description ?? 'повідомлення не доставлено.'),
      });
      if (archive) void loadArchivedOrders(true);
    } catch (error) {
      setFeedback({ id, failed: true, message: error instanceof Error ? error.message : 'Не вдалося виконати дію.' });
    } finally { setBusy(''); }
  };

  const entries = archive ? archivedOrders : orders;
  return <section className="orders-admin" aria-labelledby="admin-orders-title">
    <div className="section-heading"><h2 id="admin-orders-title">Замовлення</h2><div className="category-strip" role="group" aria-label="Список замовлень">
      <button type="button" className="filter-pill" aria-pressed={!archive} onClick={() => setArchive(false)}>Активні</button>
      <button type="button" className="filter-pill" aria-pressed={archive} onClick={() => setArchive(true)}>Архів</button>
    </div></div>
    {archive && stats && <div className="stats-grid">{stats.map(({ income, count }, i) => <div className="panel" key={i}>
      <p>Виконані за {i === 0 ? 7 : 30} днів</p><strong>{money(toKop(income))}</strong><small>{count} замовлень</small>
    </div>)}</div>}
    {archive && statsError && <p className="feedback" role="status">Статистика тимчасово недоступна.</p>}
    {error && <p className="feedback" role="alert">{error} {archive && <button type="button" className="text-button" onClick={() => void loadArchivedOrders(true)}>Повторити</button>}</p>}
    {feedback && <p className={feedback.failed ? 'feedback' : 'notice-success'} role="status">{orderNumber(feedback.id)} · {feedback.message}</p>}
    {(archive ? archivedLoading : loading) && !entries.length && <p className="muted" role="status">Завантажуємо замовлення…</p>}
    {!(archive ? archivedLoading : loading) && !entries.length && !error && <p className="empty-state">У цьому списку немає замовлень.</p>}
    <div className="history-grid">
      {entries.map(order => {
        const actions = orderTransitions[order.status] ?? [];
        const action = transition?.id === order.id ? transition.status : undefined;
        return <article className="panel history-card" key={order.id}>
          <div className="history-heading"><div><h3>{orderNumber(order.id)}</h3><time>{order.createdAt ? formatDate.format(order.createdAt) : ''}</time></div>
            <span className={'status-pill status-' + order.status}>{orderStatus[order.status] ?? 'Невідомо'}</span></div>
          <div className="admin-order-contact">
            <strong>{order.firstName} {order.lastName}</strong>
            {order.username && /^\w{5,32}$/.test(order.username) && <a href={'https://t.me/' + order.username} target="_blank" rel="noreferrer">@{order.username}</a>}
            {order.shippingDetails?.phone && <a href={'tel:' + order.shippingDetails.phone.replace(/[^\d+]/g, '')}><Phone size={15} />{order.shippingDetails.phone}</a>}
            {order.shippingDetails && <p><Truck size={16} />{order.shippingDetails.city}, {order.shippingDetails.branch}</p>}
            {order.ttn && <p>ТТН {order.ttn}</p>}
            {order.promoCode && <p>Промокод {order.promoCode}</p>}
          </div>
          <ul>{Array.isArray(order.items) && order.items.map((item, i) => <li key={item.cartItemId ?? i}>
            <span>{item.title}{item.selectedColor ? ' / ' + item.selectedColor : ''}</span><strong>× {item.quantity}</strong>
          </li>)}</ul>
          <strong className="admin-order-total">{money(toKop(order.totalPrice))}</strong>
          {actions.length > 0 && <form className="admin-form order-transition" onSubmit={event => {
            event.preventDefault();
            if (!action || (action === 'cancelled' && !confirm('Скасувати замовлення ' + orderNumber(order.id) + '?'))) return;
            void orderAction(order.id, action);
          }}>
            <label className="field-label">Змінити статус<select className="field" value={action ?? ''} disabled={Boolean(busy)} onChange={event => {
              setTransition(event.target.value ? { id: order.id, status: event.target.value as Order['status'] } : undefined);
              setTtn('');
            }}><option value="">Оберіть статус</option>{actions.map(status => <option key={status} value={status}>{orderStatus[status]}</option>)}</select></label>
            {action === 'shipped' && <label className="field-label">ТТН<input className="field" inputMode="numeric" pattern="[0-9]{14}" maxLength={14} required value={ttn} onChange={e => setTtn(e.target.value.replace(/\D/g, ''))} /></label>}
            <button className="button secondary" type="submit" disabled={!action || Boolean(busy)}>Оновити статус <ArrowRight size={16} /></button>
          </form>}
          {(needsRetry(order.adminNotice) || needsRetry(order.customerNotice)) && <div className="order-notices">
            {(['adminNotice', 'customerNotice'] as const).map(type => needsRetry(order[type]) && <div key={type}>
              {order[type]?.error && <p className="feedback">{order[type]?.error?.error_code && order[type]?.error?.error_code + ' · '}{order[type]?.error?.description}</p>}
              <button className="button secondary" type="button" disabled={Boolean(busy)} onClick={() => void orderAction(order.id, type === 'adminNotice' ? 'admin-retry' : 'customer-retry')}>
                <RefreshCw size={15} />{type === 'adminNotice' ? 'Повторити для адміністратора' : 'Повторити для покупця'}
              </button>
            </div>)}
          </div>}
        </article>;
      })}
    </div>
    {archive && hasMoreArchived && <button className="button secondary" type="button" disabled={archivedLoading} onClick={() => void loadArchivedOrders()}>Показати ще</button>}
  </section>;
}
