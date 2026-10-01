// Disposable current-schema invoice fixture, never a runtime grant interface.
export async function paidPlan(db,user,plan,{start=Math.floor(Date.now()/1000)-60,end=start+30*86400}={}) {
 const key=crypto.randomUUID().replaceAll('-',''),order=crypto.randomUUID(),subscription='sub_'+key,invoice='in_'+key;
 const amount={starter:1700,personal:3000,business:7900,'business-pro':13900}[plan];
 if(!amount)throw Error('Fixture requires a current paid plan');
 await db.prepare("INSERT INTO stripe_subscription_orders(id,user_id,plan_id,interval,price_id,amount_cents,created_at,state,subscription_id) VALUES(?,?,?,'month',?,?,?,'complete',?)").bind(order,user,plan,'price_'+key,amount,start,subscription).run();
 await db.prepare("INSERT INTO stripe_subscriptions(id,order_id,user_id,status,cancel_at_period_end,period_end,latest_invoice_id,updated_at) VALUES(?,?,?,'active',0,?,?,?)").bind(subscription,order,user,end,invoice,start).run();
 await db.prepare("INSERT INTO stripe_paid_invoices(id,user_id,subscription_id,plan_id,amount_cents,interval,starts_at,ends_at,created_at) VALUES(?,?,?,?,?,'month',?,?,?)").bind(invoice,user,subscription,plan,amount,start,end,start).run();
 return invoice;
}
