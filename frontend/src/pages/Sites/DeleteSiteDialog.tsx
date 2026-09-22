/**
 * Delete a site.
 *
 * The site leaves Sites and every list people pick a site from, but nothing
 * made at it is removed - its inspections, service jobs, invoices and
 * attendance stay as history. Typing the site's name is the one step between
 * a click and that, because a whole hospital is not something to lose to a
 * slip of the mouse.
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography,
} from '@mui/material'
import { toast } from 'react-toastify'
import { deleteFacility, type Facility } from '@/api/facilities'
import { useFacilityStore } from '@/hooks/useActiveFacility'
import { palette } from '@/theme/palette'

const tidy = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()

export default function DeleteSiteDialog({ site, onClose, onDeleted }: {
  site: Facility
  onClose: () => void
  onDeleted: () => void
}) {
  const queryClient = useQueryClient()
  const activeId = useFacilityStore((s) => s.facilityId)
  const setFacilityId = useFacilityStore((s) => s.setFacilityId)
  const [typed, setTyped] = useState('')
  const ready = tidy(typed) === tidy(site.name)

  const remove = useMutation({
    mutationFn: () => deleteFacility(site.id),
    onSuccess: () => {
      toast.success(`${site.name} deleted`)
      if (activeId === site.id) setFacilityId(null)
      queryClient.invalidateQueries({ queryKey: ['facilities'] })
      queryClient.invalidateQueries({ queryKey: ['inspection-dashboard'] })
      onDeleted()
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Could not delete the site'),
  })

  return (
    <Dialog open onClose={remove.isPending ? undefined : onClose} fullWidth
            PaperProps={{ sx: { borderRadius: '18px', maxWidth: 460 } }}>
      <DialogTitle sx={{ fontWeight: 900, color: palette.ink, pb: 0.5 }}>
        Delete {site.name}?
      </DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: 14, color: palette.textMuted, fontWeight: 600 }}>
          It will be removed from Sites, and nobody will be able to open it.
        </Typography>
        <Typography sx={{ mt: 1, fontSize: 14, color: palette.textMuted, fontWeight: 600 }}>
          Its inspections, service jobs and other records are kept.
        </Typography>
        <Typography sx={{ mt: 2.5, mb: 1, fontSize: 13.5, color: palette.ink, fontWeight: 700 }}>
          Type <b>{site.name}</b> to confirm
        </Typography>
        <TextField
          autoFocus fullWidth size="small" placeholder={site.name}
          inputProps={{ 'aria-label': 'Type the site name to confirm' }}
          value={typed} onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && ready && !remove.isPending) remove.mutate() }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={remove.isPending} sx={{ fontWeight: 800, color: palette.textMuted }}>
          Cancel
        </Button>
        <Button
          variant="contained" color="error" disabled={!ready || remove.isPending}
          onClick={() => remove.mutate()}
          // Red, not the brand green every contained button gets from the theme.
          sx={{ fontWeight: 900, borderRadius: '10px', background: '#DC2626', boxShadow: 'none',
                '&:hover': { background: '#B91C1C', boxShadow: '0 10px 22px rgba(185,28,28,0.22)' },
                '&.Mui-disabled': { background: '#FECACA', color: '#fff' } }}
        >
          {remove.isPending ? 'Deleting…' : 'Delete site'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
