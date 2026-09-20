const { getSession, updateSession, resetSession, addToCart, clearCart } = require('../../services/sessionService');
const { getAllProducts, getProductById, formatProductList } = require('../../services/productService');
const { createOrder, getOrdersByCustomer, getOrderByNumber, formatOrderSummary } = require('../../services/orderService');
const { notifyAdminNewOrder, notifyCustomerOrderReceived, notifyAdminPaymentProof } = require('../../services/notificationService');
const { createNotification } = require('../../services/notificationStore');
const { t } = require('../../lang');
const StockNotification = require('../../models/StockNotification');
const Order = require('../../models/Order');
const { ORDER_STATUS } = require('../../models/Order');
const Business = require('../../models/Business');
const fs = require('fs');
const path = require('path');

const businessNameCache = new Map();
const getBusinessName = async (businessId) => {
  if (!businessId) return 'Our Shop';
  if (businessNameCache.has(businessId)) return businessNameCache.get(businessId);
  const biz = await Business.findOne({ businessId });
  const name = biz?.name || 'Our Shop';
  businessNameCache.set(businessId, name);
  return name;
};

const getBusinessPhone = async (businessId) => {
  if (!businessId) return '';
  const biz = await Business.findOne({ businessId });
  return biz?.phone || '';
};

const lang = (session) => session?.language || 'sw';
const L = (s) => lang(s);

// ── Button helpers ──────────────────────────────────────────────────

const sendWithButtons = async (sock, sender, text, buttons, footer = '') => {
  const msg = { text };
  if (buttons && buttons.length > 0) {
    msg.buttons = buttons;
    msg.footer = footer || t('global.footer', L({ language: 'sw' }));
  }
  return sock.sendMessage(sender, msg);
};

const langButtons = () => [
  { buttonId: '1', buttonText: { displayText: 'English' }, type: 1 },
  { buttonId: '2', buttonText: { displayText: 'Kiswahili' }, type: 1 },
];

const mainMenuButtons = (s) => [
  { buttonId: '1', buttonText: { displayText: t('main_menu.btn_browse', L(s)) }, type: 1 },
  { buttonId: '2', buttonText: { displayText: t('main_menu.btn_orders', L(s)) }, type: 1 },
  { buttonId: '3', buttonText: { displayText: t('main_menu.btn_track', L(s)) }, type: 1 },
  { buttonId: '4', buttonText: { displayText: t('main_menu.btn_contact', L(s)) }, type: 1 },
  { buttonId: '5', buttonText: { displayText: t('main_menu.btn_language', L(s)) }, type: 1 },
];

const cartButtons = (s) => [
  { buttonId: '1', buttonText: { displayText: t('cart.btn_checkout', L(s)) }, type: 1 },
  { buttonId: '2', buttonText: { displayText: t('cart.btn_add_more', L(s)) }, type: 1 },
  { buttonId: '3', buttonText: { displayText: t('cart.btn_clear', L(s)) }, type: 1 },
  { buttonId: '0', buttonText: { displayText: t('cart.btn_main_menu', L(s)) }, type: 1 },
];

const browseButtons = (s) => [
  { buttonId: 'CART', buttonText: { displayText: t('browse_products.btn_cart', L(s)) }, type: 1 },
  { buttonId: '0', buttonText: { displayText: t('browse_products.btn_main_menu', L(s)) }, type: 1 },
];

const backButton = (s) => [
  { buttonId: '0', buttonText: { displayText: t('global.btn_main_menu', L(s)) }, type: 1 },
];

// ── Cart helpers ────────────────────────────────────────────────────

const formatCartMenu = (cart, s) => {
  if (!cart.length) return t('cart.empty', L(s));
  const items = cart.map((i) =>
    t('cart.item_line', L(s), { name: i.productName, qty: i.quantity, currency: i.currency, subtotal: i.subtotal.toLocaleString() })
  ).join('\n');
  const total = cart.reduce((sum, i) => sum + i.subtotal, 0);
  return t('cart.menu', L(s), { items, currency: cart[0]?.currency || 'TZS', total: total.toLocaleString() });
};

