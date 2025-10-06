import { useCallback, useEffect, useRef, useState } from 'react'

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
    const [showUnlock, setShowUnlock] = useState(false)
    const [audioState, setAudioState] = useState<AudioState>('idle')
    const [telemetry, setTelemetry] = useState<string[]>([])
    const [contextId, setContextId] = useState<number>(0)

    const micStreamRef = useRef<MediaStream | null>(null)
    const isRecordingRef = useRef(false)
    const recordedChunks = useRef<Float32Array[]>([])
    const bufferRef = useRef<AudioBuffer | null>(null)
    const processorRef = useRef<ScriptProcessorNode | null>(null)

    const logEvent = (event: string) => {
        const timestamp = new Date().toLocaleTimeString()
        setTelemetry((prev) => [`${timestamp} — ${event}`, ...prev.slice(0, 9)])
        console.log(`[${timestamp}] ${event}`)
    }

    const handleUnlock = () => {
        ensureAudioContext()
        resumeContextSafe()
        setShowUnlock(false)
        setContextId(ctxCounter)
        logEvent('audio_unlocked')
    }

    const startRecording = useCallback(async () => {
        if (!_hasUnlocked()) {
            setShowUnlock(true)
            logEvent('mic_start_blocked')
            return
        }
        if (audioState === 'listening') return

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: 1,
                },
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
            setAudioState('listening')
            logEvent('mic_start')

            processor.onaudioprocess = (e) => {
                if (!isRecordingRef.current) return
                recordedChunks.current.push(new Float32Array(e.inputBuffer.getChannelData(0)))
            }
        } catch {
            setShowUnlock(true)
            logEvent('mic_access_failed')
        }
    }, [audioState])

    const stopRecording = useCallback(() => {
        isRecordingRef.current = false
        setAudioState('idle')
        logEvent('mic_stop')

        micStreamRef.current?.getTracks().forEach((t) => t.stop())
        micStreamRef.current = null
        processorRef.current?.disconnect()
        processorRef.current = null

        const ctx = sharedAudioCtx!
        const totalLength = recordedChunks.current.reduce((acc, c) => acc + c.length, 0)

        let buffer: AudioBuffer
        if (totalLength === 0) {
            // fallback - короткий синтезований звук
            buffer = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate)
            const d = buffer.getChannelData(0)
            for (let i = 0; i < d.length; i++) d[i] = Math.sin((i / 20) * Math.PI)
        } else {
            buffer = ctx.createBuffer(1, totalLength, ctx.sampleRate)
            const data = buffer.getChannelData(0)
            let offset = 0
            for (const chunk of recordedChunks.current) {
                data.set(chunk, offset)
                offset += chunk.length
            }
        }
        bufferRef.current = buffer
        logEvent('buffer_recorded')
    }, [])

    const toggleRecording = async () => {
        if (audioState !== 'listening') await startRecording()
        else stopRecording()
    }

    const playResponse = useCallback(() => {
        if (!_hasUnlocked()) {
            setShowUnlock(true)
            logEvent('play_blocked')
            return
        }

        if (audioState === 'listening') stopRecording()

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
    }, [audioState, stopRecording])

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
        if (!_hasUnlocked()) setShowUnlock(true)

        const handleVisibility = () => {
            resumeContextSafe()
            logEvent('visibility_change')
        }
        const handlePageShow = () => {
            resumeContextSafe()
            logEvent('pageshow')
        }
        const handleDeviceChange = () => {
            logEvent('devicechange')
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

    const _hasUnlocked = () => !!sharedAudioCtx

    return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', background: '#f9fafb' }}>
            <div style={{ background: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', borderRadius: '24px', padding: '32px', width: '100%', maxWidth: '400px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h1 style={{ textAlign: 'center', fontSize: '24px', fontWeight: 700 }}>🎤 Audio Recorder</h1>

                {showUnlock && (
                    <button onClick={handleUnlock} style={{ width: '100%', padding: '12px', borderRadius: '16px', background: '#2563eb', color: 'white', fontWeight: 600, cursor: 'pointer' }}>
                        Tap to enable audio
                    </button>
                )}

                <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                    <button
                        onClick={toggleRecording}
                        disabled={audioState === 'playing'}
                        style={{
                            flex: 1,
                            padding: '12px',
                            borderRadius: '12px',
                            fontWeight: 600,
                            background: audioState === 'listening' ? '#dc2626' : '#16a34a',
                            color: 'white',
                            cursor: 'pointer',
                        }}
                    >
                        {audioState === 'listening' ? '🛑 Stop Recording' : '🎙 Start Recording'}
                    </button>

                    <button
                        onClick={playResponse}
                        disabled={audioState === 'listening'}
                        style={{ flex: 1, padding: '12px', borderRadius: '12px', fontWeight: 600, background: '#7c3aed', color: 'white', cursor: 'pointer', opacity: audioState === 'listening' ? 0.5 : 1 }}
                    >
                        ▶️ Play
                    </button>
                </div>

                <button
                    onClick={resetAudioStack}
                    style={{ width: '100%', padding: '12px', borderRadius: '12px', background: '#d1d5db', color: '#111827', fontWeight: 600, cursor: 'pointer' }}
                >
                    🔄 Reset Audio
                </button>

                <div style={{ background: '#f3f4f6', padding: '16px', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <p><strong>State:</strong> {audioState}</p>
                    <p><strong>AudioContext ID:</strong> {contextId}</p>
                    <p><strong>AudioContext State:</strong> {sharedAudioCtx?.state || 'none'}</p>
                </div>

                <details style={{ background: '#f9fafb', padding: '12px', borderRadius: '12px' }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 500 }}>Telemetry (last 10 events)</summary>
                    <ul style={{ marginTop: '8px', fontSize: '14px', maxHeight: '160px', overflowY: 'auto' }}>
                        {telemetry.map((t, i) => <li key={i}>{t}</li>)}
                    </ul>
                </details>
            </div>
        </div>
    )
}
