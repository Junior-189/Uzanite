const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Business = require('../models/Business');
const Expense = require('../models/Expense');
const Debt = require('../models/Debt');
const Purchase = require('../models/Purchase');
const ChatContact = require('../models/ChatContact');
const Notification = require('../models/Notification');
const Staff = require('../models/Staff');
const { protect, tenantApproved } = require('../middleware/auth');
const { requireFeature } = require('../middleware/featureGuard');
const { sendServerError } = require('../utils/safeError');

router.use(protect, tenantApproved, requireFeature('reports'));

function getBusinessId(req) {
  return ['super_admin', 'sub_admin'].includes(req.user.role)
    ? (req.query.businessId || 'default')
    : req.user.businessId;
}

function getStartDate(period) {
  const now = new Date();
  switch (period) {
    case 'daily': return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case 'weekly': return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case 'monthly': return new Date(now.getFullYear(), now.getMonth(), 1);
    case 'annually': return new Date(now.getFullYear(), 0, 1);
    case 'all': return new Date(now.getFullYear() - 10, 0, 1);
    default: return null;
  }
}

function getPeriodLabel(period) {
  const labels = {
    daily: 'Today (24h)', weekly: 'Weekly (7d)', monthly: 'Daily (30d)',
    annually: 'Monthly (12m)', all: 'Yearly (10y)', alltime: 'All Time',
    week: 'This Week', quarter: 'This Quarter', custom: 'Custom Range',
  };
  return labels[period] || 'All Time';
}

// Resolves a date range from the `period` query param (or explicit start/end for custom).
function getDateRange(req) {
  const period = req.query.period || 'alltime';
  const now = new Date();
  let start = null;
  let end = null;
  switch (period) {
    case 'daily': start = new Date(now.getTime() - 24 * 60 * 60 * 1000); break;
    case 'week': {
      const d = new Date(now);
      const day = (d.getDay() + 6) % 7; // Monday as start of week
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - day);
      start = d;
      break;
    }
    case 'weekly': start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
    case 'monthly': start = new Date(now.getFullYear(), now.getMonth(), 1); break;
    case 'quarter': {
      const q = Math.floor(now.getMonth() / 3);
      start = new Date(now.getFullYear(), q * 3, 1);
      break;
    }
    case 'annually': start = new Date(now.getFullYear(), 0, 1); break;
    case 'all': start = new Date(now.getFullYear() - 10, 0, 1); break;
    case 'custom': {
      if (req.query.start) start = new Date(req.query.start);
      if (req.query.end) {
        end = new Date(req.query.end);
        end.setHours(23, 59, 59, 999);
      }
      break;
    }
    default: start = null; end = null;
  }
  return { start, end };
}

// Merges a date-range filter onto `filter` for the given date `field`.
function withDate(filter, field, range) {
  if (!range.start && !range.end) return filter;
  const f = {};
  if (range.start) f.$gte = range.start;
  if (range.end) f.$lte = range.end;
  filter[field] = f;
  return filter;
}

// ── Professional PDF template helpers ──
const BRAND = '#177d54';
const BRAND_DARK = '#136445';
const INK = '#1f2937';
const MUTED = '#6b7280';
const LIGHT = '#f3f4f6';
const ZEBRA = '#f9fafb';
const LINE = '#e5e7eb';
const LEFT = 40;
const RIGHT = (doc) => doc.page.width - 40;

const fmtNum = (v) => (v || 0).toLocaleString();
const fmtDateShort = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const fmtDateLong = (d) => new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

function periodText(range, period) {
  if (period === 'alltime' || (!range.start && !range.end)) return 'All Time';
  if (range.start && range.end) return `${fmtDateLong(range.start)} – ${fmtDateLong(range.end)}`;
  if (range.start) return `${fmtDateLong(range.start)} – ${fmtDateLong(new Date())}`;
  return 'All Time';
}

// ── Report i18n (English source strings → Swahili) ──
function getLang(req) { return req.query.lang === 'sw' ? 'sw' : 'en'; }

const SW = {
  // Cover config
  'FULL REPORT': 'RIPOTI KAMILI', 'Business Overview': 'MUHTASARI WA BIASHARA', 'Complete business performance summary': 'Muhtasari kamili wa utendaji wa biashara',
  'ORDER REPORT': 'RIPOTI YA MAAGIZO', 'Sales': 'Uuzaji', 'Orders & revenue performance': 'Utendaji wa maagizo na mapato',
  'PRODUCTS REPORT': 'RIPOTI YA BIDHAA', 'Inventory': 'Hifadhi', 'Stock & product summary': 'Muhtasari wa bidhaa na stoki',
  'EXPENSES REPORT': 'RIPOTI YA GHARAMA', 'Spending': 'Matumizi', 'Expense breakdown': 'Uainishaji wa gharama',
  'PURCHASES REPORT': 'RIPOTI YA MANUNUZI', 'Procurement': 'Uninuzi', 'Purchase & supplier summary': 'Muhtasari wa ununuzi na wasambazaji',
  'DEBTS REPORT': 'RIPOTI YA MADENI', 'Debt Collection': 'Ukusanyaji wa Madeni', 'Outstanding debts & recovery': 'Madeni yaliyosalia na urejeshaji',
  'STAFF REPORT': 'RIPOTI YA WAFANYAKAZI', 'Team': 'Timu', 'Staff & activity summary': 'Muhtasari wa wafanyakazi na shughuli',
  'DASHBOARD REPORT': 'RIPOTI YA DASHIBODI', 'Live': 'Maozi', 'Real-time performance snapshot': 'Picha ya haraka ya utendaji wa wakati halisi',
  'BUSINESS REPORT': 'RIPOTI YA BIASHARA', 'Profile': 'Wasifu', 'Company profile & health': 'Wasifu na afya ya kampuni',
  'CONTACTS REPORT': 'RIPOTI YA WATEJA', 'Audience': 'Wateja', 'Customer contacts summary': 'Muhtasari wa anwani za wateja',
  'NOTIFICATIONS REPORT': 'RIPOTI YA ARIFA', 'Alerts': 'Tahadhari', 'Notification activity': 'Shughuli za arifa',
  'RECYCLE BIN REPORT': 'RIPOTI YA TUPO', 'Deleted': 'Zilizofutwa', 'Recycle bin summary': 'Muhtasari wa tupo',
  // Common
  'UZANITE REPORT': 'RIPOTI YA UZANITE', 'Generated ': 'Imezalishwa ', 'Generated by UZANITE': 'Imezalishwa na UZANITE',
  'Business Management System': 'Mfumo wa Usimamizi wa Biashara', 'REPORT': 'RIPOTI', 'All Time': 'Wakati Wote', 'Contents': 'Yaliyomo', 'Page': 'Ukurasa', 'of': 'ya',
  'Daily': 'Ya Siku', 'Weekly': 'Ya Wiki', 'Monthly': 'Ya Mwezi', 'Annually': 'Ya Mwaka',
  'Report Type': 'Aina ya Ripoti', 'Generated on': 'Imezalishwa', 'Generated:': 'Imezalishwa:', 'Year': 'Mwaka', 'Period': 'Kipindi',
  'ORDER': 'AGIZO', 'PRODUCT': 'BIDHAA', 'PURCHASE': 'UNUNUZI', 'EXPENSES': 'GHARAMA', 'STAFF': 'WAFANYAKAZI', 'DEBT': 'DENI',
  'FULL': 'KAMILI', 'DASHBOARD': 'DASHIBODI', 'BUSINESS': 'BIASHARA', 'CONTACTS': 'WATEJA', 'NOTIFICATIONS': 'ARIFA', 'RECYCLE BIN': 'TUPO',
  // Summary / KPI labels
  'Total Expenses': 'Jumla ya Gharama', 'Average': 'Wastani', 'Records': 'Rekodi', 'Top Category': 'Jamii Kuu',
  'Total Orders': 'Jumla ya Maagizo', 'Pending': 'Inasubiri', 'Approved': 'Imeidhinishwa', 'Paid': 'Imeilipwa',
  'Delivered': 'Imepewa', 'Rejected': 'Imekataliwa', 'Total Products': 'Jumla ya Bidhaa', 'In Stock': 'Ziko Stoki',
  'Low Stock': 'Stoki Ndogo', 'Out of Stock': 'Hakuna Stoki', 'Total Contacts': 'Jumla ya Wateja', 'Opted In': 'Wamejiunga',
  'Opted Out': 'Wamejitenga', 'Active (30d)': 'Hai (siku 30)', 'Engaged': 'Wanaohusika', 'Total Messages': 'Jumla ya Ujumbe',
  'Avg Msg/Contact': 'Wastani Ujumbe/Mteja', 'Opt-in Rate': 'Kiwango cha Kujiunga', 'Total Purchases': 'Jumla ya Manunuzi',
  'Total Spent': 'Jumla ya Matumizi', 'Avg / Purchase': 'Wastani / Ununuzi', 'Top Supplier': 'Msambazaji Mkuu',
  'Total Debts': 'Jumla ya Madeni', 'Total Amount': 'Jumla ya Kiasi', 'Remaining': 'Inasalia', 'Collection Rate': 'Kiwango cha Ukusanyaji',
  'Revenue': 'Mapato', 'Avg Order': 'Wastani wa Agizo', 'Completion': 'Utekaji', 'Expenses': 'Gharama', 'Purchases': 'Manunuzi',
  'Debt Remaining': 'Madeni Yanayosalia', 'Inventory Value': 'Thamani ya Stoki', 'Cash Orders': 'Maagizo ya Fedha',
  'Online Orders': 'Maagizo ya Mtandaoni', 'Cash Revenue': 'Mapato ya Fedha', 'Online Revenue': 'Mapato ya Mtandaoni',
  'Net Profit': 'Faida Halisi', 'Total Revenue': 'Jumla ya Mapato', 'Products': 'Bidhaa', 'Contacts': 'Wateja',
  'Staff Members': 'Wafanyakazi', 'Total Staff': 'Jumla ya Wafanyakazi', 'Active': 'Hai', 'Inactive': 'Isiyo Hai',
  'Avg Permissions': 'Wastani wa Ruhusa', 'Unread': 'Haijasomwa', 'Read': 'Imesomwa', 'High Priority': 'Kipaumbele cha Juu',
  'Today': 'Leo', 'Top Type': 'Aina Kuu', 'Unique Types': 'Aina za Kipekee', 'Total': 'Jumla', 'Total Deleted': 'Jumla ya Zilizofutwa',
  'Notifications': 'Arifa', 'Oldest Deletion': 'Futa ya Zamani',
  // Table column headers
  'Date': 'Tarehe', 'Description': 'Maelezo', 'Category': 'Jamii', 'Amount': 'Kiasi', 'Order #': 'Namba ya Agizo',
  'Customer': 'Mteja', 'Status': 'Hali', 'Payment': 'Malipo', 'Total': 'Jumla', 'Product': 'Bidhaa', 'Price': 'Bei',
  'Stock': 'Stoki', 'Inventory Value': 'Thamani ya Stoki', 'Order': 'Agizo', 'Cost': 'Gharama', 'Name': 'Jina',
  'Email': 'Barua pepe', 'Role': 'Jukumu', 'Permissions': 'Ruhusa', 'Due': 'Inadue', 'Supplier': 'Msambazaji',
  'Qty': 'Idadi', 'Total Cost': 'Jumla ya Gharama',
  // Bar chart titles
  'Daily Spend': 'Matumizi ya Kila Siku', 'Outstanding by Status': 'Yaliyosalia kwa Hali', 'Orders by Status': 'Maagizo kwa Hali',
  'Revenue vs Spend': 'Mapato dhidi ya Matumizi', 'Deleted Items by Type': 'Vitu Vilivyofutwa kwa Aina', 'Notifications by Type': 'Arifa kwa Aina',
  // Section headers
  'Orders': 'Maagizo', 'Expenses': 'Gharama', 'Purchases': 'Manunuzi', 'Debts': 'Madeni', 'Staff': 'Wafanyakazi',
  // Report titles
  'Expenses Report': 'Ripoti ya Gharama', 'Orders Report': 'Ripoti ya Maagizo', 'Products Report': 'Ripoti ya Bidhaa',
  'Contacts Report': 'Ripoti ya Wateja', 'Purchases Report': 'Ripoti ya Manunuzi', 'Debts Report': 'Ripoti ya Madeni',
  'Dashboard Report': 'Ripoti ya Dashibodi', 'Full Business Report': 'Ripoti Kamili ya Biashara', 'Recycle Bin Report': 'Ripoti ya Tupo',
  'Staff Report': 'Ripoti ya Wafanyakazi', 'Notifications Report': 'Ripoti ya Arifa', 'Business Profile Report': 'Ripoti ya Wasifu wa Biashara',
  // Business detail labels
  'Business Name': 'Jina la Biashara', 'Owner': 'Mmiliki', 'Phone': 'Simu', 'Currency': 'Sarafu',
  'Source': 'Chanzo', 'Recorded By': 'Imerekodwa Na',
  // Status values
  'PENDING': 'Inasubiri', 'APPROVED': 'Imeidhinishwa', 'PAID': 'Imeilipwa', 'DELIVERED': 'Imepewa', 'REJECTED': 'Imekataliwa',
  'PENDING_PAYMENT': 'Inasubiri Malipo', 'unpaid': 'Haijalipwa', 'partial': 'Sehemu', 'paid': 'Imeilipwa',
  'active': 'Hai', 'inactive': 'Isiyo Hai',
};