// ── Main handler ─────────────────────────────────────────────────────────

const handleCustomer = async (sock, sender, text, session) => {
  const upper = text.toUpperCase().trim();

  // ── Language selection ──
  if (!session.language) {
    if (upper === '1') {
      await updateSession(sender, session.businessId, { language: 'en', step: 'MAIN_MENU' });
      session.language = 'en';
      session.step = 'MAIN_MENU';
      await sock.sendMessage(sender, { text: t('language.selected', 'en') });
      return sendWithButtons(sock, sender, t('main_menu', 'en', { businessName: await getBusinessName(session.businessId) }), mainMenuButtons(session));
    }
    if (upper === '2') {
      await updateSession(sender, session.businessId, { language: 'sw', step: 'MAIN_MENU' });
      session.language = 'sw';
      session.step = 'MAIN_MENU';
      await sock.sendMessage(sender, { text: t('language.selected', 'sw') });
      return sendWithButtons(sock, sender, t('main_menu', 'sw', { businessName: await getBusinessName(session.businessId) }), mainMenuButtons(session));
    }
    return sendWithButtons(sock, sender, t('language.select', 'sw'), langButtons());
  }

  // ── Global shortcuts ──
  if (upper === 'MENU' || upper === '0' || upper === 'HOME') {
    await resetSession(sender, session.businessId);
    const s = await getSession(sender, session.businessId);
    return sendWithButtons(sock, sender, t('main_menu', L(s), { businessName: await getBusinessName(s.businessId) }), mainMenuButtons(s));
  }

  if (upper.startsWith('TRACK ')) {
    const orderNumber = upper.replace('TRACK ', '').trim();
    const order = await getOrderByNumber(orderNumber, session.businessId);
    if (!order) return sock.sendMessage(sender, { text: t('track.not_found', L(session), { orderNumber }) });
    return sock.sendMessage(sender, { text: formatOrderSummary(order, L(session)) });
  }

  if (session.step === 'AWAITING_PAYMENT_PROOF') {
    const order = await Order.findById(session.context.pendingPaymentOrderId);
    if (order && order.status === 'APPROVED') {
      order.paymentReference = text.trim();
      order.status = ORDER_STATUS.PENDING_PAYMENT;
      await order.save();
      await notifyAdminPaymentProof(sock, order, text.trim());
      await updateSession(sender, session.businessId, { step: 'MAIN_MENU', context: {} });
      const s = await getSession(sender, session.businessId);
      return sendWithButtons(sock, sender,
        t('payment.waiting', L(s), { ref: text.trim(), orderNumber: order.orderNumber }),
        mainMenuButtons(s),
      );
    }
    await updateSession(sender, session.businessId, { step: 'MAIN_MENU', context: {} });
    const s = await getSession(sender, session.businessId);
    return sendWithButtons(sock, sender, t('main_menu', L(s), { businessName: await getBusinessName(s.businessId) }), mainMenuButtons(s));
  }

  if (session.step === 'MAIN_MENU' && text.trim().length >= 3 && text.trim().length <= 30 && /^[A-Za-z0-9\s\-]+$/.test(text.trim())) {
    const orders = await getOrdersByCustomer(sender, session.businessId);
    const pendingPaymentOrder = orders.find(o => o.status === 'APPROVED');
    if (pendingPaymentOrder) {
      pendingPaymentOrder.paymentReference = text.trim();
      pendingPaymentOrder.status = ORDER_STATUS.PENDING_PAYMENT;
      await pendingPaymentOrder.save();
      await notifyAdminPaymentProof(sock, pendingPaymentOrder, text.trim());
      await updateSession(sender, session.businessId, { step: 'MAIN_MENU', context: {} });
      const s = await getSession(sender, session.businessId);
      return sendWithButtons(sock, sender,
        t('payment.waiting', L(s), { ref: text.trim(), orderNumber: pendingPaymentOrder.orderNumber }),
        mainMenuButtons(s),
      );
    }
  }

  switch (session.step) {
    case 'MAIN_MENU':
      return handleMainMenu(sock, sender, text, session);
    case 'LANGUAGE_SELECT':
      return handleLanguageSelect(sock, sender, text, session);
    case 'BROWSE_PRODUCTS':
      return handleBrowseProducts(sock, sender, text, session);
    case 'PRODUCT_DETAIL':
      return handleProductDetail(sock, sender, text, session);
    case 'CART':
      return handleCart(sock, sender, text, session);
    case 'CHECKOUT_NAME':
      return handleCheckoutName(sock, sender, text, session);
    case 'CHECKOUT_LOCATION':
      return handleCheckoutLocation(sock, sender, text, session);
    case 'CHECKOUT_PHONE':
      return handleCheckoutPhone(sock, sender, text, session);
    case 'CHECKOUT_OFFER':
      return handleCheckoutOffer(sock, sender, text, session);
    case 'MY_ORDERS':
      return handleMyOrders(sock, sender, text, session);
    default:
      await resetSession(sender, session.businessId);
      const s = await getSession(sender, session.businessId);
      return sendWithButtons(sock, sender, t('main_menu', L(s), { businessName: await getBusinessName(s.businessId) }), mainMenuButtons(s));
  }
};

