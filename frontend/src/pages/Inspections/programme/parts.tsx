/**
 * The small pieces every inspection screen uses: a chip for a due date, a chip
 * for a result, a frequency picker, and the plain reading of a built form.
 *
 * Kept together so a due date looks the same on a department, a vehicle and a
 * visit — people read these at a glance and a different colour per screen is
 * how a glance starts costing thought.
 */
import { Box, Chip, MenuItem, Stack, TextField, Typography } from '@mui/material'
import {
  DUE_STYLE, FREQUENCY_LABELS, RESULT_STYLE, shortDate,
  type DueState, type Frequency, type Result,
} from '@/api/inspectionProgramme'
import { palette } from '@/theme/palette'

export function DueChip({ state, on }: { state: DueState; on?: string | null }) {
  const style = DUE_STYLE[state]
  return (
    <Chip
      size="small"
      label={state === 'not_scheduled' ? style.label : `${style.label} · ${shortDate(on)}`}
      sx={{ height: 22, fontSize: 11, fontWeight: 800, color: style.color, bgcolor: style.bg }}
    />
  )
}

export function ResultChip({ result }: { result?: Result | null }) {
  if (!result) return <Typography sx={{ fontSize: 12.5, color: palette.textFaint, fontWeight: 700 }}>Not yet</Typography>
  const style = RESULT_STYLE[result]
  return (
    <Chip size="small" label={style.label}
          sx={{ height: 22, fontSize: 11, fontWeight: 900, color: style.color, bgcolor: style.bg }} />
  )
}

/** A count with a word under it, as the dashboard and site page show them. */
export function CountTile({ label, value, tone, onClick }: {
  label: string; value: number; tone?: { color: string; bg: string }; onClick?: () => void
}) {
  return (
    <Box
      onClick={onClick}
      sx={{
        p: 1.4, borderRadius: '14px', minWidth: 96, flex: '1 1 96px',
        bgcolor: tone?.bg ?? palette.surfaceMuted, cursor: onClick ? 'pointer' : 'default',
        border: `1px solid ${tone ? 'transparent' : palette.borderSoft}`,
      }}
    >
      <Typography sx={{ fontSize: 22, fontWeight: 900, lineHeight: 1.1, color: tone?.color ?? palette.ink }}>
        {value}
      </Typography>
      <Typography sx={{ fontSize: 11.5, fontWeight: 800, color: tone?.color ?? palette.textMuted }}>
        {label}
      </Typography>
    </Box>
  )
}

/** How often, and — when it is custom — how many days. */
export function FrequencyFields({ frequency, intervalDays, onChange, label = 'Inspect every' }: {
  frequency: Frequency | ''
  intervalDays: string
  onChange: (next: { frequency: Frequency | ''; intervalDays: string }) => void
  label?: string
}) {
  return (
    <Stack direction="row" spacing={1.2}>
      <TextField
        select fullWidth size="small" label={label} value={frequency}
        onChange={(e) => onChange({ frequency: e.target.value as Frequency | '', intervalDays })}
        InputLabelProps={{ shrink: true }} SelectProps={{ displayEmpty: true }}
      >
        <MenuItem value="">Not scheduled</MenuItem>
        {(Object.keys(FREQUENCY_LABELS) as Frequency[]).map((value) => (
          <MenuItem key={value} value={value}>{FREQUENCY_LABELS[value]}</MenuItem>
        ))}
      </TextField>
      {frequency === 'custom' && (
        <TextField
          size="small" label="Days" type="number" value={intervalDays} sx={{ width: 110 }}
          onChange={(e) => onChange({ frequency, intervalDays: e.target.value })}
          InputLabelProps={{ shrink: true }} inputProps={{ min: 1, max: 3650 }}
        />
      )}
    </Stack>
  )
}

export interface BuiltField {
  key: string
  label: string
  kind: 'choice' | 'text' | 'number'
}

/**
 * The questions inside a built form.
 *
 * Forms are drawn on a canvas, so their JSON is a layout rather than a list of
 * questions. Walking it for anything with a label is what lets an inspector
 * fill a form that somebody designed after this screen was written.
 */
export function builtFields(schema: unknown, limit = 60): BuiltField[] {
  const found: BuiltField[] = []
  const seen = new Set<string>()

  const walk = (node: unknown, path: string) => {
    if (found.length >= limit || node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, `${path}.${index}`))
      return
    }
    const record = node as Record<string, unknown>
    const label = typeof record.label === 'string' ? record.label.trim() : ''
    const type = typeof record.type === 'string' ? record.type : ''
    if (label && type && type !== 'label' && type !== 'heading' && type !== 'spacer') {
      const key = `${label}`
      if (!seen.has(key)) {
        seen.add(key)
        found.push({
          key,
          label,
          kind: ['radio', 'checkbox', 'select', 'toggle'].includes(type) ? 'choice'
            : type === 'number' ? 'number' : 'text',
        })
      }
    }
    Object.entries(record).forEach(([name, child]) => walk(child, `${path}.${name}`))
  }

  walk(schema, 'form')
  return found
}
