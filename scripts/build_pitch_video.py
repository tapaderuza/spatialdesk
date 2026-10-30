"""The hybrid pitch cut: real iPhone footage around the real app recorded in the emulator (docs/video/pitch-2026.json).

  0:00  the hook: her request, filmed on the sofa (her own sound, captioned in English)
  then  the app (a take of scripts/make-cinematic-video.mjs on a dark neutral background): the guided setup, her request
        heard in her own voice by Amazon Transcribe and answered by Amazon Nova, the gaze rim, a poke; a picture-in-picture
        corner plays her real pinch while the setup's orb is up, and her real poke while a hand pushes a control
  then  the carer's phone: the real companion page captured live at iPhone 13 size, in a device frame, Help / Recalibrate
        tapped (scripts/capture_mobile_ui.ts); back to the app as the setup opens in response
  then  if a second take was recorded (scripts/capture_extra_take.mjs, path in .video/pitch/last-extra.txt): the app in
        two of Meta's synthetic rooms, Fit room, one switch undoing it, the network failing and a card moved by hand
  end   the card with the project's measured figures, one after another (scripts/end_card.ts)
Into the phone and out of it, into each room and into the end card, the parts cross-fade. Narration (Piper, local), the app's own 3D
sound, her sound, effects (the glide, the card landing in Done, the tap: assets/audio/<name>.mp3 or .wav if there, else
synthesised), captions; H.264 1080p60 + AAC, -16 LUFS.

  python scripts/build_pitch_video.py                 clips (downloaded if missing), a new take, the phone if not yet, the edit
  python scripts/build_pitch_video.py --edit          the edit again from the last take (and the last phone)
  python scripts/build_pitch_video.py --phone         the carer's phone captured again too
  python scripts/build_pitch_video.py --skip-build    without rebuilding the app first
Needs ffmpeg/ffprobe with zscale, Node and Edge (the take, the phone, the end card), and .video/piper-venv (python -m
venv, then pip install piper-tts==1.3.0 gdown). The clips live in inputs/, which git ignores: people filmed at home are
never committed.
Output: .video/pitch/SpatialDesk_Final_Pitch_2026.mp4, copied to dist/ (which the next build empties and the next
deploy uploads).
"""
import json
import textwrap
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = json.loads((ROOT / "docs/video/pitch-2026.json").read_text(encoding="utf-8"))
WORK = ROOT / ".video" / "pitch"
OUTPUT = WORK / "SpatialDesk_Final_Pitch_2026.mp4"
VENV_PYTHON = ROOT / ".video" / "piper-venv" / "Scripts" / "python.exe"
FOLDER = "https://drive.google.com/drive/folders/1BP9bPP3lDHVEBoQ6DN88qmMM-_YV2szg"
W, H, FPS = 1920, 1080, 60
MAX_S = 180
LEAD_S = 0.5  # the app kept before its first line
PHONE = WORK / "phone"  # scripts/capture_mobile_ui.ts's
CROSSFADE_S = 0.5  # into the phone, out of it, into the end card
END_LEAD_S = 0.6  # the end card's line, once the cut has crossed into it
# Sound effects, under the voices: assets/audio/<name>.mp3 or .wav when there, else made here from ffmpeg's own sources.
SFX = {
    # Air swelling and opening as the panels glide closer: pink noise, a brighter band coming in (each different in each ear,
    # so the sound can be as wide as the panels around her), a soft rising tone in the middle.
    "whoosh": "anoisesrc=d=1.4:c=pink:r=48000:a=0.9:seed=7[lol];anoisesrc=d=1.4:c=pink:r=48000:a=0.9:seed=8[lor];"
              "[lol][lor]join=inputs=2:channel_layout=stereo,highpass=f=220,lowpass=f=1900,afade=t=in:d=0.5:curve=qsin,afade=t=out:st=0.5:d=0.9:curve=exp[lo];"
              "anoisesrc=d=1.4:c=white:r=48000:a=0.35:seed=11[hil];anoisesrc=d=1.4:c=white:r=48000:a=0.35:seed=12[hir];"
              "[hil][hir]join=inputs=2:channel_layout=stereo,highpass=f=2600,lowpass=f=7500,afade=t=in:st=0.15:d=0.45:curve=qsin,afade=t=out:st=0.6:d=0.7:curve=exp[hi];"
              "aevalsrc='0.16*sin(2*PI*420*(pow(2,1.2*t)-1)/(1.2*log(2)))':d=1.4:s=48000,aformat=channel_layouts=stereo,afade=t=in:d=0.45,afade=t=out:st=0.55:d=0.8[tone];"
              "[lo][hi][tone]amix=inputs=3:normalize=0,aecho=0.8:0.5:70|140:0.2|0.1",
    # A soft landing: a low knock, a short fall in pitch, a glassy tick on top, a small room.
    "drop": "aevalsrc='0.6*sin(2*PI*150*t)*exp(-10*t)+0.3*lt(t,0.2)*sin(2*PI*(700*t-1500*t*t))*exp(-28*t)+0.12*sin(2*PI*2600*t)*exp(-90*t)':d=0.8:s=48000,"
            "lowpass=f=6000,aecho=0.8:0.4:45|90:0.18|0.08",
    # A fingertip on glass.
    "tap": "aevalsrc='0.4*sin(2*PI*1700*t)*exp(-120*t)+0.3*sin(2*PI*340*t)*exp(-50*t)':d=0.3:s=48000",
}
SFX_DB = {"whoosh": -17, "drop": -14, "tap": -18}  # each one's peak in the mix: well under the voices, which reach about 0 dB
PIP_W, PIP_H, PIP_MARGIN, PIP_RADIUS = 576, 324, 56, 26
# iPhone HDR (HLG, BT.2020) to the video's SDR (BT.709), tone-mapped rather than clipped.
TONEMAP = ("zscale=tin=arib-std-b67:min=bt2020nc:pin=bt2020:t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,"
           "tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,")