// ── Step handlers ──

const handleLanguageSelect = async (sock, sender, text, session) => {
  const upper = text.trim().toUpperCase();
  if (upper === '1') {
    await updateSession(sender, session.businessId, { language: 'en', step: 'MAIN_MENU' });
    session.language = 'en';
    session.step = 'MAIN_MENU';
    await sock.sendMessage(sender, { text: t('language.selected', 'en') });
    return sendWithButtons(sock, sender, t('main_menu', 'en', { businessName: await getBusinessName(session.businessId) }), mainMenuButtons(session));
  }
  if (upper === '2') {
    await updateSession(sender, session.businessId, { language: 'sw', step: 'MAIN_MENU' });
    session.language = 'sw';
    session.step = 'MAIN_MENU';
    await sock.sendMessage(sender, { text: t('language.selected', 'sw') });
    return sendWithButtons(sock, sender, t('main_menu', 'sw', { businessName: await getBusinessName(session.businessId) }), mainMenuButtons(session));
  }
  return sendWithButtons(sock, sender, t('language.select', 'sw'), langButtons());
};

const handleMainMenu = async (sock, sender, text, session) => {
  switch (text.trim()) {
    case '1':
      await updateSession(sender, session.businessId, { step: 'BROWSE_PRODUCTS' });
      session.step = 'BROWSE_PRODUCTS';
      const products = await getAllProducts(session.businessId);
      const list = formatProductList(products, L(session));
      return sendWithButtons(sock, sender,
        t('browse_products.title', L(session), { list }),
        browseButtons(session),
      );

    case '2':
      await updateSession(sender, session.businessId, { step: 'MY_ORDERS' });
      session.step = 'MY_ORDERS';
      return handleMyOrders(sock, sender, text, session);

    case '3':
      await updateSession(sender, session.businessId, { step: 'MAIN_MENU' });
      return sendWithButtons(sock, sender,
        t('track.prompt', L(session)),
        backButton(session),
      );

    case '4':
      return sendWithButtons(sock, sender,
        t('contact.title', L(session), { businessName: await getBusinessName(session.businessId), phone: await getBusinessPhone(session.businessId) || t('contact.phone', L(session)) }),
        mainMenuButtons(session),
      );

    case '5':
      await updateSession(sender, session.businessId, { step: 'LANGUAGE_SELECT' });
      session.step = 'LANGUAGE_SELECT';
      return sendWithButtons(sock, sender, t('language.select', 'sw'), langButtons());

    default:
      return sendWithButtons(sock, sender, t('main_menu', L(session), { businessName: await getBusinessName(session.businessId) }), mainMenuButtons(session));
  }
};

