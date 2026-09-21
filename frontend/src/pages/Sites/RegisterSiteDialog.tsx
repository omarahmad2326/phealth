/**
 * Register a hospital.
 *
 * "Add a site" used to navigate away to the facilities module — a five-tab
 * administrative form covering billing terms, tiers, inheritance rules and
 * document uploads. None of that is what you want when you are trying to
 * create Hospital A.
 *
 * This asks for the eight fields the API actually requires plus the two worth
 * having on day one, and then takes you straight into the hospital you just
 * made, because that is what you were going to do next. Billing terms, tiers
 * and documents stay on the detailed form, reachable from the site itself
 * once there is a site to attach them to.
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider,
  MenuItem, TextField, Typography,
} from '@mui/material'
import { toast } from 'react-toastify'
import { createFacility } from '@/api/facilities'
import { palette } from '@/theme/palette'

// The zones a US hospital group actually spans. Anything else can be set on
// the detailed form rather than making this a dropdown of four hundred.
const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix',
  'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu',
]

export default function RegisterSiteDialog({ open, onClose, onCreated }: {
  open: boolean
  onClose: () => void
  onCreated: (id: number) => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    name: '', address: '', suite: '', city: '', state: '', zip_code: '',
    country: 'Pakistan', phone: '', email: '', contact_person: '',
    timezone: 'America/New_York',
  })

  const set = (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm({ ...form, [key]: e.target.value })

  const create = useMutation({
    mutationFn: () => createFacility({
      ...form,
      suite: form.suite || null,
      contact_person: form.contact_person || null,
      status: 'active',
    } as any),
    onSuccess: (created) => {
      toast.success(`${created.name} registered`)
      queryClient.invalidateQueries({ queryKey: ['facilities'] })
      onCreated(created.id)
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.detail?.[0]?.msg
        || e?.response?.data?.detail
        || 'Could not register the site'),
  })

  const required = ['name', 'address', 'city', 'state', 'zip_code', 'country',
                    'phone', 'email'] as const
  const ready = required.every((k) => String(form[k]).trim().length > 0)

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth
            PaperProps={{ sx: { borderRadius: '18px' } }}>
      <DialogTitle sx={{ fontWeight: 900, color: palette.ink, pb: 0.5 }}>
        Register a Site
      </DialogTitle>
      <DialogContent dividers>
        <Typography sx={{ mb: 2, fontSize: 12.5, color: palette.textMuted, fontWeight: 600 }}>
          Everything else — buildings, rooms, fixtures, assets and work orders —
          hangs off the site you create here.
        </Typography>

        <Box sx={{ display: 'grid', gap: 1.75 }}>
          <TextField
            autoFocus size="small" label="Site Name" required
            value={form.name} onChange={set('name')}
            placeholder="Services Hospital, Lahore"
          />

          <Divider textAlign="left">
            <Typography sx={{ fontSize: 11, fontWeight: 900, letterSpacing: 0.4,
                              textTransform: 'uppercase', color: palette.textSubtle }}>
              Where it is
            </Typography>
          </Divider>

          <TextField size="small" label="Street address" required
                     value={form.address} onChange={set('address')} />
          <Box sx={{ display: 'grid', gap: 1.75,
                     gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr' } }}>
            <TextField size="small" label="Suite or building (optional)"
                       value={form.suite} onChange={set('suite')} />
            <TextField size="small" label="City" required
                       value={form.city} onChange={set('city')} />
          </Box>
          <Box sx={{ display: 'grid', gap: 1.75,
                     gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)' } }}>
            <TextField size="small" label="State" required
                       value={form.state} onChange={set('state')} placeholder="Punjab" />
            <TextField size="small" label="ZIP" required
                       value={form.zip_code} onChange={set('zip_code')} />
            <TextField size="small" label="Country" required
                       value={form.country} onChange={set('country')} />
          </Box>

          <Divider textAlign="left">
            <Typography sx={{ fontSize: 11, fontWeight: 900, letterSpacing: 0.4,
                              textTransform: 'uppercase', color: palette.textSubtle }}>
              Who to reach
            </Typography>
          </Divider>

          <Box sx={{ display: 'grid', gap: 1.75,
                     gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
            <TextField size="small" label="Main phone" required
                       value={form.phone} onChange={set('phone')}
                       placeholder="042 1234567" />
            <TextField size="small" label="Facilities email" required type="email"
                       value={form.email} onChange={set('email')} />
            <TextField size="small" label="Contact person (optional)"
                       value={form.contact_person} onChange={set('contact_person')} />
            <TextField select size="small" label="Time zone"
                       value={form.timezone} onChange={set('timezone')}
                       helperText="Compliance due dates are counted in it">
              {TIMEZONES.map((tz) => (
                <MenuItem key={tz} value={tz}>{tz.replace('_', ' ')}</MenuItem>
              ))}
            </TextField>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} sx={{ fontWeight: 800, color: palette.textMuted }}>
          Cancel
        </Button>
        <Button
          variant="contained" disabled={!ready || create.isPending}
          onClick={() => create.mutate()}
          sx={{ fontWeight: 900, borderRadius: '10px', bgcolor: palette.brand,
                '&:hover': { bgcolor: palette.brandDeep } }}
        >
          {create.isPending ? 'Registering…' : 'Register and open'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
