# 🎙 iOS Web-Audio Stability Demo

This project is a **React + TypeScript** demo proving reliable **mic input and audio playback** on **iOS Safari**.  
It implements a **robust WebAudio state machine**, **gesture-based unlock**, and **auto-recovery logic** for mobile audio handling.

---

## 🧩 Overview

| Feature | Description |
|----------|--------------|
| 🎧 **Shared AudioContext** | A single, persistent `AudioContext` reused throughout the session. |
| 🟢 **Tap to Enable Audio** | Unlocks the context via user gesture; fixes autoplay rejections. |
| 🎙 **Push-to-Talk (Press & Hold)** | Hold to record mic input; release to stop and save to buffer. |
| ▶️ **Play Response** | Plays recorded audio (or synthetic tone if none). |
| 🔄 **Reset Audio Stack** | Stops mic, disconnects nodes, closes context, and reinitializes cleanly. |
| 🪪 **Telemetry Panel** | Logs recent events, context state, and mic info for debugging. |

---

### 🔁 State Machine

## to run

## 1: npm install

## 2: npm start
