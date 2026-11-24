-- ============================================================
-- 두레이엔지 업무관리(ERP) 데이터베이스
-- Supabase SQL Editor 에서 한 번 실행하세요. (다시 실행해도 안전)
-- 홈페이지 때 만든 관리자 2단계 로그인(is_admin)을 그대로 사용합니다.
-- 모든 데이터는 2단계 로그인을 통과한 관리자만 보고 고칠 수 있습니다.
-- ============================================================

-- 거래처 (원청사, 시설관리업체, 건물주, 자재 구매처 등)
create table if not exists public.erp_clients (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name       text not null check (char_length(name) between 1 and 60),
  kind       text,
  manager    text,
  phone      text,
  biz_no     text,
  address    text,
  memo       text
);

-- 인력 (고정·일용직 기술자)
create table if not exists public.erp_workers (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name       text not null check (char_length(name) between 1 and 30),
  phone      text,
  daily_wage integer check (daily_wage is null or daily_wage >= 0),
  skill      text,
  bank       text,
  active     boolean not null default true,
  memo       text
);

-- 현장 (공사)
create table if not exists public.erp_jobs (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  title      text not null check (char_length(title) between 1 and 80),
  client_id  uuid references public.erp_clients (id) on delete set null,
  work_type  text,
  capacity   text,
  start_date date,
  end_date   date,
  status     text not null default '예정',
  amount     bigint check (amount is null or amount >= 0),
  memo       text
);

-- 현장 체크리스트 (휴대폰으로 현장에서 체크)
create table if not exists public.erp_job_checks (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  job_id     uuid not null references public.erp_jobs (id) on delete cascade,
  text       text not null check (char_length(text) between 1 and 200),
  done       boolean not null default false
);

-- 인건비 (출역 기록, 지급 여부)
create table if not exists public.erp_labor (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  work_date  date not null,
  worker_id  uuid not null references public.erp_workers (id) on delete restrict,
  job_id     uuid references public.erp_jobs (id) on delete set null,
  days       numeric(4,1) not null default 1 check (days > 0),
  pay        bigint not null check (pay >= 0),
  paid       boolean not null default false,
  paid_date  date,
  memo       text
);

-- 비용·자재 구매
create table if not exists public.erp_expenses (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  spent_date date not null,
  category   text not null,
  job_id     uuid references public.erp_jobs (id) on delete set null,
  vendor     text,
  item       text,
  qty        text,
  amount     bigint not null check (amount >= 0),
  vat        bigint not null default 0 check (vat >= 0),
  evidence   text,
  pay_method text,
  memo       text
);

-- 매출 (세금계산서 / 청구)
create table if not exists public.erp_invoices (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  issue_date  date not null,
  client_id   uuid references public.erp_clients (id) on delete set null,
  job_id      uuid references public.erp_jobs (id) on delete set null,
  title       text,
  supply      bigint not null check (supply >= 0),
  vat         bigint not null default 0 check (vat >= 0),
  tax_invoice boolean not null default true,
  due_date    date,
  memo        text
);

-- 수금 (입금, 어음)
create table if not exists public.erp_payments (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  invoice_id  uuid not null references public.erp_invoices (id) on delete cascade,
  paid_date   date not null,
  amount      bigint not null check (amount > 0),
  method      text,
  bill_due    date,
  bill_cashed boolean not null default false,
  memo        text
);

create index if not exists erp_labor_date_idx    on public.erp_labor (work_date desc);
create index if not exists erp_expenses_date_idx on public.erp_expenses (spent_date desc);
create index if not exists erp_invoices_date_idx on public.erp_invoices (issue_date desc);
create index if not exists erp_payments_inv_idx  on public.erp_payments (invoice_id);
create index if not exists erp_checks_job_idx    on public.erp_job_checks (job_id);

-- 보안 규칙: 관리자(2단계 통과)만 전체 권한, 방문자는 접근 불가
do $$
declare t text;
begin
  foreach t in array array['erp_clients','erp_workers','erp_jobs','erp_job_checks','erp_labor','erp_expenses','erp_invoices','erp_payments']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists "admin all" on public.%I', t);
    execute format('create policy "admin all" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;
