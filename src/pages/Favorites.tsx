import { Heart } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ProductCard } from '../components/Product';
import { useFavoritesStore } from '../store/useFavoritesStore';
import { useProductsStore } from '../store/useProductsStore';

export default function Favorites() {
  const { favorites, loading, error, loadFavorites } = useFavoritesStore();
  const { products, loading: productsLoading } = useProductsStore();
  const saved = products.filter(product => product.available !== false && favorites.includes(product.id));
  return <>
    <div className="page-heading"><h1>Обране</h1><p>Збережені вироби майстерні</p></div>
    {error && <p className="feedback" role="status">{error} <button type="button" className="text-button" onClick={() => void loadFavorites()}>Повторити</button></p>}
    {loading || productsLoading ? <div className="empty-state" role="status">Завантажуємо обране…</div>
      : saved.length ? <div className="product-grid">{saved.map(product => <ProductCard key={product.id} product={product} />)}</div>
      : <div className="empty-state"><Heart size={30} strokeWidth={1.4} /><h2>Тут поки порожньо</h2><p>Зберігайте товари в каталозі, щоб швидко до них повернутися.</p><Link to="/" className="button primary">До каталогу</Link></div>}
  </>;
}
