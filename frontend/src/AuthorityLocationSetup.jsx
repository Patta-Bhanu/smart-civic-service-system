import { useState } from 'react'
import { api } from './utils'
import { LocationPicker } from './MapComponents'

export default function AuthorityLocationSetup({ token, user, onSaved }) {
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [mapOpen, setMapOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  function useDeviceLocation() {
    setError(''); setMessage('')
    if (!navigator.geolocation) { setMessage('Device location is unavailable. Choose a point on the map.'); return }
    setBusy(true)
    navigator.geolocation.getCurrentPosition((position) => {
      setLatitude(String(position.coords.latitude)); setLongitude(String(position.coords.longitude))
      setMessage(`Device location captured (accuracy about ${Math.round(position.coords.accuracy)} m).`)
      setBusy(false)
    }, (err) => {
      setMessage(err.code === 1 ? 'Location permission denied. Allow it in browser settings or choose on the map.' : 'Could not get device location. Choose a point on the map.')
      setBusy(false)
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })
  }

  async function saveLocation() {
    if (latitude === '' || longitude === '') { setError('Use device location or select a point on the map first.'); return }
    setBusy(true); setError('')
    try {
      const updated = await api('/auth/me/location', { token, method: 'POST', json: { latitude: Number(latitude), longitude: Number(longitude) } })
      onSaved(updated)
    } catch (err) { setError(err.message || 'Could not save authority location.') }
    finally { setBusy(false) }
  }

  return <main className="login-page authority-location-page"><section className="login-card"><div className="hazard-bar"/><div className="login-body">
    <div className="brand-mark">SC</div><p className="eyebrow">ONE-TIME SETUP</p><h1>Set your authority location</h1>
    <p className="muted">Welcome{user?.full_name ? `, ${user.full_name}` : ''}. Save the location of your office or service area. It is used to sort complaints nearest to you and route complaint notifications. Once saved, this location is locked.</p>
    <div className="location-actions"><button type="button" className="secondary-button" onClick={useDeviceLocation} disabled={busy}>⌖ Use device location</button><button type="button" className="secondary-button" onClick={() => setMapOpen(true)} disabled={busy}>▣ Choose on map</button></div>
    <p className="muted small-note">{latitude && longitude ? `Selected: ${Number(latitude).toFixed(6)}, ${Number(longitude).toFixed(6)}` : 'Location is required to continue.'}</p>{message && <p className="muted small-note">{message}</p>}{error && <p className="error" role="alert">{error}</p>}
    <button className="primary-button wide" onClick={saveLocation} disabled={busy || !latitude || !longitude}>{busy ? 'Saving…' : 'Save location and continue'}</button>
  </div></section>{mapOpen && <LocationPicker title="Choose authority location" description="Tap the map or drag the pin to your authority office/service area." initialLatitude={latitude} initialLongitude={longitude} onClose={() => setMapOpen(false)} onChoose={(point) => { setLatitude(String(point.latitude)); setLongitude(String(point.longitude)); setMessage('Map location selected.'); setMapOpen(false) }} />}</main>
}
