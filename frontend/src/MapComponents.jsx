import { useEffect, useRef, useState } from 'react'

export function CivicMap({ complaints, onSelect, markerMode = 'status' }) {
  const hostRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef(null)

  useEffect(() => {
    const L = window.L
    if (!L || !hostRef.current || mapRef.current) return
    const map = L.map(hostRef.current, { scrollWheelZoom: false, zoomControl: true })
      .setView([13.2257, 77.5750], 11)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)
    markersRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    const timer = window.setTimeout(() => map.invalidateSize(), 80)
    return () => {
      window.clearTimeout(timer)
      map.remove()
      mapRef.current = null
      markersRef.current = null
    }
  }, [])

  useEffect(() => {
    const L = window.L
    const map = mapRef.current
    const layer = markersRef.current
    if (!L) return
    if (!map || !layer) return
    layer.clearLayers()
    const points = complaints.filter((c) =>
      c.latitude !== null && c.latitude !== undefined && c.longitude !== null && c.longitude !== undefined &&
      Number.isFinite(Number(c.latitude)) && Number.isFinite(Number(c.longitude))
    )
    points.forEach((complaint) => {
      const status = (complaint.status || 'submitted').toLowerCase()
      const color = complaint.assigned_to_me ? 'dark-blue' : status === 'resolved' ? 'green' :
        status === 'in_progress' ? 'orange' : 'red'
      const markerIcon = L.divIcon({
        className: 'civic-marker-wrap',
        html: `<span class="civic-marker civic-marker-${color}"></span>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      })
      const marker = L.marker([Number(complaint.latitude), Number(complaint.longitude)], { icon: markerIcon })
      const popup = document.createElement('div')
      popup.className = 'map-popup'
      const title = document.createElement('strong')
      title.textContent = complaint.title || `Complaint #${complaint.id}`
      const meta = document.createElement('p')
      meta.textContent = `${complaint.category || 'Other'} · ${status.replaceAll('_', ' ')}`
      const support = document.createElement('small')
      support.textContent = `${complaint.support_count || 0} community supports`
      popup.append(title, meta, support)
      marker.bindPopup(popup).addTo(layer)
      marker.on('click', () => onSelect?.(complaint))
    })
    if (points.length === 1) {
      map.setView([Number(points[0].latitude), Number(points[0].longitude)], 15)
    } else if (points.length > 1) {
      const bounds = L.latLngBounds(points.map((p) => [Number(p.latitude), Number(p.longitude)]))
      map.fitBounds(bounds.pad(0.15), { maxZoom: 15 })
    }
  }, [complaints, onSelect, markerMode])

  return <div className="civic-map" ref={hostRef} aria-label="Map of civic complaints" />
}

export function LocationPicker({ initialLatitude, initialLongitude, onChoose, onClose, title = 'Choose issue location', description = 'Tap the map or drag the pin to the exact spot.' }) {
  const mapHost = useRef(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)
  const chosenRef = useRef(null)
  const [chosen, setChosen] = useState(() => {
    const hasInitialPoint = initialLatitude !== '' && initialLatitude != null && initialLongitude !== '' && initialLongitude != null
    return { latitude: hasInitialPoint ? Number(initialLatitude) : 12.9716, longitude: hasInitialPoint ? Number(initialLongitude) : 77.5946 }
  })

  useEffect(() => {
    if (!mapHost.current || !window.L) return undefined
    const L = window.L
    const start = [chosen.latitude, chosen.longitude]
    const map = L.map(mapHost.current).setView(start, initialLatitude !== '' && initialLongitude !== '' ? 15 : 12)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)
    const marker = L.marker(start, { draggable: true }).addTo(map)
    mapRef.current = map
    markerRef.current = marker
    const update = (latlng) => {
      const next = { latitude: Number(latlng.lat.toFixed(6)), longitude: Number(latlng.lng.toFixed(6)) }
      chosenRef.current = next
      setChosen(next)
      marker.setLatLng(latlng)
    }
    map.on('click', (event) => update(event.latlng))
    marker.on('dragend', (event) => update(event.target.getLatLng()))
    chosenRef.current = { latitude: start[0], longitude: start[1] }
    const resize = () => map.invalidateSize()
    window.setTimeout(resize, 100)
    return () => { map.remove(); mapRef.current = null; markerRef.current = null }
  }, [])

  return (
    <div className="location-picker-overlay" role="dialog" aria-modal="true" aria-label="Choose complaint location">
      <section className="location-picker-dialog">
        <div className="location-picker-heading"><div><h2>{title}</h2><p className="muted small-note">{description}</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close location picker">×</button></div>
        <div ref={mapHost} className="location-picker-map" />
        <p className="muted small-note">Selected: {Number(chosen.latitude).toFixed(6)}, {Number(chosen.longitude).toFixed(6)}</p>
        <div className="location-picker-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="button" className="primary-button" onClick={() => onChoose(chosenRef.current || chosen)}>Use this location</button></div>
      </section>
    </div>
  )
}

