import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowRight, Check, Minus, Package, Plus, ShoppingBag, Trash2, Truck } from 'lucide-react';
import { Link } from 'react-router-dom';
import DeliverySearch, { type DeliveryOption } from '../components/DeliverySearch';
import { ProductPhoto } from '../components/Product';
import { api, ApiError } from '../lib/api';
import { giftPrice, MAX_LINE_QUANTITY, MIN_ORDER_KOP, money, orderNumber, unitPrice } from '../lib/commerce';
import type { Quote } from '../lib/commerce';
import { haptic, inTelegram, telegramLink, telegramUser } from '../lib/telegram';
import { cartStockRemaining, useCartStore } from '../store/useCartStore';
import { useProductsStore } from '../store/useProductsStore';

type Receipt = { id: string; total: number };
type PendingOrder = { hash: string; key: string; basket: string };
const errorMessage = (error: unknown) => error instanceof ApiError ? error.message : 'З’єднання перервано. Спробуйте ще раз.';
const orderStorage = () => 'animeria-checkout-' + (telegramUser()?.id ?? '');

function storedOrder(): PendingOrder | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(orderStorage()) ?? 'null');
    if (value && typeof value.hash === 'string' && typeof value.key === 'string' && typeof value.basket === 'string') return value;
  } catch { /* storage unavailable */ }
}

async function checkoutKey(signature: string, basket: string, last?: PendingOrder) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signature));
  const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  if (last?.hash === hash) return last;
  const cached = storedOrder();
  if (cached?.hash === hash) return cached;
  const pending = { hash, key: crypto.randomUUID(), basket };
  try { sessionStorage.setItem(orderStorage(), JSON.stringify(pending)); } catch { /* keep the key in memory */ }
  return pending;
}

const cartPrice = (product: Parameters<typeof cartStockRemaining>[0], gift: boolean) => unitPrice(product) + (gift ? giftPrice(product) : 0);

