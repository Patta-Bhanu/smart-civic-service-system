import { useCallback, useEffect, useState } from 'react'
import { API_URL, api, formatDate, statusLabel } from './utils'
import { LocationPicker } from './MapComponents'

const emptyDepartment = { name: '', category: 'Roads', description: '', phone: '', address: '', email: '', password: '', latitude: '', longitude: '', service_radius_km: '10' }
const categories = ['Roads', 'Streetlight', 'Water', 'Garbage', 'Drainage', 'Other']

export default function AuthorityDepartmentPanel({ token, complaints = [], onRefresh, section = 'management' }) {
  const [applications, setApplications] = useState([])
  const [updates, setUpdates] = useState([])
  const [audit, setAudit] = useState([])
  const [escalations, setEscalations] = useState([])
  const [archived, setArchived] = useState([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [departmentForm, setDepartmentForm] = useState(emptyDepartment)
  const [reminderText, setReminderText] = useState({})
  const [archiveReason, setArchiveReason] = useState({})
  const [mapOpen, setMapOpen] = useState(false)
  const [locationMessage, setLocationMessage] = useState('')
  const [locationBusy, setLocationBusy] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    setError('')
    const tasks = await Promise.allSettled([
      api('/authority/applications/pending', { token }),
      api('/authority/updates/pending', { token }),
      api('/authority/audit?limit=100', { token }),
      api('/authority/escalations', { token }),
      api('/authority/complaints/archived', { token }),
    ])
    if (tasks[0].status === 'fulfilled') setApplications(tasks[0].value)
    if (tasks[1].status === 'fulfilled') setUpdates(tasks[1].value)
    if (tasks[2].status === 'fulfilled') setAudit(tasks[2].value)
    if (tasks[3].status === 'fulfilled') setEscalations(tasks[3].value)
    if (tasks[4].status === 'fulfilled') setArchived(tasks[4].value)
    const failed = tasks.find(x => x.status === 'rejected')
    if (failed) setError(failed.reason?.message || 'Some authority data could not be loaded.')
  }, [token])
  useEffect(() => { load() }, [load])

  async function action(path, method = 'POST', json = {}) {
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await api(path, { token, method, json })
      setNotice(result.message || 'Action completed.')
      await load(); await onRefresh?.()
    } catch (err) { setError(err.message || 'Action failed.') }
    finally { setBusy(false) }
  }

  async function createDepartment(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    if (!departmentForm.latitude || !departmentForm.longitude) {
      setBusy(false); setError('Choose the department location using device GPS or the map.'); return
    }
    try {
      const f = departmentForm
      const result = await api('/authority/departments', { token, method: 'POST', json: { ...f, latitude: Number(f.latitude), longitude: Number(f.longitude), service_radius_km: Number(f.service_radius_km) } })
      setNotice(result.message || `Department ${result.name || ''} created.`)
      setDepartmentForm(emptyDepartment); setLocationMessage('')
      await load(); await onRefresh?.()
    } catch (err) { setError(err.message || 'Could not create department.') }
    finally { setBusy(false) }
  }

  function useDeviceLocation() {
    setError(''); setLocationMessage('')
    if (!navigator.geolocation) { setLocationMessage('Device location is unavailable in this browser. Choose on the map.'); return }
    setLocationBusy(true)
    navigator.geolocation.getCurrentPosition((position) => {
      setDepartmentForm(current => ({ ...current, latitude: String(position.coords.latitude), longitude: String(position.coords.longitude) }))
      setLocationMessage(`Device location captured (accuracy about ${Math.round(position.coords.accuracy)} m).`)
      setLocationBusy(false)
    }, (err) => {
      setLocationMessage(err.code === 1 ? 'Location permission denied. Allow access or choose on the map.' : 'Could not get device location. Choose on the map.')
      setLocationBusy(false)
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })
  }

  async function exportExcel() {
    setError(''); setNotice('')
    try {
      const response = await fetch(`${API_URL}/authority/export.xlsx`, { headers: { Authorization: `Bearer ${token}` } })
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.detail || `Export failed (${response.status})`) }
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a')
      a.href = url; a.download = 'smart_civic_complaints.xlsx'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
      setNotice('Excel export downloaded.')
    } catch (err) { setError(err.message || 'Could not export complaints.') }
  }
  async function reviewUpdate(id, approve) { await action(`/authority/updates/${id}/${approve ? 'approve' : 'reject'}`, 'POST', approve ? {} : { reason: 'Please add clearer evidence or details and resubmit.' }) }
  async function reviewApplication(id, approve) { await action(`/authority/applications/${id}/${approve ? 'approve' : 'reject'}`, 'POST', approve ? {} : { reason: 'Application requires additional verification.' }) }

  const activeComplaints = complaints.filter(x => !x.is_archived && !['resolved', 'rejected'].includes(x.status))
  const title = section === 'reviews' ? 'Review queue' : section === 'reminders' ? 'Reminders' : section === 'audit' ? 'Audit and archive' : 'Department management'

  return <section className="authority-tools">
    <div className="authority-panel-heading"><div><p className="eyebrow">AUTHORITY WORKSPACE</p><h2>{title}</h2><p className="muted small-note">Manage civic service work from one secure authority workspace.</p></div><button className="secondary-button" onClick={load} disabled={busy}>↻ Refresh</button></div>
    {error && <p className="error banner" role="alert">{error}</p>}{notice && <p className="notice banner">{notice}</p>}
    <div className="authority-summary-grid"><div className="authority-summary"><strong>{applications.length}</strong><span>Pending applications</span></div><div className="authority-summary"><strong>{updates.length}</strong><span>Updates to review</span></div><div className="authority-summary"><strong>{escalations.length}</strong><span>Overdue complaints</span></div><div className="authority-summary"><strong>{audit.length}</strong><span>Recent audit records</span></div></div>

    {section === 'reviews' && <>
      <section className="panel authority-subpanel"><h3>Department applications</h3>{applications.length === 0 ? <p className="muted">No applications waiting for review.</p> : applications.map(x => <article className="authority-item" key={x.id}><div><strong>{x.department_name} · {x.category}</strong><p>{x.applicant_name} · {x.email} · {x.phone}</p><p>{x.address}</p><small>Submitted {formatDate(x.created_at)}{x.latitude != null && x.longitude != null ? ` · Location ${Number(x.latitude).toFixed(5)}, ${Number(x.longitude).toFixed(5)}` : ' · Location missing'}</small></div><div className="authority-item-actions"><button className="primary-button" disabled={busy} onClick={() => reviewApplication(x.id, true)}>Approve</button><button className="danger-button" disabled={busy} onClick={() => reviewApplication(x.id, false)}>Reject</button></div></article>)}</section>
      <section className="panel authority-subpanel"><h3>Department updates awaiting approval</h3>{updates.length === 0 ? <p className="muted">No updates awaiting review.</p> : updates.map(x => <article className="authority-item" key={x.id}><div><strong>Complaint #{x.complaint_id}: {x.complaint_title}</strong><p>{x.department_name} · {x.submitted_by_name} · {formatDate(x.created_at)}</p><p>{x.message}</p>{x.proposed_status && <p>Proposed status: <b>{statusLabel(x.proposed_status)}</b></p>}{x.photo_url && <a className="text-link" href={`${API_URL}${x.photo_url}`} target="_blank" rel="noreferrer">View photo evidence</a>}{x.audio_url && <audio controls src={`${API_URL}${x.audio_url}`} />}</div><div className="authority-item-actions"><button className="primary-button" disabled={busy} onClick={() => reviewUpdate(x.id, true)}>Approve update</button><button className="danger-button" disabled={busy} onClick={() => reviewUpdate(x.id, false)}>Reject</button></div></article>)}</section>
    </>}

    {section === 'management' && <>
      <section className="panel authority-subpanel"><h3>Create department and staff login</h3><p className="muted small-note">Create a department directly. For external departments, use the review queue and approve their application first.</p><form className="authority-form" onSubmit={createDepartment}>
        <label>Department name</label><input value={departmentForm.name} onChange={e => setDepartmentForm({...departmentForm, name:e.target.value})} required minLength={2}/>
        <label>Complaint category</label><select value={departmentForm.category} onChange={e => setDepartmentForm({...departmentForm, category:e.target.value})}>{categories.map(x => <option key={x}>{x}</option>)}</select>
        <label>Description</label><input value={departmentForm.description} onChange={e => setDepartmentForm({...departmentForm, description:e.target.value})}/>
        <label>Phone</label><input value={departmentForm.phone} onChange={e => setDepartmentForm({...departmentForm, phone:e.target.value})} required minLength={7}/>
        <label>Address</label><input value={departmentForm.address} onChange={e => setDepartmentForm({...departmentForm, address:e.target.value})} required minLength={3}/>
        <label>Staff email</label><input type="email" value={departmentForm.email} onChange={e => setDepartmentForm({...departmentForm, email:e.target.value})} required/>
        <label>Initial password</label><input type="password" value={departmentForm.password} onChange={e => setDepartmentForm({...departmentForm, password:e.target.value})} required minLength={8}/>
        <fieldset className="form-section"><legend>Department location</legend><p className="muted small-note">Capture the office location from this device or choose it on the map. No manual coordinates needed.</p><div className="location-actions"><button type="button" className="secondary-button" onClick={useDeviceLocation} disabled={locationBusy}>{locationBusy ? 'Locating…' : 'Use device location'}</button><button type="button" className="secondary-button" onClick={() => setMapOpen(true)}>Choose on map</button></div><p className="muted small-note">{departmentForm.latitude && departmentForm.longitude ? `Selected: ${Number(departmentForm.latitude).toFixed(6)}, ${Number(departmentForm.longitude).toFixed(6)}` : 'Location required before creating the department.'}</p>{locationMessage && <p className="muted small-note">{locationMessage}</p>}</fieldset>
        <label>Service radius (km)</label><input type="number" min="0.1" max="500" step="0.1" value={departmentForm.service_radius_km} onChange={e => setDepartmentForm({...departmentForm, service_radius_km:e.target.value})}/>
        <button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Create department'}</button>
      </form></section>
    </>}

    {section === 'reminders' && <section className="panel authority-subpanel"><div className="authority-panel-heading"><div><h3>Active complaint reminders</h3><p className="muted small-note">Send a reminder to the department assigned to each complaint.</p></div><button className="secondary-button" onClick={exportExcel}>Export Excel</button></div>
      {activeComplaints.length === 0 ? <p className="muted">No active complaints need reminders.</p> : activeComplaints.map(x => <article className="authority-item" key={x.id}><div><strong>#{x.id} · {x.title}</strong><p>{x.category} · {statusLabel(x.status)} · {x.distance_km != null ? `${x.distance_km.toFixed(2)} km from your authority location · ` : ''}due {formatDate(x.due_at)}</p><textarea aria-label={`Reminder for complaint ${x.id}`} rows={2} placeholder="Reminder message to department" value={reminderText[x.id] || ''} onChange={e => setReminderText({...reminderText, [x.id]:e.target.value})}/></div><div className="authority-item-actions"><button className="primary-button" disabled={busy || !(reminderText[x.id] || '').trim()} onClick={() => action(`/authority/complaints/${x.id}/remind`, 'POST', {message:reminderText[x.id]})}>Send reminder</button></div></article>)}
    </section>}

    {section === 'audit' && <>
      <section className="panel authority-subpanel"><h3>Archive or delete a complaint</h3><p className="muted small-note">Record a reason for every archive or permanent deletion.</p>{activeComplaints.length === 0 ? <p className="muted">No active complaints.</p> : activeComplaints.map(x => <article className="authority-item" key={x.id}><div><strong>#{x.id} · {x.title}</strong><p>{x.category} · {statusLabel(x.status)}</p><input aria-label={`Archive reason for complaint ${x.id}`} placeholder="Reason (required)" value={archiveReason[x.id] || ''} onChange={e => setArchiveReason({...archiveReason, [x.id]:e.target.value})}/></div><div className="authority-item-actions"><button className="secondary-button" disabled={busy || !(archiveReason[x.id] || '').trim()} onClick={() => action(`/authority/complaints/${x.id}/archive`, 'POST', {reason: archiveReason[x.id]})}>Archive</button><button className="danger-button" disabled={busy || !(archiveReason[x.id] || '').trim()} onClick={() => { if (window.confirm(`Permanently delete complaint #${x.id}? This cannot be undone.`)) action(`/authority/complaints/${x.id}`, 'DELETE', {reason: archiveReason[x.id]}) }}>Delete</button></div></article>)}</section>
      <section className="panel authority-subpanel"><h3>Archived complaints</h3>{archived.length === 0 ? <p className="muted">No archived complaints.</p> : archived.map(x => <article className="authority-item" key={x.id}><div><strong>#{x.id} · {x.title}</strong><p>{x.category} · {statusLabel(x.status)}</p><p>Reason: {x.archived_reason || 'Not recorded'}</p><small>Updated {formatDate(x.updated_at)}</small></div></article>)}</section>
      <section className="panel authority-subpanel"><h3>Recent audit trail</h3>{audit.length === 0 ? <p className="muted">No audit entries yet.</p> : <div className="audit-list">{audit.slice(0, 50).map(x => <div key={x.id}><strong>{x.action.replaceAll('_',' ')}</strong><span>{x.entity_type} #{x.entity_id ?? '—'} · user #{x.actor_user_id ?? 'system'}</span><small>{formatDate(x.created_at)}</small>{x.details && <p>{x.details}</p>}</div>)}</div>}</section>
      {escalations.length > 0 && <section className="panel authority-subpanel"><h3>Overdue / escalation queue</h3>{escalations.map(x => <p key={x.id}>Complaint #{x.id} — {x.title} — due {formatDate(x.due_at)}</p>)}</section>}
    </>}

    {mapOpen && <LocationPicker title="Choose department location" description="Tap the map or drag the pin to the department office/service location." initialLatitude={departmentForm.latitude} initialLongitude={departmentForm.longitude} onClose={() => setMapOpen(false)} onChoose={(point) => { setDepartmentForm(current => ({ ...current, latitude: String(point.latitude), longitude: String(point.longitude) })); setLocationMessage('Map location selected.'); setMapOpen(false) }} />}
  </section>
}