function rt(lang, str) { return lang === 'sw' ? (SW[str] || str) : str; }

// Professional single-page cover/header drawn at the top of every report.
function drawCover(doc, business, title, ptext, lang = 'en') {
  doc.__lang = lang;
  const right = RIGHT(doc);
  // Top accent bar
  doc.rect(0, 0, doc.page.width, 6).fill(BRAND);
  // Logo mark
  doc.roundedRect(LEFT, 22, 38, 38, 9).fill(BRAND);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20);
  doc.text((business?.name || 'U').trim().charAt(0).toUpperCase(), LEFT + 13, 31);
  // Business name + contact
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(13.5);
  doc.text(business?.name || 'Business', LEFT + 52, 25, { width: 250 });
  doc.fillColor(MUTED).font('Helvetica').fontSize(8);
  const contact = [business?.phone, business?.description].filter(Boolean).join('   •   ');
  if (contact) doc.text(contact, LEFT + 52, 42, { width: 250 });
  // Report label + generated date (top right)
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8).text(rt(lang, 'REPORT'), right - 170, 26, { width: 170, align: 'right' });
  doc.fillColor(INK).font('Helvetica').fontSize(8).text(rt(lang, 'Generated ') + new Date().toLocaleDateString(), right - 170, 38, { width: 170, align: 'right' });
  // Title
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(23).text(rt(lang, title), LEFT, 72, { width: right - LEFT });
  // Period pill
  const pillText = ptext || 'All Time';
  doc.font('Helvetica').fontSize(9);
  const pw = doc.widthOfString(pillText) + 26;
  doc.roundedRect(LEFT, 106, pw, 22, 11).fillAndStroke('#e7f3ec', BRAND);
  doc.fillColor(BRAND_DARK).font('Helvetica-Bold').fontSize(9).text(pillText, LEFT + 13, 112);
  // Divider
  doc.moveTo(LEFT, 144).lineWidth(1).stroke(LINE);
  doc.y = 158;
}

// Footer for single-page reports.
function drawFooterBar(doc, business, lang = 'en') {
  const fy = doc.page.height - 58;
  doc.moveTo(LEFT, fy - 8).lineWidth(0.5).stroke(LINE);
  doc.fillColor(MUTED).font('Helvetica').fontSize(8);
  doc.text(rt(lang, 'Generated by UZANITE'), LEFT, fy);
  doc.text(business?.name || 'Business', RIGHT(doc) - 200, fy, { width: 200, align: 'right' });
}

// Compact header drawn automatically on continuation pages of the Full Report.
function setupPageChrome(doc, business, title, ptext, lang = 'en') {
  doc.on('pageAdded', () => {
    const right = RIGHT(doc);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(10);
    doc.text(`${business?.name || 'Business'}  —  ${rt(lang, title)}`, LEFT, 34, { width: right - LEFT });
    doc.fillColor(MUTED).font('Helvetica').fontSize(8);
    doc.text(ptext, LEFT, 48, { width: right - LEFT });
    doc.moveTo(LEFT, 60).lineWidth(1).stroke(BRAND);
    doc.y = 74;
  });
}

// Horizontal row of summary cards with light-gray backgrounds.
function drawSummaryRow(doc, cards, lang = doc.__lang) {
  const left = LEFT;
  const right = RIGHT(doc);
  const width = right - left;
  const gap = 10;
  const count = cards.length;
  const w = (width - gap * (count - 1)) / count;
  const h = 52;
  const y = doc.y;
  cards.forEach((c, i) => {
    const x = left + i * (w + gap);
    doc.roundedRect(x, y, w, h, 6).fillAndStroke(LIGHT, LINE);
    doc.roundedRect(x, y, 4, h, 2).fill(c.accent || BRAND);
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7.5);
    doc.text(String(rt(lang, c.label)).toUpperCase(), x + 14, y + 8, { width: w - 20 });
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(14.5);
    doc.text(String(c.value), x + 14, y + 21, { width: w - 20 });
  });
  doc.y = y + h + 16;
}

// Simple vertical bar chart.
function drawBarChart(doc, series, title, lang = doc.__lang) {
  if (!series || series.length === 0) return;
  const left = LEFT;
  const width = RIGHT(doc) - left;
  const chartH = 78;
  const baseY = doc.y + chartH;
  const maxVal = Math.max(...series.map((s) => s.value), 1);
  const n = series.length;
  const gap = n > 1 ? Math.min(12, width / n / 3) : 0;
  const bw = (width - gap * (n - 1)) / n;
  if (title) {
    doc.fillColor(BRAND_DARK).font('Helvetica-Bold').fontSize(10);
    doc.text(rt(lang, title), left, doc.y, { width });
    doc.y += 15;
  }
  doc.moveTo(left, baseY).lineWidth(0.5).stroke(LINE);
  series.forEach((s, i) => {
    const h = maxVal ? (s.value / maxVal) * (chartH - 20) : 0;
    const x = left + i * (bw + gap);
    if (h > 0) doc.roundedRect(x, baseY - h, bw, h, 2).fill(BRAND);
    doc.fillColor(MUTED).font('Helvetica').fontSize(7);
    doc.text(String(rt(lang, s.label)), x, baseY + 5, { width: bw, align: 'center' });
    if (s.value) {
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(7);
      doc.text(String(s.value), x, baseY - h - 11, { width: bw, align: 'center' });
    }
  });
  doc.y = baseY + 20;
}

// Data table with zebra striping and aligned columns. Stays on the current page
// (does not add pages) so each single report fits exactly one page.
function drawTable(doc, columns, rows, opts = {}, lang = doc.__lang) {
  const left = LEFT;
  const right = RIGHT(doc);
  const width = right - left;
  const padX = 8;
  const headerH = opts.headerH || 24;
  const rowH = opts.rowH || 20;
  const bottomLimit = doc.page.height - 62;
  const fs = opts.fontSize || 9;
  const align = opts.align || {};
  const maxRows = opts.maxRows || Infinity;
  const total = columns.reduce((s, c) => s + (c.w || 1), 0);
  const colW = columns.map((c) => ((c.w || 1) / total) * width);

  const drawHeaderRow = () => {
    const hy = doc.y;
    doc.rect(left, hy, width, headerH).fill(BRAND_DARK);
    let x = left;
    columns.forEach((c, i) => {
      const w = colW[i];
      const a = align[c.key] || 'left';
      const tx = a === 'right' ? x + w - padX : x + padX;
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(fs);
      doc.text(String(rt(lang, c.label)), tx, hy + (headerH - fs) / 2, { width: w - padX * 2, align: a });
      x += w;
    });
    doc.y = hy + headerH;
  };

  let data = rows;
  let more = 0;
  if (data.length > maxRows) { more = data.length - maxRows; data = data.slice(0, maxRows); }

  drawHeaderRow();
  data.forEach((row, ri) => {
    if (doc.y + rowH > bottomLimit) return;
    const rowY = doc.y;
    const bg = ri % 2 === 1 ? ZEBRA : '#ffffff';
    doc.rect(left, rowY, width, rowH).fill(bg);
    doc.moveTo(left, rowY + rowH).lineWidth(0.4).stroke(LINE);
    let x = left;
    columns.forEach((c, i) => {
      const w = colW[i];
      const a = align[c.key] || 'left';
      const tx = a === 'right' ? x + w - padX : x + padX;
      doc.fillColor(INK).font('Helvetica').fontSize(fs);
      doc.text(String(row[c.key] != null ? row[c.key] : ''), tx, rowY + (rowH - fs) / 2, { width: w - padX * 2, align: a });
      x += w;
    });
    doc.y = rowY + rowH;
  });
  if (more > 0) {
    doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(fs);
    doc.text(`… and ${more} more`, left + padX, doc.y + 4);
    doc.y += rowH;
  }
  doc.y += 10;
}

// Section header used to separate parts of the Full Report.
function drawSectionHeader(doc, title, lang = doc.__lang) {
  if (doc.y > doc.page.height - 130) doc.addPage();
  doc.fillColor(BRAND_DARK).font('Helvetica-Bold').fontSize(15);
  doc.text(rt(lang, title), LEFT, doc.y);
  doc.moveTo(LEFT, doc.y + 22).lineWidth(1.5).stroke(BRAND);
  doc.y += 34;
}

// Footer pass: page numbers + branding on every page. Call before doc.end().
function finalizeFooters(doc, business, lang = 'en') {
  const range = doc.bufferedPageRange();
  const total = range.count;
  for (let i = range.start; i < range.start + total; i++) {
    if (i === range.start) continue; // skip the branded cover page
    doc.switchToPage(i);
    const fy = doc.page.height - 58;
    doc.moveTo(LEFT, fy - 8).lineWidth(0.5).stroke(LINE);
    doc.fillColor(MUTED).font('Helvetica').fontSize(8);
    doc.text(rt(lang, 'Generated by UZANITE'), LEFT, fy);
    doc.text(`${rt(lang, 'Page')} ${i + 1} ${rt(lang, 'of')} ${total}`, RIGHT(doc) - 100, fy, { width: 100, align: 'right' });
  }
}

// ── Dynamic branded front cover (green theme) ──
const COVER_GREEN_DARK = '#0f5132';
const COVER_GREEN = '#198754';
const COVER_TEAL = '#20c997';
const COVER_INK = '#0b1f17';
const COVER_MUTED = '#5b6b63';
const COVER_ACCENT = '#0f766e';

