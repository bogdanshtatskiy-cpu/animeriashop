import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, runTransaction } from 'firebase/firestore';
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { Pencil, Plus, Trash2, Upload, X } from 'lucide-react';
import { photos, ProductPhoto, WAND_CATEGORY } from '../../components/Product';
import { db } from '../../firebase';
import { app } from '../../lib/firebase-app';
import { finishStock, money, toKop } from '../../lib/commerce';
import type { Product } from '../../store/useCartStore';
import { useProductsStore } from '../../store/useProductsStore';

const templates = [
  ['Гаррі Поттер', 'Гаррі Поттера'], ['Герміона Ґрейнджер', 'Герміони Ґрейнджер'],
  ['Драко Мелфой', 'Драко Мелфоя'], ['Северус Снейп', 'Северуса Снейпа'], ['Албус Дамблдор', 'Албуса Дамблдора'],
];
const blank = {
  title: '', price: '', description: '', category: '', dimensions: '', material: '', colors: '', technology: '' as NonNullable<Product['technology']>,
  finish: '', character: '', stock: '', featured: false, madeToOrder: false, available: false, images: [] as string[],
  leadDays: '', packageContents: '', giftPrice: '', giftContents: '', variantStock: {} as Record<string, string>,
  discountType: 'percent' as 'percent' | 'fixed', discountValue: '',
};
type Draft = typeof blank;
type Entry = { item: Product; draft: boolean };
const types = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const storage = getStorage(app);
const colorsFrom = (value: string) => [...new Set(value.split(',').map(color => color.trim()).filter(Boolean))];

async function optimizedPhoto(file: File) {
  if (!types.includes(file.type) || file.size > 20_000_000) throw new Error('Оберіть JPEG, PNG, WebP або AVIF до 20 МБ.');
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не вдалося обробити фото.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => {
      if (!blob || blob.size >= 8 * 1024 * 1024) reject(new Error('Фото завелике або пошкоджене.'));
      else resolve(blob);
    }, 'image/webp', 0.86));
  } finally { image.close(); }
}

