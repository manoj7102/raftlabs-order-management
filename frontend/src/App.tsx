import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Bike,
  Check,
  ChefHat,
  Clock3,
  Heart,
  Leaf,
  MapPin,
  Minus,
  PackageCheck,
  Phone,
  Plus,
  RefreshCw,
  Search,
  ShoppingBag,
  Sparkles,
  X,
} from 'lucide-react';
import { createOrder, fetchMenu, fetchOrder, type Customer, type MenuItem, type Order, type OrderItem, type OrderStatus } from './api';
import { fallbackArt } from './art';

const STORAGE_KEY = 'hearth-harvest-active-order';
const STATUS_STEPS: OrderStatus[] = ['Received', 'Preparing', 'Out for Delivery'];

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

function money(amount: number): string {
  return currency.format(amount);
}

function savedOrderId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function rememberOrderId(id: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Orders still work if storage is disabled.
  }
}

interface CartLine {
  item: MenuItem;
  quantity: number;
}

function DishImage({ item, eager = false }: { item: MenuItem; eager?: boolean }) {
  return (
    <img
      src={item.image || fallbackArt(item.name)}
      alt={item.name}
      loading={eager ? 'eager' : 'lazy'}
      onError={(event) => {
        const image = event.currentTarget;
        image.onerror = null;
        image.src = fallbackArt(item.name);
      }}
    />
  );
}

function QuantityControl({ name, quantity, onDecrease, onIncrease, compact = false }: {
  name: string;
  quantity: number;
  onDecrease: () => void;
  onIncrease: () => void;
  compact?: boolean;
}) {
  return (
    <div className={`quantity-control${compact ? ' quantity-control--compact' : ''}`} aria-label={`${name} quantity`}>
      <button type="button" onClick={onDecrease} aria-label={`Remove one ${name}`}><Minus size={15} strokeWidth={2.5} /></button>
      <span aria-live="polite">{quantity}</span>
      <button type="button" onClick={onIncrease} disabled={quantity >= 99} aria-label={`Add one more ${name}`}><Plus size={15} strokeWidth={2.5} /></button>
    </div>
  );
}

