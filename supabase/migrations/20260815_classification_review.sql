create table if not exists stt_poc.classification_reviews (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references stt_poc.call_sessions(id) on delete cascade,
  ai_classification_id uuid not null references stt_poc.complaint_classifications(id) on delete restrict,
  confirmed_category text not null,
  confirmed_issues text[] not null default '{}',
  decision text not null,
  reviewer_note text,
  category_match boolean not null,
  issues_exact_match boolean not null,
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint classification_reviews_category_check check (confirmed_category in (
    'workers_compensation','employment_insurance','insurance_eligibility','premium_collection',
    'wage_claims','welfare','certificate_general','institutional_operations','other'
  )),
  constraint classification_reviews_issues_check check (confirmed_issues <@ array[
    'application_eligibility','required_documents','employer_confirmation','procedure','processing_time',
    'reason_explanation','appeal','correction_change','retroactive_application','payment_benefit','other'
  ]::text[]),
  constraint classification_reviews_decision_check check (decision in ('accepted','corrected')),
  constraint classification_reviews_note_length_check check (reviewer_note is null or length(reviewer_note) <= 2000)
);

create unique index if not exists classification_reviews_session_uidx on stt_poc.classification_reviews(session_id);
create index if not exists classification_reviews_decision_idx on stt_poc.classification_reviews(decision, reviewed_at desc);
create index if not exists classification_reviews_match_idx on stt_poc.classification_reviews(category_match, issues_exact_match, reviewed_at desc);
alter table stt_poc.classification_reviews enable row level security;

create table if not exists stt_poc.classification_review_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references stt_poc.call_sessions(id) on delete cascade,
  review_id uuid not null references stt_poc.classification_reviews(id) on delete cascade,
  ai_classification_id uuid not null references stt_poc.complaint_classifications(id) on delete restrict,
  event_type text not null,
  ai_category text not null,
  ai_issues text[] not null default '{}',
  confirmed_category text not null,
  confirmed_issues text[] not null default '{}',
  category_match boolean not null,
  issues_exact_match boolean not null,
  reviewer_note text,
  created_at timestamptz not null default now(),
  constraint classification_review_events_type_check check (event_type in ('confirmed','corrected','updated')),
  constraint classification_review_events_note_length_check check (reviewer_note is null or length(reviewer_note) <= 2000)
);

create index if not exists classification_review_events_session_idx on stt_poc.classification_review_events(session_id, created_at desc);
alter table stt_poc.classification_review_events enable row level security;

create or replace function stt_poc.save_classification_review(
  p_session_id uuid,
  p_confirmed_category text,
  p_confirmed_issues text[] default '{}',
  p_reviewer_note text default null
)
returns stt_poc.classification_reviews
language plpgsql
security definer
set search_path = stt_poc, public
as $$
declare
  v_ai stt_poc.complaint_classifications;
  v_existing stt_poc.classification_reviews;
  v_result stt_poc.classification_reviews;
  v_category_match boolean;
  v_issues_match boolean;
  v_decision text;
  v_event_type text;
  v_confirmed_issues text[];
begin
  select * into v_ai
  from stt_poc.complaint_classifications
  where session_id = p_session_id
  limit 1;
  if v_ai.id is null then raise exception 'AI classification not found'; end if;

  v_confirmed_issues := coalesce(p_confirmed_issues, '{}');
  v_category_match := v_ai.primary_category = p_confirmed_category;
  v_issues_match := (select array_agg(x order by x) from unnest(coalesce(v_ai.issues,'{}')) x)
                    is not distinct from
                    (select array_agg(x order by x) from unnest(v_confirmed_issues) x);
  v_decision := case when v_category_match and v_issues_match then 'accepted' else 'corrected' end;

  select * into v_existing
  from stt_poc.classification_reviews
  where session_id = p_session_id;
  v_event_type := case
    when v_existing.id is null then case when v_decision='accepted' then 'confirmed' else 'corrected' end
    else 'updated'
  end;

  insert into stt_poc.classification_reviews(
    session_id, ai_classification_id, confirmed_category, confirmed_issues, decision,
    reviewer_note, category_match, issues_exact_match, reviewed_at, updated_at
  ) values (
    p_session_id, v_ai.id, p_confirmed_category, v_confirmed_issues, v_decision,
    nullif(btrim(p_reviewer_note),''), v_category_match, v_issues_match, now(), now()
  )
  on conflict(session_id) do update set
    ai_classification_id=excluded.ai_classification_id,
    confirmed_category=excluded.confirmed_category,
    confirmed_issues=excluded.confirmed_issues,
    decision=excluded.decision,
    reviewer_note=excluded.reviewer_note,
    category_match=excluded.category_match,
    issues_exact_match=excluded.issues_exact_match,
    reviewed_at=now(), updated_at=now()
  returning * into v_result;

  insert into stt_poc.classification_review_events(
    session_id, review_id, ai_classification_id, event_type, ai_category, ai_issues,
    confirmed_category, confirmed_issues, category_match, issues_exact_match, reviewer_note
  ) values (
    p_session_id, v_result.id, v_ai.id, v_event_type, v_ai.primary_category, v_ai.issues,
    v_result.confirmed_category, v_result.confirmed_issues, v_result.category_match,
    v_result.issues_exact_match, v_result.reviewer_note
  );

  return v_result;
end;
$$;

revoke all on table stt_poc.classification_reviews from public, anon, authenticated;
revoke all on table stt_poc.classification_review_events from public, anon, authenticated;
revoke all on function stt_poc.save_classification_review(uuid,text,text[],text) from public, anon, authenticated;
grant select, insert, update on stt_poc.classification_reviews to service_role;
grant select, insert on stt_poc.classification_review_events to service_role;
grant execute on function stt_poc.save_classification_review(uuid,text,text[],text) to service_role;