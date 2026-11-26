import { useEffect, useId, useState } from 'react';
import { api } from '../lib/api';

export interface DeliveryOption { id: string; label: string; proof?: string }

interface Props {
  label: string;
  placeholder: string;
  value: DeliveryOption | null;
  onChange: (option: DeliveryOption | null) => void;
  action: 'cities' | 'branches';
  cityRef?: string;
  disabled?: boolean;
}

export default function DeliverySearch({ label, placeholder, value, onChange, action, cityRef, disabled }: Props) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<DeliveryOption[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const term = query.trim();
  const canSearch = open && !disabled && !value && (action === 'branches' || term.length >= 2);
  const expanded = canSearch;

  useEffect(() => {
    if (!canSearch) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      api<{ options: DeliveryOption[] }>('np', { action, query: term, cityRef }, { signal: controller.signal })
        .then(result => { if (!controller.signal.aborted) setOptions(result.options); })
        .catch(error => { if (!controller.signal.aborted) setError(error.message || 'Спробуйте ще раз.'); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [action, attempt, canSearch, cityRef, term]);

  useEffect(() => {
    if (expanded && active >= 0) document.getElementById(id + '-' + active)?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [active, expanded, id]);

  const select = (option: DeliveryOption) => {
    onChange(option);
    setQuery('');
    setOpen(false);
    setActive(-1);
  };

  return <div className="address-field" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <label className="field-label" htmlFor={id}>{label}</label>
    <input id={id} className="field" role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={id + '-options'}
      aria-activedescendant={expanded && active >= 0 && options[active] ? id + '-' + active : undefined}
      value={value?.label ?? query} placeholder={placeholder} disabled={disabled} autoComplete="off" maxLength={80}
      onFocus={() => { if (!value) { setOpen(true); setLoading(true); } }}
      onChange={event => {
        if (value) onChange(null);
        setQuery(event.target.value);
        setOptions([]);
        setActive(-1);
        setLoading(true);
        setError('');
        setOpen(true);
      }}
      onKeyDown={event => {
        if (event.key === 'Escape') { setOpen(false); return; }
        if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !value) {
          event.preventDefault();
          setOpen(true);
          if (options.length) setActive(current => event.key === 'ArrowDown' ? (current + 1) % options.length : (current <= 0 ? options.length - 1 : current - 1));
        }
        if (event.key === 'Enter' && expanded) {
          event.preventDefault();
          if (active >= 0 && options[active]) select(options[active]);
        }
      }} />
    <div className="address-results" hidden={!expanded}>
      <ul id={id + '-options'} role="listbox" aria-label={label}>
        {!loading && !error && options.map((option, i) => <li key={option.id} id={id + '-' + i} role="option" aria-selected={i === active}
          onMouseDown={event => event.preventDefault()} onClick={() => select(option)}>{option.label}</li>)}
      </ul>
      {(loading || error || !options.length) && <p className="address-message" role="status">
        {loading ? 'Шукаємо…' : error ? <>{error} <button className="text-button" type="button" onClick={() => { setLoading(true); setError(''); setAttempt(attempt + 1); }}>Повторити</button></> : 'Нічого не знайдено.'}
      </p>}
    </div>
  </div>;
}
