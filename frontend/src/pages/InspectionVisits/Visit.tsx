/**
 * Filling in a visit: one item at a time, on whatever screen the inspector has.
 *
 * The list is the work queue and the panel is the form. It is built for a
 * phone held in one hand on a plant-room floor: big targets, one decision at
 * the end — Passed, Failed or Red tag — and a note that a red tag insists on.
 */
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogContent, DialogTitle, Divider,
  FormControlLabel, IconButton, MenuItem, Stack, TextField, Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import DoneAllIcon from '@mui/icons-material/DoneAll'
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined'
import {
  errorMessage, fetchVisit, finishVisit, recordVisitItem, shortDate,
  type Result, type Visit, type VisitItem,
} from '@/api/inspectionProgramme'
import { palette } from '@/theme/palette'
import { builtFields, ResultChip } from '@/pages/Inspections/programme/parts'

const RESULT_BUTTONS: Array<{ value: Result; label: string; color: string; bg: string }> = [
  { value: 'pass', label: 'Passed', color: '#15803D', bg: '#F0FDF4' },
  { value: 'fail', label: 'Failed', color: '#B45309', bg: '#FEF3C7' },
  { value: 'red_tag', label: 'Red tag', color: '#B91C1C', bg: '#FEE2E2' },
]

export default function VisitPage() {
  const { id } = useParams()
  const visitId = Number(id)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState<VisitItem | null>(null)
  const [problem, setProblem] = useState('')

  const visit = useQuery({
    queryKey: ['visit', visitId],
    queryFn: () => fetchVisit(visitId),
    enabled: Number.isFinite(visitId),
  })

  const refresh = (next?: Visit) => {
    if (next) queryClient.setQueryData(['visit', visitId], (prev: Visit | undefined) => prev ? { ...prev, ...next } : prev)
    void queryClient.invalidateQueries({ queryKey: ['visit', visitId] })
    void queryClient.invalidateQueries({ queryKey: ['visits'] })
    void queryClient.invalidateQueries({ queryKey: ['department-detail'] })
    void queryClient.invalidateQueries({ queryKey: ['inspection-dashboard'] })
    void queryClient.invalidateQueries({ queryKey: ['programme-departments'] })
    void queryClient.invalidateQueries({ queryKey: ['site-overview'] })
    void queryClient.invalidateQueries({ queryKey: ['fleet-vehicles'] })
  }

  const finish = useMutation({
    mutationFn: async () => finishVisit(visitId),
    onSuccess: () => refresh(),
    onError: (error) => setProblem(errorMessage(error, 'This visit could not be finished.')),
  })

  if (visit.isLoading) {
    return <Box sx={{ p: 6, display: 'grid', placeItems: 'center' }}><CircularProgress size={26} /></Box>
  }
  if (!visit.data) {
    return <Typography sx={{ p: 4, fontWeight: 800, color: palette.textMuted }}>That visit is not here.</Typography>
  }

  const data = visit.data
  const items = data.item_list ?? []
  const done = items.filter((item) => item.result).length
  const finished = data.status === 'completed' || data.status === 'closed'

  return (
    <Box className="page-enter" sx={{ width: '100%', minWidth: 0 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }}
             sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 1.5, mb: 2 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 900, letterSpacing: 0.5, textTransform: 'uppercase',
                            color: palette.textSubtle }}>
            Visit {data.number}
          </Typography>
          <Typography variant="h4" sx={{ fontWeight: 900, color: palette.ink, lineHeight: 1.15 }}>
            {data.department ?? (data.scope === 'fleet' ? 'Fleet' : 'Whole site')}
          </Typography>
          <Typography sx={{ color: palette.textMuted, fontWeight: 700 }}>
            {shortDate(data.scheduled_on)} · {data.inspector?.name ?? 'Nobody assigned'} · {done} of {items.length} done
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <ResultChip result={data.result} />
          {!finished && (
            <Button variant="contained" startIcon={<DoneAllIcon />} disabled={!done || finish.isPending}
                    onClick={() => finish.mutate()}
                    sx={{ fontWeight: 900, borderRadius: '12px', bgcolor: palette.brand,
                          '&:hover': { bgcolor: palette.brandDeep } }}>
              Finish visit
            </Button>
          )}
        </Stack>
      </Stack>

      {finished && (
        <Box sx={{ p: 1.4, mb: 2, borderRadius: '14px', bgcolor: palette.surfaceMuted }}>
          <Typography sx={{ fontSize: 13, fontWeight: 800, color: palette.textStrong }}>
            This visit is finished{data.notes ? ` — ${data.notes}` : ''}. Anything nobody reached stays due and turns
            up on the next visit.
          </Typography>
        </Box>
      )}
      {problem && (
        <Typography sx={{ mb: 1.5, fontSize: 13, fontWeight: 800, color: palette.danger }}>{problem}</Typography>
      )}

      <Box sx={{ border: `1px solid ${palette.borderSoft}`, borderRadius: '18px', bgcolor: palette.white,
                 overflow: 'hidden' }}>
        {items.map((item) => (
          <Stack
            key={item.id} direction="row" spacing={1} alignItems="center"
            onClick={() => { setProblem(''); setOpen(item) }}
            sx={{ px: 2, py: 1.5, borderTop: `1px solid ${palette.borderSoft}`, cursor: 'pointer',
                  '&:hover': { bgcolor: palette.brandTint } }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography noWrap sx={{ fontWeight: 900, fontSize: 14.5, color: palette.ink }}>{item.name}</Typography>
              <Typography noWrap sx={{ fontSize: 12.5, color: palette.textMuted, fontWeight: 700 }}>
                {[item.reference, item.where, item.department].filter(Boolean).join(' · ') || item.number}
              </Typography>
              {item.note && (
                <Typography noWrap sx={{ fontSize: 12, color: palette.textStrong, fontWeight: 600 }}>
                  {item.note}
                </Typography>
              )}
            </Box>
            {item.service && (
              <Chip size="small" label={`Service ${item.service.number}`}
                    sx={{ height: 22, fontSize: 11, fontWeight: 800, color: palette.brandDeep,
                          bgcolor: palette.brandTint }} />
            )}
            {item.result ? <ResultChip result={item.result} /> : (
              <Chip size="small" label="Fill in"
                    sx={{ height: 24, fontSize: 11.5, fontWeight: 900, color: palette.brandDeep,
                          bgcolor: palette.brandTint }} />
            )}
            <ChevronRightRoundedIcon sx={{ color: palette.textFaint }} />
          </Stack>
        ))}
      </Box>

      {open && (
        <ItemPanel
          visitId={visitId} item={open} readOnly={finished}
          onClose={() => setOpen(null)}
          onRecorded={(next) => { refresh(next.visit); setOpen(null) }}
          onProblem={(message) => setProblem(message)}
        />
      )}
    </Box>
  )
}

