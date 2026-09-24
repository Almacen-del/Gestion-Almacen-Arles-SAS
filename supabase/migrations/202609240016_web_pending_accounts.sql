begin;
-- Registration makes the account visible to administrators; it grants no access.
create function public.web_queue_registered_account() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if lower(coalesce(new.email,'')) ~ '^[^[:space:]@]+@arlessas[.]com$' then
  insert into public.web_profiles(user_id,display_name,job_title,role,active,approved)
  values(new.id,left(coalesce(nullif(btrim(new.raw_user_meta_data->>'display_name'),''),new.email),160),left(coalesce(new.raw_user_meta_data->>'job_title',''),160),'READER',false,false)
  on conflict(user_id) do nothing;
 end if;
 return new;
end $$;
revoke all on function public.web_queue_registered_account() from public,anon,authenticated;
create trigger web_queue_registered_account after insert or update of email on auth.users
for each row execute function public.web_queue_registered_account();
insert into public.web_profiles(user_id,display_name,job_title,role,active,approved)
select id,left(coalesce(nullif(btrim(raw_user_meta_data->>'display_name'),''),email),160),left(coalesce(raw_user_meta_data->>'job_title',''),160),'READER',false,false
from auth.users where lower(coalesce(email,'')) ~ '^[^[:space:]@]+@arlessas[.]com$'
on conflict(user_id) do nothing;
commit;