const handleBrowseProducts = async (sock, sender, text, session) => {
  if (upper(text) === 'CART') {
    await updateSession(sender, session.businessId, { step: 'CART' });
    session.step = 'CART';
    return sendWithButtons(sock, sender, formatCartMenu(session.cart, session), cartButtons(session));
  }

  const products = await getAllProducts(session.businessId);
  const index = parseInt(text) - 1;

  if (isNaN(index) || index < 0 || index >= products.length) {
    return sock.sendMessage(sender, {
      text: t('browse_products.invalid', L(session), { max: products.length }),
    });
  }

  const product = products[index];
  await updateSession(sender, session.businessId, { step: 'PRODUCT_DETAIL', context: { productId: product._id.toString() } });
  session.step = 'PRODUCT_DETAIL';
  session.context = { productId: product._id.toString() };

  const stockLine = t('product_detail.stock', L(session), { stock: product.stock });

  const negotiableLine = product.minPrice ? `\n🤝 ${t('product.negotiable', L(session), { min: product.minPrice.toLocaleString(), currency: product.currency })}` : '';
  const detail = t('product_detail.title', L(session), {
    name: product.name,
    description: (product.description || t('product_detail.no_description', L(session))) + negotiableLine,
    currency: product.currency,
    price: product.price.toLocaleString(),
    stock_line: stockLine,
  });

  if (product.imagePath) {
    try {
      const imgPath = path.join(process.cwd(), product.imagePath);
      if (fs.existsSync(imgPath)) {
        const buffer = fs.readFileSync(imgPath);
        await sock.sendMessage(sender, { image: buffer, caption: detail });
        return;
      }
    } catch (err) {
      console.error(`Error processing image for product ${product.name}:`, err.message);
    }
  }

  return sock.sendMessage(sender, { text: detail });
};

const handleProductDetail = async (sock, sender, text, session) => {
  if (upper(text) === t('product_detail.back', L(session)).toUpperCase()) {
    await updateSession(sender, session.businessId, { step: 'BROWSE_PRODUCTS' });
    session.step = 'BROWSE_PRODUCTS';
    const products = await getAllProducts(session.businessId);
    return sendWithButtons(sock, sender,
      t('browse_products.reply_prompt', L(session), { list: formatProductList(products, L(session)) }),
      browseButtons(session),
    );
  }

  const qty = parseInt(text);
  if (isNaN(qty) || qty < 1) {
    return sock.sendMessage(sender, { text: t('product_detail.invalid_qty', L(session)) });
  }

  const product = await getProductById(session.context.productId);
  if (!product) {
    await resetSession(sender, session.businessId);
    const s = await getSession(sender, session.businessId);
    return sock.sendMessage(sender, { text: t('product_detail.not_found', L(s), { main_menu: t('main_menu', L(s), { businessName: await getBusinessName(s.businessId) }) }) });
  }

  if (qty > product.stock) {
    return sock.sendMessage(sender, { text: t('product_detail.out_of_stock', L(session), { stock: product.stock }) });
  }

  const item = {
    productId: product._id.toString(),
    productName: product.name,
    price: product.price,
    minPrice: product.minPrice || 0,
    currency: product.currency,
    quantity: qty,
    subtotal: product.price * qty,
  };

  const updatedSession = await addToCart(sender, item, session.businessId);
  await updateSession(sender, session.businessId, { step: 'CART' });
  session.step = 'CART';

  return sendWithButtons(sock, sender,
    t('cart.added', L(session), { name: product.name, qty, cart_menu: formatCartMenu(updatedSession.cart, session) }),
    cartButtons(session),
  );
};

