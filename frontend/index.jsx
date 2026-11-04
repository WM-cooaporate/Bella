import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './css/style.css';
import heroImage from './assets/images/p1.jpg';
import toteImage from './assets/images/p2.jpg';
import topImage from './assets/images/p3.jpg';

const api = async (action, options = {}) => {
  const base = import.meta.env.VITE_BELLA_API_ORIGIN || '';
  const response = await fetch(`${base}/api/${action}`, { credentials: 'include', ...options });
  const data = response.headers.get('content-type')?.includes('json') ? await response.json() : {};
  if (!response.ok) throw new Error(data.message || 'Request failed. Please try again.');
  return data;
};
const preview = import.meta.env.DEV;
const money = value => `${Number(value || 0).toLocaleString('en-EG')} EGP`;
const previewProducts = [
  { id: 'preview-knit', name: 'The Sunday Knit', description: 'A soft everyday layer, made for slow mornings and Cairo evenings.', price: 1250, stock_quantity: 8, image: heroImage },
  { id: 'preview-tote', name: 'The Everyday Tote', description: 'Room for the little things you take everywhere.', price: 890, stock_quantity: 12, image: toteImage },
  { id: 'preview-top', name: 'The Easy Top', description: 'An easy, considered shape for your everyday edit.', price: 1450, stock_quantity: 6, image: topImage },
];