def step(message):
    print(f"\n==> {message}", flush=True)


def run(args, **kwargs):
    subprocess.run(args, check=True, **kwargs)


def probe(path, entries):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", entries, "-of", "json", str(path)], check=True, capture_output=True, text=True)
    return json.loads(out.stdout)


def seconds(path):
    return float(probe(path, "format=duration")["format"]["duration"])


def hdr(path):
    streams = probe(path, "stream=codec_type,color_transfer")["streams"]
    return any(s.get("codec_type") == "video" and s.get("color_transfer") in ("arib-std-b67", "smpte2084") for s in streams)


def clips():
    """The real footage, downloaded from the shared Drive folder when any of it is missing."""
    paths = [ROOT / SCRIPT[k]["clip"] for k in ("hook", "pinch", "poke")]
    if all(p.exists() for p in paths):
        return
    step("Downloading the clips into inputs/")
    (ROOT / "inputs").mkdir(exist_ok=True)
    try:
        run([str(VENV_PYTHON), "-m", "gdown", FOLDER, "-O", str(ROOT / "inputs")])
    except subprocess.CalledProcessError:
        sys.exit("The Drive folder could not be read: share it with 'Anyone with the link', or copy the clips into inputs/.")
    missing = [str(p) for p in paths if not p.exists()]
    if missing:
        sys.exit(f"Still missing: {missing}")


