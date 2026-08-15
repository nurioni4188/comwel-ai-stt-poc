-- Quality evaluation dataset for COMWEL AI STT PoC v0.5.0
-- Apply after 20260809_draft_review_versioning.sql and 20260809_ai_summary_refine.sql.

create table if not exists stt_poc.draft_evaluations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references stt_poc.call_sessions(id) on delete cascade,
  ai_draft_id uuid not null references stt_poc.drafts(id) on delete restrict,
  staff_draft_id uuid not null references stt_poc.drafts(id) on delete restrict,
  overall_rating text not null,
  fact_omission boolean not null default false,
  fact_distortion boolean not null default false,
  hallucination boolean not null default false,
  request_omission boolean not null default false,
  confirmation_omission boolean not null default false,
  stt_error_impact boolean not null default false,
  other_issue boolean not null default false,
  reviewer_note text,
  edit_distance integer not null default 0,
  edit_ratio numeric(7,6) not null default 0,
  ai_char_count integer not null default 0,
  staff_char_count integer not null default 0,
  review_duration_ms bigint,
  model_name text,
  schema_version text not null default 'quality_evaluation_v1',
  evaluated_by text not null default 'staff',
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint draft_evaluations_overall_rating_check
    check (overall_rating in ('accurate', 'minor_edit', 'major_edit', 'unusable')),
  constraint draft_evaluations_edit_distance_check
    check (edit_distance >= 0),
  constraint draft_evaluations_edit_ratio_check
    check (edit_ratio >= 0 and edit_ratio <= 1),
  constraint draft_evaluations_char_count_check
    check (ai_char_count >= 0 and staff_char_count >= 0),
  constraint draft_evaluations_review_duration_check
    check (review_duration_ms is null or review_duration_ms >= 0),
  constraint draft_evaluations_reviewer_note_length_check
    check (reviewer_note is null or length(reviewer_note) <= 2000)
);

create unique index if not exists draft_evaluations_session_uidx
  on stt_poc.draft_evaluations(session_id);

create index if not exists draft_evaluations_rating_idx
  on stt_poc.draft_evaluations(overall_rating, evaluated_at desc);

create index if not exists draft_evaluations_ai_draft_idx
  on stt_poc.draft_evaluations(ai_draft_id);

create index if not exists draft_evaluations_staff_draft_idx
  on stt_poc.draft_evaluations(staff_draft_id);

create or replace function stt_poc.save_quality_evaluation(
  p_session_id uuid,
  p_overall_rating text,
  p_fact_omission boolean default false,
  p_fact_distortion boolean default false,
  p_hallucination boolean default false,
  p_request_omission boolean default false,
  p_confirmation_omission boolean default false,
  p_stt_error_impact boolean default false,
  p_other_issue boolean default false,
  p_reviewer_note text default null,
  p_edit_distance integer default 0,
  p_edit_ratio numeric default 0,
  p_ai_char_count integer default 0,
  p_staff_char_count integer default 0,
  p_review_duration_ms bigint default null,
  p_model_name text default null,
  p_schema_version text default 'quality_evaluation_v1',
  p_actor text default 'staff'
)
returns stt_poc.draft_evaluations
language plpgsql
security definer
set search_path = stt_poc, public
as $$
declare
  v_ai stt_poc.drafts;
  v_staff stt_poc.drafts;
  v_result stt_poc.draft_evaluations;
begin
  if p_overall_rating not in ('accurate', 'minor_edit', 'major_edit', 'unusable') then
    raise exception 'invalid overall rating';
  end if;

  if p_edit_distance < 0 or p_edit_ratio < 0 or p_edit_ratio > 1 then
    raise exception 'invalid edit metrics';
  end if;

  select * into v_ai
  from stt_poc.drafts
  where session_id = p_session_id
    and source_type = 'ai'
  order by version_no desc
  limit 1;

  if v_ai.id is null then
    raise exception 'AI refined draft not found';
  end if;

  select * into v_staff
  from stt_poc.drafts
  where session_id = p_session_id
    and source_type = 'staff'
    and status = 'confirmed'
    and is_current = true
  order by version_no desc
  limit 1;

  if v_staff.id is null then
    raise exception 'confirmed staff draft not found';
  end if;

  insert into stt_poc.draft_evaluations (
    session_id,
    ai_draft_id,
    staff_draft_id,
    overall_rating,
    fact_omission,
    fact_distortion,
    hallucination,
    request_omission,
    confirmation_omission,
    stt_error_impact,
    other_issue,
    reviewer_note,
    edit_distance,
    edit_ratio,
    ai_char_count,
    staff_char_count,
    review_duration_ms,
    model_name,
    schema_version,
    evaluated_by,
    evaluated_at,
    updated_at
  ) values (
    p_session_id,
    v_ai.id,
    v_staff.id,
    p_overall_rating,
    coalesce(p_fact_omission, false),
    coalesce(p_fact_distortion, false),
    coalesce(p_hallucination, false),
    coalesce(p_request_omission, false),
    coalesce(p_confirmation_omission, false),
    coalesce(p_stt_error_impact, false),
    coalesce(p_other_issue, false),
    nullif(btrim(p_reviewer_note), ''),
    p_edit_distance,
    p_edit_ratio,
    p_ai_char_count,
    p_staff_char_count,
    p_review_duration_ms,
    nullif(btrim(p_model_name), ''),
    coalesce(nullif(btrim(p_schema_version), ''), 'quality_evaluation_v1'),
    coalesce(nullif(btrim(p_actor), ''), 'staff'),
    now(),
    now()
  )
  on conflict (session_id) do update set
    ai_draft_id = excluded.ai_draft_id,
    staff_draft_id = excluded.staff_draft_id,
    overall_rating = excluded.overall_rating,
    fact_omission = excluded.fact_omission,
    fact_distortion = excluded.fact_distortion,
    hallucination = excluded.hallucination,
    request_omission = excluded.request_omission,
    confirmation_omission = excluded.confirmation_omission,
    stt_error_impact = excluded.stt_error_impact,
    other_issue = excluded.other_issue,
    reviewer_note = excluded.reviewer_note,
    edit_distance = excluded.edit_distance,
    edit_ratio = excluded.edit_ratio,
    ai_char_count = excluded.ai_char_count,
    staff_char_count = excluded.staff_char_count,
    review_duration_ms = excluded.review_duration_ms,
    model_name = excluded.model_name,
    schema_version = excluded.schema_version,
    evaluated_by = excluded.evaluated_by,
    evaluated_at = now(),
    updated_at = now()
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on table stt_poc.draft_evaluations from public, anon, authenticated;
revoke all on function stt_poc.save_quality_evaluation(
  uuid, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean,
  text, integer, numeric, integer, integer, bigint, text, text, text
) from public, anon, authenticated;

grant select, insert, update on table stt_poc.draft_evaluations to service_role;
grant execute on function stt_poc.save_quality_evaluation(
  uuid, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean,
  text, integer, numeric, integer, integer, bigint, text, text, text
) to service_role;
