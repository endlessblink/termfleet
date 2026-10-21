"""Local speech-to-text for TermControl (Hebrew + English). Runs on this machine only.

Protocol: one JSON object per line on stdin -> one JSON object per line on stdout.
  {"id": "...", "path": "/tmp/clip.webm", "language": "he"|"en"|null}
  -> {"id": "...", "text": "...", "language": "he", "seconds": 1.2}  or  {"id": "...", "error": "..."}
  {"id": "...", "op": "prepare", "language": "he"|"en"|null}
  -> {"id": "...", "prepared": true, "timings": {...}} (no clip or inference)
Models come from the local Hugging Face cache; nothing is downloaded or sent anywhere.
"""
import json, os, re, sys, time

BOOT_STARTED = time.perf_counter()

import av
import numpy as np
from faster_whisper import WhisperModel


def decode(path):
    """Any recorded clip (webm/opus, m4a, wav...) -> mono 16 kHz float32.

    faster-whisper's own decoder passes an option that PyAV 19 no longer accepts,
    so decode here instead.
    """
    resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
    chunks = []
    with av.open(path, mode="r") as container:
        stream = next(s for s in container.streams if s.type == "audio")
        for frame in container.decode(stream):
            for out in resampler.resample(frame):
                chunks.append(out.to_ndarray().reshape(-1))
        for out in resampler.resample(None):
            chunks.append(out.to_ndarray().reshape(-1))
    if not chunks:
        raise ValueError("No sound was found in that recording.")
    return np.concatenate(chunks).astype(np.float32) / 32768.0

DETECTOR = os.environ.get("TC_STT_DETECTOR", "Systran/faster-whisper-small")
MODELS = {
    "he": os.environ.get("TC_STT_HEBREW", "ivrit-ai/faster-whisper-v2-d4"),
    "en": os.environ.get("TC_STT_ENGLISH", "Systran/faster-whisper-large-v3"),
}
SUPPORTED = ("he", "en")

_loaded = {}  # repo -> model; at most the detector plus one large model


def model_label(repo):
    # Custom local paths can contain owner names. Never expose them in telemetry.
    return repo if not os.path.isdir(repo) and re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo) and len(repo) <= 120 else "local/custom"


def timing_record():
    return {"decodeMs": 0, "warmupMs": 0, "detectMs": 0, "inferenceMs": 0,
            "audioSeconds": 0, "coldModel": False, "coldDetector": False}


def load(repo, big, timings=None):
    started = time.perf_counter()
    cold = repo not in _loaded
    model = _load(repo, big)
    if timings is not None:
        timings["warmupMs"] += (time.perf_counter() - started) * 1000
        timings["coldModel" if big else "coldDetector"] = cold
        if big:
            timings.update(model=model_label(repo), device=model.model.device,
                           computeType=model.model.compute_type,
                           cpuThreads=int(os.environ.get("TC_STT_THREADS", "8")))
        else:
            timings["detector"] = model_label(repo)
    return model


def _load(repo, big):
    if repo in _loaded:
        return _loaded[repo]
    if big:  # keep memory bounded: only one large model at a time
        for key in [k for k in _loaded if k != DETECTOR]:
            del _loaded[key]
    # CPU by default: the GPU is usually busy with other work and CUDA's libraries
    # are not always installed (the failure only shows up when decoding starts).
    # TC_STT_DEVICE=cuda opts in once they are.
    attempts = [("cpu", "int8")]
    if os.environ.get("TC_STT_DEVICE") == "cuda":
        attempts = [("cuda", "int8_float16")] + attempts
    last = None
    for device, compute in attempts:
        try:
            model = WhisperModel(repo, device=device, compute_type=compute, local_files_only=True,
                                 cpu_threads=int(os.environ.get("TC_STT_THREADS", "8")))
            _loaded[repo] = model
            return model
        except Exception as error:  # out of GPU memory, no CUDA, ...
            last = error
    raise last


def detect(audio, timings=None):
    model = load(DETECTOR, False, timings)
    started = time.perf_counter()
    language, probability, _ = model.detect_language(audio[: 16000 * 30])
    if timings is not None:
        timings["detectMs"] = (time.perf_counter() - started) * 1000
    return language if language in SUPPORTED else ("he" if probability < 0.5 else "en"), probability


def prepare(request):
    """Overlap cold loading with recording; keep any active recognizer resident.

    This is a loading hint only. Dictation still detects the actual language.
    No audio is received and no inference or model replacement is performed.
    """
    timings = timing_record()
    active = next((repo for repo in _loaded if repo != DETECTOR), None)
    language = request.get("language")
    repo = active or (MODELS[language] if language in SUPPORTED else None)
    load(DETECTOR, False, timings)
    if repo is not None:
        load(repo, True, timings)
    return {"prepared": True, "timings": timings}


def transcribe(request):
    started = time.perf_counter()
    timings = timing_record()
    stage = time.perf_counter()
    audio = decode(request["path"])
    timings["decodeMs"] = (time.perf_counter() - stage) * 1000
    timings["audioSeconds"] = round(len(audio) / 16000, 3)
    language = request.get("language")
    if language not in SUPPORTED:
        language, _ = detect(audio, timings)
    model = load(MODELS[language], True, timings)
    stage = time.perf_counter()
    options = dict(language=language, beam_size=5, vad_filter=True,
                   condition_on_previous_text=False, temperature=0.0)
    if request.get("hotwords"):  # words the owner taught it (his word-fix list)
        options["hotwords"] = str(request["hotwords"])[:400]
    segments, _info = model.transcribe(audio, **options)
    text = " ".join(s.text.strip() for s in segments).strip()
    # faster-whisper segments are lazy: include consumption, not just creation.
    timings["inferenceMs"] = (time.perf_counter() - stage) * 1000
    for key in ("decodeMs", "warmupMs", "detectMs", "inferenceMs"):
        timings[key] = round(timings[key], 1)
    return {"text": text, "language": language,
            "seconds": round(time.perf_counter() - started, 2), "timings": timings}


def main():
    print(json.dumps({"ready": True, "bootMs": round((time.perf_counter() - BOOT_STARTED) * 1000, 1)}), flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except ValueError:
            continue
        try:
            reply = prepare(request) if request.get("op") == "prepare" else transcribe(request)
        except Exception as error:
            reply = {"error": str(error)[:300]}
        reply["id"] = request.get("id")
        print(json.dumps(reply, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