const handleCart = async (sock, sender, text, session) => {
  switch (text.trim()) {
    case '1':
      if (!session.cart.length) {
        return sock.sendMessage(sender, { text: t('cart.empty_checkout', L(session)) });
      }
      await updateSession(sender, session.businessId, { step: 'CHECKOUT_NAME' });
      session.step = 'CHECKOUT_NAME';
      return sendWithButtons(sock, sender,
        t('checkout.name_prompt', L(session)),
        backButton(session),
      );

    case '2':
      await updateSession(sender, session.businessId, { step: 'BROWSE_PRODUCTS' });
      session.step = 'BROWSE_PRODUCTS';
      const products = await getAllProducts(session.businessId);
      return sendWithButtons(sock, sender,
        t('browse_products.reply_prompt', L(session), { list: formatProductList(products, L(session)) }),
        browseButtons(session),
      );

    case '3':
      await clearCart(sender, session.businessId);
      session.cart = [];
      const s = await getSession(sender, session.businessId);
      return sendWithButtons(sock, sender,
        t('cart.cleared', L(s), { main_menu: t('main_menu', L(s), { businessName: await getBusinessName(s.businessId) }) }),
        mainMenuButtons(s),
      );

    case '0':
      await resetSession(sender, session.businessId);
      const s2 = await getSession(sender, session.businessId);
      return sendWithButtons(sock, sender, t('main_menu', L(s2), { businessName: await getBusinessName(s2.businessId) }), mainMenuButtons(s2));

    default:
      return sendWithButtons(sock, sender, formatCartMenu(session.cart, session), cartButtons(session));
  }
};

const handleCheckoutName = async (sock, sender, text, session) => {
  const name = text.trim();
  if (name.length < 2) {
    return sock.sendMessage(sender, { text: t('checkout.name_invalid', L(session)) });
  }

  const outOfStockItems = [];
  for (const item of session.cart) {
    if (item.productId) {
      const product = await getProductById(item.productId);
      if (product && product.stock === 0) {
        try {
          await StockNotification.findOneAndUpdate(
            { productId: item.productId, customerPhone: sender },
            {
              businessId: session.businessId || 'default',
              productId: item.productId,
              productName: item.productName,
              customerPhone: sender,
              notified: false,
            },
            { upsert: true, new: true }
          );
        } catch {}
        outOfStockItems.push(item.productName);
      }
    }
  }

  if (outOfStockItems.length > 0) {
    const itemList = outOfStockItems.map((n) => `• ${n}`).join('\n');
    await clearCart(sender, session.businessId);
    await updateSession(sender, session.businessId, { step: 'MAIN_MENU', context: {} });
    const s = await getSession(sender, session.businessId);
    return sendWithButtons(sock, sender,
      t('checkout.out_of_stock', L(s), { items: itemList }),
      mainMenuButtons(s),
    );
  }

  await updateSession(sender, session.businessId, { step: 'CHECKOUT_LOCATION', context: { ...session.context, customerName: name } });
  session.step = 'CHECKOUT_LOCATION';
  session.context.customerName = name;
  return sendWithButtons(sock, sender,
    t('checkout.location_prompt', L(session)),
    backButton(session),
  );
};

const handleCheckoutLocation = async (sock, sender, text, session) => {
  const location = text.trim();
  if (location.length < 3) {
    return sock.sendMessage(sender, { text: t('checkout.location_invalid', L(session)) });
  }

  await updateSession(sender, session.businessId, { step: 'CHECKOUT_PHONE', context: { ...session.context, deliveryLocation: location } });
  session.step = 'CHECKOUT_PHONE';
  session.context.deliveryLocation = location;
  return sendWithButtons(sock, sender,
    t('checkout.phone_prompt', L(session)),
    backButton(session),
  );
};

const handleCheckoutPhone = async (sock, sender, text, session) => {
  const phone = text.trim().replace(/\D/g, '');
  if (phone.length < 5) {
    return sock.sendMessage(sender, { text: t('checkout.phone_invalid', L(session)) });
  }

  const { customerName, deliveryLocation } = session.context;

  // Check if any cart item has a minPrice (negotiable)
  const hasNegotiable = session.cart.some(i => i.minPrice > 0);
  if (hasNegotiable) {
    const total = session.cart.reduce((s, i) => s + i.subtotal, 0);
    const minTotal = session.cart.reduce((s, i) => s + (i.minPrice || 0) * i.quantity, 0);
    await updateSession(sender, session.businessId, {
      step: 'CHECKOUT_OFFER',
      context: { ...session.context, customerName, deliveryLocation, deliveryPhone: phone, minTotal, originalTotal: total }
    });
    session.step = 'CHECKOUT_OFFER';
    session.context.customerName = customerName;
    session.context.deliveryLocation = deliveryLocation;
    session.context.deliveryPhone = phone;
    session.context.minTotal = minTotal;
    session.context.originalTotal = total;
    return sendWithButtons(sock, sender,
      t('checkout.offer_prompt', L(session), {
        total: total.toLocaleString(),
        currency: session.cart[0]?.currency || 'TZS',
        minTotal: minTotal.toLocaleString(),
      }),
      [{ buttonId: 'NO', buttonText: { displayText: t('checkout.offer_skip', L(session)) }, type: 1 }, { buttonId: '0', buttonText: { displayText: t('global.btn_main_menu', L(session)) }, type: 1 }]
    );
  }

  return completeOrder(sock, sender, session, customerName, deliveryLocation, phone);
};