function MenuCard({ item, quantity, onIncrease, onDecrease }: {
  item: MenuItem;
  quantity: number;
  onIncrease: () => void;
  onDecrease: () => void;
}) {
  return (
    <article className="menu-card">
      <div className="menu-card__image"><DishImage item={item} /></div>
      <div className="menu-card__body">
        <div className="menu-card__title-row">
          <h3>{item.name}</h3>
          <span className="menu-card__price">{money(item.price)}</span>
        </div>
        <p>{item.description}</p>
        <div className="menu-card__bottom">
          <span className="menu-card__fresh"><Leaf size={14} aria-hidden="true" /> Freshly made</span>
          {quantity > 0 ? (
            <QuantityControl name={item.name} quantity={quantity} onDecrease={onDecrease} onIncrease={onIncrease} compact />
          ) : (
            <button className="add-button" type="button" onClick={onIncrease} aria-label={`Add ${item.name} to cart`}>
              <Plus size={18} strokeWidth={2.5} aria-hidden="true" /> Add
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function Cart({ lines, total, onAdjust, onCheckout }: {
  lines: CartLine[];
  total: number;
  onAdjust: (id: string, change: number) => void;
  onCheckout: () => void;
}) {
  const count = lines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <div className="cart-card">
      <div className="cart-card__header">
        <div className="cart-heading-icon"><ShoppingBag size={21} aria-hidden="true" /></div>
        <div><h2>Your order</h2><p>{count ? `${count} ${count === 1 ? 'item' : 'items'} in your bag` : 'Your bag is waiting'}</p></div>
      </div>

      {lines.length ? (
        <>
          <div className="cart-items" aria-live="polite">
            {lines.map(({ item, quantity }) => (
              <div className="cart-item" key={item.id}>
                <div className="cart-item__image"><DishImage item={item} /></div>
                <div className="cart-item__content">
                  <h3>{item.name}</h3>
                  <p>{money(item.price)}</p>
                  <QuantityControl
                    name={item.name}
                    quantity={quantity}
                    onDecrease={() => onAdjust(item.id, -1)}
                    onIncrease={() => onAdjust(item.id, 1)}
                    compact
                  />
                </div>
                <strong>{money(item.price * quantity)}</strong>
              </div>
            ))}
          </div>
          <div className="cart-summary">
            <div><span>Subtotal</span><strong>{money(total)}</strong></div>
            <p>Delivery details are confirmed at checkout.</p>
            <button className="button button--primary button--full" type="button" onClick={onCheckout}>
              Continue to checkout <ArrowRight size={18} aria-hidden="true" />
            </button>
          </div>
        </>
      ) : (
        <div className="cart-empty">
          <div className="cart-empty__art"><ShoppingBag size={38} strokeWidth={1.4} aria-hidden="true" /></div>
          <h3>Nothing in your bag yet</h3>
          <p>Discover something delicious and add it to your order.</p>
          <a href="#menu" className="text-link">Explore the menu <ArrowRight size={16} aria-hidden="true" /></a>
        </div>
      )}
    </div>
  );
}

function validateCustomer(customer: Customer): Record<keyof Customer, string | null> {
  const nameLength = customer.name.trim().length;
  const addressLength = customer.address.trim().length;
  const phone = customer.phone.trim();
  const phoneDigits = phone.replace(/\D/g, '');

  return {
    name: nameLength < 2 || nameLength > 100 ? 'Enter a name between 2 and 100 characters.' : null,
    phone: phone.length > 30 || !/^\+?[\d ()-]+$/.test(phone) || phoneDigits.length < 7 || phoneDigits.length > 15
      ? 'Enter a valid phone number with 7 to 15 digits.'
      : null,
    address: addressLength < 5 || addressLength > 300 ? 'Enter a delivery address between 5 and 300 characters.' : null,
  };
}

function CheckoutDialog({ lines, total, submitting, submitError, onClose, onSubmit }: {
  lines: CartLine[];
  total: number;
  submitting: boolean;
  submitError: string | null;
  onClose: () => void;
  onSubmit: (customer: Customer) => void;
}) {
  const [customer, setCustomer] = useState<Customer>({ name: '', address: '', phone: '' });
  const [touched, setTouched] = useState<Record<keyof Customer, boolean>>({ name: false, phone: false, address: false });
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLTextAreaElement>(null);
  const errors = validateCustomer(customer);
  const visibleErrors = {
    name: touched.name || attemptedSubmit ? errors.name : null,
    phone: touched.phone || attemptedSubmit ? errors.phone : null,
    address: touched.address || attemptedSubmit ? errors.address : null,
  };

  function markTouched(field: keyof Customer) {
    setTouched((current) => ({ ...current, [field]: true }));
  }

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, submitting]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleaned = {
      name: customer.name.trim(),
      address: customer.address.trim(),
      phone: customer.phone.trim(),
    };
    const nextErrors = validateCustomer(cleaned);
    setAttemptedSubmit(true);
    const firstInvalid = (['name', 'phone', 'address'] as const).find((field) => nextErrors[field]);
    if (firstInvalid === 'name') nameRef.current?.focus();
    if (firstInvalid === 'phone') phoneRef.current?.focus();
    if (firstInvalid === 'address') addressRef.current?.focus();
    if (!firstInvalid) onSubmit(cleaned);
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose(); }}>
      <section className="checkout-dialog" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
        <div className="checkout-dialog__header">
          <div><span className="eyebrow eyebrow--green">Almost there</span><h2 id="checkout-title">Delivery details</h2><p>Tell us where to bring your food.</p></div>
          <button className="icon-button" type="button" onClick={onClose} disabled={submitting} aria-label="Close checkout"><X size={22} /></button>
        </div>
        <div className="checkout-dialog__body">
          <form id="checkout-form" onSubmit={handleSubmit} noValidate>
            <label htmlFor="customer-name">Full name</label>
            <input ref={nameRef} id="customer-name" type="text" autoComplete="name" placeholder="Your full name" maxLength={100} value={customer.name} onChange={(event) => setCustomer({ ...customer, name: event.target.value })} onBlur={() => markTouched('name')} aria-invalid={Boolean(visibleErrors.name)} aria-describedby={visibleErrors.name ? 'customer-name-error' : undefined} required />
            {visibleErrors.name && <div className="inline-error" id="customer-name-error" role="alert"><AlertCircle size={17} aria-hidden="true" />{visibleErrors.name}</div>}
            <label htmlFor="customer-phone">Phone number</label>
            <input ref={phoneRef} id="customer-phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="Your phone number" maxLength={30} value={customer.phone} onChange={(event) => setCustomer({ ...customer, phone: event.target.value })} onBlur={() => markTouched('phone')} aria-invalid={Boolean(visibleErrors.phone)} aria-describedby={visibleErrors.phone ? 'customer-phone-error' : undefined} required />
            {visibleErrors.phone && <div className="inline-error" id="customer-phone-error" role="alert"><AlertCircle size={17} aria-hidden="true" />{visibleErrors.phone}</div>}
            <label htmlFor="customer-address">Delivery address</label>
            <textarea ref={addressRef} id="customer-address" autoComplete="street-address" rows={3} placeholder="House or flat number, street, area, city" maxLength={300} value={customer.address} onChange={(event) => setCustomer({ ...customer, address: event.target.value })} onBlur={() => markTouched('address')} aria-invalid={Boolean(visibleErrors.address)} aria-describedby={visibleErrors.address ? 'customer-address-error' : undefined} required />
            {visibleErrors.address && <div className="inline-error" id="customer-address-error" role="alert"><AlertCircle size={17} aria-hidden="true" />{visibleErrors.address}</div>}
            {submitError && <div className="inline-error" role="alert"><AlertCircle size={17} aria-hidden="true" />{submitError}</div>}
          </form>
          <div className="checkout-recap">
            <h3>Your order</h3>
            {lines.map(({ item, quantity }) => (
              <div key={item.id}><span>{quantity} × {item.name}</span><strong>{money(item.price * quantity)}</strong></div>
            ))}
            <div className="checkout-recap__total"><span>Total</span><strong>{money(total)}</strong></div>
          </div>
        </div>
        <div className="checkout-dialog__footer">
          <p><Check size={15} aria-hidden="true" /> Prepared fresh after you order</p>
          <button className="button button--primary button--full" form="checkout-form" type="submit" disabled={submitting}>
            {submitting ? <><span className="spinner" aria-hidden="true" /> Placing your order…</> : <>Place order · {money(total)} <ArrowRight size={18} aria-hidden="true" /></>}
          </button>
        </div>
      </section>
    </div>
  );
}

