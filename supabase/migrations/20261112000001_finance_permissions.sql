-- Finance audit: incremental permission closure. No data rewrites.
revoke insert, update, delete, truncate on public.wallets, public.economy_transactions,
 public.economy_daily, public.economy_config, public.cash_purchases, public.promotions,
 public.account_financial_cases, public.account_financial_case_events,
 public.account_financial_case_items from public, anon, authenticated, service_role;
revoke all on function public._forbid_financial_case_delete() from public, anon, authenticated;
-- Internal helpers remain in public for compatibility, but are not callable by API clients.
alter function public._wallet_ensure_row(uuid) set search_path = '';
revoke all on function public._wallet_ensure_row(uuid) from public, anon, authenticated;
alter function public._wallet_credit_coins(uuid,numeric) set search_path = '';
revoke all on function public._wallet_credit_coins(uuid,numeric) from public, anon, authenticated;
alter function public._wallet_debit_coins(uuid,numeric) set search_path = '';
revoke all on function public._wallet_debit_coins(uuid,numeric) from public, anon, authenticated;
alter function public._wallet_credit_cash(uuid,numeric) set search_path = '';
revoke all on function public._wallet_credit_cash(uuid,numeric) from public, anon, authenticated;
alter function public._wallet_debit_cash(uuid,numeric) set search_path = '';
revoke all on function public._wallet_debit_cash(uuid,numeric) from public, anon, authenticated;
alter function public._ledger_record(uuid,text,text,text,numeric,text,text,text) set search_path = '';
revoke all on function public._ledger_record(uuid,text,text,text,numeric,text,text,text) from public, anon, authenticated;
alter function public._ledger_already_recorded(uuid,text) set search_path = '';
revoke all on function public._ledger_already_recorded(uuid,text) from public, anon, authenticated;