const handleCheckoutOffer = async (sock, sender, text, session) => {
  const { customerName, deliveryLocation, deliveryPhone, originalTotal, minTotal } = session.context;
  const upper = text.trim().toUpperCase();

  // Skip negotiation
  if (upper === 'NO' || upper === '0') {
    return completeOrder(sock, sender, session, customerName, deliveryLocation, deliveryPhone, originalTotal);
  }

  const offer = parseFloat(text.trim());
  if (isNaN(offer) || offer < 0) {
    return sock.sendMessage(sender, { text: t('checkout.offer_invalid', L(session)) });
  }

  if (offer < minTotal) {
    return sock.sendMessage(sender, {
      text: t('checkout.offer_too_low', L(session), { minTotal: minTotal.toLocaleString(), currency: session.cart[0]?.currency || 'TZS' })
    });
  }

  const finalTotal = Math.min(offer, originalTotal);
  return completeOrder(sock, sender, session, customerName, deliveryLocation, deliveryPhone, finalTotal);
};

const completeOrder = async (sock, sender, session, customerName, deliveryLocation, deliveryPhone, offeredTotal) => {
  const order = await createOrder({
    businessId: session.businessId || 'default',
    customerPhone: sender,
    customerName,
    deliveryLocation,
    deliveryPhone,
    items: session.cart,
    offeredTotal: offeredTotal || undefined,
  });

  await clearCart(sender, session.businessId);
  await updateSession(sender, session.businessId, { step: 'MAIN_MENU', context: {} });
  session.step = 'MAIN_MENU';
  session.cart = [];
  session.context = {};

  await notifyCustomerOrderReceived(sock, order, L(session), session.businessId);
  await notifyAdminNewOrder(sock, order);
  createNotification({ businessId: session.businessId || 'default', type: 'order_created', title: 'New Order', message: `Order ${order.orderNumber} placed by ${order.customerName} - ${order.currency} ${order.total.toLocaleString()}`, data: { orderId: order._id.toString() } });

  return sendWithButtons(sock, sender,
    t('checkout.success', L(session), {
      orderNumber: order.orderNumber,
      currency: order.currency,
      total: order.total.toLocaleString(),
      location: deliveryLocation,
      phone: deliveryPhone,
    }),
    mainMenuButtons(session),
  );
};


const handleMyOrders = async (sock, sender, text, session) => {
  const orders = await getOrdersByCustomer(sender, session.businessId);
  if (!orders.length) {
    await updateSession(sender, session.businessId, { step: 'BROWSE_PRODUCTS' });
    session.step = 'BROWSE_PRODUCTS';
    const allProducts = await getAllProducts(session.businessId);
    return sendWithButtons(sock, sender,
      t('my_orders.empty', L(session), { list: formatProductList(allProducts, L(session)) }),
      browseButtons(session),
    );
  }

  const list = orders
    .slice(0, 5)
    .map((o, i) => t('my_orders.line', L(session), {
      i: i + 1,
      orderNumber: o.orderNumber,
      status: o.status,
      currency: o.currency,
      total: o.total.toLocaleString(),
    }))
    .join('\n');

  await updateSession(sender, session.businessId, { step: 'MAIN_MENU', context: {} });
  session.step = 'MAIN_MENU';
  return sendWithButtons(sock, sender,
    t('my_orders.title', L(session), { list }),
    mainMenuButtons(session),
  );
};

const upper = (t) => t.toUpperCase().trim();

module.exports = { handleCustomer };
