import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Gift, Heart, ImageIcon, Share2, ShoppingBag, X } from 'lucide-react';
import { configuredStock, finishStock, giftPrice, money, toKop, unitPrice } from '../lib/commerce';
import { haptic, telegramLink } from '../lib/telegram';
import { useFavoritesStore } from '../store/useFavoritesStore';
import type { Product } from '../store/useCartStore';

export const WAND_CATEGORY = 'Чарівні палички';
export const isWand = (product: Product) => /пал[иіы]ч|wand/i.test((product.category ?? '') + ' ' + product.title) || Boolean(product.character);

export function photos(product: Product) {
  const candidates = [...(Array.isArray(product.imageUrls) ? product.imageUrls : []), product.imageUrl];
  return [...new Set(candidates.filter((url): url is string =>
    typeof url === 'string' && (url.startsWith('https://') || (url.startsWith('/') && !url.startsWith('//')))))];
}

export function ProductPhoto({ product, src, eager = false }: { product: Product; src?: string; eager?: boolean }) {
  const url = src ?? photos(product)[0];
  const [failed, setFailed] = useState('');
  return url && failed !== url
    ? <img src={url} alt={product.title} loading={eager ? 'eager' : 'lazy'} decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(url)} />
    : <span className="photo-placeholder" aria-label="Фото відсутнє" role="img"><ImageIcon size={29} strokeWidth={1.15} /></span>;
}

export function Price({ product, surcharge = 0 }: { product: Product; surcharge?: number }) {
  const price = unitPrice(product) + surcharge;
  const original = toKop(product.price) + surcharge;
  return <div className="price-row"><strong>{money(price)}</strong>{price < original && <del>{money(original)}</del>}</div>;
}

export function Stock({ product }: { product: Product }) {
  if (product.stock === 0 || product.available === false) return <span className="stock sold">Немає в наявності</span>;
  if (product.madeToOrder) return <span className="stock">Під замовлення</span>;
  if (typeof product.stock === 'number') return <span className="stock">В наявності</span>;
  return null;
}

function FavoriteButton({ product }: { product: Product }) {
  const active = useFavoritesStore(state => state.favorites.includes(product.id));
  const busy = useFavoritesStore(state => state.loading || state.pending.includes(product.id));
  const toggle = useFavoritesStore(state => state.toggleFavorite);
  return <button type="button" className="icon-button favorite-button" aria-label={active ? 'Видалити з обраного' : 'Зберегти в обране'} aria-pressed={active} disabled={busy}
    onClick={() => { haptic(); void toggle(product.id); }}>
    <Heart size={19} strokeWidth={1.65} fill={active ? 'currentColor' : 'none'} />
  </button>;
}

export function ProductCard({ product, eager }: { product: Product; eager?: boolean }) {
  const link = '/?productId=' + encodeURIComponent(product.id);
  return <article className="product-card">
    <Link to={link} className="product-media" aria-label={product.title}><ProductPhoto product={product} eager={eager} /></Link>
    <FavoriteButton product={product} />
    <div className="product-copy">
      {product.category && <p className="product-category">{isWand(product) ? WAND_CATEGORY : product.category}</p>}
      <h3><Link to={link}>{product.title}</Link></h3>
      <Stock product={product} />
      <div className="product-bottom">
        <Price product={product} />
        <Link to={link} className="icon-button card-arrow" aria-label={'Деталі — ' + product.title}><ArrowRight size={17} strokeWidth={1.7} /></Link>
      </div>
    </div>
  </article>;
}

