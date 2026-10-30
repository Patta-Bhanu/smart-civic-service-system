import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from './utils'

const MAX_RECORDING_SECONDS = 120
const MAX_PHOTO_MB = 10
const MAX_AUDIO_MB = 15

/** Downscale big phone photos before upload (faster, smaller). Falls back to the original file. */
export async function shrinkImage(file, maxSide = 1600, quality = 0.85) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) {
      bitmap.close?.()
      return file
    }
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality)
    )
    if (!blob || blob.size >= file.size) return file
    const name = file.name.replace(/\.[^.]+$/, '') || 'photo'
    return new File([blob], `${name}.jpg`, { type: 'image/jpeg' })
  } catch {
    return file
  }
}

function formatTimer(total) {
  const m = String(Math.floor(total / 60)).padStart(2, '0')
  const s = String(total % 60).padStart(2, '0')
  return `${m}:${s}`
}

/** Creates (and cleans up) an object URL for a File/Blob. */
function useObjectUrl(file) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!file) {
      setUrl('')
      return undefined
    }
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])
  return url
}

/* ------------------------------------------------------------------ */
/* In-page camera                                                      */
/* ------------------------------------------------------------------ */

export function CameraModal({ onCapture, onClose }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [facing, setFacing] = useState('environment')
  const [status, setStatus] = useState('starting') // starting | live | error
  const [errorMessage, setErrorMessage] = useState('')
  const [canFlip, setCanFlip] = useState(false)
  const [shot, setShot] = useState(null) // { blob, url }

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  // Start / restart the camera
  useEffect(() => {
    if (shot) return undefined
    let cancelled = false

    async function start() {
      stopStream()
      setStatus('starting')
      setErrorMessage('')

      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('error')
        setErrorMessage(
          'Live camera is not available here. It needs HTTPS (or localhost). You can use your phone camera app instead.'
        )
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          await video.play().catch(() => {})
        }
        setStatus('live')
        const devices = await navigator.mediaDevices.enumerateDevices()
        if (!cancelled) {
          setCanFlip(devices.filter((d) => d.kind === 'videoinput').length > 1)
        }
      } catch (err) {
        if (cancelled) return
        setStatus('error')
        setErrorMessage(
          err.name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow camera access in your browser settings and try again.'
            : err.name === 'NotFoundError'
              ? 'No camera was found on this device.'
              : 'Could not start the camera. Close other apps using it and try again.'
        )
      }
    }

    start()
    return () => {
      cancelled = true
      stopStream()
    }
  }, [facing, shot, stopStream])

  // Clean up preview URL
  useEffect(() => {
    return () => {
      if (shot) URL.revokeObjectURL(shot.url)
    }
  }, [shot])

  // Escape to close + lock page scroll while open
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose])

  function takePicture() {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    canvas.toBlob(
      (blob) => {
        if (blob) setShot({ blob, url: URL.createObjectURL(blob) })
      },
      'image/jpeg',
      0.92
    )
  }

  function usePhoto() {
    if (!shot) return
    onCapture(
      new File([shot.blob], `site-photo-${Date.now()}.jpg`, { type: 'image/jpeg' })
    )
  }

  return (
    <div className="camera-overlay" role="dialog" aria-modal="true" aria-label="Take a photo">
      <div className="camera-top">
        <span>{shot ? 'Review photo' : 'Take a photo of the issue'}</span>
        <button type="button" className="icon-button light" onClick={onClose} aria-label="Close camera">
          <Icon name="close" />
        </button>
      </div>

      <div className="camera-stage">
        {/* video stays mounted so the ref is always valid */}
        <video
          ref={videoRef}
          className={`camera-video ${shot || status === 'error' ? 'hidden' : ''}`}
          playsInline
          muted
        />
        {shot && <img className="camera-video" src={shot.url} alt="Captured preview" />}

        {status === 'starting' && !shot && <p className="camera-message">Starting camera…</p>}

        {status === 'error' && !shot && (
          <div className="camera-message">
            <p>{errorMessage}</p>
            <label className="primary-button fallback-label">
              <Icon name="camera" /> Open phone camera
              <input
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) onCapture(file)
                }}
              />
            </label>
          </div>
        )}
      </div>

      <div className="camera-controls">
        {shot ? (
          <>
            <button type="button" className="ghost-light-button" onClick={() => setShot(null)}>
              <Icon name="refresh" /> Retake
            </button>
            <button type="button" className="primary-button" onClick={usePhoto}>
              <Icon name="check" /> Use this photo
            </button>
          </>
        ) : (
          <>
            <span className="camera-spacer" />
            <button
              type="button"
              className="shutter"
              onClick={takePicture}
              disabled={status !== 'live'}
              aria-label="Capture photo"
            />
            {canFlip ? (
              <button
                type="button"
                className="icon-button light"
                onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
                aria-label="Switch camera"
              >
                <Icon name="flip" size={22} />
              </button>
            ) : (
              <span className="camera-spacer" />
            )}
          </>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Photo + voice fields                                                */
/* ------------------------------------------------------------------ */

export function PhotoField({ photo, onChange, onMessage }) {
  const [cameraOpen, setCameraOpen] = useState(false)
  const previewUrl = useObjectUrl(photo)

  function handleFile(file) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      onMessage('Please choose an image file.')
      return
    }
    if (file.size > MAX_PHOTO_MB * 1024 * 1024) {
      onMessage(`That photo is larger than ${MAX_PHOTO_MB} MB. Choose a smaller one.`)
      return
    }
    onMessage('')
    onChange(file)
  }

  return (
    <div className="field-block">
      <div className="field-title">
        <h3>Photo</h3>
        <span className="muted small-note">Optional</span>
      </div>

      {photo ? (
        <div className="photo-preview">
          <img src={previewUrl} alt="Selected complaint evidence" />
          <div className="photo-preview-bar">
            <span className="file-name">{photo.name}</span>
            <div className="button-row">
              <button type="button" className="secondary-button" onClick={() => setCameraOpen(true)}>
                <Icon name="camera" /> Retake
              </button>
              <button type="button" className="secondary-button danger-text" onClick={() => onChange(null)}>
                <Icon name="trash" /> Remove
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="photo-actions">
          <button type="button" className="photo-choice" onClick={() => setCameraOpen(true)}>
            <span className="photo-choice-icon"><Icon name="camera" size={26} /></span>
            <strong>Take photo now</strong>
            <span className="muted small-note">Use your camera on site</span>
          </button>

          <label className="photo-choice">
            <span className="photo-choice-icon"><Icon name="upload" size={26} /></span>
            <strong>Upload from device</strong>
            <span className="muted small-note">Pick a saved image</span>
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                handleFile(event.target.files?.[0])
                event.target.value = ''
              }}
            />
          </label>
        </div>
      )}

      {cameraOpen && (
        <CameraModal
          onClose={() => setCameraOpen(false)}
          onCapture={(file) => {
            handleFile(file)
            setCameraOpen(false)
          }}
        />
      )}
    </div>
  )
}

