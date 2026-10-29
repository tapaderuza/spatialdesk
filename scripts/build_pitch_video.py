"""The hybrid pitch cut: real iPhone footage around the real app recorded in the emulator (docs/video/pitch-2026.json).

  0:00  the hook: her request, filmed on the sofa (her own sound, captioned in English)
  then  the app (a take of scripts/make-cinematic-video.mjs on a dark neutral background): the guided setup, her request
        heard in her own voice by Amazon Transcribe and answered by Amazon Nova, the gaze rim, a poke; a picture-in-picture
        corner plays her real pinch while the setup's orb is up, and her real poke while a hand pushes a control
  then  the carer's phone, filmed: Help / Recalibrate; back to the app as the setup opens in response
  end   the card with the project's measured figures
Narration (Piper, local), the app's own 3D sound, the clips' sound, captions; H.264 1080p60 + AAC, -16 LUFS.

  python scripts/build_pitch_video.py                 clips (downloaded if missing), a new take, the edit
  python scripts/build_pitch_video.py --edit          the edit again from the last take
  python scripts/build_pitch_video.py --skip-build    a new take without rebuilding the app first
Needs ffmpeg/ffprobe with zscale, Node and Edge (the take), and .video/piper-venv (python -m venv, then pip install
piper-tts==1.3.0 gdown). The clips live in inputs/, which git ignores: people filmed at home are never committed.
Output: .video/pitch/SpatialDesk_Final_Pitch_2026.mp4, copied to dist/ (which the next build empties and the next
deploy uploads).
"""
import json
import os
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
END_LEAD_S, END_HOLD_S = 0.4, 2.4  # the end card before and after its line
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
    paths = [ROOT / SCRIPT[k]["clip"] for k in ("hook", "pinch", "poke", "carer_clip")]
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
    carer = SCRIPT["carer_clip"]
    t_c1 = carer["out"] - carer["in"]
    help_at = next(e["at"] for e in events if e["kind"] == "help")
    opened_at = next(e["at"] for e in events if e["kind"] == "setup-reopened")
    c2a, c2b = cap(help_at) - 0.3, cap(opened_at) + 3.5
    t_c2 = c2b - c2a
    t_d = END_LEAD_S + seconds(narration("end")) + END_HOLD_S
    o_b, o_c1 = t_a, t_a + t_b
    o_c2 = o_c1 + t_c1
    o_d = o_c2 + t_c2
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
    carer_in = add("-ss", str(carer["in"]), "-t", str(t_c1), "-i", str(ROOT / carer["clip"]))
    end_in = add("-loop", "1", "-t", str(t_d), "-i", str(directory / "end.png"))
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
        lines.append((start, seconds(file), f"Nova: {n['text']}" + (f"\n{english}" if english else "")))
    voices.append((narration("carer"), o_c1 + 0.3))
    lines.append((o_c1 + 0.3, seconds(narration("carer")), next(b["text"] for b in SCRIPT["beats"] if b["id"] == "carer")))
    voices.append((narration("end"), o_d + END_LEAD_S))
    lines.append((o_d + END_LEAD_S, seconds(narration("end")), next(b["text"] for b in SCRIPT["beats"] if b["id"] == "end")))
    for c in hook["captions"]:
        lines.append((c["at"], c["to"] - c["at"], c["text"]))
    (WORK / "captions.srt").write_text(captions(sorted(lines)), encoding="utf-8")
    voice_in = [(add("-i", str(f)), start) for f, start in voices]

    # Video.
    fit = f"scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=0x1a1a1a,fps={FPS},format=yuv420p,setsar=1"
    hook_tm = TONEMAP if hdr(ROOT / hook["clip"]) else ""
    carer_tm = TONEMAP if hdr(ROOT / carer["clip"]) else ""
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
    graph += [
        f"[{base}]drawtext=fontfile=segoeui.ttf:text='{disclosure}':fontsize=24:fontcolor=white@0.85:box=1:boxcolor=black@0.45:boxborderw=12:"
        f"x=48:y=44:enable='between(t,0.4,7)',fade=t=in:st=0:d=0.3,trim=duration={t_b},setpts=PTS-STARTPTS[vb]",
        f"[{carer_in}:v]{carer_tm}{fit},fade=t=in:st=0:d=0.25,trim=duration={t_c1},setpts=PTS-STARTPTS[vc1]",
        f"[capc]trim=start={c2a}:duration={t_c2},setpts=PTS-STARTPTS,fps={FPS},format=yuv420p,setsar=1[vc2]",
        f"[{end_in}:v]fps={FPS},format=yuv420p,setsar=1,fade=t=in:st=0:d=0.4,trim=duration={t_d},setpts=PTS-STARTPTS[vd]",
        # Captions bottom left, clear of the picture-in-picture in the bottom right corner.
        "[va][vb][vc1][vc2][vd]concat=n=5:v=1:a=0,subtitles=captions.srt:force_style='FontName=Segoe UI,FontSize=15,PrimaryColour=&H00FFFFFF,"
        "BorderStyle=3,OutlineColour=&H40000000,Outline=6,Shadow=0,Alignment=1,MarginL=20,MarginV=14'[v]",
    ]

    # Sound: hers and the carer's clip, the app's (cues and whooshes, louder: they are quiet by design), the voices.
    app_start = cap(markers["audioStartedAt"])
    graph += [
        f"[{hook_in}:a:0]aresample=48000,afade=t=out:st={t_a - 0.3}:d=0.3[ha]",
        f"[{carer_in}:a:0]aresample=48000,volume=0.35,adelay={round(o_c1 * 1000)}:all=1[ca]",
        f"[{app_in}:a]aresample=48000,asplit=2[ap1][ap2]",
        f"[ap1]atrim=start={max(0, b0 - app_start)}:duration={t_b},asetpts=PTS-STARTPTS,volume=2.2,adelay={round(o_b * 1000)}:all=1[a1]",
        f"[ap2]atrim=start={max(0, c2a - app_start)}:duration={t_c2},asetpts=PTS-STARTPTS,volume=2.2,adelay={round(o_c2 * 1000)}:all=1[a2]",
    ]
    graph += [f"[{index}:a]aresample=48000,adelay={round(start * 1000)}:all=1[v{k}]" for k, (index, start) in enumerate(voice_in)]
    mix = "[ha][ca][a1][a2]" + "".join(f"[v{k}]" for k in range(len(voice_in)))
    graph.append(f"{mix}amix=inputs={4 + len(voice_in)}:normalize=0:dropout_transition=0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]")

    step(f"Rendering {total:.1f} s")
    run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", ";".join(graph), "-map", "[v]", "-map", "[a]", "-t", f"{total}",
         "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-profile:v", "high", "-r", str(FPS), "-g", str(FPS * 2), "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", OUTPUT.name], cwd=WORK)
    (ROOT / "dist").mkdir(exist_ok=True)
    shutil.copyfile(OUTPUT, ROOT / "dist" / OUTPUT.name)
    (WORK / "edit.json").write_text(json.dumps({"take": str(directory), "parts": {"hook": t_a, "app": t_b, "carer": t_c1, "setup": t_c2, "end": t_d},
                                                "pip": windows}, indent=2), encoding="utf-8")
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
    report = edit(directory)
    print(f"\n{OUTPUT}: {report['seconds']:.1f} s, {report['width']}x{report['height']} at {report['rate']}; copied to dist/")
