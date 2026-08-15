-- v0.6.0 complaint routing classification dataset

create table if not exists stt_poc.complaint_classifications (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references stt_poc.call_sessions(id) on delete cascade,
  source_draft_id uuid not null references stt_poc.drafts(id) on delete restrict,
  primary_category text not null,
  issues text[] not null default '{}',
  confidence numeric(5,4) not null default 0,
  needs_review boolean not null default true,
  rationale text,
  model_name text,
  schema_version text not null default 'complaint_classification_v1',
  classified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint complaint_classifications_category_check check (
    primary_category in (
      'workers_compensation',
      'employment_insurance',
      'insurance_eligibility',
      'premium_collection',
      'wage_claims',
      'welfare',
      'certificate_general',
      'institutional_operations',
      'other'
    )
  ),
  constraint complaint_classifications_confidence_check check (
    confidence >= 0 and confidence <= 1
  ),
  constraint complaint_classifications_rationale_length_check check (
    rationale is null or length(rationale) <= 1000
  ),
  constraint complaint_classifications_issues_check check (
    issues <@ array[
      'application_eligibility',
      'required_documents',
      'employer_confirmation',
      'procedure',
      'processing_time',
      'reason_explanation',
      'appeal',
      'correction_change',
      'retroactive_application',
      'payment_benefit',
      'other'
    ]::text[]
  )
);

create unique index if not exists complaint_classifications_session_uidx
  on stt_poc.complaint_classifications(session_id);
create index if not exists complaint_classifications_category_idx
  on stt_poc.complaint_classifications(primary_category, classified_at desc);
create index if not exists complaint_classifications_review_idx
  on stt_poc.complaint_classifications(needs_review, classified_at desc);
create index if not exists complaint_classifications_issues_gin_idx
  on stt_poc.complaint_classifications using gin(issues);

alter table stt_poc.complaint_classifications enable row level security;

create or replace function stt_poc.save_complaint_classification(
  p_session_id uuid,
  p_primary_category text,
  p_issues text[] default '{}',
  p_confidence numeric default 0,
  p_needs_review boolean default true,
  p_rationale text default null,
  p_model_name text default null,
  p_schema_version text default 'complaint_classification_v1'
)
returns stt_poc.complaint_classifications
language plpgsql
security definer
set search_path = stt_poc, public
as $$
declare
  v_staff stt_poc.drafts;
  v_result stt_poc.complaint_classifications;
begin
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

  insert into stt_poc.complaint_classifications (
    session_id, source_draft_id, primary_category, issues,
    confidence, needs_review, rationale, model_name, schema_version,
    classified_at, updated_at
  ) values (
    p_session_id, v_staff.id, p_primary_category, coalesce(p_issues, '{}'),
    p_confidence, coalesce(p_needs_review, true), nullif(btrim(p_rationale), ''),
    nullif(btrim(p_model_name), ''),
    coalesce(nullif(btrim(p_schema_version), ''), 'complaint_classification_v1'),
    now(), now()
  )
  on conflict (session_id) do update set
    source_draft_id = excluded.source_draft_id,
    primary_category = excluded.primary_category,
    issues = excluded.issues,
    confidence = excluded.confidence,
    needs_review = excluded.needs_review,
    rationale = excluded.rationale,
    model_name = excluded.model_name,
    schema_version = excluded.schema_version,
    classified_at = now(),
    updated_at = now()
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on table stt_poc.complaint_classifications from public, anon, authenticated;
revoke all on function stt_poc.save_complaint_classification(
  uuid, text, text[], numeric, boolean, text, text, text
) from public, anon, authenticated;

grant select, insert, update on table stt_poc.complaint_classifications to service_role;
grant execute on function stt_poc.save_complaint_classification(
  uuid, text, text[], numeric, boolean, text, text, text
) to service_role;
