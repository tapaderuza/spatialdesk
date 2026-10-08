# Local text-to-speech for the demo video's voice-over: Piper with an en-US voice. No account, no API key, no cost.
# Built and used by scripts/make-video.mjs (image spatialdesk-tts).
FROM python:3.12-slim

RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir piper-tts==1.3.0

RUN mkdir -p /voices && \
    curl -sSL -o /voices/en_US-lessac-medium.onnx \
      https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx && \
    curl -sSL -o /voices/en_US-lessac-medium.onnx.json \
      https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json

COPY tts.py /tts.py
ENTRYPOINT ["python", "/tts.py"]
