/* 두레이엔지 업무관리 (ERP) */
(function () {
  'use strict';
  var CFG = window.ERP_CONFIG || {};
  var db = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // ================= 공통 도구 =================
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function won(n) { return (Math.round(Number(n) || 0)).toLocaleString('ko-KR'); }
  function wonU(n) { return won(n) + '원'; }
  function today() { var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
  function ym(d) { return d ? String(d).slice(0, 7) : ''; }
  function yr(d) { return d ? Number(String(d).slice(0, 4)) : 0; }
  function mon(d) { return d ? Number(String(d).slice(5, 7)) : 0; }
  function fmtD(d) { return d ? String(d).slice(2).replace(/-/g, '.') : ''; }
  function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }
  function sum(arr, f) { return arr.reduce(function (t, x) { return t + (Number(f(x)) || 0); }, 0); }
  function parseMoney(v) { var n = String(v || '').replace(/[^0-9]/g, ''); return n ? Number(n) : 0; }
  function toast(t) { var e = $('#toast'); e.textContent = t; e.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(function () { e.classList.remove('show'); }, 2200); }
  function badge(text, cls) { return '<span class="badge ' + cls + '">' + esc(text) + '</span>'; }

  // ================= 데이터 =================
  var TABLES = {
    clients: 'erp_clients', workers: 'erp_workers', jobs: 'erp_jobs', checks: 'erp_job_checks',
    labor: 'erp_labor', expenses: 'erp_expenses', invoices: 'erp_invoices', payments: 'erp_payments'
  };
  var D = {};
  Object.keys(TABLES).forEach(function (k) { D[k] = []; });
  var state = { year: new Date().getFullYear() };

  async function fetchAll(table) {
    var out = [], from = 0, size = 1000;
    for (;;) {
      var r = await db.from(table).select('*').order('created_at', { ascending: false }).range(from, from + size - 1);
      if (r.error) throw r.error;
      out = out.concat(r.data);
      if (r.data.length < size) return out;
      from += size;
    }
  }
  async function loadAll() {
    var keys = Object.keys(TABLES);
    var res = await Promise.all(keys.map(function (k) { return fetchAll(TABLES[k]); }));
    keys.forEach(function (k, i) { D[k] = res[i]; });
  }
  async function reload(key) { D[key] = await fetchAll(TABLES[key]); }

  function byId(key, id) { return D[key].find(function (x) { return x.id === id; }); }
  function clientName(id) { var c = id && byId('clients', id); return c ? c.name : ''; }
  function jobTitle(id) { var j = id && byId('jobs', id); return j ? j.title : ''; }
  function workerName(id) { var w = id && byId('workers', id); return w ? w.name : ''; }

  // 매출·수금 계산
  function paidOf(inv) { return sum(D.payments.filter(function (p) { return p.invoice_id === inv.id; }), function (p) { return p.amount; }); }
  function totalOf(inv) { return (Number(inv.supply) || 0) + (Number(inv.vat) || 0); }
  function balanceOf(inv) { return totalOf(inv) - paidOf(inv); }
  function invStatus(inv) {
    var bal = balanceOf(inv), paid = paidOf(inv);
    if (bal <= 0) return { t: '완납', c: 'b-green' };
    if (inv.due_date && inv.due_date < today()) return { t: '연체', c: 'b-red' };
    if (paid > 0) return { t: '일부 수금', c: 'b-amber' };
    return { t: '미수', c: 'b-blue' };
  }
  function isBill(p) { return p.method === '어음' || p.method === '전자어음'; }
  function openBills() { return D.payments.filter(function (p) { return isBill(p) && !p.bill_cashed; }); }
  function unpaidLabor() { return D.labor.filter(function (l) { return !l.paid; }); }
  function inYear(rows, key) { return rows.filter(function (r) { return yr(r[key]) === state.year; }); }
  function netExp(e) { return (Number(e.amount) || 0) - (Number(e.vat) || 0); }

  var JOB_STATUS = ['예정', '진행중', '완료', '보류'];
  var JOB_STATUS_CLS = { '예정': 'b-blue', '진행중': 'b-amber', '완료': 'b-green', '보류': 'b-gray' };
  var WORK_TYPES = ['세관', '누설검사·진공', '부품교체·수리', '설치', '유지보수', '점검', '기타'];
  var EXP_CATS = ['자재비', '외주비', '식대', '주유·차량', '잡자재', '공구·장비', '영업비', '사무실·통신', '세금·공과금', '기타'];
  var EVIDENCE = ['세금계산서', '카드', '현금영수증', '간이영수증', '없음'];
  var PAY_METHODS = ['카드', '계좌이체', '현금', '어음'];
  var RECV_METHODS = ['계좌이체', '현금', '어음', '전자어음', '카드'];
  var CLIENT_KINDS = ['원청사', '시설관리업체', '건물주', '제조사', '자재 구매처', '외주업체', '기타'];

  // ================= 입력 양식 정의 =================
  var FORMS = {
    clients: { title: '거래처', fields: [
      { k: 'name', l: '거래처 이름', req: 1, full: 1 },
      { k: 'kind', l: '구분', t: 'select', o: CLIENT_KINDS },
      { k: 'manager', l: '담당자' },
      { k: 'phone', l: '연락처', t: 'tel' },
      { k: 'biz_no', l: '사업자등록번호' },
      { k: 'address', l: '주소', full: 1 },
      { k: 'memo', l: '메모', t: 'area', full: 1 }
    ] },
    workers: { title: '인력', fields: [
      { k: 'name', l: '이름', req: 1 },
      { k: 'phone', l: '연락처', t: 'tel' },
      { k: 'daily_wage', l: '기본 일당', t: 'money', help: '출역 입력 때 자동으로 들어가요' },
      { k: 'skill', l: '담당 기술' },
      { k: 'bank', l: '입금 계좌', full: 1 },
      { k: 'active', l: '현재 같이 일함', t: 'bool', def: true },
      { k: 'memo', l: '메모', t: 'area', full: 1 }
    ] },
    jobs: { title: '현장', fields: [
      { k: 'title', l: '현장명', req: 1, full: 1, ph: '예: 홈플러스 영등포점' },
      { k: 'client_id', l: '거래처(발주처)', t: 'ref', ref: 'clients' },
      { k: 'work_type', l: '작업 종류', t: 'select', o: WORK_TYPES },
      { k: 'capacity', l: '장비 용량', ph: '예: 700RT × 3대' },
      { k: 'status', l: '상태', t: 'select', o: JOB_STATUS, def: '예정' },
      { k: 'start_date', l: '시작일', t: 'date', def: today },
      { k: 'end_date', l: '종료일', t: 'date' },
      { k: 'amount', l: '계약 금액(공급가)', t: 'money', full: 1 },
      { k: 'memo', l: '메모', t: 'area', full: 1 }
    ] },
    labor: { title: '출역·인건비', fields: [
      { k: 'work_date', l: '작업일', t: 'date', req: 1, def: today },
      { k: 'worker_id', l: '작업자', t: 'ref', ref: 'workers', req: 1 },
      { k: 'job_id', l: '현장', t: 'ref', ref: 'jobs', full: 1 },
      { k: 'days', l: '공수(일)', t: 'num', def: 1, help: '반나절은 0.5' },
      { k: 'pay', l: '지급액', t: 'money', req: 1, help: '일당 × 공수로 자동 계산' },
      { k: 'paid', l: '지급 완료', t: 'bool' },
      { k: 'paid_date', l: '지급일', t: 'date' },
      { k: 'memo', l: '메모', t: 'area', full: 1 }
    ], hook: function (f, k) {
      if (k === 'worker_id' || k === 'days') {
        var w = byId('workers', f.get('worker_id'));
        if (w && w.daily_wage) f.set('pay', Math.round(w.daily_wage * (Number(f.get('days')) || 1)));
      }
      if (k === 'paid' && f.get('paid') && !f.get('paid_date')) f.set('paid_date', today());
    } },
    expenses: { title: '비용·자재 구매', fields: [
      { k: 'spent_date', l: '날짜', t: 'date', req: 1, def: today },
      { k: 'category', l: '항목', t: 'select', o: EXP_CATS, req: 1, def: '자재비' },
      { k: 'job_id', l: '현장 (공통비면 비움)', t: 'ref', ref: 'jobs', full: 1 },
      { k: 'vendor', l: '구매처·거래처' },
      { k: 'item', l: '품목·내용' },
      { k: 'qty', l: '수량', ph: '예: 2박스' },
      { k: 'amount', l: '금액 (부가세 포함)', t: 'money', req: 1 },
      { k: 'evidence', l: '증빙', t: 'select', o: EVIDENCE, def: '카드' },
      { k: 'vat', l: '부가세 (공제분)', t: 'money', help: '증빙이 세금계산서·카드·현금영수증이면 자동 계산' },
      { k: 'pay_method', l: '결제 방법', t: 'select', o: PAY_METHODS, def: '카드' },
      { k: 'memo', l: '메모', t: 'area', full: 1 }
    ], hook: function (f, k) {
      if (k === 'amount' || k === 'evidence') {
        var ok = ['세금계산서', '카드', '현금영수증'].indexOf(f.get('evidence')) >= 0;
        f.set('vat', ok ? Math.round(parseMoney(f.get('amount')) / 11) : 0);
      }
    } },
    invoices: { title: '매출 (청구·세금계산서)', fields: [
      { k: 'issue_date', l: '발행일', t: 'date', req: 1, def: today },
      { k: 'client_id', l: '거래처', t: 'ref', ref: 'clients', req: 1 },
      { k: 'job_id', l: '현장', t: 'ref', ref: 'jobs', full: 1 },
      { k: 'title', l: '내용', full: 1, ph: '예: 2호기 세관 공사' },
      { k: 'supply', l: '공급가액', t: 'money', req: 1 },
      { k: 'vat', l: '부가세', t: 'money', help: '공급가의 10% 자동' },
      { k: 'tax_invoice', l: '세금계산서 발행함', t: 'bool', def: true },
      { k: 'due_date', l: '입금 약속일', t: 'date' },
      { k: 'memo', l: '메모', t: 'area', full: 1 }
    ], hook: function (f, k) {
      if (k === 'supply' || k === 'tax_invoice') f.set('vat', f.get('tax_invoice') ? Math.round(parseMoney(f.get('supply')) * 0.1) : 0);
      if (k === 'job_id' && !f.get('client_id')) { var j = byId('jobs', f.get('job_id')); if (j && j.client_id) f.set('client_id', j.client_id); }
    }, total: function (f) { return '합계 ' + wonU(parseMoney(f.get('supply')) + parseMoney(f.get('vat'))); } },
    payments: { title: '수금 (입금·어음)', fields: [
      { k: 'paid_date', l: '받은 날', t: 'date', req: 1, def: today },
      { k: 'amount', l: '금액', t: 'money', req: 1 },
      { k: 'method', l: '방법', t: 'select', o: RECV_METHODS, def: '계좌이체' },
      { k: 'bill_due', l: '어음 만기일', t: 'date', help: '어음일 때만' },
      { k: 'bill_cashed', l: '어음 결제(현금화) 완료', t: 'bool' },
      { k: 'memo', l: '메모', t: 'area', full: 1 }
    ] }
  };

  // ================= 입력 팝업 =================
  var dlg = $('#dlg');
  function openDlg() { if (!dlg.open) dlg.showModal(); }
  function closeDlg() { if (dlg.open) dlg.close(); }
  dlg.addEventListener('click', function (e) { if (e.target === dlg || e.target.closest('[data-x]')) closeDlg(); });

  function refOptions(key, cur) {
    var rows = D[key].slice();
    if (key === 'workers') rows = rows.filter(function (w) { return w.active || w.id === cur; });
    if (key === 'jobs') rows.sort(function (a, b) { return (b.start_date || '').localeCompare(a.start_date || ''); });
    else rows.sort(function (a, b) { return (a.name || a.title || '').localeCompare(b.name || b.title || ''); });
    return '<option value="">선택 안 함</option>' + rows.map(function (r) {
      var label = key === 'jobs' ? r.title + (r.start_date ? ' (' + fmtD(r.start_date) + ')' : '') : r.name;
      return '<option value="' + r.id + '"' + (r.id === cur ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('');
  }

  // key: 표 이름, row: 수정할 행(없으면 새로), preset: 기본값, after: 저장 후 실행
  function editForm(key, row, preset, after) {
    var F = FORMS[key];
    var isNew = !row;
    var v = Object.assign({}, row || {});
    F.fields.forEach(function (fd) {
      if (isNew && v[fd.k] == null) v[fd.k] = preset && preset[fd.k] != null ? preset[fd.k] : (typeof fd.def === 'function' ? fd.def() : fd.def);
    });
    var html = '<form id="ef" novalidate><div class="dlg-head"><h3>' + esc(F.title) + (isNew ? ' 추가' : ' 수정') + '</h3><button type="button" class="x" data-x aria-label="닫기">×</button></div><div class="dlg-body">';
    F.fields.forEach(function (fd) {
      var id = 'f-' + fd.k, val = v[fd.k];
      var cls = 'f' + (fd.full || fd.t === 'area' ? ' full' : '') + (fd.t === 'bool' ? ' cb' : '');
      var input;
      if (fd.t === 'select') input = '<select id="' + id + '" name="' + fd.k + '">' + (fd.req ? '' : '<option value="">선택 안 함</option>') + fd.o.map(function (o) { return '<option' + (o === val ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
      else if (fd.t === 'ref') input = '<select id="' + id + '" name="' + fd.k + '">' + refOptions(fd.ref, val) + '</select>';
      else if (fd.t === 'area') input = '<textarea id="' + id + '" name="' + fd.k + '" rows="2">' + esc(val) + '</textarea>';
      else if (fd.t === 'bool') input = '<input id="' + id + '" name="' + fd.k + '" type="checkbox"' + (val ? ' checked' : '') + '>';
      else if (fd.t === 'money') input = '<input id="' + id + '" name="' + fd.k + '" type="text" inputmode="numeric" value="' + (val != null && val !== '' ? won(val) : '') + '" placeholder="0">';
      else if (fd.t === 'date') input = '<input id="' + id + '" name="' + fd.k + '" type="date" value="' + esc(val || '') + '">';
      else if (fd.t === 'num') input = '<input id="' + id + '" name="' + fd.k + '" type="number" step="0.5" min="0.5" value="' + esc(val == null ? '' : val) + '">';
      else input = '<input id="' + id + '" name="' + fd.k + '" type="' + (fd.t === 'tel' ? 'tel' : 'text') + '" value="' + esc(val || '') + '"' + (fd.ph ? ' placeholder="' + esc(fd.ph) + '"' : '') + '>';
      if (fd.t === 'bool') html += '<div class="' + cls + '">' + input + '<label for="' + id + '">' + esc(fd.l) + '</label></div>';
      else html += '<div class="' + cls + '"><label for="' + id + '">' + esc(fd.l) + (fd.req ? ' *' : '') + '</label>' + input + (fd.help ? '<span class="help">' + esc(fd.help) + '</span>' : '') + '</div>';
    });
    if (F.total) html += '<div class="total-line" id="ef-total"></div>';
    html += '<p class="msg err full" id="ef-msg" style="grid-column:1/-1"></p></div><div class="dlg-foot"><div>' + (isNew ? '' : '<button type="button" class="btn danger" id="ef-del">삭제</button>') + '</div><div class="btn-row"><button type="button" class="btn" data-x>취소</button><button type="submit" class="btn primary" id="ef-save">저장</button></div></div></form>';
    $('#dlg-body').innerHTML = html;
    var form = $('#ef');
    var api = {
      get: function (k) { var e = form.elements[k]; if (!e) return null; return e.type === 'checkbox' ? e.checked : e.value; },
      set: function (k, val) { var e = form.elements[k]; if (!e) return; var fd = F.fields.find(function (x) { return x.k === k; }); if (e.type === 'checkbox') e.checked = !!val; else e.value = fd && fd.t === 'money' ? won(val) : val; }
    };
    function refreshTotal() { if (F.total) $('#ef-total').textContent = F.total(api); }
    form.addEventListener('input', function (e) {
      var fd = F.fields.find(function (x) { return x.k === e.target.name; });
      if (fd && fd.t === 'money') { var pos = e.target.value; e.target.value = pos.replace(/[^0-9]/g, '') ? won(parseMoney(pos)) : ''; }
      if (F.hook && e.target.name) F.hook(api, e.target.name);
      refreshTotal();
    });
    form.addEventListener('change', function (e) { if (F.hook && e.target.tagName === 'SELECT') { F.hook(api, e.target.name); refreshTotal(); } });
    if (isNew && F.hook) F.fields.forEach(function (fd) { if (v[fd.k] != null && fd.t !== 'money') F.hook(api, fd.k); });
    if (isNew && preset) Object.keys(preset).forEach(function (k) { if (preset[k] != null) api.set(k, preset[k]); });
    refreshTotal();
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var out = {}, msg = $('#ef-msg');
      for (var i = 0; i < F.fields.length; i++) {
        var fd = F.fields[i], val = api.get(fd.k);
        if (fd.t === 'money') val = form.elements[fd.k].value === '' ? null : parseMoney(val);
        else if (fd.t === 'num') val = val === '' ? null : Number(val);
        else if (fd.t !== 'bool') { val = (val || '').trim(); if (val === '') val = null; }
        if (fd.req && (val == null || val === '')) { msg.textContent = fd.l + '을(를) 입력해 주세요.'; form.elements[fd.k].focus(); return; }
        out[fd.k] = val;
      }
      if (key === 'payments' && !isNew) delete out.invoice_id;
      if (key === 'payments' && isNew) out.invoice_id = preset.invoice_id;
      if (key === 'expenses' && out.vat == null) out.vat = 0;
      if (key === 'invoices' && out.vat == null) out.vat = 0;
      if (key === 'labor' && out.days == null) out.days = 1;
      $('#ef-save').disabled = true;
      var r = isNew ? await db.from(TABLES[key]).insert(out) : await db.from(TABLES[key]).update(out).eq('id', row.id);
      $('#ef-save').disabled = false;
      if (r.error) { msg.textContent = '저장하지 못했습니다. ' + errText(r.error); return; }
      closeDlg();
      toast('저장했습니다');
      await reload(key);
      if (after) after(); else route();
    });
    var del = $('#ef-del');
    if (del) del.addEventListener('click', async function () {
      if (del.dataset.c !== '1') { del.dataset.c = '1'; del.textContent = '한 번 더 누르면 삭제'; return; }
      var r = await db.from(TABLES[key]).delete().eq('id', row.id);
      if (r.error) { $('#ef-msg').textContent = '삭제하지 못했습니다. ' + errText(r.error); return; }
      closeDlg();
      toast('삭제했습니다');
      await loadAll();
      if (key === 'jobs' && location.hash.indexOf('#/job/') === 0) location.hash = '#/jobs'; else route();
    });
    openDlg();
    var first = form.querySelector('input:not([type=checkbox]), select');
    if (first && window.matchMedia('(min-width: 821px)').matches) first.focus();
  }
  function errText(e) {
    var m = String(e && e.message || '');
    if (/row-level security|permission/i.test(m)) { setTimeout(checkSession, 300); return '로그인이 만료되었을 수 있어요. 다시 로그인해 주세요.'; }
    if (/foreign key|violates/i.test(m) && /labor/.test(m)) return '이 작업자의 출역 기록이 있어 삭제할 수 없어요. "같이 일함"을 해제해 주세요.';
    if (/foreign key/i.test(m)) return '연결된 기록이 있어 삭제할 수 없어요.';
    return '';
  }

  // ================= 화면 공통 =================
  var ICONS = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    jobs: '<path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/>',
    sales: '<path d="M12 2v20"/><path d="M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    costs: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M7 15h4"/>',
    people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14c3 0 5.5 2 5.5 5"/>',
    clients: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h10M7 17h6"/>',
    books: '<path d="M4 4h12a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3z"/><path d="M8 8h7M8 12h7"/>'
  };
  var MENU = [
    ['home', '홈', 'home'], ['jobs', '현장', 'jobs'], ['sales', '매출·수금', 'sales'], ['costs', '비용·자재', 'costs'],
    ['people', '인력', 'people'], ['clients', '거래처', 'clients'], ['books', '세금·회계', 'books']
  ];
  function drawNav(cur) {
    $('#nav').innerHTML = MENU.map(function (m) {
      return '<a href="#/' + m[0] + '"' + (cur === m[0] ? ' aria-current="page"' : '') + '><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[m[2]] + '</svg><span>' + m[1] + '</span></a>';
    }).join('');
  }
  function table(cols, rows, onClick, foot) {
    if (!rows.length) return '<div class="table-wrap"><p class="empty">아직 입력된 내용이 없어요.</p></div>';
    var h = '<div class="table-wrap"><table><thead><tr>' + cols.map(function (c) { var cl = [c.num ? 'num' : '', c.m ? 'hide-m' : ''].join(' ').trim(); return '<th' + (cl ? ' class="' + cl + '"' : '') + '>' + c.l + '</th>'; }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (r, i) {
      h += '<tr data-i="' + i + '"' + (onClick ? '' : ' class="plain"') + '>' + cols.map(function (c) {
        var cl = [c.num ? 'num' : '', c.m ? 'hide-m' : ''].join(' ').trim();
        return '<td' + (cl ? ' class="' + cl + '"' : '') + '>' + c.v(r) + '</td>';
      }).join('') + '</tr>';
    });
    h += '</tbody>' + (foot ? '<tfoot><tr>' + foot + '</tr></tfoot>' : '') + '</table></div>';
    return h;
  }
  function bindRows(container, rows, onClick) {
    if (!onClick) return;
    $$('tbody tr', container).forEach(function (tr) {
      tr.tabIndex = 0;
      tr.addEventListener('click', function (e) { if (e.target.closest('button,a,input')) return; onClick(rows[Number(tr.dataset.i)]); });
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') onClick(rows[Number(tr.dataset.i)]); });
    });
  }
  function head(title, btns) { return '<div class="page-head"><h2>' + title + '</h2><div class="btn-row">' + (btns || '') + '</div></div>'; }
  function kpi(k, v, s, cls, href) {
    var tag = href ? 'a href="' + href + '"' : 'div';
    return '<' + tag + ' class="kpi ' + (cls || '') + '"><div class="k">' + k + '</div><div class="v">' + v + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + '</' + (href ? 'a' : 'div') + '>';
  }
  function chips(name, opts, cur) {
    return '<div class="filters" role="group">' + opts.map(function (o) { return '<button type="button" class="chip" data-' + name + '="' + esc(o) + '" aria-pressed="' + (o === cur) + '">' + esc(o) + '</button>'; }).join('') + '</div>';
  }
  var view = $('#view');

  // ================= 홈 =================
  function pageHome() {
    var m = today().slice(0, 7);
    var inv = D.invoices.filter(function (i) { return ym(i.issue_date) === m; });
    var lab = D.labor.filter(function (l) { return ym(l.work_date) === m; });
    var exp = D.expenses.filter(function (e) { return ym(e.spent_date) === m; });
    var sales = sum(inv, function (i) { return i.supply; });
    var cost = sum(lab, function (l) { return l.pay; }) + sum(exp, netExp);
    var recv = D.invoices.filter(function (i) { return balanceOf(i) > 0; });
    var overdue = recv.filter(function (i) { return i.due_date && i.due_date < today(); });
    var bills = openBills().filter(function (p) { return p.bill_due && daysBetween(today(), p.bill_due) <= 30; });
    var wages = unpaidLabor();
    var running = D.jobs.filter(function (j) { return j.status === '진행중' || j.status === '예정'; })
      .sort(function (a, b) { return (a.start_date || '9').localeCompare(b.start_date || '9'); });
    var h = head(Number(m.slice(5)) + '월 현황');
    h += '<div class="quick">' +
      '<button class="btn green" data-q="expenses">+ 비용·자재</button>' +
      '<button class="btn green" data-q="labor">+ 출역·인건비</button>' +
      '<button class="btn green" data-q="invoices">+ 매출</button>' +
      '<button class="btn green" data-q="jobs">+ 현장</button></div>';
    h += '<div class="cards">' +
      kpi('이번 달 매출', wonU(sales), '공급가 기준', '', '#/sales') +
      kpi('이번 달 지출', wonU(cost), '인건비 + 비용', '', '#/costs') +
      kpi('이번 달 이익', wonU(sales - cost), '', sales - cost >= 0 ? 'good' : 'bad', '#/books') +
      kpi('받을 돈 (미수금)', wonU(sum(recv, balanceOf)), recv.length + '건' + (overdue.length ? ' · 연체 ' + overdue.length + '건' : ''), overdue.length ? 'bad' : '', '#/sales/recv') +
      kpi('어음 만기 30일 이내', wonU(sum(bills, function (p) { return p.amount; })), bills.length + '장', bills.length ? 'warn' : '', '#/sales/bills') +
      kpi('줄 돈 (미지급 인건비)', wonU(sum(wages, function (l) { return l.pay; })), wages.length + '건', wages.length ? 'warn' : '', '#/people/unpaid') +
      '</div>';
    h += '<div class="panel"><h3>진행 중·예정 현장 <a href="#/jobs" class="btn small">전체 보기</a></h3>' +
      table([
        { l: '상태', v: function (j) { return badge(j.status, JOB_STATUS_CLS[j.status] || 'b-gray'); } },
        { l: '현장', v: function (j) { return '<strong>' + esc(j.title) + '</strong>'; } },
        { l: '작업', m: 1, v: function (j) { return esc(j.work_type || ''); } },
        { l: '시작일', v: function (j) { return fmtD(j.start_date); } },
        { l: '체크', num: 1, v: function (j) { var c = D.checks.filter(function (x) { return x.job_id === j.id; }); return c.length ? c.filter(function (x) { return x.done; }).length + '/' + c.length : '-'; } }
      ], running, true) + '</div>';
    view.innerHTML = h;
    bindRows(view, running, function (j) { location.hash = '#/job/' + j.id; });
    $$('[data-q]', view).forEach(function (b) { b.addEventListener('click', function () { editForm(b.dataset.q); }); });
  }

  // ================= 현장 =================
  var jobFilter = '진행·예정', jobSearch = '';
  function pageJobs() {
    var rows = D.jobs.filter(function (j) {
      if (jobFilter === '진행·예정' && !(j.status === '진행중' || j.status === '예정')) return false;
      if (JOB_STATUS.indexOf(jobFilter) >= 0 && j.status !== jobFilter) return false;
      if (jobFilter === '올해 전체' && yr(j.start_date) !== state.year && j.start_date) return false;
      if (jobSearch && (j.title + clientName(j.client_id)).indexOf(jobSearch) < 0) return false;
      return true;
    }).sort(function (a, b) { return (b.start_date || '').localeCompare(a.start_date || ''); });
    var h = head('현장', '<button class="btn primary" id="add">+ 현장 추가</button>');
    h += chips('f', ['진행·예정', '올해 전체', '예정', '진행중', '완료', '보류'], jobFilter);
    h += '<div class="filters"><input type="search" id="s" placeholder="현장명·거래처 검색" value="' + esc(jobSearch) + '" aria-label="현장 검색"></div>';
    h += table([
      { l: '상태', v: function (j) { return badge(j.status, JOB_STATUS_CLS[j.status] || 'b-gray'); } },
      { l: '현장', v: function (j) { return '<strong>' + esc(j.title) + '</strong><div class="muted" style="font-size:13px">' + esc(clientName(j.client_id)) + '</div>'; } },
      { l: '작업', m: 1, v: function (j) { return esc(j.work_type || '') + (j.capacity ? '<div class="muted" style="font-size:13px">' + esc(j.capacity) + '</div>' : ''); } },
      { l: '기간', v: function (j) { return fmtD(j.start_date) + (j.end_date ? ' ~ ' + fmtD(j.end_date) : ''); } },
      { l: '계약 금액', num: 1, m: 1, v: function (j) { return j.amount ? won(j.amount) : '-'; } }
    ], rows, true);
    view.innerHTML = h;
    bindRows(view, rows, function (j) { location.hash = '#/job/' + j.id; });
    $('#add').addEventListener('click', function () { editForm('jobs'); });
    $$('[data-f]', view).forEach(function (b) { b.addEventListener('click', function () { jobFilter = b.dataset.f; pageJobs(); }); });
    var s = $('#s'); s.addEventListener('input', function () { jobSearch = s.value.trim(); var pos = s.selectionStart; pageJobs(); var n = $('#s'); n.focus(); n.setSelectionRange(pos, pos); });
  }
  function pageJob(id) {
    var j = byId('jobs', id);
    if (!j) { view.innerHTML = head('현장') + '<p class="empty">현장을 찾을 수 없어요.</p>'; return; }
    var checks = D.checks.filter(function (c) { return c.job_id === id; }).sort(function (a, b) { return a.created_at.localeCompare(b.created_at); });
    var lab = D.labor.filter(function (l) { return l.job_id === id; }).sort(function (a, b) { return b.work_date.localeCompare(a.work_date); });
    var exp = D.expenses.filter(function (e) { return e.job_id === id; }).sort(function (a, b) { return b.spent_date.localeCompare(a.spent_date); });
    var inv = D.invoices.filter(function (i) { return i.job_id === id; });
    var sales = sum(inv, function (i) { return i.supply; }), lc = sum(lab, function (l) { return l.pay; }), ec = sum(exp, netExp);
    var h = '<div class="page-head"><h2><a href="#/jobs" style="text-decoration:none">현장</a> › ' + esc(j.title) + '</h2><div class="btn-row"><button class="btn" id="edit">현장 정보 수정</button></div></div>';
    h += '<div class="grid2"><div class="panel"><h3>현장 정보 ' + badge(j.status, JOB_STATUS_CLS[j.status] || 'b-gray') + '</h3><dl class="info-list">' +
      '<dt>거래처</dt><dd>' + esc(clientName(j.client_id) || '-') + '</dd>' +
      '<dt>작업</dt><dd>' + esc([j.work_type, j.capacity].filter(Boolean).join(' · ') || '-') + '</dd>' +
      '<dt>기간</dt><dd>' + (fmtD(j.start_date) || '-') + (j.end_date ? ' ~ ' + fmtD(j.end_date) : '') + '</dd>' +
      '<dt>계약 금액</dt><dd>' + (j.amount ? wonU(j.amount) : '-') + '</dd>' +
      (j.memo ? '<dt>메모</dt><dd style="white-space:pre-line">' + esc(j.memo) + '</dd>' : '') + '</dl>' +
      '<div class="btn-row" style="margin-top:12px">' + JOB_STATUS.map(function (s) { return '<button class="chip" data-st="' + s + '" aria-pressed="' + (s === j.status) + '">' + s + '</button>'; }).join('') + '</div></div>';
    h += '<div class="panel"><h3>현장 체크리스트 <span class="muted" style="font-size:14px">' + checks.filter(function (c) { return c.done; }).length + '/' + checks.length + '</span></h3><div class="checks">' +
      (checks.length ? checks.map(function (c) {
        return '<div class="check-row' + (c.done ? ' done' : '') + '"><input type="checkbox" id="c-' + c.id + '" data-c="' + c.id + '"' + (c.done ? ' checked' : '') + '><label for="c-' + c.id + '">' + esc(c.text) + '</label><button type="button" data-cd="' + c.id + '" aria-label="항목 삭제">×</button></div>';
      }).join('') : '<p class="muted">현장에서 확인할 항목을 추가해 두세요.</p>') +
      '</div><form class="add-check" id="addc"><input id="ct" type="text" maxlength="200" placeholder="예: 냉각수 펌프 확인" aria-label="체크 항목"><button class="btn primary" type="submit">추가</button></form>' +
      (checks.length ? '' : '<div class="btn-row" style="margin-top:8px"><button class="btn small" id="tpl">기본 항목 넣기</button></div>') + '</div></div>';
    h += '<div class="panel"><h3>현장 손익</h3><div class="profit">' +
      '<div><span>매출(공급가)</span><strong>' + won(sales) + '</strong></div>' +
      '<div><span>인건비</span><strong>' + won(lc) + '</strong></div>' +
      '<div><span>비용·자재</span><strong>' + won(ec) + '</strong></div>' +
      '<div><span>이익</span><strong style="color:' + (sales - lc - ec >= 0 ? 'var(--green)' : 'var(--red)') + '">' + won(sales - lc - ec) + '</strong></div>' +
      '</div></div>';
    h += '<div class="panel"><h3>매출·수금 <button class="btn small primary" data-add="invoices">+ 매출</button></h3><div id="t-inv"></div></div>';
    h += '<div class="panel"><h3>출역·인건비 <button class="btn small primary" data-add="labor">+ 출역</button></h3><div id="t-lab"></div></div>';
    h += '<div class="panel"><h3>비용·자재 <button class="btn small primary" data-add="expenses">+ 비용</button></h3><div id="t-exp"></div></div>';
    view.innerHTML = h;
    $('#t-inv').innerHTML = invTable(inv); bindRows($('#t-inv'), inv, showInvoice);
    $('#t-lab').innerHTML = laborTable(lab); bindRows($('#t-lab'), lab, function (r) { editForm('labor', r); });
    $('#t-exp').innerHTML = expTable(exp); bindRows($('#t-exp'), exp, function (r) { editForm('expenses', r); });
    $('#edit').addEventListener('click', function () { editForm('jobs', j); });
    $$('[data-add]', view).forEach(function (b) { b.addEventListener('click', function () { editForm(b.dataset.add, null, { job_id: id, client_id: b.dataset.add === 'invoices' ? j.client_id : undefined }); }); });
    $$('[data-st]', view).forEach(function (b) { b.addEventListener('click', async function () {
      var patch = { status: b.dataset.st };
      if (b.dataset.st === '완료' && !j.end_date) patch.end_date = today();
      var r = await db.from(TABLES.jobs).update(patch).eq('id', id);
      if (r.error) { toast('저장 실패 ' + errText(r.error)); return; }
      await reload('jobs'); pageJob(id); toast('상태를 바꿨습니다');
    }); });
    $$('[data-c]', view).forEach(function (cb) { cb.addEventListener('change', async function () {
      var r = await db.from(TABLES.checks).update({ done: cb.checked }).eq('id', cb.dataset.c);
      if (r.error) { toast('저장 실패 ' + errText(r.error)); cb.checked = !cb.checked; return; }
      await reload('checks'); pageJob(id);
    }); });
    $$('[data-cd]', view).forEach(function (b) { b.addEventListener('click', async function () {
      await db.from(TABLES.checks).delete().eq('id', b.dataset.cd); await reload('checks'); pageJob(id);
    }); });
    $('#addc').addEventListener('submit', async function (e) {
      e.preventDefault(); var t = $('#ct').value.trim(); if (!t) return;
      var r = await db.from(TABLES.checks).insert({ job_id: id, text: t });
      if (r.error) { toast('저장 실패 ' + errText(r.error)); return; }
      await reload('checks'); pageJob(id); $('#ct').focus();
    });
    var tpl = $('#tpl');
    if (tpl) tpl.addEventListener('click', async function () {
      var items = ['장비·자재 반입 확인', '냉각수·냉수 펌프 상태', '진공도·누설 확인', '작업 전 사진 촬영', '작업 후 사진 촬영', '시운전 확인', '현장 정리·담당자 확인'];
      await db.from(TABLES.checks).insert(items.map(function (t) { return { job_id: id, text: t }; }));
      await reload('checks'); pageJob(id);
    });
  }

  // ================= 매출·수금 =================
  function invTable(rows) {
    return table([
      { l: '발행일', v: function (i) { return fmtD(i.issue_date); } },
      { l: '거래처 / 내용', v: function (i) { return '<strong>' + esc(clientName(i.client_id)) + '</strong><div class="muted" style="font-size:13px">' + esc(i.title || jobTitle(i.job_id)) + '</div>'; } },
      { l: '합계', num: 1, m: 1, v: function (i) { return won(totalOf(i)); } },
      { l: '받을 돈', num: 1, v: function (i) { var b = balanceOf(i); return b > 0 ? '<strong>' + won(b) + '</strong>' : '0'; } },
      { l: '상태', v: function (i) { var s = invStatus(i); return badge(s.t, s.c); } }
    ], rows, true);
  }
  function showInvoice(inv) {
    var pays = D.payments.filter(function (p) { return p.invoice_id === inv.id; }).sort(function (a, b) { return a.paid_date.localeCompare(b.paid_date); });
    var s = invStatus(inv);
    var h = '<div class="dlg-head"><h3>매출 상세</h3><button type="button" class="x" data-x aria-label="닫기">×</button></div><div style="padding:16px 20px">' +
      '<dl class="info-list"><dt>거래처</dt><dd>' + esc(clientName(inv.client_id) || '-') + '</dd><dt>현장</dt><dd>' + esc(jobTitle(inv.job_id) || '-') + '</dd><dt>내용</dt><dd>' + esc(inv.title || '-') + '</dd>' +
      '<dt>발행일</dt><dd>' + fmtD(inv.issue_date) + (inv.tax_invoice ? ' (세금계산서)' : '') + '</dd><dt>공급가 / 부가세</dt><dd>' + won(inv.supply) + ' / ' + won(inv.vat) + '</dd><dt>합계</dt><dd><strong>' + wonU(totalOf(inv)) + '</strong></dd>' +
      '<dt>입금 약속일</dt><dd>' + (fmtD(inv.due_date) || '-') + '</dd><dt>받은 돈</dt><dd>' + wonU(paidOf(inv)) + '</dd><dt>남은 돈</dt><dd><strong>' + wonU(balanceOf(inv)) + '</strong> ' + badge(s.t, s.c) + '</dd></dl>' +
      '<h4 style="margin:16px 0 8px">수금 내역</h4>' + (pays.length ? '<div id="pl">' + table([
        { l: '날짜', v: function (p) { return fmtD(p.paid_date); } },
        { l: '방법', v: function (p) { return esc(p.method || '') + (isBill(p) ? ' <span class="muted">만기 ' + fmtD(p.bill_due) + (p.bill_cashed ? ' · 결제됨' : '') + '</span>' : ''); } },
        { l: '금액', num: 1, v: function (p) { return won(p.amount); } }
      ], pays, true) + '</div>' : '<p class="muted">아직 받은 돈이 없어요.</p>') +
      '</div><div class="dlg-foot"><button class="btn" id="ie">매출 수정·삭제</button><button class="btn green" id="ip">+ 수금 등록</button></div>';
    $('#dlg-body').innerHTML = h;
    openDlg();
    if (pays.length) bindRows($('#pl'), pays, function (p) { editForm('payments', p, null, function () { showInvoice(byId('invoices', inv.id)); route(); }); });
    $('#ie').addEventListener('click', function () { editForm('invoices', inv); });
    $('#ip').addEventListener('click', function () {
      editForm('payments', null, { invoice_id: inv.id, amount: Math.max(balanceOf(inv), 0) }, function () { route(); var fresh = byId('invoices', inv.id); if (fresh) showInvoice(fresh); });
    });
  }
  function pageSales(tab) {
    tab = tab || 'list';
    var tabs = '<div class="tabs">' + [['list', '매출 목록'], ['recv', '미수금'], ['bills', '어음']].map(function (t) { return '<a href="#/sales/' + t[0] + '"' + (tab === t[0] ? ' aria-current="page"' : '') + '>' + t[1] + '</a>'; }).join('') + '</div>';
    var h = head('매출·수금', '<button class="btn primary" id="add">+ 매출 등록</button>') + tabs;
    var rows;
    if (tab === 'list') {
      rows = inYear(D.invoices, 'issue_date').sort(function (a, b) { return b.issue_date.localeCompare(a.issue_date); });
      h += '<div class="cards">' + kpi(state.year + '년 매출(공급가)', wonU(sum(rows, function (i) { return i.supply; }))) + kpi('부가세', wonU(sum(rows, function (i) { return i.vat; }))) + kpi('그중 받을 돈', wonU(sum(rows, function (i) { return Math.max(balanceOf(i), 0); }))) + '</div>';
      h += '<div id="t"></div>';
      view.innerHTML = h; $('#t').innerHTML = invTable(rows); bindRows($('#t'), rows, showInvoice);
    } else if (tab === 'recv') {
      rows = D.invoices.filter(function (i) { return balanceOf(i) > 0; }).sort(function (a, b) { return (a.due_date || a.issue_date).localeCompare(b.due_date || b.issue_date); });
      var byC = {};
      rows.forEach(function (i) { var k = clientName(i.client_id) || '(거래처 없음)'; byC[k] = byC[k] || { n: k, amt: 0, cnt: 0, oldest: i.issue_date }; byC[k].amt += balanceOf(i); byC[k].cnt++; if (i.issue_date < byC[k].oldest) byC[k].oldest = i.issue_date; });
      var cl = Object.keys(byC).map(function (k) { return byC[k]; }).sort(function (a, b) { return b.amt - a.amt; });
      h += '<div class="cards">' + kpi('전체 미수금', wonU(sum(rows, balanceOf)), rows.length + '건') + kpi('연체 (약속일 지남)', wonU(sum(rows.filter(function (i) { return i.due_date && i.due_date < today(); }), balanceOf)), '', 'bad') + '</div>';
      h += '<div class="panel"><h3>거래처별 받을 돈</h3>' + table([
        { l: '거래처', v: function (c) { return '<strong>' + esc(c.n) + '</strong>'; } },
        { l: '건수', num: 1, v: function (c) { return c.cnt; } },
        { l: '가장 오래된 청구', v: function (c) { return fmtD(c.oldest) + ' <span class="muted">(' + daysBetween(c.oldest, today()) + '일 지남)</span>'; } },
        { l: '받을 돈', num: 1, v: function (c) { return '<strong>' + won(c.amt) + '</strong>'; } }
      ], cl) + '</div><div class="panel"><h3>미수 매출 (약속일 빠른 순)</h3><div id="t"></div></div>';
      view.innerHTML = h; $('#t').innerHTML = invTable(rows); bindRows($('#t'), rows, showInvoice);
    } else {
      rows = openBills().sort(function (a, b) { return (a.bill_due || '9').localeCompare(b.bill_due || '9'); });
      h += '<div class="cards">' + kpi('결제 안 된 어음', wonU(sum(rows, function (p) { return p.amount; })), rows.length + '장') + '</div>';
      h += '<div id="t"></div><p class="note">어음이 결제(현금화)되면 "결제 완료"를 눌러 주세요.</p>';
      view.innerHTML = h;
      $('#t').innerHTML = table([
        { l: '만기일', v: function (p) { var d = p.bill_due ? daysBetween(today(), p.bill_due) : null; return (fmtD(p.bill_due) || '-') + (d != null ? ' ' + badge(d < 0 ? '만기 지남' : 'D-' + d, d < 0 ? 'b-red' : d <= 30 ? 'b-amber' : 'b-gray') : ''); } },
        { l: '거래처', v: function (p) { var i = byId('invoices', p.invoice_id); return esc(i ? clientName(i.client_id) : ''); } },
        { l: '받은 날', m: 1, v: function (p) { return fmtD(p.paid_date); } },
        { l: '금액', num: 1, v: function (p) { return won(p.amount); } },
        { l: '', v: function (p) { return '<button class="btn small green" data-cash="' + p.id + '">결제 완료</button>'; } }
      ], rows, true);
      bindRows($('#t'), rows, function (p) { editForm('payments', p); });
      $$('[data-cash]', view).forEach(function (b) { b.addEventListener('click', async function () {
        var r = await db.from(TABLES.payments).update({ bill_cashed: true }).eq('id', b.dataset.cash);
        if (r.error) { toast('저장 실패 ' + errText(r.error)); return; }
        await reload('payments'); route(); toast('결제 완료로 표시했습니다');
      }); });
    }
    $('#add').addEventListener('click', function () { editForm('invoices'); });
  }

  // ================= 비용·자재 =================
  var expCat = '전체', expMonth = '';
  function expTable(rows, foot) {
    return table([
      { l: '날짜', v: function (e) { return fmtD(e.spent_date); } },
      { l: '항목', v: function (e) { return badge(e.category, e.category === '자재비' ? 'b-blue' : 'b-gray'); } },
      { l: '내용', v: function (e) { return '<strong>' + esc(e.item || e.vendor || '') + '</strong><div class="muted" style="font-size:13px">' + esc([e.vendor && e.item ? e.vendor : '', e.qty, jobTitle(e.job_id)].filter(Boolean).join(' · ')) + '</div>'; } },
      { l: '증빙', m: 1, v: function (e) { return esc(e.evidence || ''); } },
      { l: '금액', num: 1, v: function (e) { return won(e.amount); } }
    ], rows, true, foot);
  }
  function pageCosts() {
    var rows = inYear(D.expenses, 'spent_date').filter(function (e) {
      return (expCat === '전체' || e.category === expCat) && (!expMonth || ym(e.spent_date) === expMonth);
    }).sort(function (a, b) { return b.spent_date.localeCompare(a.spent_date); });
    var months = ['<option value="">' + state.year + '년 전체</option>'];
    for (var i = 1; i <= 12; i++) { var mm = state.year + '-' + String(i).padStart(2, '0'); months.push('<option value="' + mm + '"' + (expMonth === mm ? ' selected' : '') + '>' + i + '월</option>'); }
    var h = head('비용·자재', '<button class="btn primary" id="add">+ 비용·자재 입력</button>');
    h += chips('c', ['전체'].concat(EXP_CATS), expCat);
    h += '<div class="filters"><select id="m" aria-label="월 선택">' + months.join('') + '</select></div>';
    var byCat = {};
    rows.forEach(function (e) { byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount); });
    h += '<div class="cards">' + kpi('합계', wonU(sum(rows, function (e) { return e.amount; })), rows.length + '건') + kpi('공제 부가세', wonU(sum(rows, function (e) { return e.vat; }))) +
      Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; }).slice(0, 3).map(function (k) { return kpi(k, wonU(byCat[k])); }).join('') + '</div>';
    h += '<div id="t"></div>';
    view.innerHTML = h;
    $('#t').innerHTML = expTable(rows); bindRows($('#t'), rows, function (r) { editForm('expenses', r); });
    $('#add').addEventListener('click', function () { editForm('expenses', null, expCat !== '전체' ? { category: expCat } : null); });
    $$('[data-c]', view).forEach(function (b) { b.addEventListener('click', function () { expCat = b.dataset.c; pageCosts(); }); });
    $('#m').addEventListener('change', function (e) { expMonth = e.target.value; pageCosts(); });
  }

  // ================= 인력 =================
  function laborTable(rows) {
    return table([
      { l: '작업일', v: function (l) { return fmtD(l.work_date); } },
      { l: '작업자', v: function (l) { return '<strong>' + esc(workerName(l.worker_id)) + '</strong>'; } },
      { l: '현장', m: 1, v: function (l) { return esc(jobTitle(l.job_id)); } },
      { l: '공수', num: 1, v: function (l) { return l.days; } },
      { l: '지급액', num: 1, v: function (l) { return won(l.pay); } },
      { l: '지급', v: function (l) { return l.paid ? badge('지급', 'b-green') : badge('미지급', 'b-amber'); } }
    ], rows, true);
  }
  function pagePeople(tab) {
    tab = tab || 'labor';
    var tabs = '<div class="tabs">' + [['labor', '출역·인건비'], ['unpaid', '미지급 정산'], ['list', '인력 명단']].map(function (t) { return '<a href="#/people/' + t[0] + '"' + (tab === t[0] ? ' aria-current="page"' : '') + '>' + t[1] + '</a>'; }).join('') + '</div>';
    var h = head('인력', tab === 'list' ? '<button class="btn primary" id="add">+ 인력 등록</button>' : '<button class="btn primary" id="add">+ 출역 입력</button>') + tabs;
    if (tab === 'labor') {
      var rows = inYear(D.labor, 'work_date').sort(function (a, b) { return b.work_date.localeCompare(a.work_date); });
      var m = today().slice(0, 7);
      var thisM = rows.filter(function (l) { return ym(l.work_date) === m; });
      h += '<div class="cards">' + kpi('이번 달 인건비', wonU(sum(thisM, function (l) { return l.pay; })), sum(thisM, function (l) { return l.days; }) + '공수') + kpi(state.year + '년 인건비', wonU(sum(rows, function (l) { return l.pay; }))) + '</div><div id="t"></div>';
      view.innerHTML = h; $('#t').innerHTML = laborTable(rows); bindRows($('#t'), rows, function (r) { editForm('labor', r); });
    } else if (tab === 'unpaid') {
      var un = unpaidLabor(), byW = {};
      un.forEach(function (l) { byW[l.worker_id] = byW[l.worker_id] || { id: l.worker_id, n: workerName(l.worker_id), amt: 0, days: 0, from: l.work_date, to: l.work_date }; var w = byW[l.worker_id]; w.amt += Number(l.pay); w.days += Number(l.days); if (l.work_date < w.from) w.from = l.work_date; if (l.work_date > w.to) w.to = l.work_date; });
      var ws = Object.keys(byW).map(function (k) { return byW[k]; }).sort(function (a, b) { return b.amt - a.amt; });
      h += '<div class="cards">' + kpi('줄 돈 합계', wonU(sum(ws, function (w) { return w.amt; })), ws.length + '명') + '</div><div id="t"></div><p class="note">"전부 지급"을 누르면 그 사람의 미지급 출역이 모두 오늘 날짜로 지급 처리돼요.</p>';
      view.innerHTML = h;
      $('#t').innerHTML = table([
        { l: '작업자', v: function (w) { var p = byId('workers', w.id); return '<strong>' + esc(w.n) + '</strong>' + (p && p.bank ? '<div class="muted" style="font-size:13px">' + esc(p.bank) + '</div>' : ''); } },
        { l: '기간', m: 1, v: function (w) { return fmtD(w.from) + ' ~ ' + fmtD(w.to); } },
        { l: '공수', num: 1, v: function (w) { return w.days; } },
        { l: '줄 돈', num: 1, v: function (w) { return '<strong>' + won(w.amt) + '</strong>'; } },
        { l: '', v: function (w) { return '<button class="btn small green" data-pay="' + w.id + '">전부 지급</button>'; } }
      ], ws);
      $$('[data-pay]', view).forEach(function (b) { b.addEventListener('click', async function () {
        if (b.dataset.c !== '1') { b.dataset.c = '1'; b.textContent = '확인: 한 번 더'; return; }
        var r = await db.from(TABLES.labor).update({ paid: true, paid_date: today() }).eq('worker_id', b.dataset.pay).eq('paid', false);
        if (r.error) { toast('저장 실패 ' + errText(r.error)); return; }
        await reload('labor'); route(); toast('지급 처리했습니다');
      }); });
    } else {
      var ppl = D.workers.slice().sort(function (a, b) { return (b.active - a.active) || a.name.localeCompare(b.name); });
      h += '<div id="t"></div>';
      view.innerHTML = h;
      $('#t').innerHTML = table([
        { l: '이름', v: function (w) { return '<strong>' + esc(w.name) + '</strong>' + (w.active ? '' : ' ' + badge('쉬는 중', 'b-gray')); } },
        { l: '연락처', v: function (w) { return w.phone ? '<a href="tel:' + esc(w.phone.replace(/[^0-9+]/g, '')) + '">' + esc(w.phone) + '</a>' : ''; } },
        { l: '기술', m: 1, v: function (w) { return esc(w.skill || ''); } },
        { l: '일당', num: 1, v: function (w) { return w.daily_wage ? won(w.daily_wage) : '-'; } },
        { l: state.year + '년 공수', num: 1, m: 1, v: function (w) { return sum(inYear(D.labor, 'work_date').filter(function (l) { return l.worker_id === w.id; }), function (l) { return l.days; }); } }
      ], ppl, true);
      bindRows($('#t'), ppl, function (r) { editForm('workers', r); });
    }
    $('#add').addEventListener('click', function () { editForm(tab === 'list' ? 'workers' : 'labor'); });
  }

  // ================= 거래처 =================
  function pageClients() {
    var rows = D.clients.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    var h = head('거래처', '<button class="btn primary" id="add">+ 거래처 등록</button>') + '<div id="t"></div>';
    view.innerHTML = h;
    $('#t').innerHTML = table([
      { l: '거래처', v: function (c) { return '<strong>' + esc(c.name) + '</strong>' + (c.kind ? ' ' + badge(c.kind, 'b-gray') : ''); } },
      { l: '담당자·연락처', v: function (c) { return esc(c.manager || '') + (c.phone ? ' <a href="tel:' + esc(c.phone.replace(/[^0-9+]/g, '')) + '">' + esc(c.phone) + '</a>' : ''); } },
      { l: state.year + '년 매출', num: 1, m: 1, v: function (c) { return won(sum(inYear(D.invoices, 'issue_date').filter(function (i) { return i.client_id === c.id; }), function (i) { return i.supply; })); } },
      { l: '받을 돈', num: 1, v: function (c) { var b = sum(D.invoices.filter(function (i) { return i.client_id === c.id; }), function (i) { return Math.max(balanceOf(i), 0); }); return b ? '<strong>' + won(b) + '</strong>' : '0'; } }
    ], rows, true);
    bindRows($('#t'), rows, function (r) { editForm('clients', r); });
    $('#add').addEventListener('click', function () { editForm('clients'); });
  }

  // ================= 세금·회계 =================
  function monthly() {
    var out = [];
    for (var m = 1; m <= 12; m++) {
      var inv = inYear(D.invoices, 'issue_date').filter(function (i) { return mon(i.issue_date) === m; });
      var lab = inYear(D.labor, 'work_date').filter(function (l) { return mon(l.work_date) === m; });
      var exp = inYear(D.expenses, 'spent_date').filter(function (e) { return mon(e.spent_date) === m; });
      var o = { m: m, sales: sum(inv, function (i) { return i.supply; }), outVat: sum(inv, function (i) { return i.vat; }), labor: sum(lab, function (l) { return l.pay; }),
        mat: sum(exp.filter(function (e) { return e.category === '자재비' || e.category === '외주비'; }), netExp),
        etc: sum(exp.filter(function (e) { return !(e.category === '자재비' || e.category === '외주비'); }), netExp), inVat: sum(exp, function (e) { return e.vat; }) };
      o.profit = o.sales - o.labor - o.mat - o.etc;
      out.push(o);
    }
    return out;
  }
  function pageBooks() {
    var M = monthly();
    var tot = function (k) { return sum(M, function (x) { return x[k]; }); };
    var h = head(state.year + '년 세금·회계');
    h += '<div class="cards">' + kpi('매출(공급가)', wonU(tot('sales'))) + kpi('인건비', wonU(tot('labor'))) + kpi('자재·외주비', wonU(tot('mat'))) + kpi('기타 경비', wonU(tot('etc'))) + kpi('이익', wonU(tot('profit')), '', tot('profit') >= 0 ? 'good' : 'bad') + '</div>';
    h += '<div class="panel"><h3>월별 손익</h3><div id="pl"></div></div>';
    var half = function (a, b) { var s = M.slice(a, b); return { o: sum(s, function (x) { return x.outVat; }), i: sum(s, function (x) { return x.inVat; }) }; };
    var h1 = half(0, 6), h2 = half(6, 12);
    var vatRow = function (n, p, x) { return '<tr class="plain"><td>' + n + '</td><td class="hide-m">' + p + '</td><td class="num">' + won(x.o) + '</td><td class="num">' + won(x.i) + '</td><td class="num"><strong>' + won(x.o - x.i) + '</strong></td></tr>'; };
    h += '<div class="panel"><h3>부가가치세 예상 (반기별)</h3><div class="table-wrap"><table><thead><tr><th>구분</th><th class="hide-m">기간 (신고 시기)</th><th class="num">매출세액</th><th class="num">매입세액</th><th class="num">낼 세금(예상)</th></tr></thead><tbody>' +
      vatRow('1기', '1~6월 (7월 신고)', h1) + vatRow('2기', '7~12월 (다음 해 1월 신고)', h2) + '</tbody></table></div>' +
      '<p class="note">매입세액은 비용 입력 때 증빙이 세금계산서·카드·현금영수증인 것만 계산돼요. 실제 신고 금액은 세무사와 꼭 확인하세요. (참고용)</p></div>';
    var jp = D.jobs.map(function (j) {
      var s = sum(D.invoices.filter(function (i) { return i.job_id === j.id && yr(i.issue_date) === state.year; }), function (i) { return i.supply; });
      var c = sum(D.labor.filter(function (l) { return l.job_id === j.id && yr(l.work_date) === state.year; }), function (l) { return l.pay; }) + sum(D.expenses.filter(function (e) { return e.job_id === j.id && yr(e.spent_date) === state.year; }), netExp);
      return { j: j, s: s, c: c, p: s - c };
    }).filter(function (x) { return x.s || x.c; }).sort(function (a, b) { return b.p - a.p; });
    h += '<div class="panel"><h3>현장별 이익</h3><div id="jp"></div></div>';
    h += '<div class="panel"><h3>엑셀로 내보내기 <span class="muted" style="font-size:13px;font-weight:400">세무사에게 보낼 때</span></h3><div class="btn-row">' +
      [['pl', '월별 손익'], ['invoices', '매출'], ['payments', '수금'], ['expenses', '비용·자재'], ['labor', '인건비'], ['jobs', '현장'], ['clients', '거래처'], ['workers', '인력']].map(function (x) { return '<button class="btn small" data-csv="' + x[0] + '">' + x[1] + '</button>'; }).join('') +
      '</div><p class="note">' + state.year + '년 기준으로 내려받아요. (현장·거래처·인력은 전체)</p></div>';
    view.innerHTML = h;
    $('#pl').innerHTML = table([
      { l: '월', v: function (x) { return x.m + '월'; } },
      { l: '매출', num: 1, v: function (x) { return won(x.sales); } },
      { l: '인건비', num: 1, v: function (x) { return won(x.labor); } },
      { l: '자재·외주', num: 1, m: 1, v: function (x) { return won(x.mat); } },
      { l: '기타 경비', num: 1, m: 1, v: function (x) { return won(x.etc); } },
      { l: '이익', num: 1, v: function (x) { return '<strong style="color:' + (x.profit < 0 ? 'var(--red)' : 'inherit') + '">' + won(x.profit) + '</strong>'; } }
    ], M, false, '<td>합계</td><td class="num">' + won(tot('sales')) + '</td><td class="num">' + won(tot('labor')) + '</td><td class="num hide-m">' + won(tot('mat')) + '</td><td class="num hide-m">' + won(tot('etc')) + '</td><td class="num">' + won(tot('profit')) + '</td>');
    $('#jp').innerHTML = table([
      { l: '현장', v: function (x) { return '<strong>' + esc(x.j.title) + '</strong>'; } },
      { l: '매출', num: 1, v: function (x) { return won(x.s); } },
      { l: '비용', num: 1, m: 1, v: function (x) { return won(x.c); } },
      { l: '이익', num: 1, v: function (x) { return '<strong style="color:' + (x.p < 0 ? 'var(--red)' : 'var(--green)') + '">' + won(x.p) + '</strong>'; } }
    ], jp, true);
    bindRows($('#jp'), jp, function (x) { location.hash = '#/job/' + x.j.id; });
    $$('[data-csv]', view).forEach(function (b) { b.addEventListener('click', function () { exportCsv(b.dataset.csv); }); });
  }

  function exportCsv(kind) {
    var Y = state.year, cols, rows;
    if (kind === 'pl') { cols = [['월', 'm'], ['매출', 'sales'], ['매출세액', 'outVat'], ['인건비', 'labor'], ['자재·외주비', 'mat'], ['기타 경비', 'etc'], ['매입세액', 'inVat'], ['이익', 'profit']]; rows = monthly(); }
    else if (kind === 'invoices') { cols = [['발행일', 'issue_date'], ['거래처', function (r) { return clientName(r.client_id); }], ['현장', function (r) { return jobTitle(r.job_id); }], ['내용', 'title'], ['공급가액', 'supply'], ['부가세', 'vat'], ['합계', totalOf], ['받은 돈', paidOf], ['남은 돈', balanceOf], ['세금계산서', function (r) { return r.tax_invoice ? 'O' : ''; }], ['입금 약속일', 'due_date'], ['메모', 'memo']]; rows = inYear(D.invoices, 'issue_date'); }
    else if (kind === 'payments') { cols = [['받은 날', 'paid_date'], ['거래처', function (r) { var i = byId('invoices', r.invoice_id); return i ? clientName(i.client_id) : ''; }], ['금액', 'amount'], ['방법', 'method'], ['어음 만기', 'bill_due'], ['어음 결제', function (r) { return r.bill_cashed ? 'O' : ''; }], ['메모', 'memo']]; rows = inYear(D.payments, 'paid_date'); }
    else if (kind === 'expenses') { cols = [['날짜', 'spent_date'], ['항목', 'category'], ['현장', function (r) { return jobTitle(r.job_id); }], ['구매처', 'vendor'], ['품목', 'item'], ['수량', 'qty'], ['금액', 'amount'], ['부가세', 'vat'], ['증빙', 'evidence'], ['결제', 'pay_method'], ['메모', 'memo']]; rows = inYear(D.expenses, 'spent_date'); }
    else if (kind === 'labor') { cols = [['작업일', 'work_date'], ['작업자', function (r) { return workerName(r.worker_id); }], ['현장', function (r) { return jobTitle(r.job_id); }], ['공수', 'days'], ['지급액', 'pay'], ['지급', function (r) { return r.paid ? 'O' : ''; }], ['지급일', 'paid_date'], ['메모', 'memo']]; rows = inYear(D.labor, 'work_date'); }
    else if (kind === 'jobs') { cols = [['현장', 'title'], ['거래처', function (r) { return clientName(r.client_id); }], ['작업', 'work_type'], ['용량', 'capacity'], ['상태', 'status'], ['시작일', 'start_date'], ['종료일', 'end_date'], ['계약 금액', 'amount'], ['메모', 'memo']]; rows = D.jobs; }
    else if (kind === 'clients') { cols = [['거래처', 'name'], ['구분', 'kind'], ['담당자', 'manager'], ['연락처', 'phone'], ['사업자번호', 'biz_no'], ['주소', 'address'], ['메모', 'memo']]; rows = D.clients; }
    else { cols = [['이름', 'name'], ['연락처', 'phone'], ['일당', 'daily_wage'], ['기술', 'skill'], ['계좌', 'bank'], ['같이 일함', function (r) { return r.active ? 'O' : ''; }], ['메모', 'memo']]; rows = D.workers; }
    var q = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = [cols.map(function (c) { return q(c[0]); }).join(',')].concat(rows.map(function (r) { return cols.map(function (c) { return q(typeof c[1] === 'function' ? c[1](r) : r[c[1]]); }).join(','); }));
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '두레이엔지_' + ({ pl: '월별손익', invoices: '매출', payments: '수금', expenses: '비용자재', labor: '인건비', jobs: '현장', clients: '거래처', workers: '인력' }[kind]) + (['jobs', 'clients', 'workers'].indexOf(kind) < 0 ? '_' + Y : '') + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // ================= 화면 이동 =================
  function route() {
    var p = (location.hash || '#/home').slice(2).split('/');
    var page = p[0] || 'home';
    drawNav(page === 'job' ? 'jobs' : page);
    if (page === 'jobs') pageJobs();
    else if (page === 'job') pageJob(p[1]);
    else if (page === 'sales') pageSales(p[1]);
    else if (page === 'costs') pageCosts();
    else if (page === 'people') pagePeople(p[1]);
    else if (page === 'clients') pageClients();
    else if (page === 'books') pageBooks();
    else pageHome();
  }
  window.addEventListener('hashchange', function () { closeDlg(); route(); view.focus(); window.scrollTo(0, 0); });

  // ================= 로그인 (아이디 + 비밀번호 + 보안 질문) =================
  var loginMsg = $('#login-msg');
  function showLogin(step) {
    $('#app').hidden = true; $('#login').hidden = false;
    $('#login-form').hidden = step !== 'pw'; $('#q-form').hidden = step !== 'q';
  }
  async function askQuestion() {
    var r = await db.rpc('get_admin_question');
    showLogin('q');
    if (r.error) { $('#q-text').textContent = /locked/.test(r.error.message) ? '보안 질문을 5번 틀려서 30분 동안 잠겼습니다.' : '보안 질문을 불러오지 못했습니다.'; $('#q-btn').disabled = true; return; }
    $('#q-btn').disabled = false; $('#q-text').textContent = r.data; $('#q-ans').value = ''; $('#q-ans').focus();
  }
  async function status() {
    var s = await db.auth.getSession();
    if (!s.data || !s.data.session) return 'none';
    var r = await db.rpc('admin_status');
    return r.error ? 'none' : r.data;
  }
  async function start() {
    var st = await status();
    if (st === 'verified') {
      $('#login').hidden = true; $('#app').hidden = false;
      view.innerHTML = '<p class="empty">불러오는 중…</p>';
      try { await loadAll(); } catch (e) { view.innerHTML = '<p class="empty">데이터를 불러오지 못했습니다. (erp.sql 실행 여부를 확인해 주세요)</p>'; return; }
      route();
    } else if (st === 'need_answer' || st === 'locked') { await askQuestion(); }
    else { if (st !== 'none') await db.auth.signOut(); showLogin('pw'); $('#l-id').focus(); }
  }
  async function checkSession() { var st = await status(); if (st !== 'verified') { toast('로그인이 만료되어 다시 확인합니다'); start(); } }
  $('#login-form').addEventListener('submit', async function (e) {
    e.preventDefault(); loginMsg.textContent = '';
    var id = $('#l-id').value.trim();
    if (id.indexOf('@') < 0) { var m = await db.rpc('resolve_admin_login', { p_login: id }); id = m && m.data ? m.data : ''; }
    if (!id) { loginMsg.textContent = '아이디 또는 비밀번호가 맞지 않습니다.'; return; }
    var r = await db.auth.signInWithPassword({ email: id.toLowerCase(), password: $('#l-pw').value });
    if (r.error) { loginMsg.textContent = '아이디 또는 비밀번호가 맞지 않습니다.'; return; }
    $('#l-pw').value = '';
    var st = await status();
    if (st === 'none') { await db.auth.signOut(); loginMsg.textContent = '사용 권한이 없는 계정입니다.'; return; }
    start();
  });
  $('#q-form').addEventListener('submit', async function (e) {
    e.preventDefault(); loginMsg.textContent = '';
    var r = await db.rpc('verify_admin_answer', { ans: $('#q-ans').value });
    if (r.error) { if (/locked/.test(r.error.message)) { $('#q-text').textContent = '보안 질문을 5번 틀려서 30분 동안 잠겼습니다.'; $('#q-btn').disabled = true; } else loginMsg.textContent = '확인 중 문제가 생겼습니다.'; return; }
    if (r.data !== true) { loginMsg.textContent = '답이 맞지 않습니다. (5번 틀리면 30분 잠금)'; return; }
    start();
  });
  $('#q-cancel').addEventListener('click', async function () { await db.auth.signOut(); loginMsg.textContent = ''; showLogin('pw'); });
  $('#logout').addEventListener('click', async function () { await db.rpc('admin_logout'); await db.auth.signOut(); showLogin('pw'); });
  $('#refresh').addEventListener('click', async function () { await checkSession(); await loadAll(); route(); toast('최신 내용으로 불러왔습니다'); });
  var ysel = $('#year'), cy = new Date().getFullYear();
  for (var y = cy + 1; y >= 2013; y--) ysel.insertAdjacentHTML('beforeend', '<option value="' + y + '"' + (y === cy ? ' selected' : '') + '>' + y + '년</option>');
  ysel.addEventListener('change', function () { state.year = Number(ysel.value); expMonth = ''; route(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && !$('#app').hidden) checkSession(); });

  start();
})();
