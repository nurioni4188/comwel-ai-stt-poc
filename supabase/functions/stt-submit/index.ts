import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json; charset=utf-8" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const invokeBase = Deno.env.get("CLOVA_SPEECH_INVOKE_URL");
  const clovaKey = Deno.env.get("CLOVA_SPEECH_SECRET");
  if (!invokeBase || !clovaKey) return reply({ error: "clova_not_configured" }, 503);

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return reply({ error: "unauthorized" }, 401);

  const userDb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: { user }, error: ue } = await userDb.auth.getUser(auth.slice(7));
  if (ue || !user) return reply({ error: "unauthorized" }, 401);

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return reply({ error: "invalid_json" }, 400); }

  const path = String(body?.storage_path ?? "");
  if (!path.startsWith(user.id + "/") || path.includes("..")) return reply({ error: "invalid_storage_path" }, 400);

  const language = String(body?.language_code ?? "ko-KR");
  if (!["ko-KR", "en-US", "enko", "ja", "zh-cn", "zh-tw"].includes(language)) return reply({ error: "unsupported_language" }, 400);

  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const slash = path.lastIndexOf("/");
  const folder = path.slice(0, slash);
  const filename = path.slice(slash + 1);

  const { data: objects, error: oe } = await service.storage.from("stt-audio").list(folder, { search: filename, limit: 10 });
  const object = objects?.find((v: any) => v.name === filename);
  if (oe || !object) return reply({ error: "audio_not_found" }, 404);

  const size = Number(object?.metadata?.size ?? 0);
  const mime = String(object?.metadata?.mimetype ?? body?.mime_type ?? "application/octet-stream");
  if (size <= 0 || size > 209715200) return reply({ error: "invalid_file_size" }, 400);

  const { data: session, error: se } = await service.schema("stt_poc").from("call_sessions")
    .insert({ status: "recording", caller_label: body?.caller_label ?? null }).select("id").single();
  if (se || !session) return reply({ error: "session_create_failed" }, 500);

  const { data: job, error: je } = await service.from("stt_jobs").insert({
    user_id: user.id,
    session_id: session.id,
    storage_path: path,
    original_filename: filename,
    mime_type: mime,
    file_size_bytes: size,
    language_code: language,
    status: "pending",
    provider: "naver_clova_speech",
    model: "general",
    enable_diarization: Boolean(body?.enable_diarization ?? true),
    metadata: { boostings: Array.isArray(body?.boostings) ? body.boostings : [] },
  }).select("*").single();

  if (je || !job) {
    console.error("job_create_failed", je?.message, je?.details, je?.hint, je?.code);
    await service.schema("stt_poc").from("call_sessions").update({ status: "failed", ended_at: new Date().toISOString() }).eq("id", session.id);
    return reply({ error: "job_create_failed", message: je?.message ?? null, code: je?.code ?? null }, 500);
  }

  const { data: signed, error: signedError } = await service.storage.from("stt-audio").createSignedUrl(path, 86400);
  if (signedError || !signed?.signedUrl) {
    await service.from("stt_jobs").update({ status: "failed", error_code: "SIGNED_URL_FAILED", error_message: signedError?.message ?? "Could not create signed URL" }).eq("id", job.id);
    return reply({ error: "signed_url_failed" }, 500);
  }

  const callback = supabaseUrl + "/functions/v1/stt-clova-callback";
  const endpoint = invokeBase.replace(/\/$/, "") + (invokeBase.endsWith("/recognizer/url") ? "" : "/recognizer/url");

  let clovaResponse: Response;
  try {
    clovaResponse = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "X-CLOVASPEECH-API-KEY": clovaKey },
      body: JSON.stringify({
        url: signed.signedUrl,
        language,
        completion: "async",
        callback,
        wordAlignment: true,
        fullText: true,
        noiseFiltering: true,
        diarization: { enable: Boolean(body?.enable_diarization ?? true) },
        boostings: Array.isArray(body?.boostings) ? body.boostings : [],
        userdata: { job_id: job.id },
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("clova_fetch_failed", message);
    await service.from("stt_jobs").update({ status: "failed", error_code: "CLOVA_NETWORK_FAILED", error_message: message, completed_at: new Date().toISOString() }).eq("id", job.id);
    return reply({ error: "clova_network_failed", message }, 502);
  }

  const raw = await clovaResponse.text();
  let clova: any = {};
  try { clova = JSON.parse(raw); } catch { clova = { message: raw.slice(0, 500) }; }

  if (!clovaResponse.ok || String(clova?.result ?? "").toUpperCase() === "FAILED") {
    const now = new Date().toISOString();
    await service.from("stt_jobs").update({ status: "failed", error_code: "CLOVA_SUBMIT_FAILED", error_message: String(clova?.message ?? clovaResponse.status), completed_at: now }).eq("id", job.id);
    await service.schema("stt_poc").from("call_sessions").update({ status: "failed", ended_at: now }).eq("id", session.id);
    return reply({ error: "clova_submit_failed", message: clova?.message ?? null }, 502);
  }

  if (!clova?.token) {
    const now = new Date().toISOString();
    await service.from("stt_jobs").update({ status: "failed", error_code: "CLOVA_TOKEN_MISSING", error_message: "CLOVA submit response did not include a provider token", completed_at: now }).eq("id", job.id);
    await service.schema("stt_poc").from("call_sessions").update({ status: "failed", ended_at: now }).eq("id", session.id);
    return reply({ error: "clova_token_missing" }, 502);
  }

  const { error: updateError } = await service.from("stt_jobs").update({
    status: "processing",
    progress: 0,
    provider_job_id: clova.token,
    processing_started_at: new Date().toISOString(),
  }).eq("id", job.id);
  if (updateError) return reply({ error: "job_update_failed" }, 500);

  await service.from("stt_job_events").insert({
    job_id: job.id,
    user_id: user.id,
    event_type: "clova_submitted",
    from_status: "pending",
    to_status: "processing",
    details: { provider_token_recorded: true },
  });

  return reply({ job_id: job.id, session_id: session.id, status: "processing" }, 202);
});