"""
Cut a recorded gameplay run (scripts/capture.mjs video ...) into the
submission video: one clip per beat mark, short crossfades between clips
(which also hide the clock jumps), game audio aligned and loudness-normalised,
and an end card. Requires ffmpeg on PATH and Pillow.

  python scripts/edit-video.py capture/video1 out.mp4 [--card card.png]
"""
import json
import subprocess
import sys
from pathlib import Path

src = Path(sys.argv[1])
out = Path(sys.argv[2])
card = None
if '--card' in sys.argv:
    card = Path(sys.argv[sys.argv.index('--card') + 1])

result = json.loads((src / 'result.json').read_text())
marks = result['marks']
audio = json.loads((src / 'audio.json').read_text())
video = next(p for p in src.glob('page@*.webm'))
W, H, FPS = 1280, 720, 30
XF = 0.4  # crossfade seconds

# Per-beat trims: (start offset, max length) applied to [mark_i, mark_i+1)
TRIM = {
    'title': (0.3, 3.6),
    'enter': None,  # drop: session start / fade-in from the emulator
    'establish': (0.2, 9.0),
    'chop': (0.0, 4.0),
    'gaze': (0.0, 4.5),
    'plant': (0.0, 14.0),
    'replant': (0.0, 3.6),
    'cloud': (0.0, 14.0),
    'dance': (0.4, 8.0),
    'crush': (0.0, 5.0),
    'bless': (0.0, 6.0),
    'petition': (0.0, 6.5),
    'smoke': (0.0, 16.0),
    'lightning': (0.0, 4.5),
    'festival': (0.0, 30.0),
    'lanterns': (0.0, 10.0),
    'ending': (0.0, 7.0),
}

work = src / 'edit'
work.mkdir(exist_ok=True)

# 1) mux game audio onto the full recording (audio starts later than video)
full = work / 'full.mp4'
subprocess.run([
    'ffmpeg', '-y', '-v', 'error', '-i', str(video), '-i', str(audio['file']),
    '-filter_complex', f'[0:v]fps={FPS},scale={W}:{H}:flags=lanczos,format=yuv420p[v];[1:a]aresample=48000,adelay={int(audio["offsetSec"] * 1000)}:all=1,apad[a]',
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-c:a', 'aac', '-b:a', '256k', '-shortest', str(full),
], check=True)

# 2) cut segments
clips = []
for i, m in enumerate(marks[:-1]):
    rule = TRIM.get(m['name'], (0.0, 999))
    if rule is None:
        continue
    start = m['t'] + rule[0]
    end = min(marks[i + 1]['t'], start + rule[1])
    if end - start < 1.0:
        continue
    clip = work / f'{i:02d}-{m["name"]}.mp4'
    subprocess.run([
        'ffmpeg', '-y', '-v', 'error', '-ss', f'{start:.3f}', '-i', str(full), '-t', f'{end - start:.3f}',
        '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-c:a', 'aac', '-b:a', '256k', str(clip),
    ], check=True)
    clips.append((clip, end - start))

# 3) optional end card (5 s still with silence)
if card:
    endclip = work / 'zz-card.mp4'
    subprocess.run([
        'ffmpeg', '-y', '-v', 'error', '-loop', '1', '-t', '5', '-i', str(card), '-f', 'lavfi', '-t', '5', '-i', 'anullsrc=r=48000:cl=stereo',
        '-vf', f'scale={W}:{H},fps={FPS},format=yuv420p,fade=t=in:st=0:d=0.5', '-c:v', 'libx264', '-crf', '16', '-c:a', 'aac', '-shortest', str(endclip),
    ], check=True)
    clips.append((endclip, 5.0))

# 4) crossfade chain (normalise timebase/format; use measured durations)
def dur(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)], capture_output=True, text=True).stdout
    return float(out.strip())
clips = [(c, dur(c)) for c, _ in clips]
inputs = []
for c, _ in clips:
    inputs += ['-i', str(c)]
fc = []
for k in range(len(clips)):
    fc.append(f'[{k}:v]settb=AVTB,fps={FPS},scale={W}:{H},setsar=1,format=yuv420p[nv{k}]')
    fc.append(f'[{k}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[na{k}]')
vprev, aprev = '[nv0]', '[na0]'
acc = clips[0][1]
for k in range(1, len(clips)):
    off = acc - XF
    fc.append(f'{vprev}[nv{k}]xfade=transition=fade:duration={XF}:offset={off:.3f}[v{k}]')
    fc.append(f'{aprev}[na{k}]acrossfade=d={XF}[a{k}]')
    vprev, aprev = f'[v{k}]', f'[a{k}]'
    acc = acc + clips[k][1] - XF
fc.append(f'{aprev}loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=out:st={acc - 1.2:.3f}:d=1.2[aout]')
fc.append(f'{vprev}fade=t=in:st=0:d=0.4,fade=t=out:st={acc - 0.8:.3f}:d=0.8[vout]')
subprocess.run(['ffmpeg', '-y', '-v', 'error', *inputs, '-filter_complex', ';'.join(fc), '-map', '[vout]', '-map', '[aout]',
                '-c:v', 'libx264', '-crf', '17', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k',
                '-movflags', '+faststart', str(out)], check=True)
print(f'{out}  {acc:.1f} s  ({len(clips)} clips)')
