import { useCallback, useEffect, useState } from 'react'
import { api, formatDate } from './utils'

export default function DepartmentDashboardPanel({ token, section = 'dashboard' }) {
  const [department, setDepartment] = useState(null)
  const [reminders, setReminders] = useState([])
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      const results = await Promise.all([api('/departments/mine', { token }), api('/departments/reminders', { token })])
      setDepartment(results[0]); setReminders(results[1])
    } catch (err) { setError(err.message || 'Could not load department information.') }
  }, [token])
  useEffect(() => { load() }, [load])
  return <div className="department-dashboard-tools">
    {error && <p className="error banner" role="alert">{error}</p>}
    {section !== 'reminders' && department && <section className="panel department-profile-panel"><p className="eyebrow">YOUR DEPARTMENT</p><h2>{department.name}</h2><div className="info-grid"><div className="info-item"><span>Category</span><strong>{department.category || department.description || 'Not set'}</strong></div><div className="info-item"><span>Contact</span><strong>{department.phone || 'Not set'}</strong></div><div className="info-item"><span>Email</span><strong>{department.email || 'Not set'}</strong></div><div className="info-item"><span>Address</span><strong>{department.address || 'Not set'}</strong></div></div></section>}
    {section === 'reminders' && <section className="panel department-reminders-panel"><div className="authority-panel-heading"><h2>Authority reminders</h2><button className="secondary-button" onClick={load}>Refresh</button></div>{reminders.length === 0 ? <p className="muted">No reminders from the authority.</p> : reminders.map(x => <article className="authority-item" key={x.id}><div><strong>Complaint #{x.complaint_id}: {x.title}</strong><p>{x.message}</p><small>{formatDate(x.created_at)}</small></div></article>)}</section>}
  </div>
}
