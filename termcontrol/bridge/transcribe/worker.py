"""Local speech-to-text for TermControl (Hebrew + English). Runs on this machine only.

Protocol: one JSON object per line on stdin -> one JSON object per line on stdout.
  {"id": "...", "path": "/tmp/clip.webm", "language": "he"|"en"|null}
  -> {"id": "...", "text": "...", "language": "he", "seconds": 1.2}  or  {"id": "...", "error": "..."}
Models come from the local Hugging Face cache; nothing is downloaded or sent anywhere.
"""
import json, os, sys, time

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


def load(repo, big):
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


def detect(audio):
    model = load(DETECTOR, False)
    language, probability, _ = model.detect_language(audio[: 16000 * 30])
    return language if language in SUPPORTED else ("he" if probability < 0.5 else "en"), probability


def transcribe(request):
    started = time.time()
    audio = decode(request["path"])
    language = request.get("language")
    if language not in SUPPORTED:
        language, _ = detect(audio)
    model = load(MODELS[language], True)
    segments, _info = model.transcribe(
        audio, language=language, beam_size=5, vad_filter=True,
        condition_on_previous_text=False, temperature=0.0,
    )
    text = " ".join(s.text.strip() for s in segments).strip()
    return {"text": text, "language": language, "seconds": round(time.time() - started, 2)}


def main():
    print(json.dumps({"ready": True}), flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except ValueError:
            continue
        try:
            reply = transcribe(request)
        except Exception as error:
            reply = {"error": str(error)[:300]}
        reply["id"] = request.get("id")
        print(json.dumps(reply, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