function TrackingView({ order, orderId, loading, error, menu, onRetry, onMenu }: {
  order: Order | null;
  orderId: string | null;
  loading: boolean;
  error: string | null;
  menu: MenuItem[];
  onRetry: () => void;
  onMenu: () => void;
}) {
  if (!order) {
    return (
      <section className="tracking-page tracking-page--state">
        <button className="back-link" onClick={onMenu} type="button"><ArrowLeft size={17} /> Back to menu</button>
        <div className="state-panel">
          {loading ? <><span className="spinner spinner--dark" /><h1>Finding your order…</h1><p>We’re getting its latest status.</p></> : <><AlertCircle size={38} /><h1>We couldn’t load your order</h1><p>{error || 'Please try again in a moment.'}</p><button className="button button--primary" type="button" onClick={onRetry}><RefreshCw size={17} /> Try again</button></>}
          {orderId && <span className="state-panel__id">Order {orderId}</span>}
        </div>
      </section>
    );
  }

  const activeStep = Math.max(0, STATUS_STEPS.indexOf(order.status));
  const currentMessage = order.status === 'Received'
    ? 'Your order is in. The kitchen will start preparing it shortly.'
    : order.status === 'Preparing'
      ? 'Our kitchen is making your food fresh, just for you.'
      : 'Your food is on its way. Get ready to enjoy it!';

  return (
    <section className="tracking-page" aria-live="polite">
      <button className="back-link" onClick={onMenu} type="button"><ArrowLeft size={17} /> Back to menu</button>
      <div className="tracking-hero">
        <div className="tracking-hero__content">
          <span className="eyebrow eyebrow--light"><span className="live-dot" /> Live order updates</span>
          <h1>Good things are<br /><em>on their way.</em></h1>
          <p>Thanks, {order.customer.name.split(' ')[0]}! Follow your order as it moves from our kitchen to your door.</p>
        </div>
        <div className="tracking-hero__visual" aria-hidden="true"><div className="tracking-hero__circle"><Bike size={105} strokeWidth={1.3} /></div><span className="tracking-hero__spark">✦</span></div>
      </div>

      <div className="tracking-grid">
        <div className="tracking-card tracking-card--status">
          <div className="tracking-card__top"><div><span className="eyebrow eyebrow--green">Order status</span><h2>{order.status}</h2></div><span className="status-pill"><span className="live-dot" /> Updates automatically</span></div>
          <p className="tracking-message">{currentMessage}</p>
          <ol className="status-steps">
            {STATUS_STEPS.map((status, index) => {
              const complete = index < activeStep;
              const active = index === activeStep;
              const Icon = index === 0 ? PackageCheck : index === 1 ? ChefHat : Bike;
              return (
                <li className={`${complete ? 'is-complete' : ''} ${active ? 'is-active' : ''}`} key={status} aria-current={active ? 'step' : undefined}>
                  <div className="status-steps__icon">{complete ? <Check size={22} strokeWidth={2.5} aria-hidden="true" /> : <Icon size={22} aria-hidden="true" />}</div>
                  <div><strong>{status}</strong><span>{index === 0 ? 'Order confirmed' : index === 1 ? 'Made fresh in our kitchen' : 'Heading to your doorstep'}</span></div>
                </li>
              );
            })}
          </ol>
          {error && <div className="inline-error tracking-refresh-error" role="alert"><AlertCircle size={17} /> Status refresh paused. <button type="button" onClick={onRetry}>Retry now</button></div>}
        </div>
        <div className="tracking-card tracking-card--details">
          <h2>Order details</h2>
          <div className="order-reference"><span>Order number</span><strong>#{order.id}</strong></div>
          <div className="order-lines">
            {order.items.map((item, index) => {
              const itemName = item.name || menu.find((menuItem) => menuItem.id === item.menuItemId)?.name || 'Menu item';
              return <div key={`${item.menuItemId}-${index}`}><span>{item.quantity} × {itemName}</span>{typeof item.price === 'number' && <strong>{money(item.price * item.quantity)}</strong>}</div>;
            })}
          </div>
          <div className="order-total"><span>Total</span><strong>{money(order.total)}</strong></div>
          <div className="delivery-details"><span><MapPin size={17} aria-hidden="true" /> Delivering to</span><p>{order.customer.address}</p><span><Phone size={17} aria-hidden="true" /> {order.customer.phone}</span></div>
          <button className="button button--outline button--full" type="button" onClick={onMenu}>Explore the menu <ArrowRight size={17} /></button>
        </div>
      </div>
    </section>
  );
}

