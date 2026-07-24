-- 0157_runtime_health_alert_settings.sql
-- UI-editable alert thresholds/cadence for the Runtime Health monitor.
-- Singleton config row; RLS deny-all (service_role bypasses).

create table public.runtime_health_alert_settings (
  setting_key             text primary key default 'default',
  enabled                 boolean not null default true,
  recipient_emails        text[] not null default '{}',
  email_level             text not null default 'critical' check (email_level in ('warning', 'critical')),
  check_interval_minutes  int not null default 15  check (check_interval_minutes between 1 and 1440),
  cooldown_minutes        int not null default 360 check (cooldown_minutes between 0 and 10080),
  conn_warn_pct           int not null default 70  check (conn_warn_pct between 1 and 100),
  conn_crit_pct           int not null default 90  check (conn_crit_pct between 1 and 100),
  redis_warn_pct          int not null default 75  check (redis_warn_pct between 1 and 100),
  redis_crit_pct          int not null default 90  check (redis_crit_pct between 1 and 100),
  disk_warn_pct           int not null default 80  check (disk_warn_pct between 1 and 100),
  disk_crit_pct           int not null default 90  check (disk_crit_pct between 1 and 100),
  queue_backlog_warn      int not null default 500  check (queue_backlog_warn >= 0),
  queue_backlog_crit      int not null default 2000 check (queue_backlog_crit >= 0),
  updated_at              timestamptz not null default now(),
  updated_by              uuid
);

alter table public.runtime_health_alert_settings enable row level security;
-- No policies: only the service_role (BYPASSRLS) may read/write.

insert into public.runtime_health_alert_settings (setting_key) values ('default')
on conflict (setting_key) do nothing;
