import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './css/style.css';
import heroImage from './assets/images/p1.jpg';

const api = async (action, options = {}) => {
  const base = import.meta.env.VITE_BELLA_API_ORIGIN || '';
  const response = await fetch(`${base}/api/${action}`, { credentials: 'include', ...options });
  const data = response.headers.get('content-type')?.includes('json') ? await response.json() : {};
  if (!response.ok) throw new Error(data.message || 'Request failed');
  return data;
};
const money = value => `${Number(value || 0).toLocaleString('en-EG')} EGP`;
function App() {
  const [products, setProducts] = useState([]), [product, setProduct] = useState(null), [order, setOrder] = useState(null), [message, setMessage] = useState(''), [status, setStatus] = useState(null);
  useEffect(() => { api('products').then(r => setProducts(r.data)).catch(e => setMessage(e.message)); }, []);
  async function checkout(e) {
    e.preventDefault(); const form = new FormData(e.currentTarget);
    try { const r = await api('orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer_name: form.get('customer_name'), phone: form.get('phone'), address: form.get('address'), product_id: product.id, quantity: Number(form.get('quantity')) }) }); setOrder(r.data); setMessage(`Order ${r.data.order_number} reserved for 30 minutes.`); }
    catch (error) { setMessage(error.message); }
  }
  async function receipt(e) {
    e.preventDefault(); const form = new FormData(e.currentTarget); form.set('order_id', order.order_id);
    try { await api('payments', { method: 'POST', body: form }); setMessage('Receipt submitted securely for review.'); setOrder(null); }
    catch (error) { setMessage(error.message); }
  }
  async function track(e) { e.preventDefault(); const form = new FormData(e.currentTarget); try { setStatus((await api('orders/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order_number: form.get('order_number'), phone: form.get('phone') }) })).data); } catch (error) { setMessage(error.message); } }
  return <><header className="site-header"><div className="container nav"><a className="brand" href="#home">bella<span>.</span></a><nav><a href="#home">Home</a><a href="#products">Shop</a><a href="#track">Track order</a></nav><a href="/admin.html">Admin</a></div></header><main><section className="hero" id="home"><div className="container hero-grid"><div className="hero-copy"><p className="eyebrow">THE BELLA EDIT · CAIRO</p><h1>Everyday things,<br/><em>beautifully chosen.</em></h1><p>A considered collection of pieces made to bring a little more joy to the everyday.</p><a className="button button-dark" href="#products">Discover the collection →</a></div><div className="hero-visual"><img src={heroImage} alt="A selection from the Bella collection"/><div className="image-caption">THE NEW COLLECTION</div></div></div></section><section className="section products-section" id="products"><div className="container"><div className="section-head"><h2>Shop the collection</h2></div><div className="products-grid">{products.map(p=><article className="product-card" key={p.id}><div className="product-photo"><img src={p.image?.startsWith('http')?p.image:`/api/${String(p.image||'').split('/').map(encodeURIComponent).join('/')}`} alt={p.name}/></div><div className="product-info"><h3>{p.name}</h3><p>{p.description}</p><div className="product-bottom"><span>{money(p.price)}</span><button className="button button-dark" onClick={()=>setProduct(p)}>Order</button></div></div></article>)}</div></div></section>{product&&!order&&<section className="section"><div className="container narrow"><h2>Delivery details · {product.name}</h2><form className="panel order-form" onSubmit={checkout}><label>Your name<input name="customer_name" maxLength="150" required/></label><label>Egyptian mobile<input name="phone" pattern="01[0125][0-9]{8}" required/></label><label>Address<textarea name="address" maxLength="2000" required/></label><label>Quantity<input name="quantity" type="number" min="1" max="100" defaultValue="1" required/></label><button className="button button-dark">Reserve and continue</button></form></div></section>}{order&&<section className="section"><div className="container narrow"><h2>Complete payment</h2><p>{order.order_number} · {money(order.total_amount)}</p><form className="panel payment-form" onSubmit={receipt}><label>Method<select name="payment_method" required><option value="INSTAPAY">InstaPay</option><option value="ORANGE_CASH">Orange Cash</option></select></label><label>Transaction reference<input name="transaction_reference" maxLength="150"/></label><label>Receipt (JPG, PNG or PDF; max 3 MB)<input name="receipt" type="file" accept="image/jpeg,image/png,application/pdf" required/></label><button className="button button-dark">Submit receipt</button></form></div></section>}<section className="section" id="track"><div className="container narrow"><h2>Where’s my order?</h2><form className="track-form" onSubmit={track}><label>Order number<input name="order_number" placeholder="BELLA-XXXXXXXX" required/></label><label>Phone<input name="phone" pattern="01[0125][0-9]{8}" required/></label><button className="button button-dark">Check status</button></form>{status&&<p>{status.order_number} · {status.order_status} · {money(status.total_amount)}</p>}</div></section>{message&&<p className="container" role="status">{message}</p>}</main><footer className="site-footer"><div className="container">Bella · Thoughtfully chosen</div></footer></>;
}
createRoot(document.getElementById('root')).render(<App/>);