export default function Cart() {
  const { items, removeItem, updateQuantity, clearCart } = useCartStore();
  const { products, loading, error: catalogError, refreshProducts } = useProductsStore();
  const user = telegramUser();
  const orderInProgress = useRef(false);
  const idempotency = useRef<PendingOrder>();
  const initialPending = useRef(inTelegram() ? storedOrder() : undefined);
  const [firstName, setFirstName] = useState(user?.first_name ?? '');
  const [lastName, setLastName] = useState(user?.last_name ?? '');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState<DeliveryOption | null>(null);
  const [branch, setBranch] = useState<DeliveryOption | null>(null);
  const [promoInput, setPromoInput] = useState('');
  const [applied, setApplied] = useState<{ signature: string; quote: Quote } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'quote' | 'place' | ''>('');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [pending, setPending] = useState(initialPending.current);
  const live = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);
  const lines = items.map(item => ({ id: item.id, color: item.selectedColor ?? '', quantity: item.quantity, ...(item.gift ? { gift: true } : {}) }));
  const signature = JSON.stringify(lines);
  const quote = applied?.signature === signature ? applied.quote : null;
  const localSubtotal = items.reduce((sum, item) => sum + cartPrice(live.get(item.id) ?? item, Boolean(item.gift)) * item.quantity, 0);
  const subtotal = quote?.subtotal ?? localSubtotal;
  const total = quote?.total ?? localSubtotal;
  const unavailable = (item: typeof items[number]) => {
    const product = live.get(item.id);
    if (!product) return !loading && !catalogError;
    return product.available === false || (item.gift && !giftPrice(product)) || cartStockRemaining(product, items, item.selectedColor) < 0 ||
      (product.colors?.length ? !product.colors.includes(item.selectedColor ?? '') : Boolean(item.selectedColor));
  };
  const hasUnavailable = items.some(unavailable);

  const finish = useCallback((result: Receipt) => {
    setReceipt(result);
    clearCart();
    void refreshProducts();
    setPending(undefined);
    try { sessionStorage.removeItem(orderStorage()); } catch { /* storage unavailable */ }
    haptic();
  }, [clearCart, refreshProducts]);

  const recoverOrder = useCallback(async (previous: PendingOrder, signal?: AbortSignal) => {
    const { receipt: result } = await api<{ receipt: Receipt | null }>('checkout', { action: 'status', key: previous.key }, { signal });
    if (result && !signal?.aborted) finish(result);
    return Boolean(result);
  }, [finish]);

  useEffect(() => {
    const previous = initialPending.current;
    if (!previous || previous.basket !== signature) return;
    const controller = new AbortController();
    void recoverOrder(previous, controller.signal).catch(() => {});
    return () => controller.abort();
  }, [recoverOrder, signature]);

  async function applyPromo(code: string) {
    const result = await api<{ quote: Quote }>('checkout', { action: 'quote', items: lines, promo: code });
    setApplied({ signature, quote: result.quote });
  }

  async function handlePromo() {
    if (orderInProgress.current || !promoInput.trim()) return;
    orderInProgress.current = true;
    setBusy('quote');
    setError('');
    try { await applyPromo(promoInput.trim()); }
    catch (error) { setError(errorMessage(error)); }
    finally { orderInProgress.current = false; setBusy(''); }
  }

  async function checkout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (orderInProgress.current) return;
    if (!firstName.trim() || !lastName.trim() || !/^[1-9]\d{8}$/.test(phone) || !city || !branch?.proof) {
      setError('Перевірте контакти й оберіть відділення Нової пошти зі списку.');
      return;
    }
    if (hasUnavailable || subtotal < MIN_ORDER_KOP) return;
    setError('');
    setBusy('place');
    orderInProgress.current = true;
    const request = { firstName: firstName.trim(), lastName: lastName.trim(), phone: '+380' + phone, items: lines, promo: quote?.promo, expectedTotal: total };
    try {
      idempotency.current = await checkoutKey(JSON.stringify({ ...request, city: city.id, branch: branch.id }), signature, idempotency.current);
      const result = await api<Receipt>('checkout', { ...request, action: 'place', key: idempotency.current.key, deliveryProof: branch.proof });
      finish(result);
    } catch (error) {
      setError(errorMessage(error));
      if (!(error instanceof ApiError) || !error.code) setPending(idempotency.current);
      if (error instanceof ApiError && error.code === 'PRICE_CHANGED') {
        try { await applyPromo(quote?.promo ?? ''); } catch (quoteError) { setError(errorMessage(quoteError)); }
      }
      if (error instanceof ApiError && error.code === 'UNAVAILABLE') void refreshProducts();
      if (error instanceof ApiError && (error.code === 'DELIVERY_EXPIRED' || error.code === 'INVALID_PROMO')) {
        if (error.code === 'DELIVERY_EXPIRED') setBranch(null);
        else setApplied(null);
      }
    } finally { orderInProgress.current = false; setBusy(''); }
  }

  if (receipt) return <div className="empty-state order-success">
    <span className="success-icon"><Check size={29} /></span><h1>Замовлення прийнято</h1>
    <p>{orderNumber(receipt.id)} · {money(receipt.total)}</p>
    <p>Перевіряйте статус у профілі. Деталі оплати узгодимо в Telegram.</p>
    <Link to="/profile" className="button primary">Мої замовлення <ArrowRight size={17} /></Link>
    <Link to="/" className="button secondary">До каталогу</Link>
  </div>;

  return <>
    <div className="page-heading"><h1>Кошик</h1><p>Ваше замовлення в Animeria</p></div>
    {!items.length ? <div className="empty-state"><ShoppingBag size={31} strokeWidth={1.4} /><h2>Кошик порожній</h2>
      <p>Додайте вироби, які хочете замовити.</p><Link to="/" className="button primary">До каталогу <ArrowRight size={17} /></Link></div>
      : <form className="checkout-layout" onSubmit={event => void checkout(event)}>
        <div className="checkout-main">
          <section className="panel cart-lines" aria-labelledby="items-title">
            <h2 id="items-title"><Package size={20} strokeWidth={1.55} /> Вироби</h2>
            {items.map(item => {
              const product = live.get(item.id) ?? item;
              const limitStock = cartStockRemaining(product, items, item.selectedColor) <= 0;
              const linePrice = quote?.lines.find(line => line.id === item.id && line.color === (item.selectedColor ?? '') && Boolean(line.gift) === Boolean(item.gift))?.unitPrice ?? cartPrice(product, Boolean(item.gift));
              return <article className="cart-line" key={item.cartItemId}>
                <Link className="line-photo" aria-label={product.title} to={'/?productId=' + encodeURIComponent(product.id)}><ProductPhoto product={product} /></Link>
                <div className="line-copy"><h3>{product.title}</h3>{item.selectedColor && <p>{item.selectedColor}</p>}
                  {item.gift && <p>Подарунковий набір</p>}
                  <strong>{money(linePrice * item.quantity)}</strong>{unavailable(item) && <p className="line-error">Перевірте наявність, оздоблення або комплектацію</p>}</div>
                <div className="line-actions">
                  <div className="stepper">
                    <button type="button" aria-label={'Зменшити кількість — ' + item.title} disabled={item.quantity <= 1 || Boolean(busy)} onClick={() => updateQuantity(item.cartItemId, item.quantity - 1)}><Minus size={15} /></button>
                    <span aria-label="Кількість">{item.quantity}</span>
                    <button type="button" aria-label={'Збільшити кількість — ' + item.title} disabled={unavailable(item) || limitStock || item.quantity >= MAX_LINE_QUANTITY || Boolean(busy)} onClick={() => updateQuantity(item.cartItemId, item.quantity + 1)}><Plus size={15} /></button>
                  </div>
                  <button className="icon-button delete-button" type="button" aria-label={'Видалити — ' + item.title} disabled={Boolean(busy)} onClick={() => removeItem(item.cartItemId)}><Trash2 size={17} strokeWidth={1.6} /></button>
                </div>
              </article>;
            })}
          </section>

          {inTelegram() && <section className="panel shipping-panel" aria-labelledby="shipping-title">
            <h2 id="shipping-title"><Truck size={20} strokeWidth={1.6} /> Доставка Новою поштою</h2>
            <div className="shipping-fields">
              <label className="field-label">Ім’я<input className="field" required autoComplete="given-name" maxLength={64} value={firstName} onChange={event => setFirstName(event.target.value)} /></label>
              <label className="field-label">Прізвище<input className="field" required autoComplete="family-name" maxLength={64} value={lastName} onChange={event => setLastName(event.target.value)} /></label>
              <label className="field-label full-field">Телефон<span className="phone-field"><span>+380</span><input type="tel" className="field" required autoComplete="tel-national" placeholder="XX XXX XX XX"
                value={phone.replace(/^(\d{2})(\d{0,3})(\d{0,2})(\d{0,2})$/, (_, a, b, c, d) => [a, b, c, d].filter(Boolean).join(' '))}
                onChange={event => {
                  const digits = event.target.value.replace(/\D/g, '');
                  setPhone((digits.length >= 12 && digits.startsWith('380') ? digits.slice(3) : digits.length === 10 && digits.startsWith('0') ? digits.slice(1) : digits).slice(0, 9));
                }} /></span></label>
              <DeliverySearch action="cities" label="Місто" placeholder="Введіть назву міста" value={city} onChange={option => { setCity(option); setBranch(null); }} disabled={Boolean(busy)} />
              <DeliverySearch key={city?.id ?? 'none'} action="branches" label="Відділення або поштомат" placeholder="Введіть номер чи адресу" value={branch}
                onChange={setBranch} cityRef={city?.id} disabled={!city || Boolean(busy)} />
            </div>
          </section>}
        </div>
        <section className="panel checkout-summary" aria-labelledby="summary-title">
          <h2 id="summary-title">Підсумок</h2>
          {inTelegram() && <div className="promo-area">
            <label className="field-label" htmlFor="promo">Промокод</label>
            <div className="promo-row"><input className="field" id="promo" placeholder="Введіть код" maxLength={40} autoComplete="off" value={promoInput}
              disabled={Boolean(quote?.promo) || Boolean(busy)} onChange={event => setPromoInput(event.target.value.toUpperCase())}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void handlePromo(); } }} />
              <button type="button" className="button secondary" disabled={Boolean(busy) || !promoInput.trim()}
                onClick={() => quote?.promo ? setApplied(null) : void handlePromo()}>{quote?.promo ? 'Скасувати' : 'Застосувати'}</button></div>
            {quote?.promo && <p className="muted" role="status">Застосовано {quote.promo}</p>}
            {applied?.quote.promo && !quote && <p className="muted">Кошик змінився. Застосуйте код ще раз.</p>}
          </div>}
          <dl className="summary-totals"><div><dt>Вироби</dt><dd>{money(subtotal)}</dd></div>
            {total < subtotal && <div><dt>Знижка</dt><dd>−{money(subtotal - total)}</dd></div>}
            <div><dt>Доставка</dt><dd>За тарифом Нової пошти</dd></div>
            <div className="summary-total"><dt>До сплати</dt><dd>{money(total)}</dd></div>
          </dl>
          {subtotal < MIN_ORDER_KOP && <p className="feedback">Мінімальна сума — {money(MIN_ORDER_KOP)}.</p>}
          {hasUnavailable && <p className="feedback">Видаліть недоступні позиції або змініть їх кількість.</p>}
          {error && <p className="feedback" role="alert">{error}</p>}
          {pending?.basket === signature && <button type="button" className="button secondary recovery-button" disabled={Boolean(busy)}
            onClick={async () => {
              if (orderInProgress.current) return;
              orderInProgress.current = true;
              setBusy('place');
              try {
                if (!(await recoverOrder(pending))) setError('Попереднє замовлення ще не знайдено. Перевірте ще раз або оформіть його.');
              } catch (error) { setError(errorMessage(error)); }
              finally { orderInProgress.current = false; setBusy(''); }
            }}>Перевірити попередню спробу</button>}
          {inTelegram() ? <button type="submit" className="button primary checkout-cta" disabled={Boolean(busy) || loading || subtotal < MIN_ORDER_KOP || hasUnavailable}>
            {busy === 'place' ? 'Оформлюємо…' : 'Оформити замовлення'} <ArrowRight size={18} />
          </button> : telegramLink()
            ? <a href={telegramLink()} className="button primary checkout-cta">Відкрити в Telegram <ArrowRight size={18} /></a>
            : <p className="muted">Для оформлення відкрийте магазин у Telegram.</p>}
        </section>
      </form>}
  </>;
}