export default function AdminProducts() {
  const { products, loading, error: loadError, refreshProducts } = useProductsStore();
  const [drafts, setDrafts] = useState<Product[]>([]);
  const [draftError, setDraftError] = useState('');
  const [editing, setEditing] = useState<Entry | null>(null);
  const [form, setForm] = useState<Draft>(blank);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [find, setFind] = useState('');
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setForm(previous => ({ ...previous, [key]: value }));

  useEffect(() => onSnapshot(collection(db, 'product_drafts'), snapshot => {
    setDrafts(snapshot.docs.map(entry => ({ ...entry.data(), id: entry.id } as Product)));
  }, () => setDraftError('Не вдалося завантажити чернетки.')), []);

  const edit = (entry: Entry) => {
    const item = entry.item;
    setEditing(entry);
    setMessage('');
    setError('');
    setForm({
      title: item.title, price: item.price > 0 ? String(item.price) : '', description: item.description ?? '', category: item.category ?? '',
      dimensions: item.dimensions ?? '', material: item.material ?? '', colors: item.colors?.join(', ') ?? '', technology: item.technology ?? '',
      finish: item.finish ?? '', character: item.character ?? '', stock: item.stock == null ? '' : String(item.stock),
      featured: Boolean(item.featured), madeToOrder: Boolean(item.madeToOrder), available: !entry.draft && item.available !== false,
      leadDays: item.leadDays ? String(item.leadDays) : '', packageContents: item.packageContents ?? '',
      giftPrice: item.giftSet ? String(item.giftSet.price) : '', giftContents: item.giftSet?.contents ?? '',
      variantStock: Object.fromEntries(Object.entries(item.variantStock ?? {}).map(([key, value]) => [key, String(value)])),
      images: photos(item), discountType: item.discount?.type ?? 'percent', discountValue: item.discount?.value ? String(item.discount.value) : '',
    });
    requestAnimationFrame(() => document.getElementById('product-editor')?.scrollIntoView({ block: 'start' }));
  };

  const upload = async (files: File[]) => {
    if (uploading || busy || !files.length) return;
    setUploading(true);
    setError('');
    try {
      for (const file of files.slice(0, Math.max(0, 8 - form.images.length))) {
        const blob = await optimizedPhoto(file);
        const target = ref(storage, 'products/' + crypto.randomUUID() + (blob.type === 'image/webp' ? '.webp' : '.png'));
        await uploadBytes(target, blob, { contentType: blob.type, cacheControl: 'public,max-age=31536000,immutable' });
        const url = await getDownloadURL(target);
        setForm(previous => ({ ...previous, images: [...previous.images, url] }));
      }
    } catch (error) { setError(error instanceof Error ? error.message : 'Не вдалося завантажити фото.'); }
    finally { setUploading(false); }
  };

  const colors = colorsFrom(form.colors);
  const entries = [...products.map(item => ({ item, draft: false })), ...drafts.map(item => ({ item, draft: true }))];
  const results = entries.filter(({ item }) => (item.title + ' ' + (item.category ?? '')).toLocaleLowerCase('uk').includes(find.toLocaleLowerCase('uk').trim()));

  return <div className="admin-layout">
    <section className="panel" id="product-editor">
      <div className="admin-section-heading"><h2>{editing ? 'Редагування виробу' : 'Новий виріб'}</h2>
        {editing && <button className="icon-button" type="button" aria-label="Новий виріб" disabled={busy || uploading} onClick={() => { setEditing(null); setForm(blank); setError(''); }}><Plus size={19} /></button>}
      </div>
      <form className="admin-form" onPaste={event => {
        const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'));
        if (files.length) { event.preventDefault(); void upload(files); }
      }} onSubmit={async event => {
        event.preventDefault();
        const title = form.title.trim();
        if (!title) { setError('Вкажіть назву виробу.'); return; }
        if (form.available && (!Number(form.price) || !form.images.length)) {
          setError('Для публікації додайте ціну й щонайменше одне фото виробу.'); return;
        }
        setBusy(true); setError(''); setMessage('');
        const destination = collection(db, form.available ? 'products' : 'product_drafts');
        const source = editing ? doc(db, editing.draft ? 'product_drafts' : 'products', editing.item.id) : null;
        const target = source ? doc(destination, source.id) : doc(destination);
        const stock = form.stock ? Number(form.stock) : null;
        const payload: Omit<Product, 'id'> = {
          title, price: Number(form.price || 0), category: form.category.trim(), material: form.material.trim(),
          dimensions: form.dimensions.trim(), character: form.character.trim(), technology: form.technology, finish: form.finish.trim(),
          colors, variantStock: Object.fromEntries(colors.flatMap(color => {
            const input = Object.hasOwn(form.variantStock, color) ? form.variantStock[color] : '';
            return input === '' ? [] : [[color, Number(input)]];
          })),
          leadDays: form.leadDays ? Number(form.leadDays) : null, packageContents: form.packageContents.trim(),
          giftSet: form.giftPrice ? { price: Number(form.giftPrice), contents: form.giftContents.trim() } : null,
          description: form.description.trim(), stock, featured: form.featured, available: form.available, madeToOrder: form.madeToOrder,
          imageUrls: form.images, imageUrl: form.images[0] ?? null,
          discount: Number(form.discountValue) ? { type: form.discountType, value: Number(form.discountValue) } : null,
        };
        if (colors.some(color => color.length > 80 || /^__.*__$/.test(color))) {
          setError('Кожен варіант має містити до 80 символів і не може починатись і завершуватись двома підкресленнями.'); setBusy(false); return;
        }
        try {
          await runTransaction(db, async tx => {
            let product = payload;
            if (source && editing) {
              const latest = await tx.get(source);
              if (!latest.exists()) throw new Error('Виріб змінився. Відкрийте його ще раз.');
              const currentStock = latest.get('stock') ?? null;
              const before = editing.item.stock ?? null;
              if (stock !== before && before !== currentStock) throw new Error('Залишок змінився після відкриття форми. Відкрийте виріб ще раз.');
              if (stock === before) product = { ...product, stock: currentStock };
              const variantStock = new Map(Object.entries(payload.variantStock ?? {}));
              const currentVariantStock = { variantStock: latest.get('variantStock') as Product['variantStock'] };
              for (const color of colors) {
                const original = finishStock(editing.item, color);
                const current = finishStock(currentVariantStock, color);
                const next = variantStock.get(color);
                if (next !== original && original !== current) throw new Error('Залишок варіанта змінився. Відкрийте виріб ще раз.');
                if (next === original && current !== undefined) variantStock.set(color, current);
                if (next === original && current === undefined) variantStock.delete(color);
              }
              product = { ...product, variantStock: Object.fromEntries(variantStock) };
              if (target.path !== source.path) tx.delete(source);
            }
            tx.set(target, product);
          });
          await refreshProducts();
          setEditing(null); setForm(blank); setMessage(form.available ? 'Виріб опубліковано.' : 'Чернетку збережено.');
        } catch (error) { setError(error instanceof Error ? error.message : 'Не вдалося зберегти виріб.'); }
        finally { setBusy(false); }
      }}>
        <fieldset disabled={busy || uploading}>
          {!editing && <label className="field-label">Шаблон палички<select className="field" defaultValue="" onChange={event => {
            const template = templates[Number(event.target.value)];
            if (event.target.value && template) setForm(previous => ({ ...previous, title: 'Паличка ' + template[1], character: template[0], category: WAND_CATEGORY, finish: 'Ручне фарбування', available: false }));
          }}><option value="">Оберіть персонажа</option>{templates.map(([name], i) => <option key={name} value={i}>{name}</option>)}</select></label>}
          <label className="field-label">Назва<input className="field" required maxLength={140} value={form.title} onChange={e => set('title', e.target.value)} /></label>
          <div className="admin-field-grid">
            <label className="field-label">Ціна, грн<input className="field" type="number" min="0.01" max="1000000" step="0.01" inputMode="decimal" value={form.price} onChange={e => set('price', e.target.value)} /></label>
            <label className="field-label">Залишок, шт.<input className="field" type="number" min="0" max="999999" step="1" placeholder="Без обліку" value={form.stock} onChange={e => set('stock', e.target.value)} /></label>
            <label className="field-label">Категорія<input className="field" maxLength={70} list="product-categories" value={form.category} onChange={e => set('category', e.target.value)} /></label>
            <datalist id="product-categories">{[...new Set([WAND_CATEGORY, ...products.flatMap(product => product.category ? [product.category] : [])])].map(name => <option key={name} value={name} />)}</datalist>
            <label className="field-label">Персонаж<input className="field" maxLength={90} value={form.character} onChange={e => set('character', e.target.value)} /></label>
            <label className="field-label">Технологія<select className="field" value={form.technology} onChange={e => set('technology', e.target.value as Draft['technology'])}>
              <option value="">Не вказана</option><option value="fdm">FDM-друк</option><option value="resin">Фотополімерний друк</option></select></label>
            <label className="field-label">Матеріал<input className="field" maxLength={80} placeholder="Наприклад, PLA" value={form.material} onChange={e => set('material', e.target.value)} /></label>
            <label className="field-label">Довжина / розмір<input className="field" maxLength={80} placeholder="Наприклад, 32 см" value={form.dimensions} onChange={e => set('dimensions', e.target.value)} /></label>
            <label className="field-label">Оздоблення<input className="field" maxLength={110} value={form.finish} onChange={e => set('finish', e.target.value)} /></label>
            <label className="field-label">Варіанти через кому<input className="field" maxLength={500} value={form.colors} onChange={e => set('colors', e.target.value)} /></label>
            <label className="field-label">Знижка<span className="admin-discount"><select aria-label="Тип знижки" className="field" value={form.discountType} onChange={e => set('discountType', e.target.value as Draft['discountType'])}><option value="percent">%</option><option value="fixed">грн</option></select>
              <input className="field" aria-label="Розмір знижки" type="number" min="0" max={form.discountType === 'percent' ? 100 : form.price || 1_000_000} step="0.01" value={form.discountValue} onChange={e => set('discountValue', e.target.value)} /></span></label>
          </div>
          {colors.length > 0 && <fieldset className="product-settings">
            <legend>Залишки за оздобленням</legend>
            <div className="admin-field-grid">{colors.map(color => <label className="field-label" key={color}>{color}
              <input className="field" type="number" min="0" max="999999" step="1" placeholder="Без окремого обліку"
                value={Object.hasOwn(form.variantStock, color) ? form.variantStock[color] : ''}
                onChange={e => set('variantStock', { ...form.variantStock, [color]: e.target.value })} />
            </label>)}</div>
          </fieldset>}
          <fieldset className="product-settings">
            <legend>Комплектація та готовність</legend>
            <label className="field-label">Що входить у базову ціну<input className="field" maxLength={240}
              value={form.packageContents} onChange={e => set('packageContents', e.target.value)} placeholder="Наприклад, паличка та захисне пакування" /></label>
            <div className="admin-field-grid">
              <label className="field-label">До відправлення, днів<input className="field" type="number" min="1" max="365" step="1"
                value={form.leadDays} onChange={e => set('leadDays', e.target.value)} /></label>
              <label className="field-label">Доплата за подарунковий набір, грн<input className="field" type="number" min="0.01" max="1000000" step="0.01"
                placeholder="Порожнє поле вимикає набір" value={form.giftPrice} onChange={e => set('giftPrice', e.target.value)} /></label>
            </div>
            {form.giftPrice && <label className="field-label">Що входить у подарунковий набір<input className="field" maxLength={240}
              placeholder="Паличка, підставка та коробка" value={form.giftContents} onChange={e => set('giftContents', e.target.value)} /></label>}
          </fieldset>
          <label className="field-label">Опис<textarea className="field" rows={4} maxLength={1800} value={form.description} onChange={e => set('description', e.target.value)} /></label>
          <label className="upload-zone"><Upload size={19} /> {uploading ? 'Завантажуємо…' : 'Додати фото або вставити з буфера'}
            <input type="file" multiple accept={types.join(',')} disabled={form.images.length >= 8} onChange={event => {
              const files = Array.from(event.target.files ?? []); event.target.value = ''; void upload(files);
            }} /></label>
          {form.images.length > 0 && <div className="admin-media-grid">{form.images.map((url, index) => <div key={url}>
            <img src={url} alt={'Фото ' + (index + 1)} loading="lazy" />
            <button className="icon-button" aria-label={'Прибрати фото ' + (index + 1)} type="button" onClick={() => set('images', form.images.filter(item => item !== url))}><X size={16} /></button>
            <button className="text-button" type="button" disabled={index === 0} onClick={() => set('images', [url, ...form.images.filter(item => item !== url)])}>{index === 0 ? 'Обкладинка' : 'На обкладинку'}</button>
          </div>)}</div>}
          <label className="check-field"><input type="checkbox" checked={form.available} onChange={e => set('available', e.target.checked)} /> Опублікувати у вітрині</label>
          <label className="check-field"><input type="checkbox" checked={form.featured} onChange={e => set('featured', e.target.checked)} /> Показати серед рекомендованих</label>
          <label className="check-field"><input type="checkbox" checked={form.madeToOrder} onChange={e => set('madeToOrder', e.target.checked)} /> Виготовляється під замовлення</label>
          <button className="button primary" type="submit">{busy ? 'Зберігаємо…' : form.available ? 'Зберегти і опублікувати' : 'Зберегти чернетку'}</button>
        </fieldset>
        {error && <p className="feedback" role="alert">{error}</p>}{message && <p className="muted" role="status">{message}</p>}
      </form>
    </section>
    <section className="panel admin-list">
      <h2>Вироби й чернетки</h2>
      <input className="field" type="search" aria-label="Знайти виріб" placeholder="Знайти виріб" value={find} onChange={e => setFind(e.target.value)} />
      {(loadError || draftError) && <p className="feedback" role="alert">{draftError || 'Не вдалося завантажити вітрину.'}</p>}
      {loading ? <p className="muted">Завантажуємо…</p> : !results.length && <p className="muted">Виробів не знайдено.</p>}
      {results.map(entry => <article className="admin-row" key={(entry.draft ? 'draft-' : '') + entry.item.id}>
        <span className="line-photo"><ProductPhoto product={entry.item} /></span>
        <div className="admin-row-copy"><h3>{entry.item.title}</h3><p>{entry.draft || entry.item.available === false ? 'Чернетка' : money(toKop(entry.item.price))}</p></div>
        <button type="button" className="icon-button" aria-label={'Редагувати — ' + entry.item.title} disabled={busy || uploading} onClick={() => edit(entry)}><Pencil size={17} /></button>
        <button type="button" className="icon-button delete-button" disabled={busy || uploading} aria-label={'Видалити — ' + entry.item.title} onClick={async () => {
          if (!confirm('Видалити «' + entry.item.title + '»?')) return;
          setError('');
          setBusy(true);
          try {
            const product = doc(db, entry.draft ? 'product_drafts' : 'products', entry.item.id);
            await runTransaction(db, async tx => {
              const snapshot = await tx.get(product);
              if (snapshot.exists()) tx.delete(product);
            });
            await refreshProducts();
            if (editing?.item.id === entry.item.id) { setEditing(null); setForm(blank); }
          } catch { setError('Не вдалося видалити виріб.'); }
          finally { setBusy(false); }
        }}><Trash2 size={17} /></button>
      </article>)}
    </section>
  </div>;
}