export function ProductDetail({ product, onClose, onAdd }: { product: Product; onClose: () => void; onAdd: (product: Product, color?: string, gift?: boolean) => boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const touchStart = useRef<number | null>(null);
  const [index, setIndex] = useState(0);
  const [color, setColor] = useState(product.colors?.[0] ?? '');
  const [status, setStatus] = useState('');
  const [gift, setGift] = useState(false);
  const surcharge = giftPrice(product);
  const giftSelected = gift && surcharge > 0;
  const total = unitPrice(product) + (giftSelected ? surcharge : 0);
  const stock = Math.min(configuredStock(product.stock) ?? Infinity, finishStock(product, color) ?? Infinity);
  const sold = product.available === false || stock === 0;
  const available = sold ? 'Немає в наявності' : product.madeToOrder ? 'Під замовлення'
    : Number.isFinite(stock) ? 'У наявності · ' + stock + ' шт.' : 'Доступно до замовлення';
  const standardContents = product.packageContents || (isWand(product) ? 'Паличка' : '');
  const readyDays = product.leadDays && product.leadDays > 0 ? product.leadDays : 0;
  const gallery = photos(product);
  const slide = Math.min(index, Math.max(0, gallery.length - 1));
  const move = (direction: number) => setIndex((slide + direction + gallery.length) % gallery.length);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const active = document.activeElement as HTMLElement | null;
    node.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      node.close();
      document.body.style.overflow = previous;
      active?.focus({ preventScroll: true });
    };
  }, []);

  const share = async () => {
    const url = telegramLink(product.id) || new URL('/?productId=' + encodeURIComponent(product.id), location.origin).href;
    try {
      if (navigator.share) await navigator.share({ title: product.title, url });
      else {
        await navigator.clipboard.writeText(url);
        setStatus('Посилання скопійовано.');
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('Не вдалося поділитися посиланням.');
    }
  };

  const details = [
    ['Персонаж', product.character], ['Розмір', product.dimensions], ['Матеріал', product.material],
    ['Технологія', product.technology === 'resin' ? 'Фотополімерний друк' : product.technology === 'fdm' ? 'FDM-друк' : ''],
    ['Оздоблення', product.finish],
  ].filter(([, value]) => value);

  return <dialog ref={dialog} className="product-dialog" aria-labelledby="product-title" onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="product-sheet">
      <div className="detail-tools">
        <button type="button" className="icon-button" aria-label="Поділитися" onClick={() => void share()}><Share2 size={19} strokeWidth={1.65} /></button>
        <button type="button" className="icon-button" autoFocus aria-label="Закрити" onClick={onClose}><X size={22} strokeWidth={1.65} /></button>
      </div>
      <div className="dialog-layout">
        <div className="detail-gallery">
          <div className="detail-media" onTouchStart={event => { touchStart.current = event.touches[0].clientX; }}
            onTouchEnd={event => {
              if (touchStart.current === null || gallery.length < 2) return;
              const diff = event.changedTouches[0].clientX - touchStart.current;
              if (Math.abs(diff) > 45) move(diff < 0 ? 1 : -1);
              touchStart.current = null;
            }}>
            <ProductPhoto product={product} src={gallery[slide]} eager />
            {gallery.length > 1 && <>
              <button type="button" className="icon-button gallery-prev" onClick={() => move(-1)} aria-label="Попереднє фото"><ArrowLeft size={19} /></button>
              <button type="button" className="icon-button gallery-next" onClick={() => move(1)} aria-label="Наступне фото"><ArrowRight size={19} /></button>
            </>}
          </div>
          {gallery.length > 1 && <div className="gallery-dots" aria-label="Фотографії товару">
            {gallery.map((url, i) => <button key={url} className="gallery-dot" type="button" aria-pressed={slide === i} aria-label={'Фото ' + (i + 1)} onClick={() => setIndex(i)} />)}
          </div>}
        </div>
        <div className="detail-copy">
          {product.category && <p className="eyebrow">{isWand(product) ? WAND_CATEGORY : product.category}</p>}
          <h2 id="product-title">{product.title}</h2>
          <Price product={product} surcharge={giftSelected ? surcharge : 0} />
          <div className="detail-readiness" aria-live="polite">
            <span className={'stock' + (sold ? ' sold' : '')}>{available}</span>
            {!sold && <span>{readyDays > 0 ? 'До відправлення · до ' + readyDays + ' дн.' : 'Термін відправлення уточнюється'}</span>}
          </div>
          {Boolean(product.colors?.length) && <fieldset className="variants"><legend>Оздоблення</legend>
            {product.colors?.map(option => <label key={option} className="filter-pill">
              <input type="radio" name="variant" value={option} checked={option === color} onChange={() => { setColor(option); setStatus(''); }} />{option}
            </label>)}
          </fieldset>}
          {surcharge > 0 ? <fieldset className="package-options">
            <legend>Комплектація</legend>
            <label className="package-option">
              <input type="radio" name="package" checked={!giftSelected} onChange={() => { setGift(false); setStatus(''); }} />
              <span><strong>Стандартна</strong>{standardContents && <small>{standardContents}</small>}</span>
            </label>
            <label className="package-option">
              <input type="radio" name="package" checked={giftSelected} onChange={() => { setGift(true); setStatus(''); }} />
              <span><strong><Gift size={16} strokeWidth={1.55} /> Подарунковий набір</strong><small>{product.giftSet?.contents || 'Паличка, підставка та коробка'}</small></span>
              <b>+{money(surcharge)}</b>
            </label>
          </fieldset> : standardContents && <dl className="details-list"><div><dt>Комплектація</dt><dd>{standardContents}</dd></div></dl>}
          {product.description && <p className="detail-description">{product.description}</p>}
          {details.length > 0 && <dl className="details-list">
            {details.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}
          </dl>}
        </div>
      </div>
      <div className="detail-purchase">
        <div className="detail-purchase-row">
          <span className="detail-total"><small>За одиницю</small><strong>{money(total)}</strong></span>
          <button type="button" className="button primary detail-cta" disabled={sold}
            onClick={() => setStatus(onAdd(product, color || undefined, giftSelected) ? 'Додано до кошика.' : 'Досягнуто доступної кількості.')}>
            {status === 'Додано до кошика.' ? <Check size={19} /> : <ShoppingBag size={19} />}
            {sold ? 'Недоступно' : 'Додати в кошик'}
          </button>
        </div>
        <div className="detail-status" role="status">{status} {status === 'Додано до кошика.' && <Link className="text-button" to="/cart">До кошика</Link>}</div>
      </div>
    </div>
  </dialog>;
}
