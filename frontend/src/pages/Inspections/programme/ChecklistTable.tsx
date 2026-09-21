/**
 * A checklist form as the table it is on paper: indicator, requirement, and
 * Yes / No / N/A for each.
 *
 * On a wide screen it is the table - the indicator spans its requirements,
 * exactly as printed, so an inspector working from the paper finds each line
 * where they expect it. On a phone the same rows stack under their indicator,
 * because a four-column table does not fit in one hand.
 */
import { Box, Chip, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, ToggleButton,
  ToggleButtonGroup, Typography, useMediaQuery } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { palette } from '@/theme/palette'
import {
  checklistSummary, evaluateChecklist,
  type ChecklistAnswer, type ChecklistRequirement, type ChecklistSchema,
} from './checklist'

const CHOICES: Array<{ value: ChecklistAnswer; label: string; color: string; bg: string }> = [
  { value: 'yes', label: 'Yes', color: '#15803D', bg: '#DCFCE7' },
  { value: 'no', label: 'No', color: '#B91C1C', bg: '#FEE2E2' },
  { value: 'na', label: 'N/A', color: '#475569', bg: '#E2E8F0' },
]

export default function ChecklistTable({ schema, answers, onChange, readOnly }: {
  schema: ChecklistSchema
  answers: Record<string, string | undefined>
  onChange: (code: string, value: ChecklistAnswer) => void
  readOnly?: boolean
}) {
  const theme = useTheme()
  const wide = useMediaQuery(theme.breakpoints.up('md'))
  const result = evaluateChecklist(schema, answers)
  const tone = result.canPass
    ? { color: '#15803D', bg: '#F0FDF4' }
    : result.notMet.length ? { color: '#B91C1C', bg: '#FEF2F2' } : { color: '#92400E', bg: '#FFFBEB' }

  const choice = (row: ChecklistRequirement) => (
    <ToggleButtonGroup
      exclusive size="small" value={answers[row.code] ?? null} disabled={readOnly}
      onChange={(_, value: ChecklistAnswer | null) => value && onChange(row.code, value)}
      aria-label={`Requirement ${row.code}`}
      sx={{ '& .MuiToggleButton-root': { px: 1.2, py: 0.35, fontWeight: 900, fontSize: 12, textTransform: 'none',
                                         minWidth: 44 } }}
    >
      {CHOICES.map((option) => (
        <ToggleButton
          key={option.value} value={option.value} aria-label={`${row.code} ${option.label}`}
          sx={{ '&.Mui-selected, &.Mui-selected:hover': { color: option.color, bgcolor: option.bg } }}
        >
          {option.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )

  // "2.1 ... OR 2.2 ..." on the paper: show the OR where it was printed.
  const orBefore = (rows: ChecklistRequirement[], index: number) =>
    index > 0 && Boolean(rows[index].alternative) && rows[index].alternative === rows[index - 1].alternative

  return (
    <Box>
      <Box sx={{ p: 1.2, mb: 1.2, borderRadius: '12px', bgcolor: tone.bg, display: 'flex', flexWrap: 'wrap',
                 gap: 1, alignItems: 'center' }}>
        <Typography sx={{ flex: 1, minWidth: 200, fontSize: 13, fontWeight: 900, color: tone.color }}>
          {checklistSummary(result)}
        </Typography>
        <Stack direction="row" spacing={0.6}>
          <Chip size="small" label={`${result.met} met`}
                sx={{ height: 22, fontSize: 11, fontWeight: 900, color: '#15803D', bgcolor: '#DCFCE7' }} />
          <Chip size="small" label={`${result.notMet.length} not met`}
                sx={{ height: 22, fontSize: 11, fontWeight: 900, color: '#B91C1C', bgcolor: '#FEE2E2' }} />
          <Chip size="small" label={`${result.notApplicable} N/A`}
                sx={{ height: 22, fontSize: 11, fontWeight: 900, color: '#475569', bgcolor: '#E2E8F0' }} />
        </Stack>
      </Box>

      {wide ? (
        <TableContainer sx={{ border: `1px solid ${palette.borderSoft}`, borderRadius: '12px' }}>
          <Table size="small" sx={{ '& td, & th': { borderColor: palette.borderSoft } }}>
            <TableHead>
              <TableRow sx={{ bgcolor: palette.surfaceMuted }}>
                <TableCell sx={{ fontWeight: 900, fontSize: 12, width: '30%' }}>Indicator No. &amp; Details</TableCell>
                <TableCell sx={{ fontWeight: 900, fontSize: 12 }}>Compliance Requirements</TableCell>
                <TableCell sx={{ fontWeight: 900, fontSize: 12, width: 170, textAlign: 'center' }}>Compliance</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {schema.checklist.sections.map((section) => section.requirements.map((row, index) => (
                <TableRow key={row.code} sx={{ verticalAlign: 'top' }}>
                  {index === 0 && (
                    <TableCell rowSpan={section.requirements.length}
                               sx={{ bgcolor: '#FAFBFC', fontSize: 12.5, color: palette.textStrong }}>
                      <Typography sx={{ fontSize: 12, fontWeight: 900, color: palette.ink }}>{section.code}</Typography>
                      <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: palette.textMuted }}>
                        {section.title}
                      </Typography>
                    </TableCell>
                  )}
                  <TableCell sx={{ fontSize: 13, color: palette.textStrong }}>
                    {orBefore(section.requirements, index) && (
                      <Typography sx={{ fontSize: 11, fontWeight: 900, color: palette.textFaint, mb: 0.3 }}>OR</Typography>
                    )}
                    <Box component="span" sx={{ fontWeight: 900, mr: 0.8 }}>{row.code}</Box>
                    {row.text}
                  </TableCell>
                  <TableCell sx={{ textAlign: 'center' }}>{choice(row)}</TableCell>
                </TableRow>
              )))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <Stack spacing={1.2}>
          {schema.checklist.sections.map((section) => (
            <Box key={section.code} sx={{ border: `1px solid ${palette.borderSoft}`, borderRadius: '12px',
                                          overflow: 'hidden' }}>
              <Box sx={{ px: 1.4, py: 1, bgcolor: palette.surfaceMuted }}>
                <Typography sx={{ fontSize: 12, fontWeight: 900, color: palette.ink }}>{section.code}</Typography>
                <Typography sx={{ fontSize: 12, fontWeight: 600, color: palette.textMuted }}>{section.title}</Typography>
              </Box>
              {section.requirements.map((row, index) => (
                <Box key={row.code} sx={{ px: 1.4, py: 1.1, borderTop: `1px solid ${palette.borderSoft}` }}>
                  {orBefore(section.requirements, index) && (
                    <Typography sx={{ fontSize: 11, fontWeight: 900, color: palette.textFaint, mb: 0.4 }}>OR</Typography>
                  )}
                  <Typography sx={{ fontSize: 13, color: palette.textStrong, mb: 0.8 }}>
                    <Box component="span" sx={{ fontWeight: 900, mr: 0.8 }}>{row.code}</Box>{row.text}
                  </Typography>
                  {choice(row)}
                </Box>
              ))}
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  )
}