export function VoiceField({ audio, onChange, recorderRef, onMessage }) {
  const [isRecording, setIsRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const streamRef = useRef(null)
  const audioUrl = useObjectUrl(audio)

  // timer + auto stop
  useEffect(() => {
    if (!isRecording) return undefined
    const id = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [isRecording])

  useEffect(() => {
    if (isRecording && seconds >= MAX_RECORDING_SECONDS) stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds, isRecording])

  // release the microphone if the form closes mid-recording
  useEffect(() => {
    return () => {
      const recorder = recorderRef.current
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = null
        recorder.stop()
      }
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [recorderRef])

  async function start() {
    onMessage('')
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      onMessage('Recording is not supported in this browser. Use Chrome on localhost or HTTPS, or attach an audio file.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const recorder = new MediaRecorder(stream)
      const chunks = []

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data)
      }
      recorder.onerror = () => {
        onMessage('Recording failed. Please try again.')
        stream.getTracks().forEach((track) => track.stop())
        setIsRecording(false)
      }
      recorder.onstop = () => {
        const type = recorder.mimeType || 'audio/webm'
        const extension = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm'
        const blob = new Blob(chunks, { type })
        onChange(new File([blob], `voice-complaint.${extension}`, { type }))
        stream.getTracks().forEach((track) => track.stop())
        setIsRecording(false)
      }

      recorderRef.current = recorder
      setSeconds(0)
      recorder.start()
      setIsRecording(true)
    } catch (err) {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      onMessage(
        err.name === 'NotAllowedError'
          ? 'Microphone permission was denied. Allow microphone access in your browser.'
          : 'Could not access the microphone. Check that it is connected and available.'
      )
      setIsRecording(false)
    }
  }

  function stop() {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }

  function handleFile(file) {
    if (!file) return
    if (file.size > MAX_AUDIO_MB * 1024 * 1024) {
      onMessage(`That audio file is larger than ${MAX_AUDIO_MB} MB. Choose a shorter one.`)
      return
    }
    onMessage('')
    onChange(file)
  }

  return (
    <div className="field-block">
      <div className="field-title">
        <h3>Voice note</h3>
        <span className="muted small-note">Optional</span>
      </div>

      {isRecording ? (
        <div className="recording-live">
          <span className="rec-dot" aria-hidden="true" />
          <strong>Recording {formatTimer(seconds)}</strong>
          <span className="muted small-note">Stops at {formatTimer(MAX_RECORDING_SECONDS)}</span>
          <button type="button" className="danger-button" onClick={stop}>
            <Icon name="stop" /> Stop
          </button>
        </div>
      ) : audio ? (
        <div className="audio-saved">
          <audio className="audio-player" controls src={audioUrl} />
          <div className="photo-preview-bar">
            <span className="file-name">{audio.name}</span>
            <div className="button-row">
              <button type="button" className="secondary-button" onClick={start}>
                <Icon name="mic" /> Re-record
              </button>
              <button type="button" className="secondary-button danger-text" onClick={() => onChange(null)}>
                <Icon name="trash" /> Remove
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="button-row">
          <button type="button" className="secondary-button" onClick={start}>
            <Icon name="mic" /> Record the audio
          </button>
          <label className="secondary-button">
            <Icon name="upload" /> Attach audio file
            <input
              type="file"
              accept="audio/*"
              hidden
              onChange={(event) => {
                handleFile(event.target.files?.[0])
                event.target.value = ''
              }}
            />
          </label>
        </div>
      )}
      <p className="muted small-note">The audio is uploaded as a recording. It is not converted to text.</p>
    </div>
  )
}


