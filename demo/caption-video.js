// Burn the SRT captions from record-demo.js into the recorded video.
// Run: node demo/caption-video.js
// Input: demo-video/<something>.webm (Playwright) + steps.srt
// Output: demo-video/warungai-demo-captioned.mp4 (falls back to the raw file on error)
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'demo-video');
const files = fs.readdirSync(OUT).filter((f) => f.endsWith('.webm'));
if (!files.length) {
  console.log('No .webm video found in', OUT);
  process.exit(1);
}
const raw = path.join(OUT, files[0]);
const captioned = path.join(OUT, 'warungai-demo-captioned.mp4');
const srt = path.join(OUT, 'steps.srt');
try {
  execFileSync(
    'ffmpeg',
    [
      '-y', '-i', raw,
      '-vf', `subtitles=${srt.replace(/:/g, '\\:')}:force_style='FontName=DejaVu Sans,FontSize=22,PrimaryColour=&HFFFFFF,OutlineColour=&H80000000,BorderStyle=1,Outline=1,Shadow=0,MarginV=40'`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
      captioned,
    ],
    { stdio: 'inherit' }
  );
  const st = fs.statSync(captioned);
  console.log('Captioned video:', captioned, Math.round(st.size / 1024) + ' KB');
} catch (e) {
  console.log('Captioning failed (raw video is still usable):', String(e.message || e).slice(0, 300));
  process.exit(0);
}
