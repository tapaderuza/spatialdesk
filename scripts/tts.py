"""Speaks every <work>/<id>.txt into <work>/<id>.wav with one Piper voice, loaded once. Used by scripts/make-video.mjs
(in Docker: the voice and /work by default) and scripts/make-cinematic-video.mjs (a voice and a directory given)."""
import pathlib
import sys
import wave

from piper import PiperVoice

voice = PiperVoice.load(sys.argv[1] if len(sys.argv) > 1 else "/voices/en_US-lessac-medium.onnx")
for text_file in sorted(pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "/work").glob("*.txt")):
    with wave.open(str(text_file.with_suffix(".wav")), "wb") as out:
        voice.synthesize_wav(text_file.read_text(encoding="utf-8").strip(), out)
    print(text_file.stem, flush=True)
