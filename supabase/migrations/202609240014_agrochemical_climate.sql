begin;
create table public.agrochemical_climate_readings (
 id uuid primary key,
 period text not null check (period in ('AM','PM')),
 reading_date date not null,
 temperature_c numeric not null check (temperature_c between -50 and 100),
 humidity_percent numeric not null check (humidity_percent between 0 and 100),
 measured_at timestamptz not null check (isfinite(measured_at)),
 notes text not null default '' check (length(notes)<=1000),
 created_by uuid not null references auth.users(id),
 responsible_name text not null,
 created_at timestamptz not null default now(),
 check (reading_date=(measured_at at time zone 'America/Bogota')::date),
 unique(reading_date,period)
);
comment on table public.agrochemical_climate_readings is 'Bodega Azul: una medición de mañana y una de tarde por fecha de Colombia';
create index agrochemical_climate_date on public.agrochemical_climate_readings(measured_at desc,id);
alter table public.agrochemical_climate_readings enable row level security;
alter table public.agrochemical_climate_readings force row level security;
revoke all on public.agrochemical_climate_readings from public,anon,authenticated;

create function public.climate_record_reading(p_id uuid,p_period text,p_temperature_c numeric,p_humidity_percent numeric,p_measured_at timestamptz,p_notes text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.operators; prior public.agrochemical_climate_readings; day date;
begin
 select * into actor from public.operators where user_id=auth.uid() and active and role in ('ADMIN','OPERATOR');
 if actor.user_id is null then raise exception 'Acceso no autorizado' using errcode='42501'; end if;
 if p_id is null or p_period is null or p_period not in ('AM','PM')
 or p_temperature_c is null or not (p_temperature_c between -50 and 100)
 or p_humidity_percent is null or not (p_humidity_percent between 0 and 100)
 or p_measured_at is null or not isfinite(p_measured_at) or p_measured_at>now()
 or p_notes is null or length(p_notes)>1000 then raise exception 'Medición inválida' using errcode='22023'; end if;
 day:=(p_measured_at at time zone 'America/Bogota')::date;
 perform pg_advisory_xact_lock(hashtextextended('climate:'||p_id,0));
 select * into prior from public.agrochemical_climate_readings where id=p_id;
 if found then
   if prior.created_by<>auth.uid() or prior.period<>p_period or prior.temperature_c<>p_temperature_c
   or prior.humidity_percent<>p_humidity_percent or prior.measured_at<>p_measured_at or prior.notes<>p_notes
   then raise exception 'Identificador ya utilizado para otra medición' using errcode='22023'; end if;
   return jsonb_build_object('id',prior.id,'status','confirmed');
 end if;
 perform pg_advisory_xact_lock(hashtextextended('climate-day:'||day||':'||p_period,0));
 if exists(select 1 from public.agrochemical_climate_readings where reading_date=day and period=p_period)
 then raise exception 'Ya existe una medición para esta fecha y turno' using errcode='23505'; end if;
 insert into public.agrochemical_climate_readings(id,period,reading_date,temperature_c,humidity_percent,measured_at,notes,created_by,responsible_name)
 values(p_id,p_period,day,p_temperature_c,p_humidity_percent,p_measured_at,p_notes,auth.uid(),actor.display_name);
 return jsonb_build_object('id',p_id,'status','confirmed');
end $$;

create function public.climate_readings_page(p_before timestamptz default null,p_limit integer default 500)
returns setof public.agrochemical_climate_readings language plpgsql security definer set search_path='' as $$
begin
 perform public.web_require_access(false);
 if p_limit is null or p_limit not between 1 and 500 then raise exception 'Filtro inválido'; end if;
 return query select * from public.agrochemical_climate_readings r
 where p_before is null or r.measured_at<p_before order by r.measured_at desc,r.id limit p_limit;
end $$;

create function public.climate_day_readings(p_day date)
returns setof public.agrochemical_climate_readings language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.operators where user_id=auth.uid() and active and role in ('ADMIN','OPERATOR'))
 then raise exception 'Acceso no autorizado' using errcode='42501'; end if;
 return query select * from public.agrochemical_climate_readings where reading_date=p_day order by period;
end $$;
revoke all on function public.climate_record_reading(uuid,text,numeric,numeric,timestamptz,text) from public,anon;
revoke all on function public.climate_readings_page(timestamptz,integer) from public,anon;
revoke all on function public.climate_day_readings(date) from public,anon;
grant execute on function public.climate_record_reading(uuid,text,numeric,numeric,timestamptz,text) to authenticated;
grant execute on function public.climate_readings_page(timestamptz,integer) to authenticated;
grant execute on function public.climate_day_readings(date) to authenticated;
notify pgrst, 'reload schema';
commit;
