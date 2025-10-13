import { useCallback, useEffect, useRef, useState } from 'react'
import './IOSAudioStyles.css'

type AudioState = 'idle' | 'listening' | 'playing'

let sharedAudioCtx: AudioContext | null = null
let ctxCounter = 0

function ensureAudioContext() {
    if (!sharedAudioCtx) {
        sharedAudioCtx = new AudioContext()
        ctxCounter++
        console.log(`🎧 Created AudioContext #${ctxCounter}`)
    }
    return sharedAudioCtx
}

function resumeContextSafe() {
    if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
        sharedAudioCtx.resume().then(() => console.log('🔊 AudioContext resumed'))
    }
}

export default function IOSAudio() {
    const [audioState, setAudioState] = useState<AudioState>('idle')
    const [telemetry, setTelemetry] = useState<string[]>([])
    const [contextId, setContextId] = useState<number>(0)

    const micStreamRef = useRef<MediaStream | null>(null)
    const isRecordingRef = useRef(false)
    const recordedChunks = useRef<Float32Array[]>([])
    const bufferRef = useRef<AudioBuffer | null>(null)
    const processorRef = useRef<ScriptProcessorNode | null>(null)
    const startTimeRef = useRef<number>(0)

    const logEvent = (event: string) => {
        const timestamp = new Date().toLocaleTimeString()
        setTelemetry((prev) => [`${timestamp} — ${event}`, ...prev.slice(0, 9)])
    }

    const startRecording = useCallback(async () => {
        ensureAudioContext()
        resumeContextSafe()
        if (audioState === 'listening') return

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
            })
            micStreamRef.current = stream
            const ctx = sharedAudioCtx!
            const source = ctx.createMediaStreamSource(stream)
            const processor = ctx.createScriptProcessor(4096, 1, 1)
            source.connect(processor)
            processor.connect(ctx.destination)
            processorRef.current = processor

            recordedChunks.current = []
            isRecordingRef.current = true
            startTimeRef.current = Date.now()
            setAudioState('listening')
            logEvent('mic_start')

            processor.onaudioprocess = (e) => {
                if (!isRecordingRef.current) return
                recordedChunks.current.push(new Float32Array(e.inputBuffer.getChannelData(0)))
            }
        } catch {
            logEvent('mic_access_failed')
        }
    }, [audioState])

    const stopRecording = useCallback(() => {
        if (!isRecordingRef.current) return
        isRecordingRef.current = false

        const duration = (Date.now() - startTimeRef.current) / 1000
        logEvent(`mic_stop — duration: ${duration.toFixed(2)}s`)

        micStreamRef.current?.getTracks().forEach((t) => t.stop())
        micStreamRef.current = null
        processorRef.current?.disconnect()
        processorRef.current = null

        if (duration <= 1) {
            recordedChunks.current = []
            bufferRef.current = null
            setAudioState('idle')
            logEvent('record_ignored (too short)')
            return
        }

        const ctx = sharedAudioCtx!
        const length = recordedChunks.current.reduce((acc, c) => acc + c.length, 0)
        const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
        const data = buffer.getChannelData(0)
        let offset = 0
        for (const chunk of recordedChunks.current) {
            data.set(chunk, offset)
            offset += chunk.length
        }
        bufferRef.current = buffer
        setAudioState('idle')
        logEvent('buffer_recorded')
    }, [])

    const playResponse = useCallback(() => {
        ensureAudioContext()
        resumeContextSafe()

        const ctx = sharedAudioCtx!
        setAudioState('playing')
        logEvent('play_start')

        const src = ctx.createBufferSource()
        src.buffer =
            bufferRef.current ||
            (() => {
                const b = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate)
                const d = b.getChannelData(0)
                for (let i = 0; i < d.length; i++) d[i] = Math.sin((i / 20) * Math.PI)
                return b
            })()

        src.connect(ctx.destination)
        src.start()
        src.onended = () => {
            setAudioState('idle')
            logEvent('play_end')
        }
    }, [])

    const resetAudioStack = useCallback(() => {
        logEvent('reset_audio_stack')
        micStreamRef.current?.getTracks().forEach((t) => t.stop())
        micStreamRef.current = null
        bufferRef.current = null
        processorRef.current?.disconnect()
        processorRef.current = null

        if (sharedAudioCtx) {
            sharedAudioCtx.close()
            sharedAudioCtx = null
            logEvent('audio_context_closed')
        }

        ensureAudioContext()
        setContextId(ctxCounter)
        setAudioState('idle')
    }, [])

    useEffect(() => {
        const handleVisibility = () => resumeContextSafe()
        const handlePageShow = () => resumeContextSafe()
        const handleDeviceChange = () => {
            if (audioState === 'listening') startRecording().catch(() => logEvent('mic_reacquire_failed'))
        }

        document.addEventListener('visibilitychange', handleVisibility)
        window.addEventListener('pageshow', handlePageShow)
        try {
            navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange as EventListener)
        } catch {}

        return () => {
            document.removeEventListener('visibilitychange', handleVisibility)
            window.removeEventListener('pageshow', handlePageShow)
            try {
                navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange as EventListener)
            } catch {}
        }
    }, [audioState, startRecording])

    return (
        <div className="audio-container">
            <div className="audio-card">
                <h1 className="audio-title">🎤 Push-to-Talk Recorder</h1>

                <div className="btn-row">
                    <button
                        onMouseDown={startRecording}
                        onMouseUp={stopRecording}
                        onTouchStart={startRecording}
                        onTouchEnd={stopRecording}
                        disabled={audioState === 'playing'}
                        className={`btn btn-main ${audioState === 'listening' ? 'btn-stop' : 'btn-record'}`}
                    >
                        {audioState === 'listening' ? '🎙 Recording...' : '🎤 Hold to Record'}
                    </button>

                    <button onClick={playResponse} disabled={audioState === 'listening'} className="btn btn-main btn-play">
                        ▶️ Play
                    </button>
                </div>

                <button onClick={resetAudioStack} className="btn btn-secondary">
                    🔄 Reset Audio
                </button>

                <div className="info-box">
                    <p><strong>State:</strong> {audioState}</p>
                    <p><strong>AudioContext ID:</strong> {contextId}</p>
                    <p><strong>AudioContext State:</strong> {sharedAudioCtx?.state || 'none'}</p>
                </div>

                <details className="telemetry-box">
                    <summary>Telemetry (last 10 events)</summary>
                    <ul>
                        {telemetry.map((t, i) => <li key={i}>{t}</li>)}
                    </ul>
                </details>
            </div>
        </div>
    )
}
