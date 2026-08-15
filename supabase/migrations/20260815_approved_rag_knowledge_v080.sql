create table if not exists stt_poc.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source_label text not null,
  source_url text,
  domain text not null default 'general',
  approval_status text not null default 'draft' check (approval_status in ('draft','approved','retired')),
  approved_by text,
  approved_at timestamptz,
  valid_from date,
  valid_to date,
  is_test_fixture boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists stt_poc.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references stt_poc.knowledge_documents(id) on delete cascade,
  chunk_no integer not null,
  content text not null check (length(content) between 1 and 8000),
  keywords text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique(document_id, chunk_no)
);

create index if not exists knowledge_documents_approval_idx on stt_poc.knowledge_documents(approval_status, domain);
create index if not exists knowledge_chunks_document_idx on stt_poc.knowledge_chunks(document_id);
create index if not exists knowledge_chunks_keywords_gin on stt_poc.knowledge_chunks using gin(keywords);

create table if not exists stt_poc.rag_answer_runs (
  id uuid primary key default gen_random_uuid(),
  question_hash text not null,
  evidence_chunk_ids uuid[] not null default '{}',
  evidence_count integer not null default 0 check (evidence_count >= 0),
  answer_generated boolean not null default false,
  fallback_reason text,
  model_name text,
  created_at timestamptz not null default now()
);

alter table stt_poc.knowledge_documents enable row level security;
alter table stt_poc.knowledge_chunks enable row level security;
alter table stt_poc.rag_answer_runs enable row level security;

revoke all on stt_poc.knowledge_documents from anon, authenticated;
revoke all on stt_poc.knowledge_chunks from anon, authenticated;
revoke all on stt_poc.rag_answer_runs from anon, authenticated;
grant select, insert, update on stt_poc.knowledge_documents to service_role;
grant select, insert, update, delete on stt_poc.knowledge_chunks to service_role;
grant select, insert on stt_poc.rag_answer_runs to service_role;

insert into stt_poc.knowledge_documents (title, source_label, domain, approval_status, approved_by, approved_at, is_test_fixture)
select 'PoC 운영 원칙', '내부 PoC 테스트 fixture', 'institutional_operations', 'approved', 'POC_BASELINE', now(), true
where not exists (
  select 1 from stt_poc.knowledge_documents where title = 'PoC 운영 원칙' and is_test_fixture = true
);

insert into stt_poc.knowledge_chunks (document_id, chunk_no, content, keywords)
select d.id, 1,
  '이 PoC는 내부직원 참고용이며 실제 민원에 대한 자동처분, 자동조사, 자동발송 또는 법적 판단을 수행하지 않는다. 개인정보와 실제 민원 원문은 입력하지 않는다. 승인된 근거가 없거나 질문에 충분히 부합하지 않으면 답변을 단정하지 않고 담당자 확인 필요로 전환한다.',
  array['PoC','내부직원','개인정보','자동처분','담당자 확인','승인 근거']
from stt_poc.knowledge_documents d
where d.title = 'PoC 운영 원칙' and d.is_test_fixture = true
and not exists (select 1 from stt_poc.knowledge_chunks c where c.document_id = d.id and c.chunk_no = 1);