def prepare():
    """A dark neutral room for the take (#1a1a1a, as a camera picture), and her request as the take's microphone."""
    WORK.mkdir(parents=True, exist_ok=True)
    dark = WORK / "dark.mp4"
    if not dark.exists():
        run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x1a1a1a:s=1280x720:r=30:d=12", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(dark)])
    mic = SCRIPT["mic"]
    wav = WORK / "her-request.wav"
    run(["ffmpeg", "-v", "error", "-y", "-ss", str(mic["in"]), "-t", str(mic["out"] - mic["in"]), "-i", str(ROOT / mic["clip"]),
         "-map", "0:a:0", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", str(wav)])
    shutil.copyfile(Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / "segoeui.ttf", WORK / "segoeui.ttf")
    return dark, wav


def take(dark, wav, skip_build):
    """The app, recorded by scripts/make-cinematic-video.mjs at this script's pace, in Spanish (her language)."""
    step("The take (the app in the emulator, live Nova and Transcribe)")
    env = {**os.environ, "NARRATION_FILE": "docs/video/pitch-2026.json", "CAPTURE_ONLY": "1", "CAMERA": f"file:{dark}",
           "CINEMATIC_QUERY": "&fov=120&lang=es-ES", "MIC_FILE": str(wav)}
    if skip_build:
        env["SKIP_BUILD"] = "1"
    run(["node", "scripts/make-cinematic-video.mjs"], cwd=ROOT, env=env)
    directory = Path((ROOT / ".video" / "cinematic" / "last.txt").read_text(encoding="utf-8").strip())
    (WORK / "last-take.txt").write_text(str(directory), encoding="utf-8")
    return directory


def phone(again, skip_build):
    """The carer's phone: the real companion page, captured live at iPhone 13 size and framed (scripts/capture_mobile_ui.ts)."""
    if (PHONE / "phone.mp4").exists() and not again:
        return
    step("The carer's phone (the companion page, live, at iPhone 13 size)")
    run(["node", "scripts/capture_mobile_ui.ts"], cwd=ROOT, env={**os.environ, **({"SKIP_BUILD": "1"} if skip_build else {})})


def end_card():
    """The end card, its figures one after another (scripts/end_card.ts), from this script's words and figures."""
    step("The end card")
    run(["node", "scripts/end_card.ts"], cwd=ROOT)


def sfx():
    """The sound effects as WAVs peaking at -1 dB (the mix sets their level): assets/audio/<name>.mp3 or .wav when there,
    else made from SFX's sources."""
    made = {}
    for name, source in SFX.items():
        given = next((p for p in (ROOT / "assets" / "audio" / f"{name}{ext}" for ext in (".mp3", ".wav")) if p.exists()), None)
        raw, out = WORK / f"sfx-{name}-raw.wav", WORK / f"sfx-{name}.wav"
        if given:
            run(["ffmpeg", "-v", "error", "-y", "-i", str(given), "-ac", "2", "-ar", "48000", str(raw)])
        else:
            run(["ffmpeg", "-v", "error", "-y", "-filter_complex", f"{source},aformat=channel_layouts=stereo,aresample=48000[out]", "-map", "[out]", str(raw)])
        detected = subprocess.run(["ffmpeg", "-i", str(raw), "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True).stderr
        peak = float(re.search(r"max_volume: (-?[\d.]+) dB", detected).group(1))
        run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-af", f"volume={-1 - peak:.2f}dB", str(out)])
        made[name] = out
        print(f"  {name}: {given.relative_to(ROOT) if given else 'synthesised'}")
    return made


def flash_in(capture):
    """Where the take's magenta sync mark first shows in its screen capture (seconds)."""
    raw = subprocess.run(["ffmpeg", "-v", "error", "-t", "20", "-i", str(capture), "-vf", "crop=16:16:20:20,scale=1:1", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"],
                         check=True, capture_output=True).stdout
    for i in range(0, len(raw) - 2, 3):
        if raw[i] > 200 and raw[i + 1] < 70 and raw[i + 2] > 200:
            return i / 3 / FPS
    sys.exit("The sync mark is not in the take's capture.")


def rounded_mask(path, width, height, radius, feather=3.0):
    """A white rounded rectangle on black, its edge softened over [feather] pixels (PGM: no imaging library needed)."""
    rows = bytearray()
    for y in range(height):
        for x in range(width):
            dx = max(radius - x - 0.5, 0, x + 0.5 - (width - radius))
            dy = max(radius - y - 0.5, 0, y + 0.5 - (height - radius))
            if dx and dy:
                outside = (dx * dx + dy * dy) ** 0.5 - radius
                alpha = min(1.0, max(0.0, (-outside + feather / 2) / feather))
            else:
                alpha = 1.0
            rows.append(int(255 * alpha))
    path.write_bytes(f"P5 {width} {height} 255\n".encode() + bytes(rows))


def srt_time(t):
    ms = max(0, round(t * 1000))
    return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}"


def balanced(text, width=34):
    """Wrapped in as few lines as `width` allows, each about as long as the others: no word left alone at the end."""
    count = len(textwrap.wrap(text, width, break_long_words=False))
    for w in range(len(text) // count, width + 1):
        lines = textwrap.wrap(text, w, break_long_words=False)
        if len(lines) == count:
            return "\n".join(lines)


def spatial(space):
    """Puts an effect where its panels are on screen: an equal-power pan from pan[0] to pan[1] (-1 the left edge, 1 the
    right) and a stereo width from width[0] to width[1] (0 a point, 1 as made), over [over] seconds."""
    (p0, p1), (w0, w1), over = space["pan"], space.get("width", [1, 1]), space.get("over", 1)
    ramp = f"clip(t/{over},0,1)"
    pan, width = f"({p0}+({p1 - p0:.3f})*{ramp})", f"({w0}+({w1 - w0:.3f})*{ramp})"
    mid, side = "0.5*(val(0)+val(1))", "0.5*(val(0)-val(1))"
    # aeval leaves its two channels without a layout, which the AAC encoder refuses: pan names them stereo again.
    return (f"aeval='({mid}+{width}*{side})*cos(({pan}+1)*PI/4)*sqrt(2)|({mid}-{width}*{side})*sin(({pan}+1)*PI/4)*sqrt(2)':c=stereo,"
            "pan=stereo|c0=c0|c1=c1")


def heard(audio, start, end, threshold=-40.0):
    """The first moment in [start, end) seconds of [audio] louder than [threshold] dB (in 50 ms steps): a press the app
    played its sound for. None if nothing is."""
    stats = subprocess.run(["ffmpeg", "-v", "error", "-i", str(audio), "-af",
                            "aresample=48000,asetnsamples=2400,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
                            "-f", "null", "-"], check=True, capture_output=True, text=True).stdout
    for t, level in re.findall(r"pts_time:([\d.]+)\s+lavfi\.astats\.Overall\.RMS_level=(\S+)", stats):
        if start <= float(t) < end and level not in ("-inf", "inf") and float(level) >= threshold:
            return float(t)
    return None


def two_lines(text, width=46):
    if len(text) <= width or "\n" in text:
        return text
    words = text.split()
    best = min(range(1, len(words)), key=lambda i: abs(len(" ".join(words[:i])) - len(text) / 2))
    return " ".join(words[:best]) + "\n" + " ".join(words[best:])


def captions(entries):
    """[(start, seconds, text)] as SRT; a long text in sentence-sized pieces, timed by length within its own audio."""
    out = []
    for start, length, text in entries:
        if "\n" in text:
            pieces = [text]
        else:
            pieces, current = [], ""
            for word in text.split():
                if current and len(current) + len(word) > 84:
                    pieces.append(current)
                    current = word
                else:
                    current = f"{current} {word}".strip()
            pieces.append(current)
        if len(pieces) > 1 and len(pieces[-1]) < 24:
            last = pieces.pop()
            pieces[-1] += " " + last  # never a word or two alone on screen
        total = sum(len(p) for p in pieces)
        t = start
        for piece in pieces:
            d = length * len(piece) / total
            out.append(f"{len(out) + 1}\n{srt_time(t)} --> {srt_time(t + d)}\n{two_lines(piece)}\n")
            t += d
    return "\n".join(out)


def edit(directory):
    step(f"The edit, from {directory}")
    markers = json.loads((directory / "markers.json").read_text(encoding="utf-8"))
    beats = {b["id"]: b for b in markers["beats"]}
    events = markers["events"]
    flash = flash_in(directory / "capture.mp4")
    cap = lambda at: flash + (at - markers["flashAt"]) / 1000  # epoch ms -> seconds into capture.mp4
    narration = lambda beat_id: ROOT / ".video" / "cinematic" / "voice" / "narrator" / f"{beat_id}.wav"
    wav = WORK / "her-request.wav"

    # The parts, and where each starts in the cut.
    hook = SCRIPT["hook"]
    t_a = hook["out"] - hook["in"]
    b0 = cap(beats["intro"]["at"]) - LEAD_S
    b1 = cap(beats["helper"]["at"])
    t_b = b1 - b0
    shot = json.loads((PHONE / "phone.json").read_text(encoding="utf-8"))
    t_c1 = seconds(PHONE / "phone.mp4")
    help_at = next(e["at"] for e in events if e["kind"] == "help")
    opened_at = next(e["at"] for e in events if e["kind"] == "setup-reopened")
    # No further than the capture goes: a part that runs out early pulls the end card ahead of its line.
    c2a, c2b = cap(help_at) - 0.5, min(cap(opened_at) + 3.5, seconds(directory / "capture.mp4"))
    t_c2 = c2b - c2a
    t_d = seconds(WORK / "end-card.mp4")
    # The second take (scripts/capture_extra_take.mjs), cut in after the setup: its segments, each from a little before its
    # first line, in the order they were filmed. Without one, the cut is as before.
    extra_file = WORK / "last-extra.txt"
    extra_dir = Path(extra_file.read_text(encoding="utf-8").strip()) if extra_file.exists() else None
    segments = []
    if extra_dir:
        em = json.loads((extra_dir / "markers.json").read_text(encoding="utf-8"))
        e_flash = flash_in(extra_dir / "capture.mp4")
        ecap = lambda at: e_flash + (at - em["flashAt"]) / 1000
        segments = [(ecap(s["from"]) - 0.3, (s["to"] - s["from"]) / 1000 + 0.3, s) for s in em["segments"]]
    # The hook dips to the app through black; the app, the phone, the setup and the end card cross-fade, each part starting
    # half a second before the one before it ends.
    o_b = t_a
    o_c1 = o_b + t_b - CROSSFADE_S
    o_c2 = o_c1 + t_c1 - CROSSFADE_S
    o_e, at = [], o_c2 + t_c2 - CROSSFADE_S
    for _, length, _ in segments:
        o_e.append(at)
        at += length - CROSSFADE_S
    o_d = at
    total = o_d + t_d
    if total >= MAX_S:
        sys.exit(f"The cut would be {total:.1f} s; the limit is {MAX_S} s.")

    # The picture-in-picture: her real pinch while the orb is up, her real poke while a hand pushes a control.
    windows = []
    kinds = [e["kind"] for e in events]
    for i, e in enumerate(events):
        if e["kind"] == "poke-start":
            end = next(x["at"] for x in events[i:] if x["kind"] == "poke-end")
            windows.append(["poke", cap(e["at"]) - 0.5, cap(end) + 0.7])
    if "orb-shown" in kinds and "pinch-end" in kinds:
        windows.append(["pinch", cap(next(e["at"] for e in events if e["kind"] == "orb-shown")), cap(next(e["at"] for e in events if e["kind"] == "pinch-end")) + 0.8])
    windows = sorted([[k, max(s, b0) - b0, min(e, b1) - b0] for k, s, e in windows if e > b0 and s < b1], key=lambda w: w[1])
    for a, b in zip(windows, windows[1:]):
        a[2] = min(a[2], b[1])  # one corner, one clip at a time
    windows = [w for w in windows if w[2] - w[1] > 0.6]

    rounded_mask(WORK / "pip-mask.pgm", PIP_W, PIP_H, PIP_RADIUS)
    rounded_mask(WORK / "pip-glow.pgm", PIP_W + 16, PIP_H + 16, PIP_RADIUS + 8, feather=8)

    # Inputs.
    inputs = []

    def add(*args):
        inputs.extend(args)
        return inputs.count("-i") - 1

    hook_in = add("-ss", str(hook["in"]), "-t", str(t_a), "-i", str(ROOT / hook["clip"]))
    capture_in = add("-i", str(directory / "capture.mp4"))
    phone_in = add("-i", str(PHONE / "phone.mp4"))
    end_in = add("-i", str(WORK / "end-card.mp4"))
    extra_in = add("-i", str(extra_dir / "capture.mp4")) if segments else None
    extra_audio = [(add("-i", str(extra_dir / a["file"])), a["startedAt"]) for a in em["audio"]] if segments else []
    app_in = add("-i", str(directory / "app-audio.webm"))
    # Finite, like every input here: an endless one keeps its whole branch, and the cut, from ever ending.
    mask_in = add("-loop", "1", "-t", str(t_b), "-i", "pip-mask.pgm")
    glow_in = add("-loop", "1", "-t", str(t_b), "-i", "pip-glow.pgm")
    for w in windows:
        clip = SCRIPT[w[0]]
        w.append(add("-stream_loop", "-1", "-ss", str(clip.get("in", 0)), "-t", str(w[2] - w[1]), "-i", str(ROOT / clip["clip"])))

    # Voices: the narration where each beat began, her own voice where the take played it, Nova where she answered.
    voices, lines = [], []
    in_b = lambda at: o_b + cap(at) - b0
    for beat in SCRIPT["beats"]:
        if beat["id"] in ("helper", "invite", "carer", "end") or beat["id"] not in beats:
            continue
        start = in_b(beats[beat["id"]]["at"])
        if beat["id"] == "say":
            voices.append((wav, start))
            lines.append((start, seconds(wav), f"\u201c{beat['text']}\u201d\n{beat['caption']}"))
        else:
            voices.append((narration(beat["id"]), start))
            lines.append((start, seconds(narration(beat["id"])), beat["text"]))
    for n in markers["nova"]:
        start = in_b(n["at"])
        if not o_b <= start < o_c1:
            continue
        file = directory / "nova" / f"{n['id']}.wav"
        voices.append((file, start))
        english = SCRIPT.get("nova_captions", {}).get(n["text"])
        if not english:
            print(f"  Nova's answer has no English caption yet (add it to nova_captions, then --edit): {n['text']}")
        # Bilingual, small and top left: clear of the card's buttons below and of the card itself to the right. The SRT reader
        # keeps a lone {\an7} and turns <font size> into its own tag; it drops any other {\...} override.
        spanish = balanced(f"Nova: {n['text']}")
        caption = f'<font size="11"><i>{spanish}</i>' + (f"\n{balanced(english)}" if english else "") + "</font>"
        lines.append((start, seconds(file), r"{\an7}" + caption))
    voices.append((narration("carer"), o_c1 + CROSSFADE_S))
    lines.append((o_c1 + CROSSFADE_S, seconds(narration("carer")), next(b["text"] for b in SCRIPT["beats"] if b["id"] == "carer")))
    voices.append((narration("end"), o_d + END_LEAD_S))
    lines.append((o_d + END_LEAD_S, seconds(narration("end")), next(b["text"] for b in SCRIPT["beats"] if b["id"] == "end")))
    for c in hook["captions"]:
        lines.append((c["at"], c["to"] - c["at"], c["text"]))
    if segments:
        texts = {b["id"]: b["text"] for b in SCRIPT["extra"]["beats"]}
        for b in em["beats"]:
            k = next(i for i, (_, _, s) in enumerate(segments) if s["from"] <= b["at"] <= s["to"])
            start = o_e[k] + ecap(b["at"]) - segments[k][0]
            file = Path(em["voiceDir"]) / f"{b['id']}.wav"
            voices.append((file, start))
            lines.append((start, seconds(file), texts[b["id"]]))
    (WORK / "captions.srt").write_text(captions(sorted(lines)), encoding="utf-8")
    voice_in = [(add("-i", str(f)), start) for f, start in voices]

    # Effects: air as the panels glide closer (from Apply's press, heard in the app's own sound, or else mid-poke), a soft
    # landing as the view reaches the Done column with the card in it, a fingertip on the phone's glass.
    app_start = cap(markers["audioStartedAt"])
    poke = next(i for i, e in enumerate(events) if e["kind"] == "poke-start" and e["at"] > beats["apply"]["at"])
    poke_from, poke_to = cap(events[poke]["at"]), cap(next(e["at"] for e in events[poke:] if e["kind"] == "poke-end"))
    press = heard(directory / "app-audio.webm", poke_from - app_start, poke_to - app_start)
    press = app_start + press if press is not None else (poke_from + poke_to) / 2
    done_at = next(e["at"] for e in events if e["kind"] == "done-shown")
    cues = {"whoosh": o_b + press - b0 + 0.05, "drop": in_b(done_at) - 0.1, "tap": o_c1 + shot["tapAt"]}
    sounds = sfx()
    sfx_in = [(add("-i", str(sounds[name])), name, at) for name, at in cues.items()]

    # Video.
    fit = f"scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=0x1a1a1a,fps={FPS},format=yuv420p,setsar=1"
    hook_tm = TONEMAP if hdr(ROOT / hook["clip"]) else ""
    x, y = W - PIP_W - PIP_MARGIN, H - PIP_H - PIP_MARGIN - 70
    label = SCRIPT["pip_label"].replace(":", r"\:").replace("'", "")
    disclosure = "The real app in Meta's IWER emulator, driven by a script. Gestures filmed separately.".replace("'", "")
    count = max(1, len(windows))
    graph = [
        f"[{hook_in}:v]{hook_tm}{fit},fade=t=in:st=0:d=0.3,fade=t=out:st={t_a - 0.3}:d=0.3,trim=duration={t_a},setpts=PTS-STARTPTS[va]",
        f"[{capture_in}:v]split=2[capb][capc]",
        f"[capb]trim=start={b0}:duration={t_b},setpts=PTS-STARTPTS,fps={FPS},format=yuv420p,setsar=1[b0]",
        f"[{mask_in}:v]format=gray,split={count}" + "".join(f"[m{i}]" for i in range(count)),
        f"[{glow_in}:v]format=gray,split={count}" + "".join(f"[g{i}]" for i in range(count)),
    ]
    if not windows:
        graph += ["[m0]nullsink", "[g0]nullsink"]
    base = "b0"
    for i, (kind, s, e, index) in enumerate(windows):
        tm = TONEMAP if hdr(ROOT / SCRIPT[kind]["clip"]) else ""
        graph += [
            f"[{index}:v]{tm}scale={PIP_W}:{PIP_H},fps={FPS},format=yuva420p[pc{i}]",
            f"[pc{i}][m{i}]alphamerge,setpts=PTS-STARTPTS+{s}/TB,fade=t=in:st={s}:d=0.25:alpha=1,fade=t=out:st={e - 0.25}:d=0.25:alpha=1[p{i}]",
            f"color=c=0xe9eef5:s={PIP_W + 16}x{PIP_H + 16}:r={FPS}:d={t_b},format=yuva420p[gc{i}]",
            f"[gc{i}][g{i}]alphamerge,colorchannelmixer=aa=0.28[gl{i}]",
            f"[{base}][gl{i}]overlay=x={x - 8}:y={y - 8}:enable='between(t,{s},{e})'[w{i}a]",
            f"[w{i}a][p{i}]overlay=x={x}:y={y}:eof_action=pass:enable='between(t,{s},{e})',"
            f"drawtext=fontfile=segoeui.ttf:text='{label}':fontsize=24:fontcolor=white@0.92:x={x + 14}:y={y + PIP_H + 14}:enable='between(t,{s},{e})'[w{i}]",
        ]
        base = f"w{i}"
    def note(text, a, b, row=0):
        """One line of large text in a dark box, top centre (row 0, then below), faded in and out between a and b."""
        alpha = f"if(lt(t,{a:.3f}),0,if(lt(t,{a + 0.3:.3f}),(t-{a:.3f})/0.3,if(lt(t,{b - 0.3:.3f}),1,if(lt(t,{b:.3f}),({b:.3f}-t)/0.3,0))))"
        text = text.replace(":", r"\:").replace("'", "")
        return (f"drawtext=fontfile=segoeui.ttf:text='{text}':fontsize=44:fontcolor=white:box=1:boxcolor=0x0b0f14@0.72:boxborderw=18:"
                f"x=(w-text_w)/2:y={64 + 92 * row}:alpha='{alpha}':enable='between(t,{a:.3f},{b:.3f})',")

    # Before and after, as the app measures it, over the glide; then the second take's segments, cross-faded.
    before_after = SCRIPT.get("extra", {}).get("before_after", "")
    overlay = note(before_after, press - b0 + 0.4, press - b0 + 3.8) if segments and before_after else ""
    chain, last = [], "x2"
    if segments:
        chain.append(f"[{extra_in}:v]split={len(segments)}" + "".join(f"[es{i}]" for i in range(len(segments))))
        for i, (s0, length, _) in enumerate(segments):
            chain.append(f"[es{i}]trim=start={s0:.4f}:duration={length:.4f},setpts=PTS-STARTPTS,fps={FPS},format=yuv420p,setsar=1,settb=1/{FPS}[ve{i}]")
            chain.append(f"[{last}][ve{i}]xfade=transition=fade:duration={CROSSFADE_S}:offset={o_e[i]:.4f}[xe{i}]")
            last = f"xe{i}"
    # The app's own words as the switch undoes and as the network fails, large: on its panel they are too small to read
    # here. A line that comes while another is up goes below it, and both leave together.
    shown = []
    for e in em["events"] if segments else []:
        text = f"“{e['notice']}”" if e.get("notice") else SCRIPT["extra"].get("callouts", {}).get(e["kind"])
        k = next((i for i, (_, _, s) in enumerate(segments) if s["from"] <= e["at"] <= s["to"]), None)
        if text and k is not None:
            a = o_e[k] + ecap(e["at"]) - segments[k][0] + 0.2
            up = [n for n in shown if n[2] > a]
            for n in up:
                n[2] = a + 3
            shown.append([text, a, a + 3, len(up)])
    notes = "".join(note(*n) for n in shown)
    graph += [
        f"[{base}]drawtext=fontfile=segoeui.ttf:text='{disclosure}':fontsize=24:fontcolor=white@0.85:box=1:boxcolor=black@0.45:boxborderw=12:"
        f"x=48:y=44:enable='between(t,0.4,7)',{overlay}fade=t=in:st=0:d=0.3,trim=duration={t_b},setpts=PTS-STARTPTS[vb]",
        f"[{phone_in}:v]fps={FPS},format=yuv420p,setsar=1,trim=duration={t_c1},setpts=PTS-STARTPTS,settb=1/{FPS}[vc1]",
        f"[capc]trim=start={c2a}:duration={t_c2},setpts=PTS-STARTPTS,fps={FPS},format=yuv420p,setsar=1,settb=1/{FPS}[vc2]",
        f"[{end_in}:v]fps={FPS},format=yuv420p,setsar=1,trim=duration={t_d},setpts=PTS-STARTPTS,settb=1/{FPS}[vd]",
        f"[va][vb]concat=n=2:v=1:a=0,fps={FPS},settb=1/{FPS}[vab]",
        f"[vab][vc1]xfade=transition=fade:duration={CROSSFADE_S}:offset={o_c1:.4f}[x1]",
        f"[x1][vc2]xfade=transition=fade:duration={CROSSFADE_S}:offset={o_c2:.4f}[x2]",
        # Captions bottom left, clear of the picture-in-picture in the bottom right corner.
        *chain,
        f"[{last}][vd]xfade=transition=fade:duration={CROSSFADE_S}:offset={o_d:.4f},{notes}subtitles=captions.srt:force_style='FontName=Segoe UI,FontSize=15,"
        "PrimaryColour=&H00FFFFFF,BorderStyle=3,OutlineColour=&H40000000,Outline=6,Shadow=0,Alignment=1,MarginL=20,MarginV=14'[v]",
    ]

    # Sound: hers, the app's (cues and whooshes, louder: they are quiet by design) faded across the cross-fades, the voices,
    # the effects.
    graph += [
        f"[{hook_in}:a:0]aresample=48000,afade=t=out:st={t_a - 0.3}:d=0.3[ha]",
        f"[{app_in}:a]aresample=48000,asplit=2[ap1][ap2]",
        f"[ap1]atrim=start={max(0, b0 - app_start)}:duration={t_b},asetpts=PTS-STARTPTS,volume=2.2,"
        f"afade=t=out:st={t_b - CROSSFADE_S}:d={CROSSFADE_S},adelay={round(o_b * 1000)}:all=1[a1]",
        f"[ap2]atrim=start={max(0, c2a - app_start)}:duration={t_c2},asetpts=PTS-STARTPTS,volume=2.2,"
        f"afade=t=in:d={CROSSFADE_S},adelay={round(o_c2 * 1000)}:all=1[a2]",
    ]
    graph += [f"[{index}:a]aresample=48000,adelay={round(start * 1000)}:all=1[v{k}]" for k, (index, start) in enumerate(voice_in)]
    # Each effect sounds where its panels are on screen (sfx_space): the glide's air travels and narrows onto the card.
    graph += [f"[{index}:a]aresample=48000,aformat=channel_layouts=stereo,{spatial(SCRIPT['sfx_space'][name])},volume={SFX_DB[name] + 1}dB,"
              f"adelay={round(at * 1000)}:all=1[f{k}]" for k, (index, name, at) in enumerate(sfx_in)]
    for i, (s0, length, s) in enumerate(segments):
        index, started = extra_audio[i]
        graph.append(f"[{index}:a]aresample=48000,atrim=start={max(0, (s['from'] - 300 - started) / 1000):.3f}:duration={length:.3f},asetpts=PTS-STARTPTS,"
                     f"volume=2.2,afade=t=in:d={CROSSFADE_S},afade=t=out:st={length - CROSSFADE_S:.3f}:d={CROSSFADE_S},adelay={round(o_e[i] * 1000)}:all=1[ea{i}]")
    mix = "[ha][a1][a2]" + "".join(f"[v{k}]" for k in range(len(voice_in))) + "".join(f"[f{k}]" for k in range(len(sfx_in))) + "".join(f"[ea{i}]" for i in range(len(segments)))
    graph.append(f"{mix}amix=inputs={3 + len(voice_in) + len(sfx_in) + len(segments)}:normalize=0:dropout_transition=0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]")

    step(f"Rendering {total:.1f} s")
    run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", ";".join(graph), "-map", "[v]", "-map", "[a]", "-t", f"{total}",
         "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-profile:v", "high", "-r", str(FPS), "-g", str(FPS * 2), "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", OUTPUT.name], cwd=WORK)
    (ROOT / "dist").mkdir(exist_ok=True)
    shutil.copyfile(OUTPUT, ROOT / "dist" / OUTPUT.name)
    (WORK / "edit.json").write_text(json.dumps({"take": str(directory), "parts": {"hook": t_a, "app": t_b, "phone": t_c1, "setup": t_c2, "extra": [round(x[1], 3) for x in segments], "end": t_d},
                                                "crossfade": CROSSFADE_S, "sfx": cues, "pip": windows}, indent=2), encoding="utf-8")
    return verify(markers)


def verify(markers):
    step("Checks")
    info = probe(OUTPUT, "stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels:format=duration")
    video = next(s for s in info["streams"] if s["codec_type"] == "video")
    frames = int(subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", str(OUTPUT)],
                                check=True, capture_output=True, text=True).stdout.strip().strip(","))
    duration = float(info["format"]["duration"])
    errors = subprocess.run(["ffmpeg", "-v", "error", "-i", str(OUTPUT), "-f", "null", "-"], capture_output=True, text=True).stderr.strip()
    loud = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(OUTPUT), "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True).stderr
    summary = " ".join(loud.split("Summary:")[-1].split())
    report = {"file": str(OUTPUT), "seconds": duration, "width": video["width"], "height": video["height"], "rate": video["r_frame_rate"], "frames": frames,
              "expected_frames": round(duration * FPS), "decode_errors": errors or "none", "loudness": summary[:160], "render": markers.get("render")}
    (WORK / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    problems = []
    if duration >= MAX_S:
        problems.append(f"{duration:.1f} s is not under {MAX_S} s")
    if (video["width"], video["height"], video["r_frame_rate"]) != (W, H, f"{FPS}/1"):
        problems.append(f"video is {video['width']}x{video['height']} at {video['r_frame_rate']}")
    if abs(frames - report["expected_frames"]) > 2:
        problems.append(f"{frames} frames for {report['expected_frames']} expected")
    if errors:
        problems.append(f"decoding errors: {errors[:200]}")
    if problems:
        sys.exit("The cut fails its checks: " + "; ".join(problems))
    return report


if __name__ == "__main__":
    arguments = sys.argv[1:]
    clips()
    dark, wav = prepare()
    if "--edit" in arguments:
        directory = Path((WORK / "last-take.txt").read_text(encoding="utf-8").strip())
    else:
        directory = take(dark, wav, "--skip-build" in arguments)
    # A new take has just built the app: the phone serves that build.
    phone("--phone" in arguments, "--skip-build" in arguments or "--edit" not in arguments)
    end_card()
    report = edit(directory)
    print(f"\n{OUTPUT}: {report['seconds']:.1f} s, {report['width']}x{report['height']} at {report['rate']}; copied to dist/")