function ItemPanel({ visitId, item, readOnly, onClose, onRecorded, onProblem }: {
  visitId: number
  item: VisitItem
  readOnly: boolean
  onClose: () => void
  onRecorded: (next: { item: VisitItem; visit: Visit }) => void
  onProblem: (message: string) => void
}) {
  const fields = useMemo(
    () => item.forms.map((form) => ({ form, fields: builtFields(form.schema) })),
    [item.forms],
  )
  const [answers, setAnswers] = useState<Record<string, Record<string, string>>>(() => {
    const seeded: Record<string, Record<string, string>> = {}
    for (const entry of item.answers ?? []) {
      seeded[String(entry.form_id)] = (entry.answers ?? {}) as Record<string, string>
    }
    return seeded
  })
  const [note, setNote] = useState(item.note ?? '')
  const [result, setResult] = useState<Result | ''>(item.result ?? '')
  const [problem, setProblem] = useState('')
  // Service is work raised because something is at fault, so it is the
  // inspector's call: a fault they fixed on the spot should leave no job
  // behind for somebody else to close. A vehicle has no equipment record for
  // a job to hang on, so the tick is not offered there.
  const [raiseService, setRaiseService] = useState(false)

  const record = useMutation({
    mutationFn: async (chosen: Result) => recordVisitItem(visitId, item.id, {
      result: chosen,
      answers: item.forms.map((form) => ({
        form_id: form.form_id, name: form.name, answers: answers[String(form.form_id)] ?? {},
      })),
      note: note.trim() || null,
      raise_service: raiseService && chosen !== 'pass',
    }),
    onSuccess: onRecorded,
    onError: (error) => {
      const message = errorMessage(error, 'That could not be recorded.')
      setProblem(message)
      onProblem(message)
    },
  })

  const set = (formId: number, key: string, value: string) =>
    setAnswers((prev) => ({ ...prev, [String(formId)]: { ...(prev[String(formId)] ?? {}), [key]: value } }))

  return (
    <Dialog open onClose={onClose} fullWidth fullScreen={window.innerWidth < 600}
            PaperProps={{ sx: { borderRadius: { xs: 0, sm: '18px' }, maxWidth: 620 } }}>
      <DialogTitle sx={{ fontWeight: 900, pr: 6 }}>
        {item.name}
        <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: palette.textMuted }}>
          {[item.reference, item.where].filter(Boolean).join(' · ') || item.number}
        </Typography>
        <IconButton onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }} aria-label="Close">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          {fields.map(({ form, fields: questions }) => (
            <Box key={form.form_id}>
              <Typography sx={{ fontSize: 12, fontWeight: 900, letterSpacing: 0.4, textTransform: 'uppercase',
                                color: palette.textSubtle, mb: 0.8 }}>
                {form.name}
              </Typography>
              {!questions.length && (
                <Typography sx={{ fontSize: 12.5, color: palette.textMuted, fontWeight: 700 }}>
                  This form has no questions to fill in — record the result and a note.
                </Typography>
              )}
              <Stack spacing={1.2}>
                {questions.map((question) => (
                  question.kind === 'choice' ? (
                    <TextField
                      key={question.key} select size="small" label={question.label} disabled={readOnly}
                      value={answers[String(form.form_id)]?.[question.key] ?? ''}
                      onChange={(e) => set(form.form_id, question.key, e.target.value)}
                      InputLabelProps={{ shrink: true }} SelectProps={{ displayEmpty: true }}
                    >
                      <MenuItem value="">Not checked</MenuItem>
                      <MenuItem value="Pass">Pass</MenuItem>
                      <MenuItem value="Fail">Fail</MenuItem>
                      <MenuItem value="N/A">N/A</MenuItem>
                    </TextField>
                  ) : (
                    <TextField
                      key={question.key} size="small" label={question.label} disabled={readOnly}
                      type={question.kind === 'number' ? 'number' : 'text'}
                      value={answers[String(form.form_id)]?.[question.key] ?? ''}
                      onChange={(e) => set(form.form_id, question.key, e.target.value)}
                      InputLabelProps={{ shrink: true }}
                    />
                  )
                ))}
              </Stack>
              <Divider sx={{ mt: 2 }} />
            </Box>
          ))}

          <TextField
            size="small" label="Notes" value={note} multiline minRows={2} disabled={readOnly}
            onChange={(e) => setNote(e.target.value)} InputLabelProps={{ shrink: true }}
            helperText="A red tag needs one: what is wrong, in your words."
          />

          {!readOnly && item.kind === 'equipment' && (
            <FormControlLabel
              control={<Checkbox size="small" checked={raiseService}
                                 onChange={(e) => setRaiseService(e.target.checked)} />}
              label={
                <Box>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: palette.ink }}>
                    Raise a service job for this
                  </Typography>
                  <Typography sx={{ fontSize: 12, fontWeight: 600, color: palette.textMuted }}>
                    Leave it off if you have already fixed it. Ticked, it raises one job titled from your
                    note, on Service, linked back to this inspection.
                  </Typography>
                </Box>
              }
              sx={{ alignItems: 'flex-start', m: 0 }}
            />
          )}
          {item.service && (
            <Stack direction="row" spacing={0.8} alignItems="center">
              <BuildOutlinedIcon sx={{ fontSize: 17, color: palette.brand }} />
              <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: palette.brandDeep }}>
                Service {item.service.number} is open for this
              </Typography>
            </Stack>
          )}

          {!readOnly && (
            <Stack direction="row" spacing={1}>
              {RESULT_BUTTONS.map((button) => (
                <Button
                  key={button.value}
                  onClick={() => { setResult(button.value); setProblem(''); record.mutate(button.value) }}
                  disabled={record.isPending}
                  sx={{
                    flex: 1, py: 1.2, fontWeight: 900, borderRadius: '12px',
                    color: button.color, bgcolor: button.bg,
                    border: `1.5px solid ${result === button.value ? button.color : 'transparent'}`,
                    '&:hover': { bgcolor: button.bg, filter: 'brightness(0.97)' },
                  }}
                >
                  {record.isPending && result === button.value
                    ? <CircularProgress size={16} sx={{ color: button.color }} />
                    : button.label}
                </Button>
              ))}
            </Stack>
          )}
          {readOnly && item.result && (
            <Stack direction="row" spacing={1} alignItems="center">
              <CheckCircleIcon sx={{ fontSize: 18, color: palette.brand }} />
              <Typography sx={{ fontSize: 13, fontWeight: 800, color: palette.textStrong }}>
                Recorded as {item.result_label}
              </Typography>
            </Stack>
          )}
          {problem && <Typography sx={{ fontSize: 12.5, color: palette.danger, fontWeight: 700 }}>{problem}</Typography>}
        </Stack>
      </DialogContent>
    </Dialog>
  )
}