function App() {
  const [products, setProducts] = useState(preview ? previewProducts : []);
  const [loading, setLoading] = useState(!preview);
  const [catalogError, setCatalogError] = useState('');
  const [product, setProduct] = useState(null);
  const [order, setOrder] = useState(null);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState('INSTAPAY');
  const [busy, setBusy] = useState(false);
  const [demoOrder, setDemoOrder] = useState(null);
  const paymentAccounts = useMemo(() => ({
    INSTAPAY: import.meta.env.VITE_INSTAPAY_HANDLE || '',
    ORANGE_CASH: import.meta.env.VITE_ORANGE_CASH_NUMBER || '',
  }), []);
  const paymentReady = preview || Boolean(paymentAccounts.INSTAPAY || paymentAccounts.ORANGE_CASH);

  useEffect(() => {
    if (preview) return;
    api('products').then(result => setProducts(Array.isArray(result.data) ? result.data : []))
      .catch(error => setCatalogError(error.message))
      .finally(() => setLoading(false));
  }, []);

  function chooseProduct(item) {
    setProduct(item);
    setOrder(null);
    setMessage('');
    setTimeout(() => document.getElementById('checkout')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }

  async function checkout(event) {
    event.preventDefault();
    if (!product || !paymentReady || busy) return;
    const form = new FormData(event.currentTarget);
    const chosenMethod = String(form.get('checkout_method') || paymentMethod);
    setBusy(true);
    setMessage('');
    try {
      if (preview) {
        const created = {
          order_id: `preview-${Date.now()}`,
          order_number: `BELLA-${Math.random().toString(16).slice(2, 10).toUpperCase()}`,
          total_amount: (Number(product.price) * Number(form.get('quantity'))).toFixed(2),
          customer_name: String(form.get('customer_name')).trim(),
          phone: String(form.get('phone')),
          product_name: product.name,
          quantity: Number(form.get('quantity')),
        };
        setDemoOrder(created);
        setOrder(created);
      } else {
        const result = await api('orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer_name: form.get('customer_name'), phone: form.get('phone'), address: form.get('address'), product_id: product.id, quantity: Number(form.get('quantity')) }) });
        const created = { ...result.data, customer_name: String(form.get('customer_name')).trim(), phone: String(form.get('phone')), product_name: product.name, quantity: Number(form.get('quantity')) };
        setOrder(created);
      }
      setPaymentMethod(chosenMethod);
      setTimeout(() => document.getElementById('payment')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function submitReceipt(event) {
    event.preventDefault();
    if (!order || busy) return;
    const form = new FormData(event.currentTarget);
    form.set('payment_method', paymentMethod);
    const receipt = form.get('receipt');
    if (!receipt || !receipt.size || receipt.size > 3 * 1024 * 1024 || !['image/jpeg', 'image/png', 'application/pdf'].includes(receipt.type)) {
      setMessage('Choose a JPG, PNG or PDF receipt under 3 MB.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      if (preview) {
        setDemoOrder(current => ({ ...current, payment_method: form.get('payment_method'), order_status: 'PENDING_PAYMENT' }));
        setOrder(null);
        setProduct(null);
        setMessage('Preview complete. No real order or payment was created.');
      } else {
        form.set('order_id', order.order_id);
        await api('payments', { method: 'POST', body: form });
        setMessage(`Receipt received for ${order.order_number}. We’ll review it and update your order.`);
        setOrder(null);
        setProduct(null);
      }
      event.currentTarget.reset();
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function track(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const orderNumber = String(form.get('order_number')).trim().toUpperCase();
    const phone = String(form.get('phone')).trim();
    setStatus(null);
    setMessage('');
    try {
      if (preview) {
        if (demoOrder?.order_number === orderNumber && demoOrder.phone === phone) setStatus({ order_number: demoOrder.order_number, order_status: demoOrder.order_status || 'PENDING_PAYMENT', total_amount: demoOrder.total_amount });
        else throw new Error('No preview order matches those details. Complete the demo checkout first.');
      } else {
        setStatus((await api('orders/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order_number: orderNumber, phone }) })).data);
      }
    } catch (error) { setMessage(error.message); }
  }

  const account = paymentAccounts[paymentMethod];
  const imageSrc = item => item.image?.startsWith('http') || item.image?.startsWith('/') ? item.image : `/api/${String(item.image || '').split('/').map(encodeURIComponent).join('/')}`;

  return <>
    {preview && <div className="demo-banner"><strong>Preview mode</strong><span>Sample products and prices · checkout and receipt are simulated · no money or orders are created.</span></div>}
    <header className="site-header"><div className="container nav"><a className="brand" href="#home" aria-label="Bella home">bella<span>.</span></a><nav aria-label="Main navigation"><a href="#home">Home</a><a href="#products">Shop</a><a href="#track">Track order</a></nav><a className="nav-cta" href="#products">Explore the edit <span>↗</span></a></div></header>
    <main>
      <section className="hero" id="home"><div className="container hero-grid"><div className="hero-copy"><p className="eyebrow"><span className="eyebrow-line"/> THE BELLA EDIT · CAIRO</p><h1>Everyday things,<br/><em>beautifully chosen.</em></h1><p className="hero-description">A considered collection of pieces made to bring a little more joy to the everyday.</p><a className="button button-dark" href="#products">Discover the collection <span aria-hidden="true">→</span></a><div className="hero-note"><span className="note-star">✳</span><span>Thoughtful finds, chosen with care<br/>and made to be loved every day.</span></div></div><div className="hero-visual"><img src={heroImage} alt="A look from the Bella everyday collection"/><div className="hero-stamp">BELLA<br/>EDIT<br/>№ 01</div><div className="image-caption"><span>THE NEW COLLECTION</span><span>01 — 03</span></div></div></div></section>
      <div className="trust-strip"><div className="container trust-items"><span>✳ Thoughtfully chosen</span><span>✳ Cairo, Egypt</span><span>✳ Here for the everyday</span></div></div>
      <section className="section products-section" id="products"><div className="container"><div className="section-head"><div><p className="eyebrow">A LITTLE SOMETHING FOR EVERY DAY</p><h2>Shop the collection</h2></div><p>{products.length ? `${String(products.length).padStart(2, '0')} considered finds` : 'A thoughtful edit, coming soon'}</p></div>
        {loading && <div className="loading-card" role="status">Opening the Bella collection…</div>}
        {catalogError && <div className="empty-state" role="alert"><strong>We couldn’t load the collection.</strong><br/>Please try again in a moment. {catalogError}</div>}
        {!loading && !catalogError && products.length === 0 && <div className="empty-state"><strong>The collection is being prepared.</strong><br/>We’re choosing a few lovely things for you. Please check back soon.</div>}
        <div className="products-grid">{products.map((item, index) => <article className="product-card" key={item.id}><div className="product-photo"><img src={imageSrc(item)} alt={item.name} loading="lazy"/><span className="product-index">BELLA EDIT · {String(index + 1).padStart(2, '0')}</span></div><div className="product-info"><h3>{item.name}</h3><p>{item.description || 'A thoughtfully chosen piece for your everyday.'}</p><div className="product-bottom"><span className="product-price">{money(item.price)}</span><button className="order-button" disabled={!item.stock_quantity || !paymentReady} onClick={() => chooseProduct(item)}>{!item.stock_quantity ? 'Sold out' : 'Choose this piece →'}</button></div></div></article>)}</div>
        {!paymentReady && <p className="payment-setup-notice">Checkout is temporarily unavailable while Bella’s payment details are being set up. Please check back soon.</p>}
      </div></section>
      <section className="story-section"><div className="container story-grid"><div className="story-image"><img src={toteImage} alt="A considered everyday piece from Bella" loading="lazy"/></div><div><p className="eyebrow">A MORE THOUGHTFUL EVERYDAY</p><h2>Little things,<br/><em>chosen with feeling.</em></h2><p>Bella brings together useful, beautiful pieces that make the everyday feel a little more special. Made for real life, and picked with care in Cairo.</p><a className="text-link" href="#products">Find your Bella piece <span>→</span></a></div></div></section>
      {product && !order && <section className="section order-section" id="checkout"><div className="container narrow"><div className="section-head"><div><p className="eyebrow">YOUR BELLA PIECE</p><h2>Let’s make it yours.</h2></div><button className="text-button" onClick={() => setProduct(null)}>Back to collection</button></div><div className="order-wrapper"><form className="panel order-form" onSubmit={checkout}><h3>Delivery details</h3><label className="form-group">Your name<input name="customer_name" autoComplete="name" maxLength="150" required/></label><label className="form-group">Egyptian mobile number<input name="phone" type="tel" inputMode="numeric" autoComplete="tel-national" pattern="01[0125][0-9]{8}" placeholder="010 1234 5678" required/><small>We’ll use this to confirm your order and help you track it.</small></label><label className="form-group">Delivery address<textarea name="address" autoComplete="street-address" maxLength="2000" required/></label><label className="form-group">Quantity<input name="quantity" type="number" min="1" max={Math.min(100, Number(product.stock_quantity))} defaultValue="1" required/></label><fieldset className="payment-choice"><legend>How would you like to pay?</legend>{['INSTAPAY', 'ORANGE_CASH'].map(method => { const available = preview || Boolean(paymentAccounts[method]); return <label className={`method-option ${!available ? 'method-disabled' : ''}`} key={method}><input type="radio" name="checkout_method" value={method} checked={paymentMethod === method} onChange={() => setPaymentMethod(method)} disabled={!available}/><span><strong>{method === 'INSTAPAY' ? 'InstaPay' : 'Orange Cash'}</strong><small>{available ? (preview ? 'Preview only · no transfer' : paymentAccounts[method]) : 'Temporarily unavailable'}</small></span></label>; })}</fieldset><button className="button button-dark full-button" disabled={busy || !paymentReady}>{busy ? 'Preparing your order…' : 'Continue to payment →'}</button>{message && <p className="form-error" role="alert">{message}</p>}</form><aside className="panel invoice"><p className="eyebrow">YOUR ORDER</p><div className="summary-product"><img src={imageSrc(product)} alt=""/><div><strong>{product.name}</strong><span>{money(product.price)} each</span></div></div><div className="invoice-row"><span>Available now</span><strong>{product.stock_quantity}</strong></div><div className="invoice-total"><span>Item total</span><strong>{money(product.price)}</strong></div><p className="fine-print">Delivery is not included in this item total. Bella will confirm any delivery charge before dispatch.</p></aside></div></div></section>}
      {order && <section className="section order-section" id="payment"><div className="container narrow"><div className="payment-heading"><p className="eyebrow">ONE LAST LITTLE STEP</p><h2>Complete your payment.</h2><p>Order {order.order_number} · Stock is reserved for 30 minutes.</p></div><div className="payment-total"><span>Total due</span><strong>{money(order.total_amount)}</strong></div><form className="panel payment-form" onSubmit={submitReceipt}><h3>Pay with {paymentMethod === 'INSTAPAY' ? 'InstaPay' : 'Orange Cash'}</h3><div className="demo-payment-note">{preview ? 'This is a practice checkout. Do not transfer money. The receipt step is simulated and no file leaves your device.' : <>Send the exact total to <strong>{account}</strong>, then attach your transfer receipt. Bella reviews receipts manually.</>}</div><label className="form-group">Transaction reference <span className="optional">(optional)</span><input name="transaction_reference" maxLength="150" autoComplete="off"/></label><label className="form-group">Payment receipt<input name="receipt" type="file" accept="image/jpeg,image/png,application/pdf" required/><small>JPG, PNG or PDF · up to 3 MB</small></label><button className="button button-dark full-button" disabled={busy}>{busy ? 'Sending securely…' : 'Submit payment receipt →'}</button>{message && <p className="form-error" role="alert">{message}</p>}<p className="reservation-note">Your item is held while you complete this step. Please don’t refresh the page.</p></form></div></section>}
      <section className="section track-section" id="track"><div className="container track-grid"><div><p className="eyebrow">HERE FOR YOU, AFTER CHECKOUT TOO</p><h2>Where’s my order?</h2><p>Enter your order number and mobile number to see the latest update.</p></div><div><form className="track-form" onSubmit={track}><label>Order number<input name="order_number" placeholder="BELLA-XXXXXXXX" required/></label><label>Mobile number<input name="phone" type="tel" inputMode="numeric" pattern="01[0125][0-9]{8}" placeholder="010 1234 5678" required/></label><button className="button button-dark">Check order status →</button></form>{status && <div className="track-result" role="status"><strong>{status.order_number}</strong><p>Status: {String(status.order_status).replaceAll('_', ' ').toLowerCase()}</p><span>{money(status.total_amount)}</span></div>}{message && !product && !order && <p className="form-error" role="alert">{message}</p>}</div></div></section>
    </main>
    <footer className="site-footer"><div className="container footer-content"><a className="brand" href="#home">bella<span>.</span></a><p>Thoughtfully chosen, for the everyday.</p><span>Made with care in Cairo · © {new Date().getFullYear()} Bella</span></div></footer>
  </>;
}

createRoot(document.getElementById('root')).render(<App/>);
