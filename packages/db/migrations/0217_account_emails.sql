-- 0217: the addresses of a list of accounts, in one call (operator ruling 215).
--
-- THE NEED. A notice that goes to an account must be mailed to that account's own address. The
-- API read it one account at a time through GoTrue's admin door (`getAuthAdminUser`), which is
-- right for one referee and wrong for the notice of a new Event: that one goes to every follower
-- of an organisation, up to 5,000. GoTrue lists accounts by page, never by a list of ids, and
-- PostgREST does not expose the `auth` schema. So the notice took the address of a follower's
-- first roster row instead, and a follower who is on no roster got no email at all.
--
-- WHAT THIS ADDS. `account_emails(uuid[])` answers one row per account that exists and has an
-- address: its id and its address, as GoTrue holds it. An id that names no account has no row.
--
-- WHO MAY CALL IT. The API only, through the service-role client. The function reads `auth.users`
-- and is SECURITY DEFINER for that reason, so it is closed to everyone else by name: PostgREST
-- serves every function of `public` at `/rpc/<name>`, and the image grants EXECUTE on new
-- functions to anon and authenticated by default (a REVOKE from PUBLIC alone leaves those).
-- An open call would hand any visitor the address behind any account id.
--
-- `search_path` is empty, and the table and the cast are spelled with their schema: a definer
-- function that resolves names through a caller's path can be made to run the caller's objects.
--
-- WHO IS ASKED FOR. Only the ids in the list: the API asks for the followers it is about to tell.
-- An account is answered as GoTrue holds it, as the one-account door does (`getAuthAdminUser`):
-- no filter on a suspended account, and an address under change is the old, confirmed one.

create or replace function public.account_emails(p_user_ids uuid[])
returns table (user_id uuid, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.email::pg_catalog.text
    from auth.users u
   where u.id = any (p_user_ids)
     and u.email is not null
     and u.email <> '';
$$;

revoke all on function public.account_emails(uuid[]) from public;
revoke execute on function public.account_emails(uuid[]) from anon, authenticated;
grant execute on function public.account_emails(uuid[]) to service_role;

-- PostgREST serves a function it knows of: without a reload a deploy over a running stack
-- answers "function not found" until its next restart.
notify pgrst, 'reload schema';
