-- AI summary refinement versioning for COMWEL AI STT PoC

alter table stt_poc.drafts
  drop constraint if exists drafts_source_type_check;

alter table stt_poc.drafts
  add constraint drafts_source_type_check
  check (source_type in ('extractive', 'ai', 'staff', 'generative_ai'));

create or replace function stt_poc.save_ai_refined_draft(
  p_session_id uuid,
  p_content text
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
    raise exception 'AI refined draft content must not be empty';
  end if;

  if length(p_content) > 4000 then
    raise exception 'AI refined draft content is too long';
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

  if v_current.id is null then
    raise exception 'current draft not found';
  end if;

  if v_current.status = 'confirmed' then
    raise exception 'confirmed draft cannot be refined';
  end if;

  if v_current.source_type <> 'extractive' then
    raise exception 'AI refinement requires a current extractive draft';
  end if;

  select coalesce(max(version_no), 0) + 1
  into v_next_version
  from stt_poc.drafts
  where session_id = p_session_id;

  update stt_poc.drafts
  set
    status = 'superseded',
    is_current = false,
    updated_at = now()
  where id = v_current.id;

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
    'complaint_summary_ai_refined_v1',
    btrim(p_content),
    v_next_version,
    'ai',
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

  if v_current.source_type <> 'staff' then
    raise exception 'only a staff-reviewed draft can be confirmed';
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

revoke all on function stt_poc.save_ai_refined_draft(uuid, text)
  from public, anon, authenticated;
revoke all on function stt_poc.confirm_current_draft(uuid, text)
  from public, anon, authenticated;
grant execute on function stt_poc.save_ai_refined_draft(uuid, text)
  to service_role;
grant execute on function stt_poc.confirm_current_draft(uuid, text)
  to service_role;
