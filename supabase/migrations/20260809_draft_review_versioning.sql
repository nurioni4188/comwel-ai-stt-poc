-- Draft review/versioning migration for COMWEL AI STT PoC
-- Apply only after verifying the current Production stt_poc.drafts schema.

alter table stt_poc.drafts
  add column if not exists version_no integer,
  add column if not exists source_type text,
  add column if not exists status text,
  add column if not exists is_current boolean,
  add column if not exists parent_draft_id uuid,
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_by text;

alter table stt_poc.drafts
  add constraint drafts_parent_draft_id_fkey
  foreign key (parent_draft_id)
  references stt_poc.drafts(id)
  on delete set null;

with ranked as (
  select
    id,
    row_number() over (
      partition by session_id
      order by created_at asc, id asc
    ) as version_no,
    row_number() over (
      partition by session_id
      order by updated_at desc, created_at desc, id desc
    ) as current_rank
  from stt_poc.drafts
)
update stt_poc.drafts d
set
  version_no = coalesce(d.version_no, ranked.version_no),
  source_type = coalesce(
    d.source_type,
    case
      when d.draft_type = 'complaint_summary_extractive_v1' then 'extractive'
      else 'staff'
    end
  ),
  status = coalesce(
    d.status,
    case when ranked.current_rank = 1 then 'draft' else 'superseded' end
  ),
  is_current = coalesce(d.is_current, ranked.current_rank = 1)
from ranked
where d.id = ranked.id;

alter table stt_poc.drafts
  alter column version_no set not null,
  alter column source_type set not null,
  alter column status set not null,
  alter column is_current set not null,
  alter column is_current set default true,
  alter column status set default 'draft';

alter table stt_poc.drafts
  add constraint drafts_version_no_positive_check
  check (version_no > 0),
  add constraint drafts_source_type_check
  check (source_type in ('extractive', 'staff', 'generative_ai')),
  add constraint drafts_status_check
  check (status in ('draft', 'confirmed', 'superseded'));

create unique index if not exists drafts_session_version_uidx
  on stt_poc.drafts(session_id, version_no);

create unique index if not exists drafts_one_current_per_session_uidx
  on stt_poc.drafts(session_id)
  where is_current = true;

create index if not exists drafts_parent_draft_id_idx
  on stt_poc.drafts(parent_draft_id);

create or replace function stt_poc.save_staff_draft(
  p_session_id uuid,
  p_content text,
  p_actor text default null
)
returns stt_poc.drafts
language plpgsql
security definer
set search_path = stt_poc, public
as $$
declare
  v_current stt_poc.drafts;
  v_next_version integer;
  v_new stt_poc.drafts;
begin
  if nullif(btrim(p_content), '') is null then
    raise exception 'draft content must not be empty';
  end if;

  if length(p_content) > 4000 then
    raise exception 'draft content is too long';
  end if;

  perform 1
  from stt_poc.call_sessions
  where id = p_session_id
    and status = 'completed';

  if not found then
    raise exception 'completed session not found';
  end if;

  select *
  into v_current
  from stt_poc.drafts
  where session_id = p_session_id
    and is_current = true
  order by version_no desc
  limit 1
  for update;

  select coalesce(max(version_no), 0) + 1
  into v_next_version
  from stt_poc.drafts
  where session_id = p_session_id;

  if v_current.id is not null then
    update stt_poc.drafts
    set
      status = 'superseded',
      is_current = false,
      updated_at = now()
    where id = v_current.id;
  end if;

  insert into stt_poc.drafts (
    session_id,
    draft_type,
    content,
    version_no,
    source_type,
    status,
    is_current,
    parent_draft_id,
    updated_at
  ) values (
    p_session_id,
    'complaint_summary_staff_v1',
    btrim(p_content),
    v_next_version,
    'staff',
    'draft',
    true,
    v_current.id,
    now()
  )
  returning * into v_new;

  return v_new;
end;
$$;

create or replace function stt_poc.confirm_current_draft(
  p_session_id uuid,
  p_actor text default null
)
returns stt_poc.drafts
language plpgsql
security definer
set search_path = stt_poc, public
as $$
declare
  v_current stt_poc.drafts;
begin
  select *
  into v_current
  from stt_poc.drafts
  where session_id = p_session_id
    and is_current = true
  order by version_no desc
  limit 1
  for update;

  if v_current.id is null then
    raise exception 'current draft not found';
  end if;

  update stt_poc.drafts
  set
    status = 'confirmed',
    confirmed_at = coalesce(confirmed_at, now()),
    confirmed_by = coalesce(nullif(btrim(p_actor), ''), confirmed_by, 'staff'),
    updated_at = now()
  where id = v_current.id
  returning * into v_current;

  return v_current;
end;
$$;

revoke all on function stt_poc.save_staff_draft(uuid, text, text) from public, anon, authenticated;
revoke all on function stt_poc.confirm_current_draft(uuid, text) from public, anon, authenticated;
grant execute on function stt_poc.save_staff_draft(uuid, text, text) to service_role;
grant execute on function stt_poc.confirm_current_draft(uuid, text) to service_role;
