/**
 * Red tags at this site: what is not up to standard, and what was done about it.
 *
 * This is the screen an authority would be shown, so nothing is hidden: a
 * cleared tag keeps its row, with who cleared it, when, and what they said
 * they did.
 */
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Box, Chip, CircularProgress, Stack, Typography, Button } from '@mui/material'
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined'
import { fetchRedTags } from '@/api/inspectionProgramme'
import { hasPermission } from '@/config/permissions'
import { useActiveFacility } from '@/hooks/useActiveFacility'
import { useAuthStore } from '@/stores/authStore'
import { palette } from '@/theme/palette'
import { ClearRedTagDialog } from '@/pages/Departments/DepartmentDetail'

const when = (value?: string | null) =>
  value ? new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

export default function RedTagsPage() {
  const user = useAuthStore((s) => s.user)
  const queryClient = useQueryClient()
  const { facilityId, facility } = useActiveFacility()
  const [showCleared, setShowCleared] = useState(false)
  const [clearing, setClearing] = useState<number | null>(null)
  const canClear = hasPermission(user, 'inspections', 'edit')

  const list = useQuery({
    queryKey: ['red-tags', facilityId, showCleared],
    queryFn: () => fetchRedTags(facilityId as number, showCleared),
    enabled: !!facilityId,
    placeholderData: (previous) => previous,
  })
  const tags = list.data?.items ?? []
  const standing = tags.filter((tag) => !tag.cleared_at).length

  return (
    <Box className="page-enter" sx={{ width: '100%', minWidth: 0 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }}
             sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 1.5, mb: 2.5 }}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
          <Box sx={{ width: 48, height: 48, borderRadius: '15px', display: 'grid', placeItems: 'center',
                     color: palette.danger, bgcolor: '#FEE2E2', '& svg': { fontSize: 26 } }}>
            <ReportProblemOutlinedIcon />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 900, letterSpacing: 0.5, textTransform: 'uppercase',
                              color: palette.textSubtle }}>
              Inspections
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 900, color: palette.ink, lineHeight: 1.15 }}>Red tags</Typography>
            <Typography sx={{ color: palette.textMuted, fontWeight: 700 }}>
              {facility?.name ?? 'This site'} · {standing} standing
            </Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={0.8}>
          {([false, true] as const).map((value) => (
            <Chip
              key={String(value)} label={value ? 'Including cleared' : 'Standing'}
              onClick={() => setShowCleared(value)}
              sx={{ fontWeight: 900, fontSize: 12,
                    bgcolor: showCleared === value ? palette.brand : palette.white,
                    color: showCleared === value ? '#fff' : palette.textStrong,
                    border: `1px solid ${showCleared === value ? palette.brand : palette.borderSoft}` }}
            />
          ))}
        </Stack>
      </Stack>

      <Box sx={{ border: `1px solid ${palette.borderSoft}`, borderRadius: '18px', bgcolor: palette.white,
                 overflow: 'hidden' }}>
        {list.isLoading && <Box sx={{ p: 4, display: 'grid', placeItems: 'center' }}><CircularProgress size={22} /></Box>}
        {!list.isLoading && !tags.length && (
          <Typography sx={{ p: 4, textAlign: 'center', fontWeight: 700, color: palette.textMuted }}>
            {showCleared ? 'No red tags have ever been raised here.' : 'Nothing is red-tagged. '}
          </Typography>
        )}
        {tags.map((tag) => (
          <Box key={tag.id}
               sx={{ px: 2, py: 1.6, borderTop: `1px solid ${palette.borderSoft}`,
                     bgcolor: tag.cleared_at ? palette.white : '#FEF2F2' }}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2} alignItems={{ md: 'center' }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={0.8} alignItems="center" sx={{ minWidth: 0 }}>
                  <Typography noWrap sx={{ fontWeight: 900, fontSize: 14.5,
                                           color: tag.cleared_at ? palette.ink : '#B91C1C' }}>
                    {tag.name}
                  </Typography>
                  <Chip size="small" label={tag.cleared_at ? 'Cleared' : 'Standing'}
                        sx={{ height: 20, fontSize: 10.5, fontWeight: 900,
                              color: tag.cleared_at ? '#15803D' : '#fff',
                              bgcolor: tag.cleared_at ? '#F0FDF4' : palette.danger }} />
                  {tag.kind === 'vehicle' && <Chip size="small" label="Fleet"
                        sx={{ height: 20, fontSize: 10.5, fontWeight: 800, bgcolor: palette.surfaceMuted,
                              color: palette.textMuted }} />}
                </Stack>
                <Typography sx={{ fontSize: 12.5, color: palette.textMuted, fontWeight: 700 }}>
                  {[tag.department, tag.reference, tag.where].filter(Boolean).join(' · ')}
                </Typography>
                <Typography sx={{ mt: 0.6, fontSize: 13.5, fontWeight: 700, color: palette.textStrong }}>
                  {tag.note}
                </Typography>
                <Typography sx={{ fontSize: 12, color: palette.textFaint, fontWeight: 700 }}>
                  Raised by {tag.raised_by ?? 'somebody'} · {when(tag.raised_at)}
                </Typography>
                {tag.cleared_at && (
                  <Typography sx={{ mt: 0.4, fontSize: 12.5, fontWeight: 700, color: '#15803D' }}>
                    Cleared by {tag.cleared_by ?? 'somebody'} · {when(tag.cleared_at)} — {tag.clear_note}
                  </Typography>
                )}
              </Box>
              {!tag.cleared_at && canClear && (
                <Button variant="outlined" onClick={() => setClearing(tag.id)}
                        sx={{ fontWeight: 900, borderRadius: '11px', color: '#B91C1C', borderColor: '#FCA5A5',
                              alignSelf: { xs: 'flex-start', md: 'center' } }}>
                  Clear
                </Button>
              )}
            </Stack>
          </Box>
        ))}
      </Box>

      {clearing !== null && (
        <ClearRedTagDialog
          tagId={clearing}
          onClose={() => setClearing(null)}
          onSaved={() => {
            setClearing(null)
            void queryClient.invalidateQueries({ queryKey: ['red-tags'] })
            void queryClient.invalidateQueries({ queryKey: ['inspection-dashboard'] })
            void queryClient.invalidateQueries({ queryKey: ['site-overview'] })
          }}
        />
      )}
    </Box>
  )
}
