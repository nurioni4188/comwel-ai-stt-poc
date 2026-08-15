import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405);

  let p: Record<string, any>;
  try { p = await req.json(); } catch { return reply({ error: "invalid_json" }, 400); }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const jobId = p?.params?.userdata?.job_id ?? p?.userdata?.job_id;
  const providerToken = String(p?.token ?? "");
  if (!jobId) return reply({ error: "missing_job_id" }, 400);
  if (!providerToken) return reply({ error: "missing_provider_token" }, 401);

  const { data: job, error: je } = await db.from("stt_jobs").select("*").eq("id", jobId).maybeSingle();
  if (je || !job) {
    console.error("callback_job_not_found", { job_id: jobId, error: je?.message ?? null });
    return reply({ error: "job_not_found" }, 404);
  }

  if (!job.provider_job_id || job.provider_job_id !== providerToken) {
    console.error("callback_provider_token_mismatch", { job_id: job.id });
    return reply({ error: "provider_token_mismatch" }, 401);
  }

  const result = String(p?.result ?? "").toUpperCase();
  const segs = Array.isArray(p?.segments) ? p.segments : [];
  const payloadText = String(p?.text ?? "").trim();
  const rawProgress = Number(p?.progress ?? NaN);
  const progress = Math.max(0, Math.min(100,
    Number.isFinite(rawProgress) ? rawProgress : (result === "COMPLETED" ? 100 : Number(job.progress ?? 0)),
  ));

  console.log("clova_callback_received", {
    job_id: job.id,
    result,
    progress,
    segment_count: segs.length,
    has_text: payloadText.length > 0,
  });

  const failed = result === "FAILED" || result === "ERROR" || result === "TIMEOUT" || result.startsWith("ERROR_");
  if (failed) {
    const now = new Date().toISOString();
    const { error: jobFailError } = await db.from("stt_jobs").update({
      status: "failed",
      progress,
      error_code: result || "CLOVA_FAILED",
      error_message: String(p?.message ?? "CLOVA Speech processing failed"),
      completed_at: now,
    }).eq("id", job.id);
    if (jobFailError) return reply({ error: "job_update_failed" }, 500);

    if (job.session_id) {
      const { error: sessionFailError } = await db.schema("stt_poc").from("call_sessions")
        .update({ status: "failed", ended_at: now }).eq("id", job.session_id);
      if (sessionFailError) console.error("callback_session_fail_update_failed", { job_id: job.id, error: sessionFailError.message });
    }
    return reply({ ok: true });
  }

  const success = result === "COMPLETED" ||
    (result === "SUCCEEDED" && (progress >= 100 || segs.length > 0 || payloadText.length > 0));

  if (!success) {
    const { error: processingError } = await db.from("stt_jobs").update({ status: "processing", progress }).eq("id", job.id);
    if (processingError) return reply({ error: "job_update_failed" }, 500);
    return reply({ ok: true, state: "processing" });
  }

  const fullText = String(p?.text ?? segs.map((s: any) => s?.textEdited ?? s?.text ?? "").join(" ")).trim();
  const confidence = Number.isFinite(Number(p?.confidence)) ? Number(p.confidence) : null;
  const now = new Date().toISOString();

  const { error: te } = await db.from("stt_transcripts").upsert({
    job_id: job.id,
    user_id: job.user_id,
    full_text: fullText,
    detected_language: p?.params?.lang ?? job.language_code ?? "ko-KR",
    confidence,
    word_count: fullText ? fullText.split(/\s+/u).length : 0,
    provider_metadata: { version: p?.version, speakers: p?.speakers ?? [] },
    updated_at: now,
  }, { onConflict: "job_id" });
  if (te) return reply({ error: "transcript_write_failed" }, 500);

  if (segs.length) {
    const rows = segs.map((s: any, i: number) => ({
      job_id: job.id,
      user_id: job.user_id,
      segment_index: i,
      start_ms: Math.max(0, Number(s?.start ?? 0)),
      end_ms: Math.max(Number(s?.start ?? 0), Number(s?.end ?? s?.start ?? 0)),
      speaker_label: s?.speaker?.label ?? s?.diarization?.label ?? null,
      text: String(s?.textEdited ?? s?.text ?? ""),
      confidence: Number.isFinite(Number(s?.confidence)) ? Number(s.confidence) : null,
      words: Array.isArray(s?.words) ? s.words : [],
    }));
    const { error: segmentError } = await db.from("stt_segments").upsert(rows, { onConflict: "job_id,segment_index" });
    if (segmentError) return reply({ error: "segment_write_failed" }, 500);
  }

  let bridgeWarning: string | null = null;
  if (job.session_id) {
    const poc = db.schema("stt_poc");
    if (segs.length) {
      const chunks = segs.map((s: any, i: number) => ({
        session_id: job.session_id,
        chunk_index: i,
        transcript: String(s?.textEdited ?? s?.text ?? ""),
        audio_format: job.mime_type,
        duration_ms: Math.max(0, Number(s?.end ?? 0) - Number(s?.start ?? 0)),
      }));
      const { error: chunkError } = await poc.from("transcript_chunks").upsert(chunks, { onConflict: "session_id,chunk_index" });
      if (chunkError) bridgeWarning = chunkError.message;
    }
    const { error: sessionError } = await poc.from("call_sessions").update({ status: "completed", ended_at: now }).eq("id", job.session_id);
    if (sessionError) bridgeWarning = bridgeWarning ?? sessionError.message;
  }

  const durationMs = segs.length ? Math.max(...segs.map((s: any) => Number(s?.end ?? 0))) : null;
  const { error: completeError } = await db.from("stt_jobs").update({
    status: "completed",
    progress: 100,
    provider: "naver_clova_speech",
    duration_ms: durationMs,
    completed_at: now,
    error_code: bridgeWarning ? "POC_BRIDGE_WARNING" : null,
    error_message: bridgeWarning,
    metadata: { ...(job.metadata ?? {}), clova_version: p?.version },
  }).eq("id", job.id);
  if (completeError) return reply({ error: "job_complete_update_failed" }, 500);

  const { error: eventError } = await db.from("stt_job_events").insert({
    job_id: job.id,
    user_id: job.user_id,
    event_type: "clova_callback_completed",
    from_status: job.status,
    to_status: "completed",
    details: { callback_result: result, segment_count: segs.length, bridge_warning: bridgeWarning },
  });
  if (eventError) console.error("callback_event_insert_failed", { job_id: job.id, error: eventError.message });

  console.log("clova_callback_completed", {
    job_id: job.id,
    result,
    segment_count: segs.length,
    text_length: fullText.length,
    bridge_warning: bridgeWarning,
  });

  return reply({ ok: true, state: "completed" });
});