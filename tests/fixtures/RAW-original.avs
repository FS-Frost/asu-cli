raw="C:\Raw\Ep01\video.mkv"
video=FFVideoSource(raw, threads=1, fpsnum=24000, fpsden=1001, colorspace="YV12")

audio=FFAudioSource(raw)

AudioDub(video, audio)
