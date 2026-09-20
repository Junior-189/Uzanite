const {
  getOrdersByBusiness,
  getOrderByNumber,
  approveOrder,
  rejectOrder,
  requestPayment,
  confirmPayment,
  markDelivered,
  formatOrderSummary,
} = require('../../services/orderService');

const {
  notifyCustomerOrderApproved,
  notifyCustomerOrderRejected,
  notifyCustomerPaymentConfirmed,
  notifyCustomerDelivered,
} = require('../../services/notificationService');

const { getAllProducts } = require('../../services/productService');
const { handleQuickProductUpload, handleQuickProductWithImage } = require('../../services/quickProductService');
const User = require('../../models/User');
const { t } = require('../../lang');

const ADMIN_LANG = 'sw';

const helpButtons = () => [
  { buttonId: 'ORDERS', buttonText: { displayText: t('admin.help_btn_orders', ADMIN_LANG) }, type: 1 },
  { buttonId: 'PRODUCTS', buttonText: { displayText: t('admin.help_btn_products', ADMIN_LANG) }, type: 1 },
  { buttonId: 'HELP', buttonText: { displayText: t('admin.help_btn_help', ADMIN_LANG) }, type: 1 },
];

const handleAdmin = async (sock, sender, text, imageBuffer) => {
  const parts = text.trim().split(/\s+/);
  const cmd = parts[0].toUpperCase();

  // Look up businessId from admin's phone number
  const senderPhone = (sender || '').replace('@s.whatsapp.net', '').replace('@lid', '');
  const adminUser = await User.findOne({ phone: senderPhone }).catch(() => null);
  const businessId = adminUser?.businessId || 'default';

  try {
    if (cmd === 'QUICK_ADD' || cmd === 'QUICK_ADD_IMAGE') {
      if (imageBuffer) {
        return handleQuickProductWithImage(sock, sender, text, imageBuffer, businessId);
      } else {
        return handleQuickProductUpload(sock, sender, text, null, businessId);
      }
    }

    switch (cmd) {
      case 'HELP':
        return sock.sendMessage(sender, {
          text: t('admin.help', ADMIN_LANG),
          buttons: helpButtons(),
          footer: t('global.footer', ADMIN_LANG),
        });

      case 'ORDERS': {
        const status = parts[1] ? parts[1].toUpperCase() : null;
        const orders = await getOrdersByBusiness(businessId, status);
        if (!orders.length) {
          return sock.sendMessage(sender, {
            text: t('admin.orders_empty', ADMIN_LANG, { status: status ? status + ' ' : '' }),
            buttons: [{ buttonId: 'HELP', buttonText: { displayText: t('admin.help_btn_help', ADMIN_LANG) }, type: 1 }],
          });
        }
        const list = orders
          .slice(0, 10)
          .map((o) => t('admin.orders_line', ADMIN_LANG, {
            orderNumber: o.orderNumber,
            status: o.status,
            currency: o.currency,
            total: o.total.toLocaleString(),
            customer: o.customerName,
          }))
          .join('\n');
        return sock.sendMessage(sender, {
          text: t('admin.orders_title', ADMIN_LANG, { status: status ? ' (' + status + ')' : '', list }),
          buttons: [{ buttonId: 'HELP', buttonText: { displayText: t('admin.help_btn_help', ADMIN_LANG) }, type: 1 }],
        });
      }

      case 'TRACK': {
        const trackNum = parts[1];
        if (!trackNum) return sock.sendMessage(sender, { text: t('admin.track_usage', ADMIN_LANG) });
        const order = await getOrderByNumber(trackNum, businessId);
        if (!order) return sock.sendMessage(sender, { text: t('admin.track_not_found', ADMIN_LANG, { orderNumber: trackNum }) });
        return sock.sendMessage(sender, { text: formatOrderSummary(order, ADMIN_LANG) });
      }

      case 'APPROVE': {
        const approveNum = parts[1];
        const note = parts.slice(2).join(' ');
        if (!approveNum) return sock.sendMessage(sender, { text: t('admin.approve_usage', ADMIN_LANG) });
        const order = await getOrderByNumber(approveNum, businessId);
        if (!order) return sock.sendMessage(sender, { text: t('admin.approve_not_found', ADMIN_LANG) });
        if (order.status !== 'PENDING') {
          return sock.sendMessage(sender, { text: t('admin.approve_wrong_status', ADMIN_LANG, { status: order.status }) });
        }
        const approved = await approveOrder(order._id, note);
        const updated = await requestPayment(approved._id);
        await notifyCustomerOrderApproved(sock, updated, null, updated.businessId);
        return sock.sendMessage(sender, {
          text: t('admin.approve_success', ADMIN_LANG, { orderNumber: approveNum }),
        });
      }

      case 'REJECT': {
        const rejectNum = parts[1];
        const reason = parts.slice(2).join(' ') || 'No reason provided';
        if (!rejectNum) return sock.sendMessage(sender, { text: t('admin.reject_usage', ADMIN_LANG) });
        const order = await getOrderByNumber(rejectNum, businessId);
        if (!order) return sock.sendMessage(sender, { text: t('admin.reject_not_found', ADMIN_LANG) });
        const updated = await rejectOrder(order._id, reason);
        await notifyCustomerOrderRejected(sock, updated, null, updated.businessId);
        return sock.sendMessage(sender, {
          text: t('admin.reject_success', ADMIN_LANG, { orderNumber: rejectNum }),
        });
      }

      case 'PAY': {
        const payNum = parts[1];
        if (!payNum) return sock.sendMessage(sender, { text: t('admin.pay_usage', ADMIN_LANG) });
        const order = await getOrderByNumber(payNum, businessId);
        if (!order) return sock.sendMessage(sender, { text: t('admin.pay_not_found', ADMIN_LANG) });
        await requestPayment(order._id);
        await notifyCustomerOrderApproved(sock, order, null, order.businessId);
        return sock.sendMessage(sender, { text: t('admin.pay_success', ADMIN_LANG, { orderNumber: payNum }) });
      }

      case 'CONFIRM_PAYMENT': {
        const confirmNum = parts[1];
        const method = parts[2] || 'manual';
        const reference = parts.slice(3).join(' ') || 'N/A';
        if (!confirmNum) {
          return sock.sendMessage(sender, { text: t('admin.confirm_usage', ADMIN_LANG) });
        }
        const order = await getOrderByNumber(confirmNum, businessId);
        if (!order) return sock.sendMessage(sender, { text: t('admin.confirm_not_found', ADMIN_LANG) });
        const confirmed = await confirmPayment(order._id, { method, reference });
        await notifyCustomerPaymentConfirmed(sock, confirmed, null, confirmed.businessId);
        return sock.sendMessage(sender, {
          text: t('admin.confirm_success', ADMIN_LANG, { orderNumber: confirmNum, method, ref: reference }),
        });
      }

      case 'DELIVER': {
        const deliverNum = parts[1];
        const deliverNote = parts.slice(2).join(' ');
        if (!deliverNum) return sock.sendMessage(sender, { text: t('admin.deliver_usage', ADMIN_LANG) });
        const order = await getOrderByNumber(deliverNum, businessId);
        if (!order) return sock.sendMessage(sender, { text: t('admin.deliver_not_found', ADMIN_LANG) });
        if (order.status !== 'PAID') {
          return sock.sendMessage(sender, {
            text: t('admin.deliver_wrong_status', ADMIN_LANG, { status: order.status }),
          });
        }
        const delivered = await markDelivered(order._id, deliverNote);
        await notifyCustomerDelivered(sock, delivered, null, delivered.businessId);
        return sock.sendMessage(sender, {
          text: t('admin.deliver_success', ADMIN_LANG, { orderNumber: deliverNum }),
        });
      }

      case 'PRODUCTS': {
        const products = await getAllProducts(businessId);
        if (!products.length) return sock.sendMessage(sender, {
          text: t('admin.products_empty', ADMIN_LANG),
          buttons: [{ buttonId: 'HELP', buttonText: { displayText: t('admin.help_btn_help', ADMIN_LANG) }, type: 1 }],
        });
        const list = products
          .map((p, i) => t('admin.products_line', ADMIN_LANG, {
            i: i + 1,
            name: p.name,
            currency: p.currency,
            price: p.price.toLocaleString(),
            active: p.active ? t('admin.products_active', ADMIN_LANG) : t('admin.products_inactive', ADMIN_LANG),
          }))
          .join('\n');
        return sock.sendMessage(sender, {
          text: t('admin.products_title', ADMIN_LANG, { list }),
          buttons: [{ buttonId: 'HELP', buttonText: { displayText: t('admin.help_btn_help', ADMIN_LANG) }, type: 1 }],
        });
      }

      default:
        return null;
    }
  } catch (err) {
    console.error('Admin flow error:', err);
    return sock.sendMessage(sender, { text: t('admin.error', ADMIN_LANG, { message: err.message }) });
  }
};

module.exports = { handleAdmin };