// reportType -> cover title + eyebrow + subtitle (section 2 of the spec)
const coverConfig = {
  full:           { title: 'FULL REPORT', eyebrow: 'Business Overview', subtitle: 'Complete business performance summary' },
  orders:         { title: 'ORDER REPORT', eyebrow: 'Sales', subtitle: 'Orders & revenue performance' },
  products:       { title: 'PRODUCTS REPORT', eyebrow: 'Inventory', subtitle: 'Stock & product summary' },
  expenses:       { title: 'EXPENSES REPORT', eyebrow: 'Spending', subtitle: 'Expense breakdown' },
  purchases:      { title: 'PURCHASES REPORT', eyebrow: 'Procurement', subtitle: 'Purchase & supplier summary' },
  debts:          { title: 'DEBTS REPORT', eyebrow: 'Debt Collection', subtitle: 'Outstanding debts & recovery' },
  staff:          { title: 'STAFF REPORT', eyebrow: 'Team', subtitle: 'Staff & activity summary' },
  dashboard:      { title: 'DASHBOARD REPORT', eyebrow: 'Live', subtitle: 'Real-time performance snapshot' },
  business:       { title: 'BUSINESS REPORT', eyebrow: 'Profile', subtitle: 'Company profile & health' },
  contacts:       { title: 'CONTACTS REPORT', eyebrow: 'Audience', subtitle: 'Customer contacts summary' },
  notifications:  { title: 'NOTIFICATIONS REPORT', eyebrow: 'Alerts', subtitle: 'Notification activity' },
  'recycle-bin':  { title: 'RECYCLE BIN REPORT', eyebrow: 'Deleted', subtitle: 'Recycle bin summary' },
};

// Map the route's `period` value to the 4 canonical filter types (section 3).
function coverFilterType(period) {
  if (['daily', 'weekly', 'monthly', 'annually'].includes(period)) return period;
  return 'all';
}

// Period label text based on the selected filter (section 3 of the spec).
function coverPeriodLabel(filterType, dateRange, lang = 'en') {
  const ref = (dateRange && dateRange.end) ? new Date(dateRange.end) : new Date();
  const locale = lang === 'sw' ? 'sw-TZ' : 'en-US';
  const f = (d, o) => d.toLocaleDateString(locale, o);
  switch (filterType) {
    case 'daily': return f(ref, { day: 'numeric', month: 'long', year: 'numeric' });
    case 'weekly': {
      const s = new Date(ref); s.setDate(ref.getDate() - 6);
      return `${f(s, { day: 'numeric' })} – ${f(ref, { day: 'numeric', month: 'long', year: 'numeric' })}`;
    }
    case 'monthly': return f(ref, { month: 'long', year: 'numeric' });
    case 'annually': return `${ref.getFullYear()}`;
    default: return rt(lang, 'All Time');
  }
}

// Cadence descriptor (Daily/Weekly/Monthly/Annually/All Time).
function cadenceLabel(filterType, lang = 'en') {
  switch (filterType) {
    case 'daily': return rt(lang, 'Daily');
    case 'weekly': return rt(lang, 'Weekly');
    case 'monthly': return rt(lang, 'Monthly');
    case 'annually': return rt(lang, 'Annually');
    default: return rt(lang, 'All Time');
  }
}

// Friendly report-type descriptor (what this report describes).
const reportTypeName = {
  full: 'Full Business Report', orders: 'Orders Report', products: 'Products Report',
  expenses: 'Expenses Report', purchases: 'Purchases Report', debts: 'Debts Report',
  staff: 'Staff Report', dashboard: 'Dashboard Report', business: 'Business Profile Report',
  contacts: 'Contacts Report', notifications: 'Notifications Report', 'recycle-bin': 'Recycle Bin Report',
};
function reportTypeLabel(reportType, lang = 'en') {
  return rt(lang, reportTypeName[reportType] || reportTypeName.full);
}

// Tenant brand mark: rounded square with the business initial.
// (No logo asset exists in the data model; a real business.logo could be
//  embedded later via doc.image with this badge as the fallback.)
// bg/fg let the mark invert on a dark sidebar.
function drawTenantMark(doc, x, y, s, business, bg = COVER_GREEN, fg = '#ffffff') {
  const initial = (business?.name || 'U').trim().charAt(0).toUpperCase() || 'U';
  doc.roundedRect(x, y, s, s, s * 0.22).fill(bg);
  doc.fillColor(fg).font('Helvetica-Bold').fontSize(s * 0.5);
  doc.text(initial, x, y + s * 0.26, { width: s, align: 'center' });
}

// UZANITE mark: rounded pill with the "UZANITE" wordmark (mirrors UzerLogo.jsx).
function drawUzerMark(doc, x, y, h, bg = COVER_GREEN, fg = '#ffffff') {
  const w = h * 2.7;
  doc.roundedRect(x, y, w, h, h * 0.32).fill(bg);
  doc.fillColor(fg).font('Helvetica-Bold').fontSize(h * 0.5);
  doc.text('UZANITE', x, y + h * 0.27, { width: w, align: 'center' });
  return w;
}

// Report category word for the stacked cover title (line 1 of the title block).
const reportCategory = {
  full: 'FULL', orders: 'ORDER', products: 'PRODUCT', expenses: 'EXPENSES',
  purchases: 'PURCHASE', debts: 'DEBT', staff: 'STAFF', dashboard: 'DASHBOARD',
  business: 'BUSINESS', contacts: 'CONTACTS', notifications: 'NOTIFICATIONS', 'recycle-bin': 'RECYCLE BIN',
};

// Vertical flowing wave/ribbon graphic on the right side (~45% width).
// Purely decorative and identical across every report type/filter.
function drawCoverWaves(doc) {
  const W = doc.page.width, H = doc.page.height;
  const bands = [
    { base: W * 0.58, amp: 28, color: '#5eead4', op: 0.5, freq: 0.012, phase: 0.0 },
    { base: W * 0.66, amp: 38, color: '#14b8a6', op: 0.55, freq: 0.014, phase: 1.4 },
    { base: W * 0.74, amp: 30, color: COVER_ACCENT, op: 0.7, freq: 0.011, phase: 2.6 },
  ];
  const step = 22;
  bands.forEach((b) => {
    doc.save();
    doc.opacity(b.op).fill(b.color);
    doc.moveTo(b.base + Math.sin(b.phase) * b.amp, 0);
    for (let y = step; y <= H; y += step) {
      const x = b.base + Math.sin(y * b.freq + b.phase) * b.amp;
      doc.lineTo(x, y);
    }
    doc.lineTo(W, H);
    doc.lineTo(W, 0);
    doc.closePath();
    doc.fill();
    doc.restore();
  });
  doc.opacity(1);
}

