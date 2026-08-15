alter table stt_poc.rag_answer_runs add column if not exists answer_hash text;

create table if not exists stt_poc.tts_runs (
  id uuid primary key default gen_random_uuid(),
  rag_run_id uuid not null references stt_poc.rag_answer_runs(id) on delete cascade,
  answer_hash text not null,
  provider text not null default 'clova_voice',
  speaker text not null,
  format text not null,
  status text not null check (status in ('requested','completed','failed','blocked')),
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists tts_runs_rag_run_idx on stt_poc.tts_runs(rag_run_id);
create index if not exists tts_runs_created_idx on stt_poc.tts_runs(created_at desc);

alter table stt_poc.tts_runs enable row level security;
revoke all on stt_poc.tts_runs from anon, authenticated;
grant select, insert, update on stt_poc.tts_runs to service_role;
