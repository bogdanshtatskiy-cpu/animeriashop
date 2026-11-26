import { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, runTransaction } from 'firebase/firestore';
import { Pencil, Trash2 } from 'lucide-react';
import { db } from '../../firebase';
import { money, toKop } from '../../lib/commerce';

interface Promo {
  id: string;
  code: string;
  discountType: 'percent' | 'fixed';
  discountValue: number;
  minOrderAmount?: number | null;
  validFrom?: number | null;
  validUntil?: number | null;
  usageLimit?: number | null;
  usageCount: number;
}

const inputDate = (value?: number | null) => {
  if (!value) return '';
  const local = new Date(value);
  return new Date(value - local.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export default function AdminPromos() {
  const [promos, setPromos] = useState<Promo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Promo>();
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);

  useEffect(() => onSnapshot(collection(db, 'promocodes'), snapshot => {
    setPromos(snapshot.docs.map(entry => ({ ...entry.data(), id: entry.id } as Promo)));
    setLoading(false);
  }, () => { setError('Не вдалося завантажити промокоди.'); setLoading(false); }), []);

  return <div className="admin-layout">
    <section className="panel"><h2>{editing ? 'Редагування промокоду' : 'Новий промокод'}</h2>
      <form key={editing?.id ?? version} className="admin-form" onSubmit={async event => {
        event.preventDefault();
        setError('');
        setBusy(true);
        const fields = new FormData(event.currentTarget);
        const code = editing?.code ?? String(fields.get('code')).trim().toUpperCase();
        const discountType = fields.get('type') === 'fixed' ? 'fixed' : 'percent';
        const discountValue = Number(fields.get('value'));
        const optional = (field: string) => fields.get(field) ? Number(fields.get(field)) : null;
        const timestamp = (field: string) => fields.get(field) ? new Date(String(fields.get(field))).getTime() : null;
        const validFrom = timestamp('from');
        const validUntil = timestamp('until');
        try {
          if (validFrom && validUntil && validUntil <= validFrom) throw new Error('Кінцева дата має бути пізніше початкової.');
          if (!editing && promos.some(promo => promo.code === code)) throw new Error('Промокод уже існує.');
          if (discountType === 'percent' && discountValue > 100) throw new Error('Знижка має бути не більшою за 100%.');
          const ref = doc(db, 'promocodes', editing?.id ?? code);
          await runTransaction(db, async tx => {
            const snapshot = await tx.get(ref);
            if (!editing && snapshot.exists()) throw new Error('Промокод уже існує.');
            if (editing && !snapshot.exists()) throw new Error('Промокод уже видалено.');
            tx.set(ref, {
              code, discountType, discountValue, minOrderAmount: optional('minimum'), usageLimit: optional('limit'),
              validFrom, validUntil, usageCount: snapshot.get('usageCount') ?? 0,
            });
          });
          setEditing(undefined); setVersion(previous => previous + 1);
        } catch (error) { setError(error instanceof Error ? error.message : 'Не вдалося зберегти промокод.'); }
        finally { setBusy(false); }
      }}>
        <label className="field-label">Промокод<input className="field" name="code" required pattern={'[A-Za-z0-9_\\-]{2,40}'} maxLength={40}
          disabled={Boolean(editing) || busy} defaultValue={editing?.code} placeholder="Наприклад, WAND10" /></label>
        <div className="admin-field-grid">
          <label className="field-label">Тип знижки<select className="field" name="type" defaultValue={editing?.discountType ?? 'percent'}><option value="percent">Відсоток</option><option value="fixed">Сума, грн</option></select></label>
          <label className="field-label">Розмір знижки<input className="field" name="value" type="number" required min="0.01" max="1000000" step="0.01" defaultValue={editing?.discountValue} /></label>
          <label className="field-label">Мінімальна сума, грн<input className="field" name="minimum" type="number" min="0" max="1000000" step="0.01" defaultValue={editing?.minOrderAmount ?? undefined} /></label>
          <label className="field-label">Ліміт використань<input className="field" name="limit" type="number" min="1" max="1000000" step="1" defaultValue={editing?.usageLimit ?? undefined} /></label>
          <label className="field-label">Початок дії<input className="field" name="from" type="datetime-local" defaultValue={inputDate(editing?.validFrom)} /></label>
          <label className="field-label">Кінець дії<input className="field" name="until" type="datetime-local" defaultValue={inputDate(editing?.validUntil)} /></label>
        </div>
        {error && <p className="feedback" role="alert">{error}</p>}
        <button type="submit" className="button primary" disabled={busy || loading}>{busy ? 'Зберігаємо…' : 'Зберегти промокод'}</button>
        {editing && <button type="button" className="button secondary" onClick={() => setEditing(undefined)}>Скасувати редагування</button>}
      </form>
    </section>
    <section className="panel admin-list"><h2>Промокоди</h2>
      {loading ? <p className="muted">Завантажуємо…</p> : !promos.length && <p className="muted">Промокодів поки немає.</p>}
      {promos.map(promo => <article className="admin-row" key={promo.id}>
        <div className="admin-row-copy"><h3>{promo.code}</h3><p>{promo.discountType === 'percent' ? promo.discountValue + '%' : money(toKop(promo.discountValue))} · Використано {promo.usageCount ?? 0}{promo.usageLimit ? ' / ' + promo.usageLimit : ''}</p></div>
        <button className="icon-button" type="button" disabled={busy} aria-label={'Редагувати ' + promo.code} onClick={() => { setEditing(promo); setError(''); }}><Pencil size={17} /></button>
        <button className="icon-button delete-button" type="button" disabled={busy} aria-label={'Видалити ' + promo.code} onClick={async () => {
          if (!confirm('Видалити промокод ' + promo.code + '?')) return;
          setBusy(true); setError('');
          try { await deleteDoc(doc(db, 'promocodes', promo.id)); if (editing?.id === promo.id) setEditing(undefined); }
          catch { setError('Не вдалося видалити промокод.'); }
          finally { setBusy(false); }
        }}><Trash2 size={17} /></button>
      </article>)}
    </section>
  </div>;
}