// Renders the minimalist wave-style cover. Call once at the very start of a report.
// Left negative space holds: header (tenant × UZANITE), stacked title, period line,
// and a generated timestamp footer. No KPIs / extra decoration.
function drawFrontCover(doc, opts) {
  const { reportType = 'full', filterType = 'all', dateRange, business, lang = 'en' } = opts;
  doc.__lang = lang;
  const W = doc.page.width, H = doc.page.height;
  const LM = 56;

  doc.rect(0, 0, W, H).fill('#ffffff');

  // Right-side decorative waves (behind all text).
  drawCoverWaves(doc);

  // ── Top-left header: tenant logo × UZANITE logo + business name ──
  const hY = 50;
  drawTenantMark(doc, LM, hY, 30, business, COVER_GREEN, '#ffffff');
  const divX = LM + 30 + 14;
  doc.moveTo(divX, hY + 4).lineWidth(1).stroke('#cbd5e1');
  drawUzerMark(doc, divX + 12, hY + 2, 26, COVER_GREEN, '#ffffff');
  doc.fillColor('#374151').font('Helvetica-Bold').fontSize(9);
  doc.text((business?.name || 'BUSINESS').toUpperCase(), LM, hY + 42, { characterSpacing: 2, width: W * 0.4 });

  // ── Middle-left title block (stacked: category / REPORT) ──
  const cat = rt(lang, reportCategory[reportType] || reportCategory.full);
  const rep = rt(lang, 'REPORT');
  const catY = 318, repY = 344;
  doc.fillColor('#111827').font('Helvetica').fontSize(16);
  doc.text(cat.toUpperCase(), LM, catY, { characterSpacing: 3 });
  doc.fillColor(COVER_ACCENT).font('Helvetica-Bold').fontSize(48);
  doc.text(rep.toUpperCase(), LM, repY, { characterSpacing: 1 });

  // ── Below title: frequency · period ──
  const freq = cadenceLabel(filterType, lang);
  const period = coverPeriodLabel(filterType, dateRange, lang);
  const sub = (filterType === 'all')
    ? freq.toUpperCase()
    : `${freq.toUpperCase()}  ·  ${period.toUpperCase()}`;
  doc.fillColor('#6b7280').font('Helvetica').fontSize(11);
  doc.text(sub, LM, repY + 62, { characterSpacing: 1.5 });

  // ── Footer: generated date + time ──
  const now = new Date();
  const dPart = now.toLocaleDateString(lang === 'sw' ? 'sw-TZ' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' });
  const tPart = now.toLocaleTimeString(lang === 'sw' ? 'sw-TZ' : 'en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  const fy = H - 64;
  doc.fillColor('#9ca3af').font('Helvetica').fontSize(8);
  doc.text(`${rt(lang, 'Generated:')} ${dPart}, ${tPart}`, LM, fy, { characterSpacing: 1.5 });
}

// ── Summary (live metrics for dashboard widgets) ──
router.get('/summary', async (req, res) => {
  try {
    const bizId = getBusinessId(req);
    const range = getDateRange(req);

    const orderFilter = { businessId: bizId };
    withDate(orderFilter, 'createdAt', range);
    const productFilter = { businessId: bizId, active: { $ne: false } };
    withDate(productFilter, 'createdAt', range);
    const expenseFilter = { businessId: bizId };
    withDate(expenseFilter, 'date', range);
    const purchaseFilter = { businessId: bizId };
    withDate(purchaseFilter, 'date', range);
    const debtFilter = { businessId: bizId };
    withDate(debtFilter, 'createdAt', range);
    const staffFilter = { businessId: bizId };
    withDate(staffFilter, 'createdAt', range);

    const [orders, products, expenses, purchases, debts, staff] = await Promise.all([
      Order.find(orderFilter).lean(),
      Product.find(productFilter).lean(),
      Expense.find(expenseFilter).lean(),
      Purchase.find(purchaseFilter).lean(),
      Debt.find(debtFilter).lean(),
      Staff.find(staffFilter).select('-password').lean(),
    ]);

    const revenue = orders
      .filter((o) => o.status === 'PAID' || o.status === 'DELIVERED')
      .reduce((s, o) => s + (o.total || 0), 0);
    const expenseTotal = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    const purchaseTotal = purchases.reduce((s, p) => s + (p.totalCost || 0), 0);
    const debtTotal = debts.reduce((s, d) => s + (d.amount || 0), 0);
    const debtPaid = debts.reduce((s, d) => s + (d.paidAmount || 0), 0);
    const inventoryValue = products.reduce((s, p) => s + ((p.price || 0) * (p.stock || 0)), 0);

    res.json({
      success: true,
      period: req.query.period || 'alltime',
      range: { start: range.start, end: range.end },
      metrics: {
        orders: { count: orders.length, revenue },
        products: { count: products.length, value: inventoryValue },
        expenses: { count: expenses.length, total: expenseTotal },
        purchases: { count: purchases.length, total: purchaseTotal },
        debts: { count: debts.length, total: debtTotal, remaining: debtTotal - debtPaid },
        staff: { count: staff.length },
      },
    });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// ── Expenses Report ──
router.get('/expenses', async (req, res) => {
  try {
    const period = req.query.period || 'alltime';
    const lang = getLang(req);
    const bizId = getBusinessId(req);
    const range = getDateRange(req);
    const filter = { businessId: bizId };
    withDate(filter, 'date', range);
    const expenses = await Expense.find(filter).sort({ date: -1 }).lean();
    const business = await Business.findOne({ businessId: bizId }).lean();

    const total = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    const catCount = {};
    expenses.forEach(e => { const cat = e.category || 'Other'; catCount[cat] = (catCount[cat] || 0) + 1; });
    const topCategory = Object.entries(catCount).sort((a, b) => b[1] - a[1])[0];
    const avgExpense = expenses.length > 0 ? Math.round(total / expenses.length) : 0;

    const byDay = {};
    expenses.forEach(e => {
      const d = new Date(e.date).toISOString().slice(0, 10);
      byDay[d] = (byDay[d] || 0) + (e.amount || 0);
    });
    let series = Object.entries(byDay).sort().map(([d, v]) => ({ label: fmtDateShort(d), value: v }));
    if (series.length > 14) series = series.slice(-14);

    const doc = new PDFDocument({ margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="expenses-report.pdf"`);
    doc.pipe(res);
    const ptext = periodText(range, period);
    drawFrontCover(doc, { reportType: 'expenses', filterType: coverFilterType(period), dateRange: range, business, lang, summaryStats: [`Total Expenses: ${fmtNum(total)}`, `Average: ${fmtNum(avgExpense)}`, `Top Category: ${topCategory ? topCategory[0] : 'N/A'}`] });
    doc.addPage();
    drawCover(doc, business, 'Expenses Report', ptext, lang);

    drawSummaryRow(doc, [
      { label: 'Total Expenses', value: fmtNum(total) },
      { label: 'Average', value: fmtNum(avgExpense) },
      { label: 'Records', value: fmtNum(expenses.length) },
      { label: 'Top Category', value: topCategory ? topCategory[0].slice(0, 14) : 'N/A' },
    ]);
    drawBarChart(doc, series, 'Daily Spend');

    const rows = expenses.map(e => ({
      date: fmtDateShort(e.date),
      description: (e.description || '—').slice(0, 32),
      category: e.category || 'Other',
      recordedBy: (e.recordedBy || 'Owner').slice(0, 16),
      amount: fmtNum(e.amount),
    }));
    drawTable(doc, [
      { key: 'date', label: 'Date', w: 1.2 },
      { key: 'description', label: 'Description', w: 3.0 },
      { key: 'category', label: 'Category', w: 1.4 },
      { key: 'recordedBy', label: 'Recorded By', w: 1.4 },
      { key: 'amount', label: 'Amount', w: 1.4 },
    ], rows, { align: { amount: 'right' }, rowH: 16, fontSize: 8, maxRows: 20 });

    drawFooterBar(doc, business, lang);
    doc.end();
  } catch (err) { sendServerError(res, err, req); }
});

// ── Orders Report ──
router.get('/orders', async (req, res) => {
  try {
    const period = req.query.period || 'alltime';
    const lang = getLang(req);
    const bizId = getBusinessId(req);
    const range = getDateRange(req);
    const filter = { businessId: bizId };
    withDate(filter, 'createdAt', range);
    const orders = await Order.find(filter).sort({ createdAt: -1 }).lean();
    const business = await Business.findOne({ businessId: bizId }).lean();

    const totalOrders = orders.length;
    const revenue = orders.filter(o => o.status === 'PAID' || o.status === 'DELIVERED').reduce((s, o) => s + (o.total || 0), 0);
    const avgOrder = totalOrders > 0 ? Math.round(revenue / totalOrders) : 0;
    const productCounts = {};
    orders.forEach(o => (o.items || []).forEach(it => {
      const key = it.productName || 'Unknown';
      productCounts[key] = (productCounts[key] || 0) + (it.quantity || 1);
    }));
    const topProduct = Object.entries(productCounts).sort((a, b) => b[1] - a[1])[0];

    const pending = orders.filter(o => o.status === 'PENDING').length;
    const approved = orders.filter(o => o.status === 'APPROVED').length;
    const paid = orders.filter(o => o.status === 'PAID').length;
    const delivered = orders.filter(o => o.status === 'DELIVERED').length;
    const rejected = orders.filter(o => o.status === 'REJECTED').length;

    const doc = new PDFDocument({ margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="orders-report.pdf"`);
    doc.pipe(res);
    const ptext = periodText(range, period);
    drawFrontCover(doc, { reportType: 'orders', filterType: coverFilterType(period), dateRange: range, business, lang, summaryStats: [`Total Orders: ${fmtNum(totalOrders)}`, `Total Revenue: ${fmtNum(revenue)}`, `Top Product: ${topProduct ? topProduct[0] : 'N/A'}`] });
    doc.addPage();
    drawCover(doc, business, 'Orders Report', ptext, lang);

    // KPI row mirroring the Orders page (total + status breakdown)
    drawSummaryRow(doc, [
      { label: 'Total Orders', value: fmtNum(totalOrders) },
      { label: 'Pending', value: fmtNum(pending) },
      { label: 'Approved', value: fmtNum(approved) },
      { label: 'Paid', value: fmtNum(paid) },
      { label: 'Delivered', value: fmtNum(delivered) },
      { label: 'Rejected', value: fmtNum(rejected) },
    ]);

    const rows = orders.map(o => ({
      num: o.orderNumber || '—',
      date: fmtDateShort(o.createdAt),
      customer: (o.customerName || 'Customer').slice(0, 20),
      phone: o.customerPhone || '—',
      status: rt(lang, o.status),
      payment: o.paymentMethod || '—',
      source: o.source || '—',
      recordedBy: (o.recordedBy || 'Owner').slice(0, 14),
      total: fmtNum(o.total),
    }));
    drawTable(doc, [
      { key: 'num', label: 'Order #', w: 1.4 },
      { key: 'date', label: 'Date', w: 1.0 },
      { key: 'customer', label: 'Customer', w: 1.7 },
      { key: 'phone', label: 'Phone', w: 1.1 },
      { key: 'status', label: 'Status', w: 1.2 },
      { key: 'payment', label: 'Payment', w: 1.1 },
      { key: 'source', label: 'Source', w: 1.0 },
      { key: 'recordedBy', label: 'Recorded By', w: 1.4 },
      { key: 'total', label: 'Total', w: 1.1 },
    ], rows, { align: { total: 'right' }, maxRows: 14, rowH: 18, fontSize: 8 });

    drawFooterBar(doc, business, lang);
    doc.end();
  } catch (err) { sendServerError(res, err, req); }
});

// ── Products Report ──
router.get('/products', async (req, res) => {
  try {
    const bizId = getBusinessId(req);
    const period = req.query.period || 'alltime';
    const lang = getLang(req);
    const range = getDateRange(req);
    const filter = { businessId: bizId, active: { $ne: false } };
    const products = await Product.find(filter).sort({ name: 1 }).lean();
    const business = await Business.findOne({ businessId: bizId }).lean();

    const total = products.length;
    const outOfStock = products.filter(p => !p.stock || p.stock <= 0).length;
    const inStock = products.filter(p => (p.stock || 0) > 0).length;
    const lowStock = products.filter(p => (p.stock || 0) > 0 && (p.stock || 0) <= (p.lowStockThreshold || 5)).length;
    const inventoryValue = products.reduce((s, p) => s + ((p.price || 0) * (p.stock || 0)), 0);

    const doc = new PDFDocument({ margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="products-report.pdf"`);
    doc.pipe(res);
    const ptext = periodText(range, period);
    drawFrontCover(doc, { reportType: 'products', filterType: coverFilterType(period), dateRange: range, business, lang, summaryStats: [`Total Products: ${fmtNum(total)}`, `In Stock: ${fmtNum(inStock)}`, `Low Stock: ${fmtNum(lowStock)}`] });
    doc.addPage();
    drawCover(doc, business, 'Products Report', ptext, lang);

    drawSummaryRow(doc, [
      { label: 'Total Products', value: fmtNum(total) },
      { label: 'In Stock', value: fmtNum(inStock) },
      { label: 'Low Stock', value: fmtNum(lowStock) },
      { label: 'Out of Stock', value: fmtNum(outOfStock) },
    ]);

    const rows = products.map(p => ({
      name: (p.name || '—').slice(0, 22),
      price: fmtNum(p.price),
      stock: fmtNum(p.stock),
      low: fmtNum(p.lowStockThreshold || 5),
      value: fmtNum((p.price || 0) * (p.stock || 0)),
      recordedBy: (p.recordedBy || 'Owner').slice(0, 14),
    }));
    drawTable(doc, [
      { key: 'name', label: 'Product', w: 2.6 },
      { key: 'price', label: 'Price', w: 1.2 },
      { key: 'stock', label: 'Stock', w: 1.1 },
      { key: 'low', label: 'Low Stock', w: 1.1 },
      { key: 'value', label: 'Inventory Value', w: 1.6 },
      { key: 'recordedBy', label: 'Recorded By', w: 1.4 },
    ], rows, { align: { price: 'right', stock: 'right', low: 'right', value: 'right' }, rowH: 13, fontSize: 7.5, headerH: 20, maxRows: 35 });

    drawFooterBar(doc, business, lang);
    doc.end();
  } catch (err) { sendServerError(res, err, req); }
});

// ── Contacts Report ──
router.get('/contacts', async (req, res) => {
  try {
    const bizId = getBusinessId(req);
    const period = req.query.period || 'alltime';
    const lang = getLang(req);
    const range = getDateRange(req);
    const filter = { businessId: bizId };
    withDate(filter, 'createdAt', range);
    const contacts = await ChatContact.find(filter).sort({ name: 1 }).lean();
    const business = await Business.findOne({ businessId: bizId }).lean();

    const total = contacts.length;
    const optedIn = contacts.filter(c => !c.unsubscribedAt).length;
    const optedOut = contacts.filter(c => c.unsubscribedAt).length;
    const withMessages = contacts.filter(c => (c.messageCount || 0) > 0).length;
    const totalMessages = contacts.reduce((s, c) => s + (c.messageCount || 0), 0);
    const activeRecent = contacts.filter(c => c.lastMessageAt && new Date(c.lastMessageAt) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)).length;

    const doc = new PDFDocument({ margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="contacts-report.pdf"`);
    doc.pipe(res);
    const ptext = periodText(range, period);
    drawFrontCover(doc, { reportType: 'contacts', filterType: coverFilterType(period), dateRange: range, business, lang, summaryStats: [`Total Contacts: ${fmtNum(total)}`, `Opted In: ${fmtNum(optedIn)}`, `Total Messages: ${fmtNum(totalMessages)}`] });
    doc.addPage();
    drawCover(doc, business, 'Contacts Report', ptext, lang);
    drawSummaryRow(doc, [
      { label: 'Total Contacts', value: fmtNum(total) },
      { label: 'Opted In', value: fmtNum(optedIn) },
      { label: 'Opted Out', value: fmtNum(optedOut) },
      { label: 'Active (30d)', value: fmtNum(activeRecent) },
    ]);
    drawSummaryRow(doc, [
      { label: 'Engaged', value: fmtNum(withMessages) },
      { label: 'Total Messages', value: fmtNum(totalMessages) },
      { label: 'Avg Msg/Contact', value: fmtNum(total > 0 ? Math.round(totalMessages / total) : 0) },
      { label: 'Opt-in Rate', value: `${total > 0 ? Math.round(optedIn / total * 100) : 0}%` },
    ]);
    drawFooterBar(doc, business, lang);
    doc.end();
  } catch (err) { sendServerError(res, err, req); }
});

// ── Purchases Report ──
router.get('/purchases', async (req, res) => {
  try {
    const period = req.query.period || 'alltime';
    const lang = getLang(req);
    const bizId = getBusinessId(req);
    const range = getDateRange(req);
    const filter = { businessId: bizId };
    withDate(filter, 'date', range);
    const purchases = await Purchase.find(filter).sort({ date: -1 }).lean();
    const business = await Business.findOne({ businessId: bizId }).lean();

    const total = purchases.length;
    const grandTotal = purchases.reduce((s, p) => s + (p.totalCost || 0), 0);
    const avgCost = total > 0 ? Math.round(grandTotal / total) : 0;
    const bySupplier = {};
    purchases.forEach(p => { const sup = p.supplier || 'Other'; bySupplier[sup] = (bySupplier[sup] || 0) + (p.totalCost || 0); });
    const topSupplier = Object.entries(bySupplier).sort((a, b) => b[1] - a[1])[0];

    const doc = new PDFDocument({ margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="purchases-report.pdf"`);
    doc.pipe(res);
    const ptext = periodText(range, period);
    drawFrontCover(doc, { reportType: 'purchases', filterType: coverFilterType(period), dateRange: range, business, lang, summaryStats: [`Total Purchases: ${fmtNum(total)}`, `Suppliers: ${fmtNum(Object.keys(bySupplier).length)}`, `Total Spent: ${fmtNum(grandTotal)}`] });
    doc.addPage();
    drawCover(doc, business, 'Purchases Report', ptext, lang);

    drawSummaryRow(doc, [
      { label: 'Total Purchases', value: fmtNum(total) },
      { label: 'Total Spent', value: fmtNum(grandTotal) },
      { label: 'Avg / Purchase', value: fmtNum(avgCost) },
      { label: 'Top Supplier', value: topSupplier ? topSupplier[0].slice(0, 14) : 'N/A' },
    ]);

    const rows = purchases.map(p => ({
      date: fmtDateShort(p.date),
      product: (p.productName || '—').slice(0, 20),
      supplier: (p.supplier || 'Other').slice(0, 16),
      qty: fmtNum(p.quantity),
      total: fmtNum(p.totalCost),
      recordedBy: (p.recordedBy || 'Owner').slice(0, 14),
      expiry: p.expiryDate ? fmtDateShort(p.expiryDate) : '—',
    }));
    drawTable(doc, [
      { key: 'date', label: 'Date', w: 1.1 },
      { key: 'product', label: 'Product', w: 2.0 },
      { key: 'supplier', label: 'Supplier', w: 1.5 },
      { key: 'qty', label: 'Qty', w: 0.8 },
      { key: 'total', label: 'Total Cost', w: 1.3 },
      { key: 'recordedBy', label: 'Recorded By', w: 1.3 },
      { key: 'expiry', label: 'Expiry', w: 1.2 },
    ], rows, { align: { qty: 'right', total: 'right' }, maxRows: 14 });

    drawFooterBar(doc, business, lang);
    doc.end();
  } catch (err) { sendServerError(res, err, req); }
});

// ── Debts Report ──
router.get('/debts', async (req, res) => {
  try {
    const bizId = getBusinessId(req);
    const period = req.query.period || 'alltime';
    const lang = getLang(req);
    const range = getDateRange(req);
    const filter = { businessId: bizId };
    withDate(filter, 'createdAt', range);
    const debts = await Debt.find(filter).sort({ createdAt: -1 }).lean();
    const business = await Business.findOne({ businessId: bizId }).lean();

    const total = debts.length;
    const totalAmount = debts.reduce((s, d) => s + (d.amount || 0), 0);
    const totalPaid = debts.reduce((s, d) => s + (d.paidAmount || 0), 0);
    const totalRemaining = totalAmount - totalPaid;
    const overdue = debts.filter(d => d.dueDate && new Date(d.dueDate) < new Date() && (d.amount || 0) > (d.paidAmount || 0)).length;
    const collectionRate = totalAmount > 0 ? Math.round((totalPaid / totalAmount) * 100) : 0;

    const byStatus = { Unpaid: 0, Partial: 0, Paid: 0 };
    debts.forEach(d => {
      const key = d.status === 'unpaid' ? 'Unpaid' : d.status === 'partial' ? 'Partial' : 'Paid';
      byStatus[key] += (d.amount || 0);
    });
    const statusSeries = [
      { label: 'Unpaid', value: byStatus.Unpaid },
      { label: 'Partial', value: byStatus.Partial },
      { label: 'Paid', value: byStatus.Paid },
    ];

    const doc = new PDFDocument({ margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="debts-report.pdf"`);
    doc.pipe(res);
    const ptext = periodText(range, period);
    drawFrontCover(doc, { reportType: 'debts', filterType: coverFilterType(period), dateRange: range, business, lang, summaryStats: [`Total Debts: ${fmtNum(total)}`, `Debtors: ${new Set(debts.map(d => d.customerName)).size}`, `Overdue: ${overdue}`] });
    doc.addPage();
    drawCover(doc, business, 'Debts Report', ptext, lang);

    drawSummaryRow(doc, [
      { label: 'Total Debts', value: fmtNum(total) },
      { label: 'Total Amount', value: fmtNum(totalAmount) },
      { label: 'Remaining', value: fmtNum(totalRemaining) },
      { label: 'Collection Rate', value: `${collectionRate}%` },
    ]);
    drawBarChart(doc, statusSeries, 'Outstanding by Status');

    const rows = debts.map(d => ({
      customer: (d.customerName || '—').slice(0, 22),
      amount: fmtNum(d.amount),
      paid: fmtNum(d.paidAmount),
      remaining: fmtNum((d.amount || 0) - (d.paidAmount || 0)),
      status: rt(lang, d.status),
      recordedBy: (d.recordedBy || 'Owner').slice(0, 14),
      due: d.dueDate ? fmtDateShort(d.dueDate) : '—',
    }));
    drawTable(doc, [
      { key: 'customer', label: 'Customer', w: 2.4 },
      { key: 'amount', label: 'Amount', w: 1.4 },
      { key: 'paid', label: 'Paid', w: 1.4 },
      { key: 'remaining', label: 'Remaining', w: 1.4 },
      { key: 'status', label: 'Status', w: 1.2 },
      { key: 'recordedBy', label: 'Recorded By', w: 1.4 },
      { key: 'due', label: 'Due', w: 1.2 },
    ], rows, { align: { amount: 'right', paid: 'right', remaining: 'right' }, maxRows: 14 });

    drawFooterBar(doc, business, lang);
    doc.end();
  } catch (err) { sendServerError(res, err, req); }
});

// ── Dashboard Report ──
router.get('/dashboard', async (req, res) => {
  try {
    const period = req.query.period || 'alltime';
    const lang = getLang(req);
    const bizId = getBusinessId(req);
    const range = getDateRange(req);
    const filter = { businessId: bizId };
    withDate(filter, 'createdAt', range);
    const orders = await Order.find(filter).lean();
    const business = await Business.findOne({ businessId: bizId }).lean();

    const totalOrders = orders.length;
    const revenue = orders.filter(o => o.status === 'PAID' || o.status === 'DELIVERED').reduce((s, o) => s + (o.total || 0), 0);
    const pending = orders.filter(o => o.status === 'PENDING').length;
    const approved = orders.filter(o => o.status === 'APPROVED').length;
    const pendingPayment = orders.filter(o => o.status === 'PENDING_PAYMENT').length;
    const paid = orders.filter(o => o.status === 'PAID').length;
    const delivered = orders.filter(o => o.status === 'DELIVERED').length;
    const rejected = orders.filter(o => o.status === 'REJECTED').length;
    const avgOrder = totalOrders > 0 ? Math.round(revenue / totalOrders) : 0;
    const cashOrders = orders.filter(o => o.paymentMethod === 'cash').length;
    const onlineOrders = orders.filter(o => o.paymentMethod && o.paymentMethod !== 'cash').length;
    const cashRevenue = orders.filter(o => o.paymentMethod === 'cash' && (o.status === 'PAID' || o.status === 'DELIVERED')).reduce((s, o) => s + (o.total || 0), 0);
    const onlineRevenue = orders.filter(o => o.paymentMethod && o.paymentMethod !== 'cash' && (o.status === 'PAID' || o.status === 'DELIVERED')).reduce((s, o) => s + (o.total || 0), 0);
    const completionRate = totalOrders > 0 ? Math.round(delivered / totalOrders * 100) : 0;

    const statusSeries = [
      { label: 'Pending', value: pending },
      { label: 'Approved', value: approved },
      { label: 'Paid', value: paid },
      { label: 'Delivered', value: delivered },
      { label: 'Rejected', value: rejected },
    ];

    const doc = new PDFDocument({ margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="dashboard-report.pdf"`);
    doc.pipe(res);
    const ptext = periodText(range, period);
    drawFrontCover(doc, { reportType: 'dashboard', filterType: coverFilterType(period), dateRange: range, business, lang, summaryStats: [`Total Orders: ${fmtNum(totalOrders)}`, `Revenue: ${fmtNum(revenue)}`, `Completion: ${completionRate}%`] });
    doc.addPage();
    drawCover(doc, business, 'Dashboard Report', ptext, lang);
    drawSummaryRow(doc, [
      { label: 'Total Orders', value: fmtNum(totalOrders) },
      { label: 'Revenue', value: fmtNum(revenue) },
      { label: 'Avg Order', value: fmtNum(avgOrder) },
      { label: 'Completion', value: `${completionRate}%` },
    ]);
    drawBarChart(doc, statusSeries, 'Orders by Status');
    drawSummaryRow(doc, [
      { label: 'Pending', value: fmtNum(pending) },
      { label: 'Approved', value: fmtNum(approved) },
      { label: 'Pending Payment', value: fmtNum(pendingPayment) },
      { label: 'Paid', value: fmtNum(paid) },
    ]);
    drawSummaryRow(doc, [
      { label: 'Delivered', value: fmtNum(delivered) },
      { label: 'Rejected', value: fmtNum(rejected) },
      { label: 'Cash Orders', value: fmtNum(cashOrders) },
      { label: 'Online Orders', value: fmtNum(onlineOrders) },
    ]);
    drawSummaryRow(doc, [
      { label: 'Cash Revenue', value: fmtNum(cashRevenue) },
      { label: 'Online Revenue', value: fmtNum(onlineRevenue) },
    ]);
    drawFooterBar(doc, business, lang);
    doc.end();
  } catch (err) { sendServerError(res, err, req); }
});

// ── Full Report ──
router.get('/full', async (req, res) => {
  try {
    const period = req.query.period || 'alltime';
    const lang = getLang(req);
    const bizId = getBusinessId(req);
    const range = getDateRange(req);
    const orderFilter = { businessId: bizId };
    withDate(orderFilter, 'createdAt', range);
    const orders = await Order.find(orderFilter).lean();
    const expenseFilter = { businessId: bizId };
    withDate(expenseFilter, 'date', range);
    const purchaseFilter = { businessId: bizId };
    withDate(purchaseFilter, 'date', range);
    const debtFilter = { businessId: bizId };
    withDate(debtFilter, 'createdAt', range);
    const productsCount = await Product.countDocuments({ businessId: bizId, active: { $ne: false } });
    const productsAll = await Product.find({ businessId: bizId, active: { $ne: false } }).lean();
    const expenses = await Expense.find(expenseFilter).lean();
    const contacts = await ChatContact.countDocuments({ businessId: bizId });
    const debts = await Debt.find(debtFilter).lean();
    const purchases = await Purchase.find(purchaseFilter).lean();
    const staff = await Staff.find({ businessId: bizId }).select('-password').lean();
    const business = await Business.findOne({ businessId: bizId }).lean();

    const totalOrders = orders.length;
    const revenue = orders.filter(o => o.status === 'PAID' || o.status === 'DELIVERED').reduce((s, o) => s + (o.total || 0), 0);
    const delivered = orders.filter(o => o.status === 'DELIVERED').length;
    const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    const totalPurchases = purchases.reduce((s, p) => s + (p.totalCost || 0), 0);
    const totalDebtAmount = debts.reduce((s, d) => s + (d.amount || 0), 0);
    const totalDebtPaid = debts.reduce((s, d) => s + (d.paidAmount || 0), 0);
    const totalRemaining = totalDebtAmount - totalDebtPaid;
    // Cost of goods sold = sum of (qty * product cost) for paid/delivered orders
    const costMap = {};
    productsAll.forEach(p => { costMap[p._id.toString()] = p.cost || 0; });
    let cogs = 0;
    orders.filter(o => o.status === 'PAID' || o.status === 'DELIVERED').forEach(o => (o.items || []).forEach(item => {
      if (item.productId) cogs += (item.quantity || 1) * (costMap[item.productId.toString()] || 0);
    }));
    const profit = revenue - cogs - totalExpenses;
    const avgOrder = totalOrders > 0 ? Math.round(revenue / totalOrders) : 0;
    const lowStock = productsAll.filter(p => (p.stock || 0) > 0 && (p.stock || 0) <= (p.lowStockThreshold || 5)).length;
    const inventoryValue = productsAll.reduce((s, p) => s + ((p.price || 0) * (p.stock || 0)), 0);
    const completionRate = totalOrders > 0 ? Math.round(delivered / totalOrders * 100) : 0;

    // Dashboard-style breakdown (status + cash/online) for the KPI/charts section.
    const pending = orders.filter(o => o.status === 'PENDING').length;
    const approved = orders.filter(o => o.status === 'APPROVED').length;
    const paid = orders.filter(o => o.status === 'PAID').length;
    const rejected = orders.filter(o => o.status === 'REJECTED').length;
    const statusSeries = [
      { label: 'Pending', value: pending },
      { label: 'Approved', value: approved },
      { label: 'Paid', value: paid },
      { label: 'Delivered', value: delivered },
      { label: 'Rejected', value: rejected },
    ];
    const cashOrders = orders.filter(o => o.paymentMethod === 'cash').length;
    const onlineOrders = orders.filter(o => o.paymentMethod && o.paymentMethod !== 'cash').length;
    const cashRevenue = orders.filter(o => o.paymentMethod === 'cash' && (o.status === 'PAID' || o.status === 'DELIVERED')).reduce((s, o) => s + (o.total || 0), 0);
    const onlineRevenue = orders.filter(o => o.paymentMethod && o.paymentMethod !== 'cash' && (o.status === 'PAID' || o.status === 'DELIVERED')).reduce((s, o) => s + (o.total || 0), 0);

    // Per-section KPI aggregates for the Full Report content pages.
    const outOfStock = productsAll.filter(p => (p.stock || 0) <= 0).length;
    const inStock = productsAll.filter(p => (p.stock || 0) > 0).length;
    const avgExpense = expenses.length ? Math.round(totalExpenses / expenses.length) : 0;
    const catCounts = {}; expenses.forEach(e => { const k = e.category || 'Other'; catCounts[k] = (catCounts[k] || 0) + 1; });
    const topCategory = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0];
    const grandTotal = purchases.reduce((s, p) => s + (p.totalCost || 0), 0);
    const supCounts = {}; purchases.forEach(p => { const k = p.supplier || 'Other'; supCounts[k] = (supCounts[k] || 0) + 1; });
    const topSupplier = Object.entries(supCounts).sort((a, b) => b[1] - a[1])[0];
    const avgCost = purchases.length ? Math.round(grandTotal / purchases.length) : 0;
    const overdue = debts.filter(d => (d.status === 'unpaid' || d.status === 'partial') && d.dueDate && new Date(d.dueDate) < new Date()).length;
    const debtors = new Set(debts.map(d => d.customerName)).size;
    const activeStaff = staff.filter(s => s.status === 'active').length;
    const inactiveStaff = staff.length - activeStaff;
    const avgPerms = staff.length ? Math.round(staff.reduce((s, st) => s + (st.permissions || []).length, 0) / staff.length) : 0;

    const doc = new PDFDocument({ margin: 40, bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="full-report.pdf"`);
    doc.pipe(res);
    const ptext = periodText(range, period);
    drawFrontCover(doc, { reportType: 'full', filterType: coverFilterType(period), dateRange: range, business, lang, summaryStats: [`Total Orders: ${fmtNum(totalOrders)}`, `Total Expenses: ${fmtNum(totalExpenses)}`, `Net Profit: ${fmtNum(profit)}`] });
    doc.addPage();
    drawCover(doc, business, 'Full Business Report', ptext, lang);
    setupPageChrome(doc, business, 'Full Business Report', ptext, lang);

    // ── Dashboard KPIs + charts (shown before the table of contents) ──
    drawSummaryRow(doc, [
      { label: 'Total Orders', value: fmtNum(totalOrders) },
      { label: 'Revenue', value: fmtNum(revenue) },
      { label: 'Net Profit', value: fmtNum(profit) },
      { label: 'Completion', value: `${completionRate}%` },
    ]);
    drawSummaryRow(doc, [
      { label: 'Expenses', value: fmtNum(totalExpenses) },
      { label: 'Purchases', value: fmtNum(totalPurchases) },
      { label: 'Debt Remaining', value: fmtNum(totalRemaining) },
      { label: 'Inventory Value', value: fmtNum(inventoryValue) },
    ]);
    drawBarChart(doc, statusSeries, 'Orders by Status');
    drawBarChart(doc, [
      { label: 'Revenue', value: revenue },
      { label: 'Expenses', value: totalExpenses },
      { label: 'Purchases', value: totalPurchases },
    ], 'Revenue vs Spend');
    drawSummaryRow(doc, [
      { label: 'Cash Orders', value: fmtNum(cashOrders) },
      { label: 'Online Orders', value: fmtNum(onlineOrders) },
      { label: 'Cash Revenue', value: fmtNum(cashRevenue) },
      { label: 'Online Revenue', value: fmtNum(onlineRevenue) },
    ]);

    // Table of contents (page 2)
    doc.addPage();
    const tocPage = doc.bufferedPageRange().count - 1;
    const sections = [];
    const startSection = (title, cards) => {
      doc.addPage();
      sections.push({ title, page: doc.bufferedPageRange().count });
      drawSectionHeader(doc, title);
      if (cards && cards.length) drawSummaryRow(doc, cards);
    };

    startSection('Orders', [
      { label: 'Total Orders', value: fmtNum(totalOrders) },
      { label: 'Revenue', value: fmtNum(revenue) },
      { label: 'Paid Orders', value: fmtNum(paid) },
      { label: 'Pending', value: fmtNum(pending) },
    ]);
    drawTable(doc, [
      { key: 'order', label: 'Order', w: 2.0 }, { key: 'customer', label: 'Customer', w: 2.6 },
      { key: 'status', label: 'Status', w: 1.6 }, { key: 'total', label: 'Total', w: 1.8 },
    ], orders.slice(0, 22).map(o => ({
      order: (o.orderNumber || '—').slice(0, 16), customer: (o.customerName || '—').slice(0, 22),
      status: rt(lang, o.status), total: fmtNum(o.total),
    })), { align: { total: 'right' }, maxRows: 22, rowH: 16, fontSize: 8 });

    startSection('Products', [
      { label: 'Total Products', value: fmtNum(productsAll.length) },
      { label: 'In Stock', value: fmtNum(inStock) },
      { label: 'Out of Stock', value: fmtNum(outOfStock) },
      { label: 'Inventory Value', value: fmtNum(inventoryValue) },
    ]);
    drawTable(doc, [
      { key: 'name', label: 'Product', w: 3.0 }, { key: 'price', label: 'Price', w: 1.8 },
      { key: 'cost', label: 'Cost', w: 1.8 }, { key: 'stock', label: 'Stock', w: 1.4 },
    ], productsAll.slice(0, 22).map(p => ({
      name: (p.name || '—').slice(0, 30), price: fmtNum(p.price), cost: fmtNum(p.cost), stock: fmtNum(p.stock),
    })), { align: { price: 'right', cost: 'right', stock: 'right' }, maxRows: 22, rowH: 16, fontSize: 8 });

    startSection('Expenses', [
      { label: 'Total Expenses', value: fmtNum(totalExpenses) },
      { label: 'Average', value: fmtNum(avgExpense) },
      { label: 'Records', value: fmtNum(expenses.length) },
      { label: 'Top Category', value: topCategory ? topCategory[0].slice(0, 14) : 'N/A' },
    ]);
    drawTable(doc, [
      { key: 'date', label: 'Date', w: 1.4 }, { key: 'desc', label: 'Description', w: 3.4 },
      { key: 'category', label: 'Category', w: 1.8 }, { key: 'amount', label: 'Amount', w: 1.4 },
    ], expenses.slice(0, 22).map(e => ({
      date: fmtDateShort(e.date), desc: (e.description || '—').slice(0, 34),
      category: (e.category || 'Other').slice(0, 18), amount: fmtNum(e.amount),
    })), { align: { amount: 'right' }, maxRows: 22, rowH: 16, fontSize: 8 });

    startSection('Purchases', [
      { label: 'Total Purchases', value: fmtNum(purchases.length) },
      { label: 'Total Spent', value: fmtNum(grandTotal) },
      { label: 'Avg / Purchase', value: fmtNum(avgCost) },
      { label: 'Top Supplier', value: topSupplier ? topSupplier[0].slice(0, 14) : 'N/A' },
    ]);
    drawTable(doc, [
      { key: 'date', label: 'Date', w: 1.4 }, { key: 'product', label: 'Product', w: 2.6 },
      { key: 'supplier', label: 'Supplier', w: 2.0 }, { key: 'total', label: 'Total', w: 1.6 },
    ], purchases.slice(0, 22).map(p => ({
      date: fmtDateShort(p.date), product: (p.productName || '—').slice(0, 24),
      supplier: (p.supplier || 'Other').slice(0, 18), total: fmtNum(p.totalCost),
    })), { align: { total: 'right' }, maxRows: 22, rowH: 16, fontSize: 8 });

    startSection('Debts', [
      { label: 'Total Debt', value: fmtNum(totalDebtAmount) },
      { label: 'Collected', value: fmtNum(totalDebtPaid) },
      { label: 'Outstanding', value: fmtNum(totalRemaining) },
      { label: 'Overdue', value: fmtNum(overdue) },
    ]);
    drawTable(doc, [
      { key: 'customer', label: 'Customer', w: 2.6 }, { key: 'amount', label: 'Amount', w: 1.6 },
      { key: 'paid', label: 'Paid', w: 1.6 }, { key: 'remaining', label: 'Remaining', w: 1.6 }, { key: 'status', label: 'Status', w: 1.2 },
    ], debts.slice(0, 22).map(d => ({
      customer: (d.customerName || '—').slice(0, 24), amount: fmtNum(d.amount), paid: fmtNum(d.paidAmount),
      remaining: fmtNum((d.amount || 0) - (d.paidAmount || 0)), status: rt(lang, d.status),
    })), { align: { amount: 'right', paid: 'right', remaining: 'right' }, maxRows: 22, rowH: 16, fontSize: 8 });

    startSection('Staff', [
      { label: 'Total Staff', value: fmtNum(staff.length) },
      { label: 'Active', value: fmtNum(activeStaff) },
      { label: 'Inactive', value: fmtNum(inactiveStaff) },
      { label: 'Avg Permissions', value: fmtNum(avgPerms) },
    ]);
    drawTable(doc, [
      { key: 'name', label: 'Name', w: 2.4 }, { key: 'role', label: 'Role', w: 2.0 },
      { key: 'perms', label: 'Permissions', w: 1.6 }, { key: 'status', label: 'Status', w: 1.6 },
    ], staff.slice(0, 22).map(s => ({
      name: (s.name || '—').slice(0, 24), role: s.role || 'staff',
      perms: (s.permissions || []).length, status: rt(lang, s.status),
    })), { align: { perms: 'right' }, maxRows: 22, rowH: 16, fontSize: 8 });

    // Render TOC now that page numbers are known
    doc.switchToPage(tocPage);
    doc.fontSize(15).font('Helvetica-Bold').fillColor('#111').text('Contents', 40, 120);
    doc.moveDown(1);
    doc.font('Helvetica').fontSize(11).fillColor('#222');
    const tocStartY = doc.y + 6;
    let ty = tocStartY;
    const tocX = 40;
    const tocRight = doc.page.width - 40;
    sections.forEach((s, i) => {
      const label = `${i + 1}.  ${s.title}`;
      doc.fontSize(11).font('Helvetica').fillColor('#222');
      doc.text(label, tocX, ty, { continued: false, width: tocRight - tocX - 40 });
      const labelW = doc.widthOfString(label);
      const pageStr = String(s.page);
      const pageW = doc.widthOfString(pageStr);
      doc.font('Helvetica-Bold').fillColor('#177d54');
      doc.text(pageStr, tocRight - pageW, ty);
      doc.strokeColor('#ccc').lineWidth(0.5);
      doc.moveTo(tocX + labelW + 6, ty + 7).lineTo(tocRight - pageW - 6, ty + 7).stroke();
      ty += 26;
    });

    finalizeFooters(doc, business, lang);
    doc.end();
  } catch (err) { sendServerError(res, err, req); }
});

// ── Recycle Bin Report ──
router.get('/recycle-bin', async (req, res) => {
  try {
    const bizId = getBusinessId(req);
    const period = req.query.period || 'alltime';
    const lang = getLang(req);
    const range = getDateRange(req);
    const deletedQuery = { businessId: bizId, deletedAt: { $ne: null } };
    withDate(deletedQuery, 'deletedAt', range);

    const [products, orders, contacts, notifications] = await Promise.all([
      Product.find(deletedQuery).lean(),
      Order.find(deletedQuery).lean(),
      ChatContact.find(deletedQuery).lean(),
      Notification.find(deletedQuery).lean(),
    ]);

    const totalDeleted = products.length + orders.length + contacts.length + notifications.length;
    const oldestItem = (() => {
      const allDates = [
        ...products.map(p => p.deletedAt),
        ...orders.map(o => o.deletedAt),
        ...contacts.map(c => c.deletedAt),
        ...notifications.map(n => n.deletedAt),
      ].filter(Boolean).sort((a, b) => new Date(a) - new Date(b));
      return allDates.length > 0 ? allDates[0] : null;
    })();
    const deletedSeries = [
      { label: 'Products', value: products.length },
      { label: 'Orders', value: orders.length },
      { label: 'Contacts', value: contacts.length },
      { label: 'Notifications', value: notifications.length },
    ];

    const doc = new PDFDocument({ margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="recycle-bin-report.pdf"`);
    doc.pipe(res);
    const business = await Business.findOne({ businessId: bizId }).lean();
    const ptext = periodText(range, period);
    drawFrontCover(doc, { reportType: 'recycle-bin', filterType: coverFilterType(period), dateRange: range, business, lang, summaryStats: [`Total Deleted: ${fmtNum(totalDeleted)}`, `Products: ${fmtNum(products.length)}`, `Orders: ${fmtNum(orders.length)}`] });
    doc.addPage();
    drawCover(doc, business, 'Recycle Bin Report', ptext, lang);
    drawSummaryRow(doc, [
      { label: 'Total Deleted', value: fmtNum(totalDeleted) },
      { label: 'Products', value: fmtNum(products.length) },
      { label: 'Orders', value: fmtNum(orders.length) },
      { label: 'Contacts', value: fmtNum(contacts.length) },
    ]);
    drawSummaryRow(doc, [
      { label: 'Notifications', value: fmtNum(notifications.length) },
      { label: 'Oldest Deletion', value: oldestItem ? fmtDateLong(oldestItem) : 'N/A' },
    ]);
    drawBarChart(doc, deletedSeries, 'Deleted Items by Type');
    drawFooterBar(doc, business, lang);
    doc.end();
  } catch (err) { sendServerError(res, err, req); }
});

// ── Staff Report ──
router.get('/staff', async (req, res) => {
  try {
    const bizId = getBusinessId(req);
    const period = req.query.period || 'alltime';
    const lang = getLang(req);
    const range = getDateRange(req);
    const filter = { businessId: bizId };
    withDate(filter, 'createdAt', range);
    const allStaff = await Staff.find(filter).select('-password').lean();

    const total = allStaff.length;
    const active = allStaff.filter(s => s.status === 'active').length;
    const inactive = total - active;
    const permissionCounts = {};
    allStaff.forEach(s => {
      (s.permissions || []).forEach(p => {
        permissionCounts[p] = (permissionCounts[p] || 0) + 1;
      });
    });
    const mostAssigned = Object.entries(permissionCounts).sort((a, b) => b[1] - a[1])[0];
    const avgPerms = total > 0 ? Math.round(Object.values(permissionCounts).reduce((a, b) => a + b, 0) / total) : 0;

    const doc = new PDFDocument({ margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="staff-report.pdf"`);
    doc.pipe(res);
    const business = await Business.findOne({ businessId: bizId }).lean();
    const ptext = periodText(range, period);
    drawFrontCover(doc, { reportType: 'staff', filterType: coverFilterType(period), dateRange: range, business, lang, summaryStats: [`Total Staff: ${fmtNum(total)}`, `Active: ${fmtNum(active)}`, `Avg Permissions: ${fmtNum(avgPerms)}`] });
    doc.addPage();
    drawCover(doc, business, 'Staff Report', ptext, lang);

    drawSummaryRow(doc, [
      { label: 'Total Staff', value: fmtNum(total) },
      { label: 'Active', value: fmtNum(active) },
      { label: 'Inactive', value: fmtNum(inactive) },
      { label: 'Avg Permissions', value: fmtNum(avgPerms) },
    ]);

    const rows = allStaff.map(s => ({
      name: (s.name || '—').slice(0, 22),
      email: (s.email || '—').slice(0, 30),
      role: s.role || 'staff',
      perms: (s.permissions || []).length,
      status: rt(lang, s.status),
    }));
    drawTable(doc, [
      { key: 'name', label: 'Name', w: 2.2 },
      { key: 'email', label: 'Email', w: 3.0 },
      { key: 'role', label: 'Role', w: 1.4 },
      { key: 'perms', label: 'Permissions', w: 1.2 },
      { key: 'status', label: 'Status', w: 1.2 },
    ], rows, { align: { perms: 'right' }, maxRows: 14 });

    drawFooterBar(doc, business, lang);
    doc.end();
  } catch (err) { sendServerError(res, err, req); }
});

// ── Notifications Report ──
router.get('/notifications', async (req, res) => {
  try {
    const bizId = getBusinessId(req);
    const period = req.query.period || 'alltime';
    const lang = getLang(req);
    const range = getDateRange(req);
    const filter = { businessId: bizId };
    withDate(filter, 'createdAt', range);
    const notifications = await Notification.find(filter).sort({ createdAt: -1 }).lean();

    const total = notifications.length;
    const unread = notifications.filter(n => !n.read).length;
    const read = total - unread;
    const highPriority = notifications.filter(n => n.priority === 'high' || n.priority === 'critical').length;
    const byType = {};
    notifications.forEach(n => { byType[n.type] = (byType[n.type] || 0) + 1; });
    const topType = Object.entries(byType).sort((a, b) => b[1] - a[1])[0];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayCount = notifications.filter(n => new Date(n.createdAt) >= today).length;
    const typeSeries = Object.entries(byType)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, value]) => ({ label: label.replace(/_/g, ' ').slice(0, 14), value }));

    const doc = new PDFDocument({ margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="notifications-report.pdf"`);
    doc.pipe(res);
    const business = await Business.findOne({ businessId: bizId }).lean();
    const ptext = periodText(range, period);
    drawFrontCover(doc, { reportType: 'notifications', filterType: coverFilterType(period), dateRange: range, business, lang, summaryStats: [`Total: ${fmtNum(total)}`, `Unread: ${fmtNum(unread)}`, `High Priority: ${fmtNum(highPriority)}`] });
    doc.addPage();
    drawCover(doc, business, 'Notifications Report', ptext, lang);
    drawSummaryRow(doc, [
      { label: 'Total', value: fmtNum(total) },
      { label: 'Unread', value: fmtNum(unread) },
      { label: 'Read', value: fmtNum(read) },
      { label: 'High Priority', value: fmtNum(highPriority) },
    ]);
    drawSummaryRow(doc, [
      { label: 'Today', value: fmtNum(todayCount) },
      { label: 'Top Type', value: topType ? topType[0].replace(/_/g, ' ') : 'N/A' },
      { label: 'Unique Types', value: fmtNum(Object.keys(byType).length) },
    ]);
    if (typeSeries.length) drawBarChart(doc, typeSeries, 'Notifications by Type');
    drawFooterBar(doc, business, lang);
    doc.end();
  } catch (err) { sendServerError(res, err, req); }
});

// ── Business Report ──
router.get('/business', async (req, res) => {
  try {
    const bizId = getBusinessId(req);
    const period = req.query.period || 'alltime';
    const lang = getLang(req);
    const range = getDateRange(req);
    const business = await Business.findOne({ businessId: bizId }).lean();
    if (!business) return res.status(404).json({ success: false, error: 'Business not found' });

    const orderFilter = { businessId: bizId };
    const expenseFilter = { businessId: bizId };
    const productFilter = { businessId: bizId, active: { $ne: false } };
    const contactFilter = { businessId: bizId };
    withDate(orderFilter, 'createdAt', range);
    withDate(expenseFilter, 'date', range);
    withDate(productFilter, 'createdAt', range);
    withDate(contactFilter, 'createdAt', range);

    const [orders, expenses, products, contacts, staffCount] = await Promise.all([
      Order.find(orderFilter).lean(),
      Expense.find(expenseFilter).lean(),
      Product.find(productFilter).lean(),
      ChatContact.find(contactFilter).lean(),
      Staff.find({ businessId: bizId }).countDocuments(),
    ]);

    const revenue = orders.filter(o => o.status === 'PAID' || o.status === 'DELIVERED').reduce((s, o) => s + (o.total || 0), 0);
    const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    const profit = revenue - totalExpenses;
    const inventoryValue = products.reduce((s, p) => s + ((p.price || 0) * (p.stock || 0)), 0);
    const ptext = periodText(range, period);

    const doc = new PDFDocument({ margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="business-report.pdf"`);
    doc.pipe(res);
    drawFrontCover(doc, { reportType: 'business', filterType: coverFilterType(period), dateRange: range, business, lang, summaryStats: [`Revenue: ${fmtNum(revenue)}`, `Expenses: ${fmtNum(totalExpenses)}`, `Net Profit: ${fmtNum(profit)}`] });
    doc.addPage();
    drawCover(doc, business, 'Business Profile Report', ptext, lang);

    // Business details block
    let by = doc.y + 6;
    const detailRows = [
      [rt(lang, 'Business Name'), business.name || 'N/A'],
      [rt(lang, 'Owner'), business.ownerName || 'N/A'],
      [rt(lang, 'Phone'), business.phone || 'N/A'],
      [rt(lang, 'Currency'), business.currency || 'TZS'],
      [rt(lang, 'Description'), (business.description || 'N/A').slice(0, 80)],
    ];
    detailRows.forEach(([k, v]) => {
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#555').text(k, 40, by, { width: 130 });
      doc.font('Helvetica').fontSize(10).fillColor('#111').text(v, 175, by, { width: doc.page.width - 215 });
      by += 20;
    });
    doc.moveDown(1);

    drawSummaryRow(doc, [
      { label: 'Total Revenue', value: fmtNum(revenue) },
      { label: 'Total Expenses', value: fmtNum(totalExpenses) },
      { label: 'Net Profit', value: fmtNum(profit) },
      { label: 'Inventory Value', value: fmtNum(inventoryValue) },
    ]);
    drawSummaryRow(doc, [
      { label: 'Total Orders', value: fmtNum(orders.length) },
      { label: 'Products', value: fmtNum(products.length) },
      { label: 'Contacts', value: fmtNum(contacts.length) },
      { label: 'Staff Members', value: fmtNum(staffCount) },
    ]);
    drawFooterBar(doc, business, lang);
    doc.end();
  } catch (err) { sendServerError(res, err, req); }
});

// ── CSV / Excel export (full detailed table, no row cap) ──
function csvEscape(v) {
  // Neutralise spreadsheet formula injection: a leading = + - @ (or tab/CR)
  // would otherwise be interpreted as a formula by Excel/Google Sheets.
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
function sendCsv(res, filename, headers, rows) {
  const lines = [headers.map(csvEscape).join(',')];
  for (const r of rows) lines.push(r.map(csvEscape).join(','));
  const csv = '\uFEFF' + lines.join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}
const csvDate = (d) => (d ? new Date(d).toLocaleDateString('en-CA') : '');
const csvNum = (v) => (v == null ? '' : v);

router.get('/:key/csv', async (req, res) => {
  try {
    const key = req.params.key;
    const lang = getLang(req);
    const bizId = getBusinessId(req);
    const range = getDateRange(req);

    switch (key) {
      case 'orders': {
        const filter = { businessId: bizId };
        withDate(filter, 'createdAt', range);
        const orders = await Order.find(filter).sort({ createdAt: -1 }).lean();
        const headers = ['Order #', 'Date', 'Customer', 'Phone', 'Status', 'Payment', 'Source', 'Recorded By', 'Items', 'Total'];
        const rows = orders.map(o => [
          o.orderNumber || '',
          csvDate(o.createdAt),
          o.customerName || '',
          o.customerPhone || '',
          rt(lang, o.status),
          o.paymentMethod || '',
          o.source || '',
          o.recordedBy || '',
          (o.items || []).map(it => `${it.productName} x${it.quantity}`).join('; '),
          csvNum(o.total),
        ]);
        return sendCsv(res, 'orders-report.csv', headers, rows);
      }
      case 'products': {
        const products = await Product.find({ businessId: bizId, active: { $ne: false } }).sort({ name: 1 }).lean();
        const headers = ['Name', 'Barcode', 'Category', 'Price', 'Cost', 'Stock', 'Low Stock Threshold', 'Inventory Value', 'Recorded By'];
        const rows = products.map(p => [
          p.name || '',
          p.barcode || '',
          p.category || '',
          csvNum(p.price),
          csvNum(p.cost),
          csvNum(p.stock),
          csvNum(p.lowStockThreshold ?? 5),
          csvNum((p.price || 0) * (p.stock || 0)),
          p.recordedBy || 'Owner',
        ]);
        return sendCsv(res, 'products-report.csv', headers, rows);
      }
      case 'expenses': {
        const filter = { businessId: bizId };
        withDate(filter, 'date', range);
        const expenses = await Expense.find(filter).sort({ date: -1 }).lean();
        const headers = ['Date', 'Description', 'Category', 'Recorded By', 'Amount'];
        const rows = expenses.map(e => [csvDate(e.date), e.description || '', e.category || 'Other', e.recordedBy || 'Owner', csvNum(e.amount)]);
        return sendCsv(res, 'expenses-report.csv', headers, rows);
      }
      case 'purchases': {
        const filter = { businessId: bizId };
        withDate(filter, 'date', range);
        const purchases = await Purchase.find(filter).sort({ date: -1 }).lean();
        const headers = ['Date', 'Product', 'Supplier', 'Quantity', 'Cost Per Unit', 'Total Cost', 'Recorded By', 'Expiry Date'];
        const rows = purchases.map(p => [
          csvDate(p.date), p.productName || '', p.supplier || '', csvNum(p.quantity), csvNum(p.costPerUnit), csvNum(p.totalCost), p.recordedBy || 'Owner', p.expiryDate ? csvDate(p.expiryDate) : '',
        ]);
        return sendCsv(res, 'purchases-report.csv', headers, rows);
      }
      case 'debts': {
        const filter = { businessId: bizId };
        withDate(filter, 'createdAt', range);
        const debts = await Debt.find(filter).sort({ createdAt: -1 }).lean();
        const headers = ['Customer', 'Phone', 'Amount', 'Paid', 'Remaining', 'Status', 'Recorded By', 'Due Date', 'Created'];
        const rows = debts.map(d => [
          d.customerName || '', d.customerPhone || '', csvNum(d.amount), csvNum(d.paidAmount),
          csvNum((d.amount || 0) - (d.paidAmount || 0)), rt(lang, d.status), d.recordedBy || 'Owner', csvDate(d.dueDate), csvDate(d.createdAt),
        ]);
        return sendCsv(res, 'debts-report.csv', headers, rows);
      }
      case 'staff': {
        const filter = { businessId: bizId };
        withDate(filter, 'createdAt', range);
        const staff = await Staff.find(filter).select('-password').sort({ name: 1 }).lean();
        const headers = ['Name', 'Email', 'Role', 'Permissions', 'Status', 'Last Login', 'Created'];
        const rows = staff.map(s => [
          s.name || '', s.email || '', s.role || 'staff', (s.permissions || []).join('; '),
          rt(lang, s.status), csvDate(s.lastLogin), csvDate(s.createdAt),
        ]);
        return sendCsv(res, 'staff-report.csv', headers, rows);
      }
      case 'full': {
        const orderFilter = { businessId: bizId }; withDate(orderFilter, 'createdAt', range);
        const dateFilter = { businessId: bizId }; withDate(dateFilter, 'date', range);
        const debtFilter = { businessId: bizId }; withDate(debtFilter, 'createdAt', range);
        const staffFilter = { businessId: bizId }; withDate(staffFilter, 'createdAt', range);
        const [orders, products, expenses, purchases, debts, staff] = await Promise.all([
          Order.find(orderFilter).sort({ createdAt: -1 }).lean(),
          Product.find({ businessId: bizId, active: { $ne: false } }).sort({ name: 1 }).lean(),
          Expense.find(dateFilter).sort({ date: -1 }).lean(),
          Purchase.find(dateFilter).sort({ date: -1 }).lean(),
          Debt.find(debtFilter).sort({ createdAt: -1 }).lean(),
          Staff.find(staffFilter).select('-password').sort({ name: 1 }).lean(),
        ]);
        const lines = [];
        const push = (arr) => lines.push(arr.map(csvEscape).join(','));
        push(['ORDERS']);
        push(['Order #', 'Date', 'Customer', 'Phone', 'Status', 'Payment', 'Source', 'Recorded By', 'Items', 'Total']);
        orders.forEach(o => push([o.orderNumber || '', csvDate(o.createdAt), o.customerName || '', o.customerPhone || '', rt(lang, o.status), o.paymentMethod || '', o.source || '', o.recordedBy || '', (o.items || []).map(it => `${it.productName} x${it.quantity}`).join('; '), csvNum(o.total)]));
        push([]);
        push(['PRODUCTS']);
        push(['Name', 'Barcode', 'Category', 'Price', 'Cost', 'Stock', 'Low Stock Threshold', 'Inventory Value', 'Recorded By', 'Expiry Date']);
        products.forEach(p => push([p.name || '', p.barcode || '', p.category || '', csvNum(p.price), csvNum(p.cost), csvNum(p.stock), csvNum(p.lowStockThreshold ?? 5), csvNum((p.price || 0) * (p.stock || 0)), p.recordedBy || 'Owner', p.expiryDate ? csvDate(p.expiryDate) : '']));
        push([]);
        push(['EXPENSES']);
        push(['Date', 'Description', 'Category', 'Recorded By', 'Amount']);
        expenses.forEach(e => push([csvDate(e.date), e.description || '', e.category || 'Other', e.recordedBy || 'Owner', csvNum(e.amount)]));
        push([]);
        push(['PURCHASES']);
        push(['Date', 'Product', 'Supplier', 'Quantity', 'Cost Per Unit', 'Total Cost', 'Recorded By', 'Expiry Date']);
        purchases.forEach(p => push([csvDate(p.date), p.productName || '', p.supplier || '', csvNum(p.quantity), csvNum(p.costPerUnit), csvNum(p.totalCost), p.recordedBy || 'Owner', p.expiryDate ? csvDate(p.expiryDate) : '']));
        push([]);
        push(['DEBTS']);
        push(['Customer', 'Phone', 'Amount', 'Paid', 'Remaining', 'Status', 'Due Date', 'Created']);
        debts.forEach(d => push([d.customerName || '', d.customerPhone || '', csvNum(d.amount), csvNum(d.paidAmount), csvNum((d.amount || 0) - (d.paidAmount || 0)), rt(lang, d.status), csvDate(d.dueDate), csvDate(d.createdAt)]));
        push([]);
        push(['STAFF']);
        push(['Name', 'Email', 'Role', 'Permissions', 'Status', 'Last Login', 'Created']);
        staff.forEach(s => push([s.name || '', s.email || '', s.role || 'staff', (s.permissions || []).join('; '), rt(lang, s.status), csvDate(s.lastLogin), csvDate(s.createdAt)]));
        const csv = '\uFEFF' + lines.join('\r\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="full-report.csv"');
        return res.send(csv);
      }
      default:
        return res.status(400).json({ success: false, error: 'Unknown report key' });
    }
  } catch (err) {
    sendServerError(res, err, req);
  }
});

module.exports = router;
