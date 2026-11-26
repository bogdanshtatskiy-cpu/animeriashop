import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowDownUp, Box, PackageCheck, Paintbrush, Search, X } from 'lucide-react';
import { isWand, ProductCard, ProductDetail, WAND_CATEGORY } from '../components/Product';
import { unitPrice } from '../lib/commerce';
import { haptic, telegram } from '../lib/telegram';
import { useCartStore } from '../store/useCartStore';
import { useFavoritesStore } from '../store/useFavoritesStore';
import { useProductsStore } from '../store/useProductsStore';

const normalize = (text: string) => text.toLocaleLowerCase('uk').replace(/[iі]/g, 'і').replace(/[’']/g, '');
const workshop = [
  { Icon: Box, title: 'Дві технології друку', detail: 'FDM і фотополімерний друк' },
  { Icon: Paintbrush, title: 'Ручне фарбування', detail: 'Оздоблення кожної палички вручну' },
  { Icon: PackageCheck, title: 'Нова пошта', detail: 'Доставка по Україні' },
];

export default function Catalog() {
  const { products, loading, error } = useProductsStore();
  const favoriteError = useFavoritesStore(state => state.error);
  const addItem = useCartStore(state => state.addItem);
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('featured');
  const catalog = useRef<HTMLElement>(null);
  const lastLaunch = useRef('');
  const productId = params.get('productId');
  const publicProducts = products.filter(product => product.available !== false);
  const categories = [...new Set(publicProducts.flatMap(product => isWand(product) ? [] : product.category ? [product.category] : []))].sort((a, b) => a.localeCompare(b, 'uk'));
  const selected = publicProducts.find(product => product.id === productId);
  const visible = publicProducts.filter(product => {
    const matchesCategory = !category || (category === WAND_CATEGORY ? isWand(product) : !isWand(product) && category === product.category);
    const searchable = [product.title, product.description, product.character, product.category, isWand(product) ? WAND_CATEGORY + ' Гаррі Поттер' : ''].filter(Boolean).join(' ');
    return matchesCategory && normalize(query.trim()).split(/\s+/).every(term => normalize(searchable).includes(term));
  }).sort((a, b) => {
    if (sort === 'price-up') return unitPrice(a) - unitPrice(b);
    if (sort === 'price-down') return unitPrice(b) - unitPrice(a);
    return Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || Number(isWand(b)) - Number(isWand(a));
  });

  useEffect(() => {
    const start = telegram()?.initDataUnsafe?.start_param;
    if (!productId && start && /^p_[\w-]{1,128}$/.test(start) && lastLaunch.current !== start) {
      lastLaunch.current = start;
      try {
        if (sessionStorage.getItem('animeria-launch-' + start)) return;
        sessionStorage.setItem('animeria-launch-' + start, '1');
      } catch { /* storage unavailable */ }
      setParams(previous => { const next = new URLSearchParams(previous); next.set('productId', start.slice(2)); return next; }, { replace: true });
    }
  }, [productId, setParams]);

  function closeProduct() {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      next.delete('productId');
      next.delete('photo');
      return next;
    }, { replace: true });
  }

  function setPhotoOpen(open: boolean) {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      if (open) next.set('photo', 'full');
      else next.delete('photo');
      return next;
    }, { replace: true });
  }

  return <>
    <section className="hero" aria-labelledby="hero-title">
      <picture><img src="/media/atelier.webp" alt="" fetchPriority="high" width="1440" height="960" /></picture>
      <div className="hero-content">
        <p className="eyebrow hero-eyebrow"><span />Колекція майстерні</p>
        <h1 id="hero-title">Чарівні<br /><em>палички</em></h1>
        <p className="hero-description">За мотивами світу Гаррі Поттера. Друкуємо в 3D і фарбуємо вручну.</p>
        <button type="button" className="button primary hero-cta" onClick={() => { setQuery(''); setCategory(WAND_CATEGORY); catalog.current?.scrollIntoView({ block: 'start' }); }}>
          До колекції <ArrowDown size={17} strokeWidth={1.8} />
        </button>
      </div>
    </section>
    <div className="workshop-strip">
      {workshop.map(({ Icon, title, detail }) => <div className="workshop-item" key={title}>
        <Icon size={21} strokeWidth={1.45} /><span><strong>{title}</strong><small>{detail}</small></span>
      </div>)}
    </div>
    <section className="catalog-section" ref={catalog} aria-labelledby="catalog-title">
      <div className="section-heading"><h2 id="catalog-title">Каталог майстерні</h2>
        {!loading && !error && <span className="result-count" aria-live="polite">{visible.length} поз.</span>}
      </div>
      <div className="catalog-controls">
        <div className="search-box">
          <Search size={20} strokeWidth={1.6} />
          <label className="sr-only" htmlFor="catalog-search">Пошук у каталозі</label>
          <input id="catalog-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Пошук у каталозі" />
          {query && <button className="icon-button search-clear" type="button" aria-label="Очистити пошук" onClick={() => setQuery('')}><X size={16} /></button>}
        </div>
        <label className="sort-control"><ArrowDownUp size={17} strokeWidth={1.6} /><span className="sr-only">Сортування</span>
          <select value={sort} onChange={event => setSort(event.target.value)}>
            <option value="featured">Добірка</option><option value="price-up">Дешевші</option><option value="price-down">Дорожчі</option>
          </select>
        </label>
      </div>
      <div className="category-strip" aria-label="Категорії" role="group">
        {['', WAND_CATEGORY, ...categories].map(option => <button type="button" className="filter-pill" key={option} aria-pressed={category === option} onClick={() => setCategory(option)}>{option || 'Усі вироби'}</button>)}
      </div>
      {favoriteError && <p className="feedback" role="status">{favoriteError}</p>}
      {productId && !loading && !selected && <p className="feedback" role="status">Цей товар наразі недоступний. <button type="button" className="text-button" onClick={closeProduct}>Закрити</button></p>}
      {loading ? <div className="product-grid" role="status" aria-label="Завантажуємо каталог">{Array.from({ length: 4 }, (_, i) => <div className="skeleton" key={i} />)}</div>
        : error && !products.length ? <div className="empty-state"><h3>Каталог тимчасово недоступний</h3><button type="button" className="button secondary" onClick={() => location.reload()}>Оновити</button></div>
        : visible.length ? <div className="product-grid">{visible.map((product, i) => <ProductCard key={product.id} product={product} eager={i < 2} />)}</div>
        : <div className="empty-state"><h3>{category === WAND_CATEGORY && !query ? 'Колекція готується' : 'Виробів не знайдено'}</h3>
          <p>{category === WAND_CATEGORY && !query ? 'Палички з’являться тут після публікації майстернею.' : 'Спробуйте іншу назву або категорію.'}</p>
          <button type="button" className="button secondary" onClick={() => { setCategory(''); setQuery(''); }}>Усі вироби</button>
        </div>}
    </section>
    {selected && <ProductDetail key={selected.id} product={selected} photoOpen={params.get('photo') === 'full'}
      onPhotoOpenChange={setPhotoOpen} onClose={closeProduct} onAdd={(product, color, gift) => {
      const added = addItem(product, color, gift);
      if (added) haptic();
      return added;
    }} />}
  </>;
}
