import { useState } from 'react'
import { API_URL } from './utils'
import { LocationPicker } from './MapComponents'

const initial = { applicant_name: '', department_name: '', category: 'Roads', phone: '', address: '', email: '', password: '', latitude: '', longitude: '' }

export default function DepartmentApplicationForm({ onClose, onSubmitted }) {
  const [form, setForm] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [locationMessage, setLocationMessage] = useState('')
  const [locationBusy, setLocationBusy] = useState(false)
  const [mapOpen, setMapOpen] = useState(false)
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  function useDeviceLocation() {
    setError(''); setLocationMessage('')
    if (!navigator.geolocation) { setLocationMessage('This browser does not support device location. Choose a point on the map instead.'); return }
    setLocationBusy(true)
    navigator.geolocation.getCurrentPosition((position) => {
      setForm((current) => ({ ...current, latitude: String(position.coords.latitude), longitude: String(position.coords.longitude) }))
      setLocationMessage(`Device location captured (accuracy about ${Math.round(position.coords.accuracy)} m).`)
      setLocationBusy(false)
    }, (err) => {
      setLocationMessage(err.code === 1 ? 'Location permission was denied. Allow it in browser settings or choose on the map.' : 'Could not get device location. Choose a point on the map.')
      setLocationBusy(false)
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })
  }

  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('')
    if (form.latitude === '' || form.longitude === '') {
      setBusy(false); setError('Please capture your department location or select it on the map before submitting.'); return
    }
    try {
      const response = await fetch(`${API_URL}/departments/applications`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, latitude: Number(form.latitude), longitude: Number(form.longitude) }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.detail || `Request failed (${response.status})`)
      setMessage(`Application #${data.id} submitted. You can sign in after the authority approves it.`)
      setForm(initial); setLocationMessage('')
      onSubmitted?.(data)
    } catch (err) { setError(err.message || 'Could not submit application.') }
    finally { setBusy(false) }
  }

  return <main className="login-page"><section className="login-card application-card"><div className="hazard-bar" /><div className="login-body">
    <div className="brand-mark">SC</div><h1>Department access request</h1><p className="muted">Submit your department details. A department account is created only after authority approval.</p>
    <form className="login-form" onSubmit={submit}>
      <label>Applicant full name</label><input value={form.applicant_name} onChange={e => update('applicant_name', e.target.value)} minLength={2} required />
      <label>Department name</label><input value={form.department_name} onChange={e => update('department_name', e.target.value)} minLength={2} required />
      <label>Complaint category</label><select value={form.category} onChange={e => update('category', e.target.value)}>{['Roads','Streetlight','Water','Garbage','Drainage','Other'].map(x => <option key={x}>{x}</option>)}</select>
      <label>Phone</label><input type="tel" value={form.phone} onChange={e => update('phone', e.target.value)} minLength={7} required />
      <label>Department address</label><textarea value={form.address} onChange={e => update('address', e.target.value)} rows={2} minLength={3} required />
      <label>Official email</label><input type="email" value={form.email} onChange={e => update('email', e.target.value)} required />
      <label>Choose login password</label><input type="password" value={form.password} onChange={e => update('password', e.target.value)} minLength={8} required />
      <fieldset className="form-section"><legend>Department location</legend>
        <p className="muted small-note">Set the office/service location. This helps route complaints to the right department.</p>
        <div className="location-actions"><button type="button" className="secondary-button" onClick={useDeviceLocation} disabled={locationBusy}>{locationBusy ? 'Locating…' : 'Use device location'}</button><button type="button" className="secondary-button" onClick={() => setMapOpen(true)}>Choose on map</button></div>
        <p className="muted small-note">{form.latitude && form.longitude ? `Selected: ${Number(form.latitude).toFixed(6)}, ${Number(form.longitude).toFixed(6)}` : 'Location required before submitting.'}</p>
        {locationMessage && <p className="muted small-note">{locationMessage}</p>}
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}{message && <p className="notice">{message}</p>}
      <button className="primary-button wide" disabled={busy}>{busy ? 'Submitting…' : 'Submit for approval'}</button>
    </form><p className="login-footnote"><button type="button" className="text-link" onClick={onClose}>Back to sign in</button></p>
  </div></section>{mapOpen && <LocationPicker title="Choose department location" description="Tap the map or drag the pin to your department office/service location." initialLatitude={form.latitude} initialLongitude={form.longitude} onClose={() => setMapOpen(false)} onChoose={(point) => { setForm(current => ({ ...current, latitude: String(point.latitude), longitude: String(point.longitude) })); setLocationMessage('Map location selected.'); setMapOpen(false) }} />}</main>
}