export default function App() {
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [menuState, setMenuState] = useState<'loading' | 'success' | 'error'>('loading');
  const [menuError, setMenuError] = useState<string | null>(null);
  const [menuRequest, setMenuRequest] = useState(0);
  const [search, setSearch] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [trackedOrderId, setTrackedOrderId] = useState<string | null>(savedOrderId);
  const [order, setOrder] = useState<Order | null>(null);
  const [trackingLoading, setTrackingLoading] = useState(Boolean(savedOrderId()));
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const [trackingRequest, setTrackingRequest] = useState(0);
  const [view, setView] = useState<'menu' | 'tracking'>(savedOrderId() ? 'tracking' : 'menu');
  const cartRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setMenuState('loading');
    fetchMenu(controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) {
          setMenu(items);
          setMenuState('success');
          setMenuError(null);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setMenuState('error');
          setMenuError(error instanceof Error ? error.message : 'We could not load the menu.');
        }
      });
    return () => controller.abort();
  }, [menuRequest]);

  useEffect(() => {
    if (!trackedOrderId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function refresh() {
      try {
        const updated = await fetchOrder(trackedOrderId!);
        if (cancelled) return;
        setOrder(updated);
        setTrackingLoading(false);
        setTrackingError(null);
        if (updated.status !== 'Out for Delivery') timer = setTimeout(refresh, 5000);
      } catch (error) {
        if (cancelled) return;
        setTrackingLoading(false);
        setTrackingError(error instanceof Error ? error.message : 'We could not refresh your order.');
        timer = setTimeout(refresh, 5000);
      }
    }

    void refresh();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trackedOrderId, trackingRequest]);

  const cartLines = menu.filter((item) => (quantities[item.id] || 0) > 0).map((item) => ({ item, quantity: quantities[item.id] }));
  const cartCount = cartLines.reduce((sum, line) => sum + line.quantity, 0);
  const total = cartLines.reduce((sum, line) => sum + Math.round(line.item.price * 100) * line.quantity, 0) / 100;
  const visibleMenu = menu.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(search.trim().toLowerCase()));

  function adjustQuantity(id: string, change: number) {
    setQuantities((current) => ({ ...current, [id]: Math.min(99, Math.max(0, (current[id] || 0) + change)) }));
  }

  function showMenu() {
    setView('menu');
    window.scrollTo?.({ top: 0, behavior: 'smooth' });
  }

  function showTracking() {
    setView('tracking');
    window.scrollTo?.({ top: 0, behavior: 'smooth' });
  }

  function scrollToMenu() {
    setView('menu');
    requestAnimationFrame(() => menuRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
  }

  function scrollToCart() {
    setView('menu');
    requestAnimationFrame(() => cartRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
  }

  async function placeOrder(customer: Customer) {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const items: OrderItem[] = cartLines.map(({ item, quantity }) => ({ menuItemId: item.id, quantity }));
      const created = await createOrder(customer, items);
      setOrder(created);
      setTrackedOrderId(String(created.id));
      rememberOrderId(String(created.id));
      setTrackingLoading(false);
      setTrackingError(null);
      setTrackingRequest((value) => value + 1);
      setQuantities({});
      setCheckoutOpen(false);
      setView('tracking');
      window.scrollTo?.({ top: 0, behavior: 'smooth' });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'We could not place your order. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="site-shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="site-header">
        <div className="container site-header__inner">
          <button className="brand" type="button" onClick={showMenu} aria-label="Hearth and Harvest home"><span className="brand__mark"><Leaf size={22} fill="currentColor" strokeWidth={1.5} /></span><span>hearth<span className="brand__amp">&</span>harvest<span className="brand__period">.</span></span></button>
          <nav aria-label="Main navigation">
            <button className={view === 'menu' ? 'nav-link is-active' : 'nav-link'} type="button" onClick={scrollToMenu}>Menu</button>
            {trackedOrderId && <button className={view === 'tracking' ? 'nav-link is-active' : 'nav-link'} type="button" onClick={showTracking}>Track order</button>}
          </nav>
          <button className="header-bag" type="button" onClick={scrollToCart} aria-label={`View cart, ${cartCount} ${cartCount === 1 ? 'item' : 'items'}`}><ShoppingBag size={19} aria-hidden="true" /><span>My bag</span><span className="header-bag__count">{cartCount}</span></button>
        </div>
      </header>

      <main id="main">
        {view === 'menu' ? (
          <>
            <section className="hero container" aria-labelledby="hero-heading">
              <div className="hero__copy"><span className="eyebrow eyebrow--light"><span className="eyebrow__line" /> Made fresh, delivered happy</span><h1 id="hero-heading">Your next <em>favorite meal</em> is just a click away.</h1><p>Comforting flavors, fresh ingredients, and food worth looking forward to. Pick what you love and we’ll handle the rest.</p><button className="button button--cream" type="button" onClick={scrollToMenu}>Explore the menu <ArrowRight size={19} aria-hidden="true" /></button><div className="hero__micro"><span className="hero__stars" aria-hidden="true">★★★★★</span><span>Made with care, delivered with love</span></div></div>
              <div className="hero__visual" aria-hidden="true"><div className="hero__halo" /><div className="hero__food"><img src={fallbackArt('salad')} alt="" /></div><div className="hero__badge hero__badge--top"><span><Leaf size={18} /></span><div><strong>Always fresh</strong><small>Goodness in every bite</small></div></div><div className="hero__badge hero__badge--bottom"><span><Heart size={18} fill="currentColor" /></span><div><strong>Made for you</strong><small>Prepared with care</small></div></div><span className="hero__spark hero__spark--one">✦</span><span className="hero__spark hero__spark--two">✳</span></div>
            </section>

            <section className="perks container" aria-label="Why order with us"><div><span><Leaf size={21} /></span><div><strong>Fresh ingredients</strong><p>Good food starts here</p></div></div><div><span><ChefHat size={22} /></span><div><strong>Made to order</strong><p>Prepared just for you</p></div></div><div><span><Bike size={23} /></span><div><strong>Easy delivery</strong><p>From our kitchen to you</p></div></div></section>

            <section className="menu-section container" id="menu" ref={menuRef} aria-labelledby="menu-heading">
              <div className="menu-section__intro"><div><span className="eyebrow eyebrow--green"><span className="eyebrow__line" /> Our menu</span><h2 id="menu-heading">Something good for <em>every craving.</em></h2><p>Explore thoughtfully prepared favorites for every kind of appetite.</p></div><label className="search-field"><Search size={19} aria-hidden="true" /><span className="sr-only">Search menu</span><input type="search" placeholder="Search the menu" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>

              <div className="menu-layout">
                <div className="menu-list">
                  {menuState === 'loading' && <div className="menu-grid" aria-label="Loading menu">{Array.from({ length: 6 }, (_, index) => <div className="menu-skeleton" key={index}><div /><span /><span /><span /></div>)}</div>}
                  {menuState === 'error' && <div className="menu-feedback"><AlertCircle size={38} /><h3>Menu unavailable right now</h3><p>{menuError}</p><button className="button button--primary" type="button" onClick={() => setMenuRequest((value) => value + 1)}><RefreshCw size={17} /> Try again</button></div>}
                  {menuState === 'success' && menu.length === 0 && <div className="menu-feedback"><ShoppingBag size={38} /><h3>Our menu is taking a moment</h3><p>Please check back soon for something delicious.</p><button className="button button--primary" type="button" onClick={() => setMenuRequest((value) => value + 1)}><RefreshCw size={17} /> Refresh menu</button></div>}
                  {menuState === 'success' && menu.length > 0 && visibleMenu.length === 0 && <div className="menu-feedback"><Search size={38} /><h3>No dishes found</h3><p>Try another search to find your next favorite.</p><button className="button button--outline" type="button" onClick={() => setSearch('')}>Clear search</button></div>}
                  {menuState === 'success' && visibleMenu.length > 0 && <div className="menu-grid">{visibleMenu.map((item) => <MenuCard key={item.id} item={item} quantity={quantities[item.id] || 0} onIncrease={() => adjustQuantity(item.id, 1)} onDecrease={() => adjustQuantity(item.id, -1)} />)}</div>}
                </div>
                <aside className="cart-sidebar" id="cart" ref={cartRef} aria-label="Shopping cart"><Cart lines={cartLines} total={total} onAdjust={adjustQuantity} onCheckout={() => { setSubmitError(null); setCheckoutOpen(true); }} /><div className="cart-note"><Clock3 size={18} /><p>Every meal is prepared after you order, so it arrives just right.</p></div></aside>
              </div>
            </section>

            <section className="closing-banner container"><div><span className="eyebrow eyebrow--green"><Sparkles size={15} /> A little joy, delivered</span><h2>Good food makes<br /><em>any day better.</em></h2><p>Find your new favorite in the menu above.</p></div><div className="closing-banner__art" aria-hidden="true"><img src={fallbackArt('pizza')} alt="" /></div></section>
          </>
        ) : <TrackingView order={order} orderId={trackedOrderId} loading={trackingLoading} error={trackingError} menu={menu} onRetry={() => { setTrackingLoading(!order); setTrackingRequest((value) => value + 1); }} onMenu={showMenu} />}
      </main>

      <footer className="site-footer"><div className="container"><div className="footer-brand"><span className="brand__mark"><Leaf size={20} fill="currentColor" strokeWidth={1.5} /></span><strong>hearth<span>&</span>harvest.</strong></div><p>Fresh food. Happy moments. Made with care.</p><span>© {new Date().getFullYear()} Hearth & Harvest</span></div></footer>

      {checkoutOpen && <CheckoutDialog lines={cartLines} total={total} submitting={submitting} submitError={submitError} onClose={() => setCheckoutOpen(false)} onSubmit={placeOrder} />}
    </div>
  );
}
