import { useRef, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import type { User } from 'firebase/auth';
import { api } from '../../lib/api';
import { MAX_ORDER_LINES, money, toKop } from '../../lib/commerce';
import { deliveryMethods, orderSources, paymentMethods } from '../../lib/manual-order';

const newLine = () => ({ key: crypto.randomUUID(), title: '', quantity: '1', price: '' });

export default function ManualOrderForm({ user, onClose, onCreated }: { user: User; onClose: () => void; onCreated: (id: string) => void }) {
  const [lines, setLines] = useState(() => [newLine()]);
  const [delivery, setDelivery] = useState<keyof typeof deliveryMethods>('nova-poshta');
  const [paid, setPaid] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestKey = useRef('');
  const total = lines.reduce((sum, item) => sum + toKop(Number(item.price)) * Number(item.quantity), 0);
  const updateLine = (key: string, field: 'title' | 'quantity' | 'price', value: string) => {
    setLines(current => current.map(item => item.key === key ? { ...item, [field]: value } : item));
  };

  return <section className="panel manual-order" aria-labelledby="manual-order-heading">
    <div className="admin-section-heading">
      <h3 id="manual-order-heading">Нове ручне замовлення</h3>
      <button className="icon-button" type="button" aria-label="Закрити форму" disabled={busy} onClick={onClose}><X size={20} /></button>
    </div>
    <form className="admin-form" onSubmit={async event => {
      event.preventDefault();
      if (busy) return;
      const fields = new FormData(event.currentTarget);
      setError('');
      setBusy(true);
      requestKey.current ||= crypto.randomUUID();
      try {
        const token = await user.getIdToken();
        const { id } = await api<{ id: string }>('admin_order', {
          ...Object.fromEntries(fields), key: requestKey.current, paid: Number(paid),
          items: lines.map(line => ({ title: line.title, quantity: Number(line.quantity), price: Number(line.price) })),
        }, { token });
        onCreated(id);
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Не вдалося додати замовлення.');
      } finally { setBusy(false); }
    }}>
      <fieldset disabled={busy}>
        <div className="admin-field-grid">
          <label className="field-label">Джерело<select className="field" name="source" defaultValue="threads">
            {Object.entries(orderSources).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select></label>
          <label className="field-label">Ім’я та прізвище<input autoFocus className="field" name="name" autoComplete="off" maxLength={128} required /></label>
          <label className="field-label">Телефон<input className="field" name="phone" type="tel" autoComplete="off" maxLength={32} /></label>
          <label className="field-label">Інший контакт<input className="field" name="contact" maxLength={150} placeholder="@нік або посилання" /></label>
        </div>
        <fieldset className="manual-items">
          <legend>Позиції замовлення</legend>
          {lines.map((line, index) => <div className="manual-line" key={line.key}>
            <label className="field-label manual-line-title">Виріб {index + 1}<input className="field" required maxLength={240} value={line.title}
              onChange={e => updateLine(line.key, 'title', e.target.value)} placeholder="Наприклад, паличка з підставкою" /></label>
            <label className="field-label">Кількість<input className="field" type="number" inputMode="numeric" min="1" max="999" required value={line.quantity}
              onChange={e => updateLine(line.key, 'quantity', e.target.value)} /></label>
            <label className="field-label">Ціна за шт., грн<input className="field" type="number" inputMode="decimal" min="0" max="1000000" step="0.01" required
              value={line.price} onChange={e => updateLine(line.key, 'price', e.target.value)} /></label>
            <button className="icon-button delete-button" type="button" disabled={lines.length === 1} aria-label={'Видалити позицію ' + (index + 1)}
              onClick={() => setLines(current => current.filter(item => item.key !== line.key))}><Trash2 size={17} /></button>
          </div>)}
          <button className="button secondary manual-order-trigger" type="button" disabled={lines.length >= MAX_ORDER_LINES} onClick={() => setLines(current => [...current, newLine()])}>
            <Plus size={17} /> Додати позицію
          </button>
        </fieldset>
        <div className="admin-field-grid">
          <label className="field-label">Спосіб доставки<select className="field" name="delivery" value={delivery} onChange={e => setDelivery(e.target.value as typeof delivery)}>
            {Object.entries(deliveryMethods).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select></label>
          <label className="field-label">Місто<input className="field" name="city" maxLength={100} required={delivery !== 'pickup'} /></label>
          <label className="field-label manual-wide">{delivery === 'nova-poshta' ? 'Відділення, поштомат або адреса' : 'Адреса чи місце зустрічі'}
            <input className="field" name="destination" maxLength={240} required />
          </label>
          <label className="field-label">Оплата<select className="field" name="payment" defaultValue="cod">
            {Object.entries(paymentMethods).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select></label>
          <label className="field-label">Уже отримано, грн<input className="field" type="number" inputMode="decimal" min="0"
            max={Math.min(total / 100, 1_000_000)} step="0.01" value={paid} onChange={e => setPaid(e.target.value)} placeholder="0" /></label>
        </div>
        <label className="field-label">Примітки<textarea className="field" name="note" rows={3} maxLength={2000} placeholder="Домовленості, оздоблення, побажання" /></label>
        <div className="manual-total"><span>Разом <strong>{money(total)}</strong></span><span>До сплати <strong>{money(Math.max(0, total - toKop(Number(paid))))}</strong></span></div>
        <button className="button primary" type="submit">{busy ? 'Зберігаємо…' : 'Зберегти замовлення'}</button>
      </fieldset>
      {error && <p className="feedback" role="alert">{error}</p>}
    </form>
  </section>;
}
