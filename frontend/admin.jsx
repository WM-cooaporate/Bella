import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './css/style.css';

const apiOrigin = import.meta.env.VITE_BELLA_API_ORIGIN || '';
const request = async (path, options = {}) => {
  const response = await fetch(`${apiOrigin}/api/${path}`, { credentials: 'include', ...options });
  const data = response.headers.get('content-type')?.includes('json') ? await response.json() : {};
  if (!response.ok) throw new Error(data.message || 'Request failed');
  return data;
};

function Admin() {
  const [admin, setAdmin] = useState(null);
  const [csrf, setCsrf] = useState('');
  const [error, setError] = useState('');
  const [payments, setPayments] = useState([]);
  const [orders, setOrders] = useState([]);

  async function refresh() {
    try {
      const [paymentResult, orderResult] = await Promise.all([
        request('admin/payments'),
        request('admin/orders'),
      ]);
      setPayments(paymentResult.data);
      setOrders(orderResult.data.orders);
      setError('');
    } catch (problem) {
      setError(problem.message);
    }
  }

  useEffect(() => {
    request('admin/session').then(result => {
      setAdmin(result.data);
      setCsrf(result.data.csrf_token);
    }).catch(() => {});
  }, []);

  useEffect(() => { if (admin) refresh(); }, [admin]);

  async function login(event) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    try {
      const result = await request('admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: fields.get('username'), password: fields.get('password') }),
      });
      setAdmin(result.data);
      setCsrf(result.data.csrf_token);
      setError('');
    } catch (problem) {
      setError(problem.message);
    }
  }

  async function review(paymentId, decision) {
    try {
      await request(`admin/payments/${paymentId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ decision }),
      });
      await refresh();
    } catch (problem) { setError(problem.message); }
  }

  async function showReceipt(paymentId) {
    try {
      const response = await fetch(`${apiOrigin}/api/admin/payments/${paymentId}/receipt`, { credentials: 'include' });
      if (!response.ok) throw new Error('Unable to open receipt');
      const url = URL.createObjectURL(await response.blob());
      const viewer = document.createElement('dialog');
      viewer.className = 'receipt-viewer';
      viewer.innerHTML = '<button class="receipt-close" aria-label="Close receipt">×</button><iframe title="Payment receipt"></iframe>';
      viewer.querySelector('iframe').src = url;
      viewer.querySelector('button').onclick = () => viewer.close();
      viewer.addEventListener('close', () => { URL.revokeObjectURL(url); viewer.remove(); });
      document.body.append(viewer);
      viewer.showModal();
    } catch (problem) { setError(problem.message); }
  }

  if (!admin) return <main className="admin-shell">
    <section className="admin-login panel">
      <a className="brand" href="/">bella<span>.</span></a>
      <p className="eyebrow">STORE MANAGEMENT · CAIRO</p>
      <h1>Welcome back.</h1>
      <p>Sign in to manage orders, payments and the collection.</p>
      <form onSubmit={login}>
        <label className="form-group">Username<input name="username" autoComplete="username" required /></label>
        <label className="form-group">Password<input name="password" type="password" autoComplete="current-password" required /></label>
        <button className="button button-dark full-button">Sign in <span aria-hidden="true">→</span></button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
      <a className="text-link" href="/">← Back to Bella</a>
    </section>
  </main>;

  return <main className="admin-shell">
    <header className="admin-top"><a className="brand" href="/">bella<span>.</span> <small>ADMIN</small></a><div><span>{admin.username}</span><button className="button button-light" onClick={async () => { await request('admin/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrf } }); setAdmin(null); }}>Sign out</button></div></header>
    <section className="admin-welcome"><div><p className="eyebrow">STORE OVERVIEW</p><h1>Good to see you, <em>{admin.username}.</em></h1></div><button className="button button-light" onClick={refresh}>Refresh</button></section>
    {error && <p className="form-error" role="alert">{error}</p>}
    <section><div className="admin-panel-head"><div><h2>Payment review</h2><p>Check submitted receipts and update each order.</p></div></div><div className="admin-list">
      {payments.length === 0 && <article className="panel"><p>No payments are waiting for review.</p></article>}
      {payments.map(payment => <article className="panel payment-card" key={payment.payment_id}><div className="payment-card-title"><div><p className="eyebrow">{payment.order_number}</p><h3>{payment.customer_name}</h3></div><span className="status-pill">AWAITING REVIEW</span></div><div className="payment-meta"><span>{payment.phone}</span><span>{payment.payment_method}</span><strong>{payment.amount} EGP</strong></div><p className="payment-address">{payment.address}</p><div className="payment-actions"><button className="button button-light" onClick={() => showReceipt(payment.payment_id)}>View receipt</button><button className="button button-dark" onClick={() => review(payment.payment_id, 'approve')}>Approve payment</button><button className="button button-danger" onClick={() => review(payment.payment_id, 'reject')}>Reject</button></div></article>)}
    </div></section>
    <section><div className="admin-panel-head"><div><h2>Recent orders</h2><p>{orders.length} orders in this view</p></div></div><div className="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Status</th><th>Action</th></tr></thead><tbody>{orders.map(order => <tr key={order.id}><td>{order.order_number}</td><td>{order.customer_name}<small>{order.phone}</small></td><td>{order.items_summary}</td><td><span className="status-pill">{order.order_status}</span></td><td>{order.order_status === 'PENDING_PAYMENT' && !order.has_payment && <button className="button button-danger" onClick={async () => { try { await request(`admin/orders/${order.id}/cancel`, { method: 'POST', headers: { 'X-CSRF-Token': csrf } }); await refresh(); } catch (problem) { setError(problem.message); } }}>Cancel</button>}</td></tr>)}</tbody></table></div></section>
  </main>;
}

createRoot(document.getElementById('root')).render(<Admin />);
