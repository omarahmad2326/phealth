import { type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { NumericField } from '../../components/NumericField'
import { AnimatedNumber } from '@/components/motion'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Autocomplete,
  Avatar, Box, Button, Card, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, FormControl, FormControlLabel, IconButton, InputLabel, Menu, MenuItem, Radio, RadioGroup,
  Select, Skeleton, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, Tabs,
  TextField, Tooltip, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn'
import BoltIcon from '@mui/icons-material/Bolt'
import BuildIcon from '@mui/icons-material/Build'
import CancelIcon from '@mui/icons-material/Cancel'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import DeleteIcon from '@mui/icons-material/Delete'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import EditIcon from '@mui/icons-material/Edit'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import KeyboardArrowLeftIcon from '@mui/icons-material/KeyboardArrowLeft'
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight'
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import PrintOutlinedIcon from '@mui/icons-material/PrintOutlined'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined'
import PersonIcon from '@mui/icons-material/Person'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import RemoveIcon from '@mui/icons-material/Remove'
import SaveIcon from '@mui/icons-material/Save'
import EventAvailableIcon from '@mui/icons-material/EventAvailable'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import AssessmentIcon from '@mui/icons-material/Assessment'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined'
import { toast } from 'react-toastify'
import { CanvasFormBuilder, CanvasFormViewer, type CanvasFormSchema, type CanvasFormValues } from './CanvasFormBuilder'

import {
  addInspectionBatchAsset,
  addInspectionBatchExistingAssets,
  closeInspection as closeScheduledInspection,
  createInspectionForm,
  createInstantInspection,
  fetchInspectionBatch,
  fetchInspectionBatches,
  fetchInspectionFacilityEquipment,
  fetchInspectionFacilities,
  fetchInspectionForms,
  fetchInspectionSummary,
  fetchInspections,
  generateInspectionBatchInvoice,
  generateInspectionInvoice,
  generateUpcomingInspections,
  removeInspectionBatchAsset,
  reopenInspection,
  scheduleInspections,
  saveInspectionReport,
  startInspection as startScheduledInspection,
  updateInspectionDetails,
  updateInspectionForm,
  updateInspectionTechnician,
  type BatchAssetCreatePayload,
  type Inspection,
  type InspectionBatch,
  type InspectionEquipmentItem,
  type InspectionInvoice,
  type InspectionFrequency,
  type InspectionFormOption,
  type InspectionDetailsUpdatePayload,
  deleteInspectionForm,
  archiveInspectionForm,
} from '@/api/inspections'
import { fetchInventoryParts, type InventoryPart } from '@/api/inventory'
import { fetchFacility, type Facility } from '@/api/facilities'
import {
  printInspectionFormSheet,
  printInspectionReportSheet,
  printInspectionBatchReport,
  buildInspectionSingleReportHtml,
  buildInspectionReportDocumentHtml,
  resolveReportInvoice,
} from '@/utils/inspectionReportHtml'
import { fetchModalities, type Modality } from '@/api/modalities'
import { fetchUsers, resolveUploadUrl, type UserData } from '@/api/users'
import { fetchActiveTestEquipment, type TestEquipment } from '@/api/testEquipment'
import { hasPermission } from '@/config/permissions'
import { useAuthStore } from '@/stores/authStore'
import ClippedTooltipText from '@/components/ClippedTooltipText'
import ContextTableRow from '@/components/ContextTableRow'
import SearchFieldSelect from '@/components/SearchFieldSelect'
import DebouncedSearchField from '@/components/DebouncedSearchField'
import SearchableSelect from '@/components/SearchableSelect'
import { useListContext } from '@/contexts/ListContext'
import { formatUSPhone } from '@/utils/formatters'
import { useActiveFacility } from '@/hooks/useActiveFacility'
import { palette } from '@/theme/palette'

const CHECK_FIELDS = [
  ['physical_inspection', 'Physical Inspection'],
  ['cleaning', 'Cleaning'],
  ['display', 'Display'],
  ['lubrication', 'Lubrication'],
  ['functional', 'Functional'],
  ['calibration', 'Calibration'],
  ['electrical_safety', 'Electrical Safety'],
  ['battery', 'Battery'],
  ['pm_kit', 'PM Kit'],
]

type ReportFormSource = 'default' | 'attached' | 'existing' | 'custom'
type FormBuilderMode = 'create' | 'edit' | 'report-custom'
type GridCellType = 'text' | 'input' | 'radio' | 'checkbox'
type GridCellBlockType = 'label' | 'input' | 'radio' | 'checkbox' | 'textarea'
type GridHorizontalAlign = 'left' | 'center' | 'right'
type GridVerticalAlign = 'top' | 'middle' | 'bottom'
type GridOptionLayout = 'vertical' | 'horizontal' | 'wrap'
type UpcomingDateRange = '1m' | '3m' | '6m' | '1y'

type InspectionDetailsDraft = {
  scheduledDate: string
  frequency: string
  complianceRequirement: string
  criticality: string
  inspectorId: number | ''
  formTemplateId: number | ''
}

type GridCellBlock = {
  id: string
  type: GridCellBlockType
  label: string
  options?: string[]
  inline?: boolean
  layout?: 'inline' | 'stacked'
  optionLayout?: GridOptionLayout
  width?: number
  height?: number
}

type GridCellSchema = {
  id: string
  label: string
  type: GridCellType
  options?: string[]
  blocks?: GridCellBlock[]
  rowSpan?: number
  colSpan?: number
  width?: number
  height?: number
  align?: GridHorizontalAlign
  verticalAlign?: GridVerticalAlign
  hidden?: boolean
}

type BuilderDragState =
  | { kind: 'block'; blockId: string }
  | { kind: 'option'; blockId: string; optionIndex: number }
  | { kind: 'cell-option'; row: number; col: number; optionIndex: number }
  | { kind: 'row'; rowIndex: number }
  | null

type CustomGridSchema = {
  title: string
  rows: number
  columns: number
  cells: GridCellSchema[][]
}

type FormioFormSchema = {
  display?: 'form' | 'wizard'
  components: any[]
  [key: string]: any
}

type InspectionFormSchema = {
  title: string
  version: number
  source?: string
  based_on?: string
  formio_form?: FormioFormSchema | null
  custom_grid: CustomGridSchema | null
  canvas_form?: CanvasFormSchema | null
}

const GRID_CELL_TYPES: { value: GridCellType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'input', label: 'Input Field' },
  { value: 'radio', label: 'Radio Button' },
  { value: 'checkbox', label: 'Checkbox' },
]

const DEFAULT_GRID_OPTIONS = ['Option']
const optionCellTypes: GridCellType[] = ['radio', 'checkbox']

const FORMIO_SCHEMA_SOURCE = 'formio_builder'

const createEmptyFormioForm = (title = 'Inspection Form'): FormioFormSchema => ({
  display: 'form',
  title,
  components: [],
})

const isFormioSchema = (schema: any) =>
  Boolean(schema?.formio_form?.components)
  || schema?.source === FORMIO_SCHEMA_SOURCE
  || (Array.isArray(schema?.components) && (schema?.display === 'form' || schema?.display === 'wizard' || schema?.type === 'form'))

const normalizeFormioDisplay = (display: any): 'form' | 'wizard' => display === 'wizard' ? 'wizard' : 'form'

const normalizeFormioForm = (schema: any, fallbackTitle = 'Inspection Form'): FormioFormSchema | null => {
  const form = schema?.formio_form?.components ? schema.formio_form : Array.isArray(schema?.components) ? schema : null
  if (!form) return null
  return {
    display: normalizeFormioDisplay(form.display),
    title: form.title || fallbackTitle,
    ...form,
    components: Array.isArray(form.components) ? form.components : [],
  }
}

const createGridCellBlock = (type: GridCellBlockType, index = 0): GridCellBlock => ({
  id: `block_${Date.now()}_${index}`,
  type,
  label: type === 'label' ? 'Label' : type === 'textarea' ? 'Comments' : '',
  options: type === 'checkbox' || type === 'radio' ? ['Option'] : undefined,
  inline: type === 'input',
  layout: type === 'input' ? 'inline' : 'stacked',
  optionLayout: type === 'checkbox' || type === 'radio' ? 'wrap' : undefined,
  width: type === 'label' ? 100 : 180,
  height: type === 'textarea' ? 90 : 40,
})

const UPCOMING_DATE_RANGES: { value: UpcomingDateRange; label: string; months?: number; years?: number }[] = [
  { value: '1m', label: '1 Month', months: 1 },
  { value: '3m', label: '3 Months', months: 3 },
  { value: '6m', label: '6 Months', months: 6 },
  { value: '1y', label: '1 Year', years: 1 },
]

const INSPECTION_SEARCH_FIELDS = [
  { value: 'all', label: 'All fields' },
  { value: 'inspection_number', label: 'Inspection #' },
  { value: 'batch', label: 'Batch #' },
  { value: 'facility', label: 'Facility' },
  { value: 'asset', label: 'Asset / equipment' },
  { value: 'serial', label: 'Serial #' },
  { value: 'technician', label: 'Technician' },
  { value: 'frequency', label: 'Frequency' },
  { value: 'criticality', label: 'Criticality' },
  { value: 'requirement', label: 'Requirement' },
  { value: 'status', label: 'Status / result' },
  { value: 'date', label: 'Scheduled / activity date' },
  { value: 'tier', label: 'Tier' },
  { value: 'modality', label: 'Modality' },
]

const INSPECTION_ASSET_SEARCH_FIELDS = [
  { value: 'all', label: 'All fields' },
  { value: 'asset_tag', label: 'Asset tag' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'serial', label: 'Serial #' },
  { value: 'modality', label: 'Modality' },
  { value: 'tier', label: 'Tier' },
  { value: 'status', label: 'Status' },
]

const INSPECTION_FORM_SEARCH_FIELDS = [
  { value: 'all', label: 'All fields' },
  { value: 'name', label: 'Form name' },
  { value: 'description', label: 'Description' },
  { value: 'modality', label: 'Modality' },
  { value: 'content', label: 'Form content' },
]

const CHECK_FIELD_LABELS = CHECK_FIELDS.reduce((acc, [key, label]) => ({ ...acc, [key]: label }), {} as Record<string, string>)

const labelFromKey = (key: string) => key
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase())

const slugifyKey = (value: string, fallback = 'field') => {
  const key = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return key || `${fallback}_${Date.now()}`
}

const createGridCell = (row: number, column: number): GridCellSchema => ({
  id: `cell_${row + 1}_${column + 1}`,
  label: '',
  type: 'text',
  rowSpan: 1,
  colSpan: 1,
  width: 180,
  height: 74,
  align: 'center',
  verticalAlign: 'middle',
})

const normalizeGridHorizontalAlign = (value: any): GridHorizontalAlign =>
  value === 'left' || value === 'right' || value === 'center' ? value : 'center'

const normalizeGridVerticalAlign = (value: any): GridVerticalAlign =>
  value === 'top' || value === 'bottom' || value === 'middle' ? value : 'middle'

const normalizeGridOptionLayout = (value: any): GridOptionLayout =>
  value === 'vertical' || value === 'horizontal' || value === 'wrap' ? value : 'wrap'

const gridAlignItems = (align?: GridHorizontalAlign) =>
  align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center'

const gridJustifyContent = (verticalAlign?: GridVerticalAlign) =>
  verticalAlign === 'top' ? 'flex-start' : verticalAlign === 'bottom' ? 'flex-end' : 'center'

const gridOptionContainerSx = (layout: GridOptionLayout | undefined, align?: GridHorizontalAlign): any => {
  const normalizedLayout = normalizeGridOptionLayout(layout)
  return normalizedLayout === 'vertical'
    ? {
        display: 'grid',
        gap: 0.75,
        justifyItems: gridAlignItems(align),
      }
    : {
        display: 'flex',
        gap: 1.25,
        flexWrap: normalizedLayout === 'wrap' ? 'wrap' : 'nowrap',
        justifyContent: gridAlignItems(align),
        alignItems: 'center',
      }
}

const normalizeGridCellBlock = (block: any, index: number): GridCellBlock => {
  const type: GridCellBlockType = ['label', 'input', 'radio', 'checkbox', 'textarea'].includes(block?.type) ? block.type : 'label'
  const options = Array.isArray(block?.options) && block.options.length
    ? block.options.map((option: any) => String(option))
    : type === 'checkbox' || type === 'radio' ? ['Option'] : undefined
  return {
    id: String(block?.id || `block_${index + 1}`),
    type,
    label: String(block?.label ?? ''),
    options,
    inline: block?.inline !== undefined ? Boolean(block.inline) : block?.layout ? block.layout === 'inline' : type === 'input',
    layout: block?.layout === 'inline' || block?.layout === 'stacked' ? block.layout : type === 'input' ? 'inline' : 'stacked',
    optionLayout: type === 'checkbox' || type === 'radio' ? normalizeGridOptionLayout(block?.optionLayout) : undefined,
    width: Math.max(60, Math.min(520, Number(block?.width || (type === 'label' ? 100 : 180)))),
    height: Math.max(28, Math.min(240, Number(block?.height || (type === 'textarea' ? 90 : 40)))),
  }
}

const gridCellBlockValueKey = (cell: GridCellSchema, block: GridCellBlock, optionIndex?: number) =>
  optionIndex === undefined ? `${cell.id}__${block.id}` : `${cell.id}__${block.id}__${optionIndex}`

const createEmptyGrid = (rows = 3, columns = 3, title = 'Set Title'): CustomGridSchema => ({
  title,
  rows,
  columns,
  cells: Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) => createGridCell(row, column)),
  ),
})

const normalizeGridCell = (cell: any, row: number, column: number): GridCellSchema => {
  const type: GridCellType = ['text', 'input', 'radio', 'checkbox'].includes(cell?.type) ? cell.type : 'input'
  const options = Array.isArray(cell?.options) && cell.options.length
    ? cell.options.map((option: any) => String(option)).filter(Boolean)
    : type === 'radio' ? DEFAULT_GRID_OPTIONS : []
  return {
    id: String(cell?.id || `cell_${row + 1}_${column + 1}`),
    label: String(cell?.label ?? cell?.value ?? ''),
    type,
    options: optionCellTypes.includes(type) && options.length ? options : undefined,
    blocks: Array.isArray(cell?.blocks) && cell.blocks.length
      ? cell.blocks.slice(0, 30).map((block: any, index: number) => normalizeGridCellBlock(block, index))
      : undefined,
    rowSpan: Math.max(1, Math.min(30, Number(cell?.rowSpan || 1))),
    colSpan: Math.max(1, Math.min(12, Number(cell?.colSpan || 1))),
    width: Math.max(90, Math.min(520, Number(cell?.width || 180))),
    height: Math.max(44, Math.min(460, Number(cell?.height || 74))),
    align: normalizeGridHorizontalAlign(cell?.align),
    verticalAlign: normalizeGridVerticalAlign(cell?.verticalAlign),
    hidden: Boolean(cell?.hidden),
  }
}

const normalizeGrid = (grid: any, fallbackTitle = 'Set Title'): CustomGridSchema | null => {
  if (!grid) return null
  if (Array.isArray(grid.cells) && grid.cells.length) {
    const cells = grid.cells
      .filter((row: any) => Array.isArray(row) && row.length)
      .slice(0, 30)
      .map((row: any[], rowIndex: number) => row.slice(0, 12).map((cell: any, columnIndex: number) => normalizeGridCell(cell, rowIndex, columnIndex)))
    if (cells.length) {
      return {
        title: String(grid.title || fallbackTitle),
        rows: cells.length,
        columns: Math.max(...cells.map((row: GridCellSchema[]) => row.length)),
        cells,
      }
    }
  }
  const rows = Math.max(1, Math.min(30, Number(grid.rows || 3)))
  const columns = Math.max(1, Math.min(12, Number(grid.columns || 3)))
  return {
    title: String(grid.title || fallbackTitle),
    rows,
    columns,
    cells: Array.from({ length: rows }, (_, row) =>
      Array.from({ length: columns }, (_, column) => normalizeGridCell(grid.cells?.[row]?.[column], row, column)),
    ),
  }
}

const gridFromLegacySections = (schema: any): CustomGridSchema | null => {
  const customSections = (schema?.sections || []).filter((section: any) =>
    !['identity', 'checks', 'diagnostics', 'measurements', 'photo_documentation', 'compliance', 'parts', 'test_equipment', 'billing', 'dates'].includes(section?.key),
  )
  if (!customSections.length) return null
  const fields = customSections.flatMap((section: any) => (section.fields || []).map((field: any) => ({
    label: typeof field === 'string' ? labelFromKey(field) : String(field?.label || field?.key || 'view'),
    type: typeof field === 'object' && ['text', 'radio', 'checkbox'].includes(field?.type) ? field.type : 'input',
    options: typeof field === 'object' && ['radio', 'checkbox'].includes(field?.type)
      ? (Array.isArray(field?.options) && field.options.length ? field.options.map((option: any) => String(option)) : DEFAULT_GRID_OPTIONS)
      : undefined,
  })))
  const rows = Math.max(1, Math.ceil(fields.length / 3))
  const grid = createEmptyGrid(rows, 3, customSections[0]?.label || 'Set Title')
  fields.forEach((field: any, index: number) => {
    const row = Math.floor(index / 3)
    const column = index % 3
    grid.cells[row][column] = { ...grid.cells[row][column], ...field }
  })
  return grid
}

const formioComponentKey = (label: string, fallback: string) => slugifyKey(label || fallback, fallback)

const formioFromGridCell = (cell: GridCellSchema, fallback: string): any[] => {
  if (cell.blocks?.length) {
    return cell.blocks.flatMap((block, blockIndex): any[] => {
      const label = block.label?.trim() || ''
      const key = formioComponentKey(label, `${fallback}_${blockIndex + 1}`)
      if (block.type === 'label') return label ? [{ type: 'htmlelement', tag: 'p', content: label }] : []
      if (block.type === 'textarea') return [{ type: 'textarea', key, label, input: true }]
      if (block.type === 'radio') return [{
        type: 'radio',
        key,
        label,
        input: true,
        values: (block.options?.length ? block.options : DEFAULT_GRID_OPTIONS).map(option => ({ label: option, value: slugifyKey(option, 'option') })),
      }]
      if (block.type === 'checkbox') return [{
        type: 'selectboxes',
        key,
        label,
        input: true,
        values: (block.options?.length ? block.options : DEFAULT_GRID_OPTIONS).map(option => ({ label: option, value: slugifyKey(option, 'option') })),
      }]
      return [{ type: 'textfield', key, label, input: true }]
    })
  }
  const label = cell.label?.trim() || ''
  const key = formioComponentKey(label, fallback)
  if (cell.type === 'text') return cell.label ? [{ type: 'htmlelement', tag: 'p', content: cell.label }] : []
  if (cell.type === 'radio') return [{
    type: 'radio',
    key,
    label,
    input: true,
    values: (cell.options?.length ? cell.options : DEFAULT_GRID_OPTIONS).map(option => ({ label: option, value: slugifyKey(option, 'option') })),
  }]
  if (cell.type === 'checkbox') return [{
    type: 'selectboxes',
    key,
    label,
    input: true,
    values: (cell.options?.length ? cell.options : DEFAULT_GRID_OPTIONS).map(option => ({ label: option, value: slugifyKey(option, 'option') })),
  }]
  return [{ type: 'textfield', key, label, input: true }]
}

const formioFromLegacySchema = (schema: InspectionFormSchema | null, title = 'Inspection Form'): FormioFormSchema => {
  if (schema?.formio_form) return schema.formio_form
  const components = schema?.custom_grid?.cells
    ? schema.custom_grid.cells.flatMap((row, rowIndex) => row.flatMap((cell, columnIndex) => formioFromGridCell(cell, `cell_${rowIndex + 1}_${columnIndex + 1}`)))
    : []
  return {
    ...createEmptyFormioForm(title),
    components,
  }
}

const normalizeInspectionFormSchema = (schema: any, fallbackTitle = 'Inspection Form'): InspectionFormSchema => ({
  title: String(schema?.title || fallbackTitle),
  version: Number(schema?.version || (isFormioSchema(schema) ? 4 : 3)),
  source: isFormioSchema(schema) ? FORMIO_SCHEMA_SOURCE : schema?.source,
  based_on: schema?.based_on,
  formio_form: normalizeFormioForm(schema, fallbackTitle),
  custom_grid: isFormioSchema(schema) ? null : normalizeGrid(schema?.custom_grid, schema?.custom_grid?.title) || gridFromLegacySections(schema),
  canvas_form: schema?.canvas_form && Array.isArray(schema.canvas_form.elements) ? schema.canvas_form : null,
})

const schemaToPayload = (schema: InspectionFormSchema, title: string): InspectionFormSchema => ({
  title,
  version: schema.formio_form ? 4 : schema.canvas_form ? 5 : 3,
  source: schema.formio_form ? FORMIO_SCHEMA_SOURCE : 'medrad_grid_form_builder',
  based_on: schema.based_on,
  formio_form: schema.formio_form ? { ...schema.formio_form, title } : null,
  custom_grid: schema.custom_grid ? normalizeGrid(schema.custom_grid, schema.custom_grid.title || 'Set Title') : null,
  canvas_form: schema.canvas_form ?? null,
})

const defaultGridCellValue = (cell: GridCellSchema, existing: any) => {
  if (cell.type === 'text') return ''
  if (cell.type === 'checkbox') {
    if (cell.options?.length) return Array.isArray(existing) ? existing : []
    if (existing !== undefined) return Array.isArray(existing) ? existing.length > 0 : Boolean(existing)
    return false
  }
  if (existing !== undefined) return existing
  return ''
}

const addGridCellBlockDefaults = (acc: Record<string, any>, cell: GridCellSchema, existing: Record<string, any>) => {
  ;(cell.blocks || []).forEach(block => {
    if (block.type === 'label') return
    if (block.type === 'checkbox') {
      const options = block.options?.length ? block.options : ['Option']
      options.forEach((_, optionIndex) => {
        const key = gridCellBlockValueKey(cell, block, optionIndex)
        acc[key] = existing[key] !== undefined ? Boolean(existing[key]) : false
      })
      return
    }
    if (block.type === 'radio') {
      const key = gridCellBlockValueKey(cell, block)
      acc[key] = existing[key] !== undefined ? existing[key] : ''
      return
    }
    const key = gridCellBlockValueKey(cell, block)
    acc[key] = existing[key] !== undefined ? existing[key] : ''
  })
}

const isCheckboxOptionChecked = (value: any, option: string) => Array.isArray(value)
  ? value.includes(option)
  : Boolean(value)

const toggleCheckboxOptionValue = (value: any, option: string, checked: boolean) => {
  const current = Array.isArray(value) ? value : []
  if (checked) return current.includes(option) ? current : [...current, option]
  return current.filter(item => item !== option)
}

const displayCustomGridCellValue = (cell: GridCellSchema, value: any) => {
  const label = cell.label?.trim()
  if (cell.type === 'text') return label || '-'
  if (cell.type === 'checkbox') {
    const checkedDisplay = Array.isArray(value)
      ? value.filter(Boolean).join(', ')
      : value ? 'Checked' : 'Unchecked'
    if (label && checkedDisplay) return `${label}: ${checkedDisplay}`
    return checkedDisplay || label || '-'
  }
  const display = value || ''
  if (label && display) return `${label}: ${display}`
  return display || label || '-'
}

const displayCustomGridCellBlocks = (cell: GridCellSchema, values: Record<string, any>) => {
  const displays = (cell.blocks || []).map(block => {
    const label = block.label?.trim()
    if (block.type === 'label') return label
    if (block.type === 'checkbox') {
      const checked = (block.options?.length ? block.options : ['Option'])
        .map((option, optionIndex) => values[gridCellBlockValueKey(cell, block, optionIndex)] ? (option.trim() || `Option ${optionIndex + 1}`) : '')
        .filter(Boolean)
      return label && checked.length ? `${label}: ${checked.join(', ')}` : checked.join(', ')
    }
    if (block.type === 'radio') {
      const value = values[gridCellBlockValueKey(cell, block)]
      return label && value ? `${label}: ${value}` : (value || label)
    }
    const value = values[gridCellBlockValueKey(cell, block)]
    return label && value ? `${label}: ${value}` : (value || label)
  }).filter(Boolean)
  return displays.length ? displays.join('\n') : displayCustomGridCellValue(cell, values[cell.id])
}

const shouldShowGridCellTitle = (cell: GridCellSchema) => {
  const title = cell.label?.trim()
  if (!title) return false
  if (!cell.blocks?.length) return true
  return !cell.blocks.some(block => block.label?.trim().toLowerCase() === title.toLowerCase())
}

const normalizedGridLabel = (value?: string) => value?.trim().toLowerCase() || ''

const builderGridCellBlockEntries = (cell: GridCellSchema) => {
  const seenLabels = new Set<string>()
  return (cell.blocks || [])
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => {
      if (block.type !== 'label') return true
      const label = normalizedGridLabel(block.label)
      if (!label) return true
      if (seenLabels.has(label)) return false
      seenLabels.add(label)
      return true
    })
}

const mergeSchemaDefaultsIntoReport = (currentReport: any, schema: InspectionFormSchema | null) => {
  if (schema?.formio_form) {
    return {
      ...currentReport,
      formio_form: schema.formio_form,
      formio_data: currentReport?.formio_data || {},
    }
  }
  if (!schema?.custom_grid) return currentReport
  const existing = currentReport?.custom_grid_values || {}
  const defaults = schema.custom_grid.cells.flat().reduce((acc, cell) => {
    if (cell.hidden) return acc
    if (cell.blocks?.length) {
      addGridCellBlockDefaults(acc, cell, existing)
      return acc
    }
    if (cell.type === 'text') return acc
    acc[cell.id] = defaultGridCellValue(cell, existing[cell.id])
    return acc
  }, {} as Record<string, any>)
  return {
    ...currentReport,
    custom_grid: schema.custom_grid,
    custom_grid_values: defaults,
  }
}

const statusChip = (value: string) => {
  const map: Record<string, { bg: string; color: string }> = {
    upcoming: { bg: '#E0E7FF', color: palette.brand },
    in_progress: { bg: palette.warningTint, color: palette.warning },
    completed: { bg: palette.brandSoft, color: palette.brand },
    closed: { bg: palette.surfaceMuted, color: palette.slate600 },
    pass: { bg: palette.brandSoft, color: palette.brand },
    fail: { bg: palette.dangerTint, color: palette.dangerStrong },
    pending: { bg: '#E0E7FF', color: palette.brand },
    paid: { bg: '#E0E7FF', color: palette.brand },
    overdue: { bg: palette.dangerTint, color: palette.dangerStrong },
  }
  return map[value] || { bg: palette.indigoTint, color: palette.indigo }
}

const money = (value: number | string | null | undefined) => `$${Number(value || 0).toFixed(2)}`

const flattenModalities = (items: Modality[]): Modality[] =>
  items.flatMap((item) => [item, ...flattenModalities(item.children || [])])

const formatDate = (date: string | null | undefined) => {
  if (!date) return '-'
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const toDateTimeLocalValue = (value: string | null | undefined) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

const inspectionDetailsDraft = (inspection: Inspection): InspectionDetailsDraft => ({
  scheduledDate: toDateTimeLocalValue(inspection.scheduled_date),
  frequency: inspection.inspection_frequency || 'annual',
  complianceRequirement: inspection.compliance_requirement || '',
  criticality: inspection.criticality || '',
  inspectorId: inspection.inspector_id || '',
  formTemplateId: inspection.form_template_id || '',
})

const toLocalDateParam = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const getUpcomingDateWindow = (range: UpcomingDateRange) => {
  const today = new Date()
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const to = new Date(from)
  const config = UPCOMING_DATE_RANGES.find(item => item.value === range) || UPCOMING_DATE_RANGES[0]
  if (config.years) {
    to.setFullYear(to.getFullYear() + config.years)
  } else {
    to.setMonth(to.getMonth() + (config.months || 1))
  }
  return {
    date_from: toLocalDateParam(from),
    date_to: toLocalDateParam(to),
  }
}

const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;')

// ─── Print CSS ───────────────────────────────────────────────────────────────

const REPORT_CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #eef2f7; color: #111827; font-family: Arial, sans-serif; }
  .sheet { width: 8.5in; min-height: 11in; margin: 24px auto; background: #fff; box-shadow: 0 20px 60px rgba(15,23,42,0.16); overflow: hidden; }
  .page-break { page-break-after: always; }
  .hero { display: flex; justify-content: space-between; gap: 24px; padding: 30px 38px; color: #fff; background: linear-gradient(135deg, #065F46 0%, #047857 58%, #0D9488 100%); }
  .brand { display: flex; gap: 16px; align-items: center; font-size: 22px; font-weight: 900; }
  .brand img { width: 116px; height: 76px; object-fit: contain; background: #fff; border-radius: 14px; padding: 8px; }
  .hero h1 { margin: 0; text-align: right; font-size: 30px; }
  .hero .sub { margin-top: 8px; color: rgba(255,255,255,0.84); text-align: right; font-weight: 700; }
  .content { padding: 34px 38px 38px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
  .grid2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 20px; }
  .box { border: 1px solid #E5E7EB; border-radius: 14px; padding: 14px; background: #F8FAFC; }
  .box small { display: block; color: #64748B; font-weight: 900; text-transform: uppercase; margin-bottom: 6px; }
  .box strong { color: #064E3B; }
  .section { border: 1px solid #E5E7EB; border-radius: 16px; padding: 18px; margin-top: 16px; page-break-inside: avoid; }
  h2 { margin: 0 0 12px; color: #064E3B; font-size: 18px; }
  h3 { margin: 18px 0 8px; color: #64748B; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }
  p { margin: 0; white-space: pre-wrap; line-height: 1.55; }
  table { width: 100%; border-collapse: separate; border-spacing: 0; border: 1px solid #E5E7EB; border-radius: 14px; overflow: hidden; margin-top: 10px; font-size: 12px; }
  th { text-align: left; background: #ECFDF5; color: #334155; padding: 10px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; }
  td { border-top: 1px solid #EEF2F7; padding: 10px; vertical-align: top; }
  tfoot td { font-weight: 900; }
  .right { text-align: right; }
  .amount { color: #047857; font-weight: 900; }
  .total-row td { background: #F0FDF4; color: #047857; font-size: 14px; }
  .bal-row td { background: #FEF2F2; color: #DC2626; }
  .status { display: inline-block; padding: 5px 9px; border-radius: 999px; background: #EEF2FF; color: #4F46E5; font-weight: 900; text-transform: capitalize; }
  .status.pass, .status.yes, .status.completed { background: #ECFDF5; color: #047857; }
  .status.fail, .status.no { background: #FEF2F2; color: #B91C1C; }
  .status.na, .status.n\\/a { background: #F1F5F9; color: #475569; }
  .status.paid { background: #ECFDF5; color: #047857; }
  .status.overdue, .status.cancelled { background: #FEF2F2; color: #B91C1C; }
  .summary { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 14px; }
  .pill { padding: 8px 12px; border-radius: 999px; background: #ECFDF5; color: #047857; font-weight: 900; }
  .footer { margin-top: 28px; padding-top: 14px; border-top: 1px solid #E5E7EB; color: #64748B; font-size: 11px; display: flex; justify-content: space-between; }
  @media print {
    body { background: #fff; }
    .sheet { margin: 0; width: 100%; min-height: 0; box-shadow: none; }
    .hero { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .total-row td, .bal-row td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`

const openPrintFrame = (title: string, body: string) => {
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  document.body.appendChild(frame)
  const doc = frame.contentWindow?.document
  if (!doc) return
  doc.open()
  doc.write(`<!doctype html><html><head><title>${escapeHtml(title)}</title><style>${REPORT_CSS}</style></head><body>${body}</body></html>`)
  doc.close()
  frame.onload = () => {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    window.setTimeout(() => frame.remove(), 800)
  }
}

const printInspectionReport = (inspection: Inspection) => {
  void printInspectionReportSheet(inspection)
}

const printBatchReport = (batch: InspectionBatch) => {
  if (!(batch.assets || []).length) { toast.info('No assets in this batch.'); return }
  void printInspectionBatchReport(batch)
}

const buildInvoiceSheetHtml = (invoice: InspectionInvoice, pageBreak = false): string => {
  const travel = Number(invoice.travel_charges || 0)
  const service = Number(invoice.service_charges || 0)
  return `
    <main class="sheet${pageBreak ? ' page-break' : ''}">
      <section class="hero" style="background:linear-gradient(135deg,#064E3B 0%,#047857 55%,#0D9488 100%)">
        <div class="brand">
          <img src="/mr-biomed-logo.jpeg" alt="Mr. BioMed Tech Services" />
          <div>Mr. BioMed Tech Services<br><span style="font-size:12px;color:rgba(255,255,255,0.82)">Biomedical Equipment Repair &amp; Rental Services</span></div>
        </div>
        <div>
          <h1>Inspection Invoice</h1>
          <div class="sub">${escapeHtml(invoice.invoice_number)}</div>
          ${invoice.inspection_number ? `<div class="sub" style="font-size:12px">Inspection: ${escapeHtml(invoice.inspection_number)}</div>` : ''}
        </div>
      </section>
      <section class="content">
        <div class="grid2">
          <div class="box"><small>Bill To</small><strong>${escapeHtml(invoice.customer_name || '-')}</strong>${invoice.customer_email ? `<div style="color:#64748B;font-size:12px;margin-top:4px">${escapeHtml(invoice.customer_email)}</div>` : ''}${invoice.customer_phone ? `<div style="color:#64748B;font-size:12px">${escapeHtml(formatUSPhone(invoice.customer_phone))}</div>` : ''}${invoice.customer_address ? `<div style="color:#64748B;font-size:12px">${escapeHtml(invoice.customer_address)}</div>` : ''}</div>
          <div class="box"><small>Facility</small><strong>${escapeHtml(invoice.facility_name || '-')}</strong></div>
          <div class="box"><small>Issue Date</small><strong>${escapeHtml(formatDate(invoice.issue_date))}</strong></div>
          <div class="box"><small>Due Date</small><strong>${escapeHtml(formatDate(invoice.due_date))}</strong></div>
        </div>
        <table>
          <thead><tr><th>Description</th><th>Item</th><th class="right">Amount</th></tr></thead>
          <tbody>
            <tr>
              <td>Inspection Service${invoice.inspection_number ? ` — ${escapeHtml(invoice.inspection_number)}` : ''}</td>
              <td>${escapeHtml(invoice.inventory_part_name || (invoice as any).asset_name || (invoice as any).equipment_name || '-')}</td>
              <td class="right amount">${escapeHtml(money(invoice.subtotal))}</td>
            </tr>
            ${travel > 0 ? `<tr><td>Travel Charges</td><td>—</td><td class="right amount">${escapeHtml(money(travel))}</td></tr>` : ''}
            ${service > 0 ? `<tr><td>Service Charges</td><td>—</td><td class="right amount">${escapeHtml(money(service))}</td></tr>` : ''}
            ${Number(invoice.tax_amount || 0) > 0 ? `<tr><td>Tax</td><td>—</td><td class="right">${escapeHtml(money(invoice.tax_amount))}</td></tr>` : ''}
            ${Number(invoice.discount_amount || 0) > 0 ? `<tr><td>Discount</td><td>—</td><td class="right">-${escapeHtml(money(invoice.discount_amount))}</td></tr>` : ''}
          </tbody>
          <tfoot>
            <tr class="total-row"><td colspan="2" class="right">Total</td><td class="right">${escapeHtml(money(invoice.total_amount))}</td></tr>
            <tr><td colspan="2" class="right" style="color:#64748B">Amount Paid</td><td class="right" style="color:#2563EB;font-weight:900">${escapeHtml(money(invoice.amount_paid))}</td></tr>
            <tr class="bal-row"><td colspan="2" class="right">Balance Due</td><td class="right">${escapeHtml(money(invoice.balance_due))}</td></tr>
          </tfoot>
        </table>
        <div style="margin-top:20px;display:flex;gap:12px;align-items:center">
          <span class="status ${escapeHtml(invoice.status)}">${escapeHtml(invoice.status)}</span>
          ${invoice.notes ? `<span style="color:#64748B;font-size:13px">${escapeHtml(invoice.notes)}</span>` : ''}
        </div>
        <div class="footer">
          <span>Mr. BioMed Tech Services</span>
          <span>Generated from Medrad Admin Panel</span>
        </div>
      </section>
    </main>
  `
}

const printInspectionInvoice = (invoice: InspectionInvoice) => {
  openPrintFrame(`${invoice.invoice_number} Inspection Invoice`, buildInvoiceSheetHtml(invoice))
}

const printBatchInvoices = (batch: InspectionBatch) => {
  const invoices = (batch.assets || []).filter(a => a.invoice).map(a => a.invoice!)
  if (!invoices.length) { toast.info('No invoices in this batch yet.'); return }
  const body = invoices.map((inv, i) => buildInvoiceSheetHtml(inv, i < invoices.length - 1)).join('')
  openPrintFrame(`${batch.batch_number} Batch Invoices`, body)
}

const printBatchSummaryInvoice = (batch: InspectionBatch) => {
  const invoices = (batch.assets || []).filter(a => a.invoice).map(a => a.invoice!)
  if (!invoices.length) { toast.info('No invoices in this batch yet.'); return }
  const first = invoices[0]
  const esc = escapeHtml
  const fmt = money

  const subtotal = invoices.reduce((s, inv) => s + Number(inv.subtotal || 0), 0)
  const travel   = invoices.reduce((s, inv) => s + Number((inv as any).travel_charges || 0), 0)
  const service  = invoices.reduce((s, inv) => s + Number((inv as any).service_charges || 0), 0)
  const tax      = invoices.reduce((s, inv) => s + Number(inv.tax_amount || 0), 0)
  const discount = invoices.reduce((s, inv) => s + Number(inv.discount_amount || 0), 0)
  const total    = subtotal + travel + service + tax - discount
  const paid     = invoices.reduce((s, inv) => s + Number(inv.amount_paid || 0), 0)
  const balance  = total - paid

  const lineRows = invoices.map(inv => {
    const asset = inv.inventory_part_name || (inv as any).asset_name || (inv as any).equipment_name || '-'
    return `<tr>
      <td>${esc(inv.inspection_number || '-')}</td>
      <td>${esc(asset)}</td>
      <td class="right amount">${esc(fmt(inv.subtotal))}</td>
    </tr>`
  }).join('')

  const body = `
    <main class="sheet">
      <section class="hero">
        <div class="brand">
          <img src="/mr-biomed-logo.jpeg" alt="Mr. BioMed Tech Services" />
          <div>Mr. BioMed Tech Services<br><span style="font-size:12px;color:rgba(255,255,255,0.82)">Biomedical Equipment Repair &amp; Rental Services</span></div>
        </div>
        <div>
          <h1 style="margin:0;font-size:28px;text-align:right;">Batch Summary Invoice</h1>
          <div style="text-align:right;color:rgba(255,255,255,0.84);font-weight:700;margin-top:6px;">${esc(batch.batch_number)}</div>
        </div>
      </section>
      <section class="content">
        <div class="grid2">
          <div class="box"><small>Bill To</small><strong>${esc(first.customer_name || '-')}</strong>${first.customer_email ? `<div style="color:#64748B;font-size:12px;margin-top:4px">${esc(first.customer_email)}</div>` : ''}</div>
          <div class="box"><small>Facility</small><strong>${esc(first.facility_name || '-')}</strong></div>
          <div class="box"><small>Inspections</small><strong>${invoices.length} items</strong></div>
          <div class="box"><small>Issue Date</small><strong>${esc(formatDate(first.issue_date))}</strong></div>
        </div>
        <table>
          <thead><tr><th>Inspection #</th><th>Asset / Part</th><th class="right">Amount</th></tr></thead>
          <tbody>
            ${lineRows}
            ${travel > 0 ? `<tr><td colspan="2">Travel Charges</td><td class="right amount">${esc(fmt(travel))}</td></tr>` : ''}
            ${service > 0 ? `<tr><td colspan="2">Service Charges</td><td class="right amount">${esc(fmt(service))}</td></tr>` : ''}
            ${tax > 0 ? `<tr><td colspan="2">Tax</td><td class="right">${esc(fmt(tax))}</td></tr>` : ''}
            ${discount > 0 ? `<tr><td colspan="2">Discount</td><td class="right">-${esc(fmt(discount))}</td></tr>` : ''}
          </tbody>
          <tfoot>
            <tr class="total-row"><td colspan="2" class="right">Total</td><td class="right">${esc(fmt(total))}</td></tr>
            <tr><td colspan="2" class="right" style="color:#64748B">Amount Paid</td><td class="right" style="color:#2563EB;font-weight:900">${esc(fmt(paid))}</td></tr>
            <tr class="bal-row"><td colspan="2" class="right">Balance Due</td><td class="right">${esc(fmt(balance))}</td></tr>
          </tfoot>
        </table>
        <div class="footer">
          <span>Mr. BioMed Tech Services</span>
          <span>Generated from Medrad Admin Panel</span>
        </div>
      </section>
    </main>`
  openPrintFrame(`${batch.batch_number} Batch Summary Invoice`, body)
}

const makeReport = (inspection: Inspection) => ({
  identity: {
    asset_number: inspection.asset_tag || inspection.part_number || '',
    description: inspection.equipment_name || inspection.inventory_part_name || '',
    make: inspection.make || '',
    model: inspection.model || '',
    serial_number: inspection.serial_number || '',
    location: '',
    risk_ranking: '',
    pm_schedule: 'Annual',
  },
  checks: CHECK_FIELDS.reduce((acc, [key]) => ({ ...acc, [key]: 'pass' }), {} as Record<string, string>),
  diagnostics: {
    reported_problem: 'N/A',
    problem_found: 'N/A',
    corrective_action_taken: '',
    summary: '',
  },
  measurements: [
    { name: 'Electrical leakage', set_value: '', read_value: '', unit: 'mA/Ohms', status: 'pass', notes: '' },
    { name: 'Functional test', set_value: '', read_value: '', unit: '', status: 'pass', notes: '' },
  ],
  photo_documentation: [{ label: 'Equipment condition', url: '', notes: '' }],
  compliance: {
    certified: 'yes',
    standard: inspection.compliance_requirement || 'Preventive maintenance and safety inspection',
    certificate_notes: '',
    recommendations: '',
  },
  parts: [{ description: '', part_number: '', price: 0, condition: '' }],
  test_equipment: [
    { description: 'Safety Analyzer', make: '', serial_number: '' },
    { description: 'MultiMeter', make: '', serial_number: '' },
  ],
  billing: { parts: 0, inspection_charges: 0, others: 0 },
  dates: {
    inspected_by: inspection.inspector_name || '',
    inspection_date: new Date().toISOString().slice(0, 10),
    inspection_due_date: new Date().toISOString().slice(0, 10),
    next_inspection_due_date: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().slice(0, 10),
  },
})

const emptyBatchAssetForm = (): BatchAssetCreatePayload => ({
  asset_tag: '',
  make: '',
  model: '',
  serial_number: '',
  modality_id: 0,
  tier_id: null,
  inspection_form_id: null,
  description: '',
  risk_priority: '',
  risk_name: 'Non-Critical',
  location: '',
  pm_scheduling: 'annual',
  last_pm_date: null,
  installation_date: null,
  inventory_date: new Date().toISOString().slice(0, 10),
})

const Inspections = () => {
  const pageSize = 10
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { focusRecord: publishRecentActivity } = useListContext()
  const focusRecord = (
    key: string | number,
    label: string,
    options: Parameters<typeof publishRecentActivity>[2] = {},
  ) => publishRecentActivity(key, label, {
    ...options,
    pathname: '/inspections',
    query: { context_search: label, ...options.query },
  })
  const publishInspectionInvoiceActivity = (invoice: InspectionInvoice, message: string) => {
    publishRecentActivity(`billing-inspection-${invoice.id}`, invoice.invoice_number, {
      message,
      announce: true,
      pathname: '/billing',
      query: {
        search: invoice.invoice_number,
        search_field: 'billing_number',
      },
    })
  }
  const currentUser = useAuthStore((state) => state.user)
  const canAddInspections = hasPermission(currentUser, 'inspections', 'add')
  const canEditInspections = hasPermission(currentUser, 'inspections', 'edit')
  const canDeleteInspections = hasPermission(currentUser, 'inspections', 'delete')
  const canInitiateInspections = canAddInspections && canEditInspections
  const requestedTab = Number(searchParams.get('tab') || 0)
  const queryTab = Number.isInteger(requestedTab) && requestedTab >= 0 && requestedTab <= 5 ? requestedTab : 0
  const activitySearch = searchParams.get('context_search') || ''
  const dateFrom = searchParams.get('date_from') || ''
  const dateTo = searchParams.get('date_to') || ''
  const invalidDateRange = Boolean(dateFrom && dateTo && dateFrom > dateTo)
  const [tab, setTab] = useState(queryTab)
  // Inspections kept its own facility state and asked on three screens.
  // Inside a site there is nothing to ask: it opens on the hospital you
  // are in, and the picker has only that one to offer.
  const { facilityId: activeFacilityId } = useActiveFacility()
  const [facilityId, setFacilityId] = useState<number | ''>('')
  const [selectedInstantEquipmentIds, setSelectedInstantEquipmentIds] = useState<number[]>([])
  const [selectedEquipmentIds, setSelectedEquipmentIds] = useState<number[]>([])
  const [frequency, setFrequency] = useState<InspectionFrequency>('instant')
  const [scheduleDate, setScheduleDate] = useState(new Date().toISOString().slice(0, 10))
  const [reportInspection, setReportInspection] = useState<Inspection | null>(null)
  const [viewReport, setViewReport] = useState<Inspection | null>(null)
  const [infoInspection, setInfoInspection] = useState<Inspection | null>(null)

  // On-screen report preview mirrors the printed document exactly (same builder + design).
  const viewReportFacilityQ = useQuery<Facility | null>({
    queryKey: ['facility', viewReport?.facility_id],
    queryFn: () => fetchFacility(viewReport!.facility_id),
    enabled: Boolean(viewReport?.facility_id),
  })
  const viewReportInvoiceQ = useQuery({
    queryKey: ['report-invoice', viewReport?.id, viewReport?.batch_id],
    queryFn: () => resolveReportInvoice(viewReport!),
    enabled: Boolean(viewReport),
  })
  const viewReportHtml = useMemo(
    () => (viewReport
      ? buildInspectionReportDocumentHtml(
          buildInspectionSingleReportHtml(viewReport, viewReportFacilityQ.data ?? null, viewReportInvoiceQ.data ?? viewReport.invoice),
          `${viewReport.inspection_number} Inspection Report`,
        )
      : ''),
    [viewReport, viewReportFacilityQ.data, viewReportInvoiceQ.data],
  )
  const [infoEditing, setInfoEditing] = useState(false)
  const [infoDraft, setInfoDraft] = useState<InspectionDetailsDraft | null>(null)
  const [upcomingActionAnchor, setUpcomingActionAnchor] = useState<HTMLElement | null>(null)
  const [upcomingActionItem, setUpcomingActionItem] = useState<Inspection | null>(null)
  const [rescheduleInspection, setRescheduleInspection] = useState<Inspection | null>(null)
  const [rescheduleDate, setRescheduleDate] = useState('')
  const [closeInspectionTarget, setCloseInspectionTarget] = useState<Inspection | null>(null)
  const [reopenInspectionTarget, setReopenInspectionTarget] = useState<Inspection | null>(null)
  const [closedActionAnchor, setClosedActionAnchor] = useState<HTMLElement | null>(null)
  const [closedActionItem, setClosedActionItem] = useState<Inspection | null>(null)
  const [closedSearchField, setClosedSearchField] = useState('all')
  const [closedFacilityId, setClosedFacilityId] = useState<number | ''>('')
  const [closedPage, setClosedPage] = useState(0)
  const [viewForm, setViewForm] = useState<InspectionFormOption | null>(null)
  // The form somebody is about to remove, and how. Deleting a form is not
  // undoable and archiving changes what everyone else can pick, so neither
  // happens straight off a menu click.
  const [removingForm, setRemovingForm] = useState<InspectionFormOption | null>(null)
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null)
  const [report, setReport] = useState<any>(null)
  const [partSearch, setPartSearch] = useState('')
  const [testEquipmentSearch, setTestEquipmentSearch] = useState('')
  const [debouncedPartSearch, setDebouncedPartSearch] = useState('')
  const [debouncedTestEquipmentSearch, setDebouncedTestEquipmentSearch] = useState('')
  const [reportStatus, setReportStatus] = useState<'completed' | 'in_progress'>('completed')
  const [reportFormSource, setReportFormSource] = useState<ReportFormSource>('default')
  const [selectedReportFormId, setSelectedReportFormId] = useState<number | null>(null)
  const [saveCustomForm, setSaveCustomForm] = useState(true)
  const [customFormName, setCustomFormName] = useState('')
  const [customFormDescription, setCustomFormDescription] = useState('')
  const [reportCustomSchema, setReportCustomSchema] = useState<InspectionFormSchema | null>(null)
  const [formBuilderOpen, setFormBuilderOpen] = useState(false)
  const [formBuilderMode, setFormBuilderMode] = useState<FormBuilderMode>('edit')
  const [formBuilderId, setFormBuilderId] = useState<number | null>(null)
  const [formBuilderName, setFormBuilderName] = useState('')
  const [formBuilderDescription, setFormBuilderDescription] = useState('')
  const [formBuilderModalityId, setFormBuilderModalityId] = useState<number | null>(null)
  const [formBuilderEngine, setFormBuilderEngine] = useState<'grid' | 'canvas'>('grid')
  const [canvasFormSchema, setCanvasFormSchema] = useState<CanvasFormSchema | null>(null)
  const [canvasFormValues, setCanvasFormValues] = useState<CanvasFormValues>({})
  const [formBuilderSchema, setFormBuilderSchema] = useState<InspectionFormSchema>(() => normalizeInspectionFormSchema({ sections: [] }))
  const [formBuilderFormioForm, setFormBuilderFormioForm] = useState<FormioFormSchema>(() => createEmptyFormioForm())
  const [formBuilderRows, setFormBuilderRows] = useState(3)
  const [formBuilderColumns, setFormBuilderColumns] = useState(3)
  const [tablePickerHover, setTablePickerHover] = useState<{ rows: number; columns: number } | null>(null)
  const [selectedBuilderCell, setSelectedBuilderCell] = useState<{ row: number; column: number } | null>(null)
  const [builderDrag, setBuilderDrag] = useState<BuilderDragState>(null)
  const builderDragRef = useRef<BuilderDragState>(null)
  const setBuilderDragState = (nextDrag: BuilderDragState) => {
    builderDragRef.current = nextDrag
    setBuilderDrag(nextDrag)
  }
  const [techEdit, setTechEdit] = useState<Inspection | null>(null)
  const [selectedTechId, setSelectedTechId] = useState<number | ''>('')
  const [addAssetOpen, setAddAssetOpen] = useState(false)
  const [addExistingAssetOpen, setAddExistingAssetOpen] = useState(false)
  const [batchAssetForm, setBatchAssetForm] = useState<BatchAssetCreatePayload>(emptyBatchAssetForm())
  const [existingAssetSearch, setExistingAssetSearch] = useState('')
  const [selectedExistingEquipmentIds, setSelectedExistingEquipmentIds] = useState<number[]>([])
  const [assetActionAnchor, setAssetActionAnchor] = useState<HTMLElement | null>(null)
  const [assetActionItem, setAssetActionItem] = useState<Inspection | null>(null)
  const [formActionAnchor, setFormActionAnchor] = useState<HTMLElement | null>(null)
  const [formActionItem, setFormActionItem] = useState<InspectionFormOption | null>(null)
  const [upcomingSearchField, setUpcomingSearchField] = useState('all')
  const [debouncedUpcomingSearch, setDebouncedUpcomingSearch] = useState('')
  const [debouncedClosedSearch, setDebouncedClosedSearch] = useState('')
  const [inProgressSearchField, setInProgressSearchField] = useState('all')
  const [debouncedInProgressSearch, setDebouncedInProgressSearch] = useState('')
  // Bump to force the self-contained search inputs to clear (they own their
  // keystroke state, so a query reset alone can't empty the visible text).
  const [searchResetSeed, setSearchResetSeed] = useState(0)
  const [completedSearchField, setCompletedSearchField] = useState('all')
  const [debouncedCompletedSearch, setDebouncedCompletedSearch] = useState('')
  const [scheduleAssetSearch, setScheduleAssetSearch] = useState('')
  const [scheduleAssetSearchField, setScheduleAssetSearchField] = useState('all')
  const [debouncedScheduleAssetSearch, setDebouncedScheduleAssetSearch] = useState('')
  const [instantAssetSearch, setInstantAssetSearch] = useState('')
  const [instantAssetSearchField, setInstantAssetSearchField] = useState('all')
  const [debouncedInstantAssetSearch, setDebouncedInstantAssetSearch] = useState('')
  const [formSearch, setFormSearch] = useState('')
  const [formSearchField, setFormSearchField] = useState('all')
  const [debouncedFormSearch, setDebouncedFormSearch] = useState('')
  const [upcomingRange, setUpcomingRange] = useState<UpcomingDateRange>('1m')
  const [upcomingPage, setUpcomingPage] = useState(0)
  const [inProgressBatchPage, setInProgressBatchPage] = useState(0)
  const [completedBatchPage, setCompletedBatchPage] = useState(0)
  const [legacyInProgressPage, setLegacyInProgressPage] = useState(0)
  const [legacyCompletedPage, setLegacyCompletedPage] = useState(0)

  const selectTab = (nextTab: number) => {
    setTab(nextTab)
    const next = new URLSearchParams(searchParams)
    next.delete('focus')
    next.delete('context_search')
    if (nextTab === 0) next.delete('tab')
    else next.set('tab', String(nextTab))
    setSearchParams(next, { replace: true })
  }

  useEffect(() => {
    setTab(queryTab)
    if (!activitySearch) return

    if (queryTab === 0) {
      setDebouncedUpcomingSearch(activitySearch)
      setUpcomingPage(0)
    } else if (queryTab === 2) {
      setDebouncedInProgressSearch(activitySearch)
      setInProgressBatchPage(0)
      setLegacyInProgressPage(0)
    } else if (queryTab === 3) {
      setDebouncedCompletedSearch(activitySearch)
      setCompletedBatchPage(0)
      setLegacyCompletedPage(0)
    } else if (queryTab === 5) {
      setDebouncedClosedSearch(activitySearch)
      setClosedPage(0)
    }
  }, [activitySearch, queryTab])

  const changeDateFilter = (key: 'date_from' | 'date_to', value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }

  const clearDateFilters = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('date_from')
    next.delete('date_to')
    setSearchParams(next, { replace: true })
  }

  const openFacilityFromInspection = (facilityName?: string | null) => {
    if (!facilityName || facilityName === '-') return
    navigate(`/facilities?search=${encodeURIComponent(facilityName)}`)
  }

  const openInspectionRecord = (inspection: Inspection, mode: 'progress' | 'completed') => {
    if (mode === 'completed') {
      setViewReport(inspection)
      return
    }
    if (canEditInspections) {
      setReportInspection(inspection)
    }
  }

  const openInspectionInfo = (inspection: Inspection) => {
    setInfoInspection(inspection)
    setInfoDraft(inspectionDetailsDraft(inspection))
    setInfoEditing(false)
  }

  const closeUpcomingActions = () => {
    setUpcomingActionAnchor(null)
    setUpcomingActionItem(null)
  }

  const openUpcomingActions = (event: MouseEvent<HTMLElement>, inspection: Inspection) => {
    setUpcomingActionAnchor(event.currentTarget)
    setUpcomingActionItem(inspection)
  }

  const closeClosedActions = () => {
    setClosedActionAnchor(null)
    setClosedActionItem(null)
  }

  const openClosedActions = (event: MouseEvent<HTMLElement>, inspection: Inspection) => {
    setClosedActionAnchor(event.currentTarget)
    setClosedActionItem(inspection)
  }

  useEffect(() => {
    if (!builderDrag) return undefined
    const stopDragging = () => {
      builderDragRef.current = null
      setBuilderDrag(null)
    }
    window.addEventListener('mouseup', stopDragging)
    window.addEventListener('blur', stopDragging)
    return () => {
      window.removeEventListener('mouseup', stopDragging)
      window.removeEventListener('blur', stopDragging)
    }
  }, [builderDrag])
  useEffect(() => {
    setUpcomingPage(0)
  }, [debouncedUpcomingSearch, upcomingSearchField, upcomingRange])

  useEffect(() => {
    setClosedPage(0)
  }, [debouncedClosedSearch, closedSearchField, closedFacilityId, dateFrom, dateTo])

  useEffect(() => {
    setTab(queryTab)
  }, [queryTab])

  useEffect(() => {
    setUpcomingPage(0)
    setInProgressBatchPage(0)
    setCompletedBatchPage(0)
    setLegacyInProgressPage(0)
    setLegacyCompletedPage(0)
  }, [dateFrom, dateTo])

  useEffect(() => {
    setInProgressBatchPage(0)
    setLegacyInProgressPage(0)
  }, [debouncedInProgressSearch, inProgressSearchField])

  useEffect(() => {
    setCompletedBatchPage(0)
    setLegacyCompletedPage(0)
  }, [debouncedCompletedSearch, completedSearchField])

  useEffect(() => {
    if (addExistingAssetOpen) return
    setExistingAssetSearch('')
    setSelectedExistingEquipmentIds([])
  }, [addExistingAssetOpen])

  useEffect(() => {
    if (reportInspection) return
    setPartSearch('')
    setTestEquipmentSearch('')
  }, [reportInspection])

  // Debouncing for these four searches now lives inside DebouncedSearchField,
  // so typing no longer re-renders this large page on every keystroke.

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedScheduleAssetSearch(scheduleAssetSearch.trim()), 300)
    return () => window.clearTimeout(timeout)
  }, [scheduleAssetSearch])

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedInstantAssetSearch(instantAssetSearch.trim()), 300)
    return () => window.clearTimeout(timeout)
  }, [instantAssetSearch])

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedFormSearch(formSearch.trim()), 300)
    return () => window.clearTimeout(timeout)
  }, [formSearch])

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedPartSearch(partSearch.trim()), 300)
    return () => window.clearTimeout(timeout)
  }, [partSearch])

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedTestEquipmentSearch(testEquipmentSearch.trim()), 300)
    return () => window.clearTimeout(timeout)
  }, [testEquipmentSearch])

  const summaryQ = useQuery({
    queryKey: ['inspection-summary', dateFrom, dateTo],
    queryFn: () => fetchInspectionSummary({ date_from: dateFrom || undefined, date_to: dateTo || undefined }),
    enabled: !invalidDateRange,
    staleTime: 30_000,
  })
  useEffect(() => {
    if (activeFacilityId && facilityId !== activeFacilityId) setFacilityId(activeFacilityId)
  }, [activeFacilityId])

  const facilitiesQ = useQuery({
    queryKey: ['inspection-facilities'],
    queryFn: fetchInspectionFacilities,
    enabled: tab === 0 || tab === 1 || tab === 5,
    staleTime: 5 * 60_000,
  })
  const activeFacilityAssetSearch = tab === 1
    ? debouncedInstantAssetSearch
    : debouncedScheduleAssetSearch
  const activeFacilityAssetSearchField = tab === 1
    ? instantAssetSearchField
    : scheduleAssetSearchField
  const equipmentQ = useQuery({
    queryKey: ['inspection-equipment', facilityId, activeFacilityAssetSearch, activeFacilityAssetSearchField],
    queryFn: () => fetchInspectionFacilityEquipment(
      Number(facilityId),
      activeFacilityAssetSearch || undefined,
      activeFacilityAssetSearchField === 'all' ? undefined : activeFacilityAssetSearchField,
    ),
    enabled: Boolean(facilityId),
    staleTime: 60_000,
  })
  const upcomingWindow = useMemo(() => getUpcomingDateWindow(upcomingRange), [upcomingRange])
  const effectiveUpcomingWindow = useMemo(() => (
    dateFrom || dateTo
      ? { date_from: dateFrom || undefined, date_to: dateTo || undefined }
      : upcomingWindow
  ), [dateFrom, dateTo, upcomingWindow])
  const upcomingQ = useQuery({
    queryKey: ['inspections', 'upcoming', upcomingPage, pageSize, debouncedUpcomingSearch, upcomingSearchField, upcomingRange, dateFrom, dateTo],
    queryFn: () => fetchInspections({
      status: 'upcoming',
      search: debouncedUpcomingSearch || undefined,
      search_field: upcomingSearchField === 'all' ? undefined : upcomingSearchField,
      date_from: effectiveUpcomingWindow.date_from,
      date_to: effectiveUpcomingWindow.date_to,
      skip: upcomingPage * pageSize,
      limit: pageSize,
    }),
    enabled: tab === 0 && !invalidDateRange,
    staleTime: 30_000,
    placeholderData: previousData => previousData,
    retry: 1,
  })
  const inProgressQ = useQuery({
    queryKey: ['inspections', 'in_progress', 'unbatched', legacyInProgressPage, pageSize, debouncedInProgressSearch, inProgressSearchField, dateFrom, dateTo],
    queryFn: () => fetchInspections({ status: 'in_progress', unbatched_only: true, search: debouncedInProgressSearch || undefined, search_field: inProgressSearchField === 'all' ? undefined : inProgressSearchField, date_from: dateFrom || undefined, date_to: dateTo || undefined, skip: legacyInProgressPage * pageSize, limit: pageSize }),
    enabled: tab === 2 && !invalidDateRange,
    staleTime: 30_000,
    placeholderData: previousData => previousData,
    retry: 1,
  })
  const inProgressBatchesQ = useQuery({
    queryKey: ['inspection-batches', 'in_progress', inProgressBatchPage, pageSize, debouncedInProgressSearch, inProgressSearchField, dateFrom, dateTo],
    queryFn: () => fetchInspectionBatches({ status: 'in_progress', search: debouncedInProgressSearch || undefined, search_field: inProgressSearchField === 'all' ? undefined : inProgressSearchField, date_from: dateFrom || undefined, date_to: dateTo || undefined, skip: inProgressBatchPage * pageSize, limit: pageSize }),
    enabled: tab === 2 && !invalidDateRange,
    staleTime: 30_000,
    placeholderData: previousData => previousData,
    retry: 1,
  })
  const completedBatchesQ = useQuery({
    queryKey: ['inspection-batches', 'completed', completedBatchPage, pageSize, debouncedCompletedSearch, completedSearchField, dateFrom, dateTo],
    queryFn: () => fetchInspectionBatches({ status: 'completed', search: debouncedCompletedSearch || undefined, search_field: completedSearchField === 'all' ? undefined : completedSearchField, date_from: dateFrom || undefined, date_to: dateTo || undefined, skip: completedBatchPage * pageSize, limit: pageSize }),
    enabled: tab === 3 && !invalidDateRange,
    staleTime: 30_000,
    placeholderData: previousData => previousData,
    retry: 1,
  })
  const batchDetailQ = useQuery({
    queryKey: ['inspection-batches', selectedBatchId],
    queryFn: () => fetchInspectionBatch(Number(selectedBatchId)),
    enabled: Boolean(selectedBatchId),
    staleTime: 30_000,
    retry: 1,
  })
  const batchEquipmentQ = useQuery({
    queryKey: ['inspection-equipment', 'batch-existing-options', batchDetailQ.data?.facility_id],
    queryFn: () => fetchInspectionFacilityEquipment(Number(batchDetailQ.data?.facility_id)),
    enabled: addExistingAssetOpen && Boolean(batchDetailQ.data?.facility_id),
    staleTime: 60_000,
  })
  const completedQ = useQuery({
    queryKey: ['inspections', 'completed', 'unbatched', legacyCompletedPage, pageSize, debouncedCompletedSearch, completedSearchField, dateFrom, dateTo],
    queryFn: () => fetchInspections({ status: 'completed', unbatched_only: true, search: debouncedCompletedSearch || undefined, search_field: completedSearchField === 'all' ? undefined : completedSearchField, date_from: dateFrom || undefined, date_to: dateTo || undefined, skip: legacyCompletedPage * pageSize, limit: pageSize }),
    enabled: tab === 3 && !invalidDateRange,
    staleTime: 30_000,
    placeholderData: previousData => previousData,
    retry: 1,
  })
  const closedQ = useQuery({
    queryKey: ['inspections', 'closed', closedPage, pageSize, debouncedClosedSearch, closedSearchField, closedFacilityId, dateFrom, dateTo],
    queryFn: () => fetchInspections({
      status: 'closed',
      facility_id: closedFacilityId ? Number(closedFacilityId) : undefined,
      search: debouncedClosedSearch || undefined,
      search_field: closedSearchField === 'all' ? undefined : closedSearchField,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      skip: closedPage * pageSize,
      limit: pageSize,
    }),
    enabled: tab === 5 && !invalidDateRange,
    staleTime: 30_000,
    placeholderData: previousData => previousData,
    retry: 1,
  })
  const formListSearch = tab === 4 && !reportInspection && !infoInspection
    ? debouncedFormSearch
    : ''
  const formsQ = useQuery({
    queryKey: ['inspection-forms', formListSearch, formSearchField],
    queryFn: () => fetchInspectionForms(undefined, formListSearch || undefined, formSearchField === 'all' ? undefined : formSearchField),
    enabled: tab === 4 || Boolean(reportInspection) || Boolean(infoInspection),
    staleTime: 5 * 60_000,
    placeholderData: previousData => previousData,
  })
  const modalitiesQ = useQuery({ queryKey: ['modalities'], queryFn: () => fetchModalities(), enabled: tab === 1 || addAssetOpen, staleTime: 5 * 60_000 })
  const usersQ = useQuery({ queryKey: ['users', 'inspection-technicians'], queryFn: () => fetchUsers({ is_active: true, limit: 500 }), enabled: tab === 2 || Boolean(selectedBatchId) || Boolean(infoInspection), staleTime: 60_000 })
  const testEquipmentQ = useQuery({
    queryKey: ['test-equipment', 'inspection-active-options', debouncedTestEquipmentSearch],
    queryFn: () => fetchActiveTestEquipment({ search: debouncedTestEquipmentSearch || undefined, limit: 50 }),
    enabled: Boolean(reportInspection),
    staleTime: 60_000,
    placeholderData: previousData => previousData,
  })
  const reportPartsQ = useQuery({
    queryKey: ['inventory-parts', 'inspection-report-options', debouncedPartSearch],
    queryFn: () => fetchInventoryParts({ search: debouncedPartSearch || undefined, limit: 50 }),
    enabled: Boolean(reportInspection),
    staleTime: 60_000,
    placeholderData: previousData => previousData,
  })

  // Narrowed rather than hidden: the three pickers stay where they are, with
  // nothing but the current site in them.
  const facilityOptions = (facilitiesQ.data || []).filter(
    f => !activeFacilityId || f.id === activeFacilityId,
  )
  const selectedFacility = facilityOptions.find(f => f.id === facilityId)
  const equipment = equipmentQ.data || []
  const inspectionForms = formsQ.data?.items || []
  const defaultReportForm = useMemo(
    () => inspectionForms.find((form) => form.name === 'Advanced Facility Inventory Inspection Report') || inspectionForms[0] || null,
    [inspectionForms],
  )
  const selectedReportTemplate = useMemo(() => {
    if (!selectedReportFormId) return null
    return inspectionForms.find(form => form.id === selectedReportFormId) || null
  }, [inspectionForms, selectedReportFormId])
  const activeReportSchema = useMemo(() => {
    if (reportFormSource === 'custom') return reportCustomSchema
    if (reportFormSource === 'attached') {
      return reportInspection?.attached_form_schema
        ? normalizeInspectionFormSchema(reportInspection.attached_form_schema, reportInspection.attached_form_name || 'Asset attached form')
        : null
    }
    if (reportFormSource === 'existing') {
      return selectedReportTemplate ? normalizeInspectionFormSchema(selectedReportTemplate.schema, selectedReportTemplate.name) : null
    }
    return defaultReportForm ? normalizeInspectionFormSchema(defaultReportForm.schema, defaultReportForm.name) : null
  }, [defaultReportForm, reportCustomSchema, reportFormSource, reportInspection?.attached_form_name, reportInspection?.attached_form_schema, selectedReportTemplate])
  const assignableModalities = useMemo(
    () => flattenModalities(modalitiesQ.data?.items || []),
    [modalitiesQ.data?.items],
  )

  const refreshInspectionQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['inspections'] })
    queryClient.invalidateQueries({ queryKey: ['inspection-batches'] })
    queryClient.invalidateQueries({ queryKey: ['inspection-summary'] })
  }

  const createMut = useMutation({
    mutationFn: createInstantInspection,
    onSuccess: (res) => {
      const batch = res.items?.[0]
      const assetCount = batch?.asset_count || 0
      toast.success(`${res.total} inspection batch started with ${assetCount} asset${assetCount === 1 ? '' : 's'}`)
      setSelectedInstantEquipmentIds([])
      setSearchResetSeed((seed) => seed + 1)
      setDebouncedInProgressSearch('')
      setInProgressBatchPage(0)
      queryClient.invalidateQueries({ queryKey: ['inspections'] })
      queryClient.invalidateQueries({ queryKey: ['inspection-batches'] })
      queryClient.invalidateQueries({ queryKey: ['inspection-summary'] })
      setTab(2)
      if (batch) {
        focusRecord(`inspection-batch-${batch.id}`, batch.batch_number, {
          message: 'Started as an instant inspection and moved to In Progress.',
          announce: true,
          query: { tab: 2, date_from: null, date_to: null },
        })
      } else {
        selectTab(2)
      }
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'Could not start inspection'),
  })

  const scheduleMut = useMutation({
    mutationFn: scheduleInspections,
    onSuccess: (res) => {
      const batch = res.items?.[0]
      const assetCount = batch?.asset_count || 0
      toast.success(`${res.total} inspection batch scheduled with ${assetCount} asset${assetCount === 1 ? '' : 's'}`)
      setSelectedEquipmentIds([])
      setSearchResetSeed((seed) => seed + 1)
      setDebouncedUpcomingSearch('')
      setUpcomingPage(0)
      queryClient.invalidateQueries({ queryKey: ['inspections'] })
      queryClient.invalidateQueries({ queryKey: ['inspection-batches'] })
      queryClient.invalidateQueries({ queryKey: ['inspection-summary'] })
      setTab(0)
      if (batch) {
        const firstInspection = batch.assets?.[0]
        focusRecord(
          firstInspection ? `inspection-${firstInspection.id}` : `inspection-batch-${batch.id}`,
          firstInspection?.inspection_number || batch.batch_number,
          {
          message: 'Scheduled and available under Upcoming inspections.',
          announce: true,
          query: { tab: 0 },
          },
        )
      } else {
        selectTab(0)
      }
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'Could not schedule inspections'),
  })

  const generateMut = useMutation({
    mutationFn: generateUpcomingInspections,
    onSuccess: (res) => {
      toast.success(`${res.total} upcoming inspection(s) generated`)
      queryClient.invalidateQueries({ queryKey: ['inspections'] })
      queryClient.invalidateQueries({ queryKey: ['inspection-batches'] })
      queryClient.invalidateQueries({ queryKey: ['inspection-summary'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'Could not generate schedule'),
  })

  const startMut = useMutation({
    mutationFn: startScheduledInspection,
    onSuccess: (inspection) => {
      toast.success('Inspection moved to in progress')
      queryClient.invalidateQueries({ queryKey: ['inspections'] })
      queryClient.invalidateQueries({ queryKey: ['inspection-batches'] })
      queryClient.invalidateQueries({ queryKey: ['inspection-summary'] })
      setTab(2)
      setSearchResetSeed((seed) => seed + 1)
      setDebouncedInProgressSearch('')
      setInProgressBatchPage(0)
      setLegacyInProgressPage(0)
      focusRecord(
        inspection.batch_id ? `inspection-batch-${inspection.batch_id}` : `inspection-${inspection.id}`,
        inspection.inspection_number,
        {
          message: 'Started and moved from Upcoming to In Progress.',
          announce: true,
          query: { tab: 2, date_from: null, date_to: null },
        },
      )
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'Could not start inspection'),
  })

  const rescheduleMut = useMutation({
    mutationFn: ({ id, scheduledDate, reopen }: { id: number; scheduledDate: string; reopen: boolean }) =>
      reopen
        ? reopenInspection(id, scheduledDate)
        : updateInspectionDetails(id, { scheduled_date: scheduledDate }),
    onSuccess: (updated, variables) => {
      toast.success(variables.reopen ? 'Inspection reopened with the new schedule' : 'Inspection rescheduled')
      setRescheduleInspection(null)
      setRescheduleDate('')
      setInfoInspection(previous => previous?.id === updated.id ? (variables.reopen ? null : updated) : previous)
      setInfoDraft(previous => infoInspection?.id === updated.id ? (variables.reopen ? null : inspectionDetailsDraft(updated)) : previous)
      refreshInspectionQueries()
      focusRecord(`inspection-${updated.id}`, updated.inspection_number, {
        message: variables.reopen ? 'Reopened and returned to Upcoming.' : 'Schedule updated.',
        announce: true,
        query: variables.reopen ? { tab: 0 } : undefined,
      })
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'Could not reschedule inspection'),
  })

  const updateDetailsMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: InspectionDetailsUpdatePayload }) =>
      updateInspectionDetails(id, data),
    onSuccess: (updated) => {
      toast.success('Inspection details updated')
      setInfoInspection(updated)
      setInfoDraft(inspectionDetailsDraft(updated))
      setInfoEditing(false)
      refreshInspectionQueries()
      focusRecord(`inspection-${updated.id}`, updated.inspection_number, {
        message: 'Inspection details updated.',
        announce: true,
      })
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'Could not update inspection'),
  })

  const closeInspectionMut = useMutation({
    mutationFn: closeScheduledInspection,
    onSuccess: (closed) => {
      toast.success('Inspection closed')
      setCloseInspectionTarget(null)
      setInfoInspection(previous => previous?.id === closed.id ? null : previous)
      refreshInspectionQueries()
      setTab(5)
      setClosedPage(0)
      focusRecord(`inspection-${closed.id}`, closed.inspection_number, {
        message: 'Closed and moved to the Closed tab.',
        announce: true,
        query: { tab: 5 },
      })
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'Could not close inspection'),
  })

  const reopenInspectionMut = useMutation({
    mutationFn: (inspectionId: number) => reopenInspection(inspectionId),
    onSuccess: (reopened) => {
      toast.success('Inspection returned to Upcoming')
      setReopenInspectionTarget(null)
      setInfoInspection(previous => previous?.id === reopened.id ? null : previous)
      refreshInspectionQueries()
      setTab(0)
      setUpcomingPage(0)
      focusRecord(`inspection-${reopened.id}`, reopened.inspection_number, {
        message: 'Reopened and returned to Upcoming.',
        announce: true,
        query: { tab: 0 },
      })
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'Could not reopen inspection'),
  })

  const reportMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => saveInspectionReport(id, data),
    onSuccess: (updated) => {
      toast.success(reportStatus === 'completed' ? 'Inspection report completed' : 'Inspection moved back to in progress')
      setReportInspection(null)
      setReport(null)
      setReportStatus('completed')
      queryClient.invalidateQueries({ queryKey: ['inspections'] })
      queryClient.invalidateQueries({ queryKey: ['inspection-batches'] })
      queryClient.invalidateQueries({ queryKey: ['inspection-summary'] })
      queryClient.invalidateQueries({ queryKey: ['billing-inspection-invoices'] })
      const destinationTab = reportStatus === 'completed' ? 3 : 2
      setTab(destinationTab)
      focusRecord(
        updated.batch_id ? `inspection-batch-${updated.batch_id}` : `inspection-${updated.id}`,
        updated.inspection_number,
        {
          message: reportStatus === 'completed'
            ? 'Report completed and moved to Completed.'
            : 'Report saved and returned to In Progress.',
          announce: true,
          query: { tab: destinationTab },
        },
      )
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'Could not save inspection report'),
  })

  const generateInvoiceMut = useMutation({
    mutationFn: (inspectionId: number) => generateInspectionInvoice(inspectionId),
    onSuccess: (invoice) => {
      toast.success(`Invoice ${invoice.invoice_number} is ready in Billing`)
      closeAssetActions()
      setViewReport(prev => prev && prev.id === invoice.inspection_id ? { ...prev, invoice } : prev)
      queryClient.invalidateQueries({ queryKey: ['inspections'] })
      queryClient.invalidateQueries({ queryKey: ['inspection-batches'] })
      queryClient.invalidateQueries({ queryKey: ['billing-inspection-invoices'] })
      queryClient.invalidateQueries({ queryKey: ['inspection-summary'] })
      publishInspectionInvoiceActivity(invoice, 'Inspection invoice generated and ready in Billing.')
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'Could not generate invoice'),
  })

  const generateBatchInvoiceMut = useMutation({
    mutationFn: (batchId: number) => generateInspectionBatchInvoice(batchId),
    onSuccess: (invoice) => {
      toast.success(`Batch invoice ${invoice.invoice_number} is ready in Billing`)
      queryClient.invalidateQueries({ queryKey: ['inspection-batches'] })
      queryClient.invalidateQueries({ queryKey: ['billing-inspection-invoices'] })
      queryClient.invalidateQueries({ queryKey: ['inspection-summary'] })
      publishInspectionInvoiceActivity(invoice, 'Batch inspection invoice generated and ready in Billing.')
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'Could not generate batch invoice'),
  })

  const addBatchAssetMut = useMutation({
    mutationFn: ({ batchId, data }: { batchId: number; data: BatchAssetCreatePayload }) => addInspectionBatchAsset(batchId, data),
    onSuccess: (batch) => {
      toast.success('Asset added; the inspection batch is now in progress')
      setAddAssetOpen(false)
      setBatchAssetForm(emptyBatchAssetForm())
      queryClient.setQueryData(['inspection-batches', batch.id], batch)
      queryClient.invalidateQueries({ queryKey: ['inspection-batches'] })
      queryClient.invalidateQueries({ queryKey: ['inspection-equipment'] })
      queryClient.invalidateQueries({ queryKey: ['inspection-summary'] })
      queryClient.invalidateQueries({ queryKey: ['billing-inspection-invoices'] })
      setTab(2)
      setInProgressBatchPage(0)
      focusRecord(`inspection-batch-${batch.id}`, batch.batch_number, {
        message: 'New asset added; this batch returned to In Progress.',
        announce: true,
        query: { tab: 2 },
      })
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'Could not add asset to batch'),
  })

  const addBatchExistingAssetsMut = useMutation({
    mutationFn: ({ batchId, equipmentIds }: { batchId: number; equipmentIds: number[] }) => addInspectionBatchExistingAssets(batchId, { equipment_ids: equipmentIds }),
    onSuccess: (batch, variables) => {
      toast.success(`${variables.equipmentIds.length} existing asset${variables.equipmentIds.length === 1 ? '' : 's'} added; the batch is now in progress`)
      setAddExistingAssetOpen(false)
      setSelectedExistingEquipmentIds([])
      setExistingAssetSearch('')
      queryClient.setQueryData(['inspection-batches', batch.id], batch)
      queryClient.invalidateQueries({ queryKey: ['inspection-batches'] })
      queryClient.invalidateQueries({ queryKey: ['inspections'] })
      queryClient.invalidateQueries({ queryKey: ['inspection-summary'] })
      queryClient.invalidateQueries({ queryKey: ['billing-inspection-invoices'] })
      setTab(2)
      setInProgressBatchPage(0)
      focusRecord(`inspection-batch-${batch.id}`, batch.batch_number, {
        message: `${variables.equipmentIds.length} existing asset${variables.equipmentIds.length === 1 ? '' : 's'} added; this batch returned to In Progress.`,
        announce: true,
        query: { tab: 2 },
      })
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'Could not add existing assets to batch'),
  })

  const removeBatchAssetMut = useMutation({
    mutationFn: ({ batchId, inspectionId }: { batchId: number; inspectionId: number }) => removeInspectionBatchAsset(batchId, inspectionId),
    onSuccess: (batch) => {
      toast.success('Asset removed from batch')
      queryClient.invalidateQueries({ queryKey: ['inspection-batches'] })
      queryClient.invalidateQueries({ queryKey: ['inspections'] })
      queryClient.invalidateQueries({ queryKey: ['inspection-summary'] })
      focusRecord(`inspection-batch-${batch.id}`, batch.batch_number, {
        message: 'Asset removed from this inspection batch.',
        announce: true,
        query: { tab: batch.status === 'completed' ? 3 : 2 },
      })
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'Could not remove asset from batch'),
  })

  const techMut = useMutation({
    mutationFn: ({ inspectionId, inspectorId }: { inspectionId: number; inspectorId: number | null }) => updateInspectionTechnician(inspectionId, inspectorId),
    onSuccess: (updated) => {
      toast.success('Technician updated')
      setTechEdit(null)
      setSelectedTechId('')
      queryClient.invalidateQueries({ queryKey: ['inspection-batches'] })
      queryClient.invalidateQueries({ queryKey: ['inspections'] })
      queryClient.invalidateQueries({ queryKey: ['inspection-summary'] })
      focusRecord(
        updated.batch_id ? `inspection-batch-${updated.batch_id}` : `inspection-${updated.id}`,
        updated.inspection_number,
        {
          message: 'Assigned technician updated.',
          announce: true,
          query: { tab: updated.status === 'completed' ? 3 : updated.status === 'closed' ? 5 : 2 },
        },
      )
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'Could not change technician'),
  })

  const formBuilderMut = useMutation({
    mutationFn: async () => {
      const name = formBuilderName.trim()
      if (!name) throw new Error('Form name is required')
      const payload = {
        name,
        description: formBuilderDescription.trim() || null,
        modality_id: formBuilderModalityId,
        schema: schemaToPayload({
          ...formBuilderSchema,
          title: name,
          source: 'medrad_grid_form_builder',
          version: formBuilderEngine === 'canvas' ? 5 : 3,
          formio_form: null,
          custom_grid: formBuilderEngine === 'canvas' ? null : formBuilderSchema.custom_grid,
          canvas_form: formBuilderEngine === 'canvas' ? (canvasFormSchema ?? null) : null,
        }, name),
      }
      if (formBuilderMode === 'create') return createInspectionForm(payload)
      if (!formBuilderId) throw new Error('Inspection form was not selected')
      return updateInspectionForm(formBuilderId, payload)
    },
    onSuccess: (saved) => {
      toast.success(formBuilderMode === 'create' ? 'Inspection form created' : 'Inspection form updated')
      setFormBuilderOpen(false)
      queryClient.invalidateQueries({ queryKey: ['inspection-forms'] })
      if (reportInspection && reportFormSource === 'custom') {
        setSelectedReportFormId(saved.id)
      }
      focusRecord(`inspection-form-${saved.id}`, saved.name, {
        message: formBuilderMode === 'create' ? 'Inspection form created.' : 'Inspection form updated.',
        announce: true,
        query: { tab: 4 },
      })
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || e.message || 'Could not save inspection form'),
  })

  const saveCustomTemplateMut = useMutation({
    mutationFn: async () => {
      const name = customFormName.trim()
      if (!name) throw new Error('Form name is required')
      const schema = schemaToPayload(
        reportCustomSchema || normalizeInspectionFormSchema(buildReusableFormSchema(name, report || {}), name),
        name,
      )
      if (!schema.custom_grid && !schema.formio_form?.components) throw new Error('Create the custom form before saving it')
      const payload = {
        name,
        description: customFormDescription.trim() || `Custom inspection form${reportInspection ? ` created from ${reportInspection.inspection_number}` : ''}`,
        modality_id: null,
        schema,
      }
      if (selectedReportFormId && reportFormSource === 'custom') {
        return updateInspectionForm(selectedReportFormId, payload)
      }
      return createInspectionForm(payload)
    },
    onSuccess: (saved) => {
      toast.success('Custom inspection form saved without completing the report')
      setSelectedReportFormId(saved.id)
      setCustomFormName(saved.name)
      setCustomFormDescription(saved.description || '')
      setReportCustomSchema(schemaForForm(saved))
      queryClient.invalidateQueries({ queryKey: ['inspection-forms'] })
      focusRecord(`inspection-form-${saved.id}`, saved.name, {
        message: 'Reusable inspection form saved.',
        announce: true,
        query: { tab: 4 },
      })
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || e.message || 'Could not save custom inspection form'),
  })

  // Removing a form, two ways. Delete only where nothing has ever used
  // it; archive otherwise. The refusal comes from the server with the
  // count in it, so what the user reads is the truth about their data
  // rather than a guess made on the screen.
  const deleteFormMut = useMutation({
    mutationFn: (form: InspectionFormOption) => deleteInspectionForm(form.id),
    onSuccess: (result) => {
      const detached = result.detached_equipment + result.detached_parts
      toast.success(detached
        ? `${result.name} deleted. ${detached} record${detached === 1 ? '' : 's'} no longer point at it.`
        : `${result.name} deleted.`)
      setRemovingForm(null)
      setFormBuilderOpen(false)
      queryClient.invalidateQueries({ queryKey: ['inspection-forms'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || e.message || 'Could not delete this form'),
  })

  const archiveFormMut = useMutation({
    mutationFn: (form: InspectionFormOption) => archiveInspectionForm(form.id),
    onSuccess: (saved) => {
      toast.success(`${saved.name} archived. Inspections built on it are untouched.`)
      setRemovingForm(null)
      setFormBuilderOpen(false)
      queryClient.invalidateQueries({ queryKey: ['inspection-forms'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || e.message || 'Could not archive this form'),
  })

  useEffect(() => {
    if (reportInspection) {
      setReport(reportInspection.form_data || makeReport(reportInspection))
      setReportStatus(reportInspection.status === 'completed' ? 'completed' : 'completed')
      const usesAttached = Boolean(reportInspection.attached_form_id)
      const initialSource: ReportFormSource = usesAttached ? 'attached' : 'default'
      setReportFormSource(initialSource)
      setSelectedReportFormId(
        usesAttached
          ? reportInspection.attached_form_id
          : defaultReportForm?.id || reportInspection.form_template_id || null,
      )
      const assetName = reportInspection.asset_name || reportInspection.equipment_name || reportInspection.inspection_number
      setCustomFormName(`${assetName} Custom Inspection Form`)
      setCustomFormDescription(`Reusable custom inspection form created from ${reportInspection.inspection_number}.`)
      const baseSchema = usesAttached && reportInspection.attached_form_schema
        ? normalizeInspectionFormSchema(reportInspection.attached_form_schema, reportInspection.attached_form_name || 'Asset attached form')
        : reportInspection.form_template_schema
          ? normalizeInspectionFormSchema(reportInspection.form_template_schema, reportInspection.form_template_name || 'Inspection form')
          : defaultReportForm
            ? schemaForForm(defaultReportForm)
            : null
      setReportCustomSchema(baseSchema)
      setSaveCustomForm(true)
    }
  }, [reportInspection, defaultReportForm?.id])

  const legacyInProgress = inProgressQ.data?.items || []
  const legacyCompleted = completedQ.data?.items || []

  const stats = {
    upcoming: summaryQ.data?.upcoming || 0,
    instantItems: equipment.length,
    inProgress: summaryQ.data?.in_progress || 0,
    completed: summaryQ.data?.completed || 0,
  }

  const selectedBatch = batchDetailQ.data
  const selectedBatchBillingApproved = selectedBatch?.batch_invoice?.billing_approval_status === 'approved'
  const canAddAssetsToSelectedBatch = canInitiateInspections && !selectedBatchBillingApproved
  const batchEquipmentIds = useMemo(
    () => new Set((selectedBatch?.assets || []).map(asset => asset.equipment_id).filter((id): id is number => Boolean(id))),
    [selectedBatch?.assets],
  )
  const availableExistingBatchAssets = useMemo(() => {
    const search = existingAssetSearch.trim().toLowerCase()
    return (batchEquipmentQ.data || [])
      .filter(item => !batchEquipmentIds.has(item.id))
      .filter(item => {
        if (!search) return true
        return [
          item.asset_tag,
          item.make,
          item.model,
          item.serial_number,
          item.modality_name,
          item.criticality,
        ].some(value => String(value || '').toLowerCase().includes(search))
      })
  }, [batchEquipmentIds, batchEquipmentQ.data, existingAssetSearch])
  const batchTechnicians = useMemo(() => {
    const users = usersQ.data?.items || []
    if (!selectedBatch?.facility_id) return users
    return users.filter((user: UserData) =>
      user.facility_id === selectedBatch.facility_id ||
      (user.facilities || []).some(facility => facility.id === selectedBatch.facility_id) ||
      ['superadmin', 'admin', 'technician'].includes(user.role),
    )
  }, [selectedBatch?.facility_id, usersQ.data?.items])

  const infoTechnicians = useMemo(() => {
    if (!infoInspection) return []
    return (usersQ.data?.items || []).filter((user: UserData) => {
      const isCurrentInspector = user.id === infoInspection.inspector_id
      if (user.role !== 'technician' && !isCurrentInspector) return false
      return isCurrentInspector
        || user.facility_id === infoInspection.facility_id
        || (user.facilities || []).some(facility => facility.id === infoInspection.facility_id)
        || ['superadmin', 'admin'].includes(user.role)
    })
  }, [infoInspection, usersQ.data?.items])

  const toggleInstantEquipment = (id: number) => {
    setSelectedInstantEquipmentIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id])
  }

  const toggleEquipment = (id: number) => {
    setSelectedEquipmentIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id])
  }

  const toggleAllEquipment = () => {
    const ids = equipment.map(item => item.id)
    setSelectedEquipmentIds(prev => ids.length && ids.every(id => prev.includes(id)) ? [] : ids)
  }

  const allScheduleEquipmentSelected = equipment.length > 0 && equipment.every(item => selectedEquipmentIds.includes(item.id))

  const toggleExistingBatchEquipment = (id: number) => {
    setSelectedExistingEquipmentIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id])
  }

  const toggleAllExistingBatchEquipment = () => {
    const ids = availableExistingBatchAssets.map(item => item.id)
    setSelectedExistingEquipmentIds(prev => ids.length && ids.every(id => prev.includes(id)) ? [] : ids)
  }

  const allExistingBatchEquipmentSelected = availableExistingBatchAssets.length > 0 && availableExistingBatchAssets.every(item => selectedExistingEquipmentIds.includes(item.id))

  const toggleAllInstantEquipment = () => {
    const ids = equipment.map(item => item.id)
    setSelectedInstantEquipmentIds(prev => ids.length && ids.every(id => prev.includes(id)) ? [] : ids)
  }

  const allInstantEquipmentSelected = equipment.length > 0 && equipment.every(item => selectedInstantEquipmentIds.includes(item.id))

  const startInspection = () => {
    if (!canInitiateInspections) return toast.error('You do not have permission to initiate inspections')
    if (!facilityId) return toast.error('Select a facility first')
    if (!selectedInstantEquipmentIds.length) return toast.error('Select at least one asset or use Select All')
    createMut.mutate({
      facility_id: Number(facilityId),
      equipment_ids: selectedInstantEquipmentIds,
      frequency,
    })
  }

  const scheduleSelected = () => {
    if (!canAddInspections) return toast.error('You do not have permission to schedule inspections')
    if (!facilityId) return toast.error('Select a facility first')
    if (!selectedEquipmentIds.length) return toast.error('Select at least one asset or use Select All')
    scheduleMut.mutate({
      facility_id: Number(facilityId),
      equipment_ids: selectedEquipmentIds,
      frequency: frequency === 'instant' ? 'annual' : frequency,
      scheduled_date: new Date(scheduleDate).toISOString(),
    })
  }

  const openRescheduleDialog = (inspection: Inspection) => {
    closeUpcomingActions()
    setRescheduleInspection(inspection)
    setRescheduleDate(toDateTimeLocalValue(inspection.scheduled_date))
  }

  const submitReschedule = () => {
    if (!rescheduleInspection || !rescheduleDate) return toast.error('Select a scheduled date and time')
    const parsed = new Date(rescheduleDate)
    if (Number.isNaN(parsed.getTime())) return toast.error('Enter a valid scheduled date and time')
    rescheduleMut.mutate({
      id: rescheduleInspection.id,
      scheduledDate: parsed.toISOString(),
      reopen: rescheduleInspection.status === 'closed',
    })
  }

  const submitInspectionDetails = () => {
    if (!infoInspection || !infoDraft) return
    if (!infoDraft.scheduledDate) return toast.error('Scheduled date and time is required')
    const parsed = new Date(infoDraft.scheduledDate)
    if (Number.isNaN(parsed.getTime())) return toast.error('Enter a valid scheduled date and time')
    if (!infoDraft.frequency.trim()) return toast.error('Inspection frequency is required')
    if (!infoDraft.formTemplateId) return toast.error('Select an inspection form')
    updateDetailsMut.mutate({
      id: infoInspection.id,
      data: {
        scheduled_date: parsed.toISOString(),
        inspection_frequency: infoDraft.frequency.trim(),
        compliance_requirement: infoDraft.complianceRequirement.trim() || null,
        criticality: infoDraft.criticality.trim() || null,
        inspector_id: infoDraft.inspectorId === '' ? null : Number(infoDraft.inspectorId),
        form_template_id: Number(infoDraft.formTemplateId),
      },
    })
  }

  const closeInspectionInfo = () => {
    if (updateDetailsMut.isPending) return
    setInfoInspection(null)
    setInfoDraft(null)
    setInfoEditing(false)
  }

  const cancelInspectionDetailsEdit = () => {
    if (infoInspection) setInfoDraft(inspectionDetailsDraft(infoInspection))
    setInfoEditing(false)
  }

  const updateReport = (section: string, key: string, value: any) => {
    setReport((prev: any) => ({ ...prev, [section]: { ...prev[section], [key]: value } }))
  }

  const updateArrayReport = (section: 'parts' | 'test_equipment' | 'measurements' | 'photo_documentation', index: number, key: string, value: any) => {
    setReport((prev: any) => {
      const next = [...prev[section]]
      next[index] = { ...next[index], [key]: value }
      return { ...prev, [section]: next }
    })
  }

  const testEquipmentSnapshot = (item: TestEquipment) => ({
    id: item.id,
    description: item.tem,
    make: item.mrf || '',
    model: item.model || '',
    serial_number: item.serial_number || '',
    asset: item.asset || '',
    image_url: item.image_url || '',
  })

  const inventoryPartSnapshot = (item: InventoryPart) => ({
    id: item.id,
    description: item.description || item.part_type || '',
    part_number: item.part_number || '',
    price: Number(item.unit_price || 0),
    condition: item.condition || '',
    make: item.make || '',
    model: item.model || '',
    serial_number: item.serial_number || '',
  })

  const schemaForForm = (form: InspectionFormOption | null | undefined) =>
    form ? normalizeInspectionFormSchema(form.schema, form.name) : normalizeInspectionFormSchema({ title: 'Inspection Form' })

  const openCreateFormBuilder = () => {
    setFormBuilderMode('create')
    setFormBuilderId(null)
    setFormBuilderName('New Inspection Form')
    setFormBuilderDescription('')
    setFormBuilderModalityId(null)
    setFormBuilderEngine('grid')
    setCanvasFormSchema(null)
    setFormBuilderSchema({
      title: 'New Inspection Form',
      version: 3,
      source: 'medrad_grid_form_builder',
      based_on: defaultReportForm?.name,
      formio_form: null,
      custom_grid: null,
    })
    setFormBuilderRows(3)
    setFormBuilderColumns(3)
    setTablePickerHover(null)
    setFormBuilderOpen(true)
  }

  const openEditFormBuilder = (form: InspectionFormOption) => {
    // A checklist is stored as data, not as a canvas layout. Opened here it
    // would be read as an empty layout, and saving would wipe it.
    if ((form.schema as { source?: string } | null)?.source === 'phealth_checklist') {
      toast.info('This is a standard checklist. It opens as a table during an inspection and is not edited here.')
      return
    }
    setFormBuilderMode('edit')
    setFormBuilderId(form.id)
    setFormBuilderName(form.name)
    setFormBuilderDescription(form.description || '')
    setFormBuilderModalityId(form.modality_id)
    const schema = schemaForForm(form)
    setFormBuilderSchema(schema)
    setFormBuilderFormioForm(formioFromLegacySchema(schema, form.name))
    setFormBuilderRows(schema.custom_grid?.rows || 3)
    setFormBuilderColumns(schema.custom_grid?.columns || 3)
    setTablePickerHover(null)
    const isCanvas = Boolean(schema.canvas_form?.elements)
    setFormBuilderEngine(isCanvas ? 'canvas' : 'grid')
    setCanvasFormSchema(isCanvas ? schema.canvas_form! : null)
    setFormBuilderOpen(true)
  }

  const openReportCustomBuilder = () => {
    const base = reportCustomSchema || activeReportSchema || normalizeInspectionFormSchema({ title: customFormName || 'Custom Inspection Form' })
    setFormBuilderMode('report-custom')
    setFormBuilderId(null)
    setFormBuilderName(customFormName || `${reportInspection?.asset_name || reportInspection?.equipment_name || 'Asset'} Custom Inspection Form`)
    setFormBuilderDescription(customFormDescription)
    setFormBuilderModalityId(null)
    const title = customFormName || base.title
    setFormBuilderSchema({ ...base, title, source: 'medrad_grid_form_builder', version: 3, formio_form: null, custom_grid: base.custom_grid || null })
    setFormBuilderRows(base.custom_grid?.rows || 3)
    setFormBuilderColumns(base.custom_grid?.columns || 3)
    setTablePickerHover(null)
    setFormBuilderOpen(true)
  }

  const setBuilderGrid = (rows: number, columns: number) => {
    const safeRows = Math.max(1, Math.min(30, Number(rows || 1)))
    const safeColumns = Math.max(1, Math.min(12, Number(columns || 1)))
    setFormBuilderSchema(prev => ({
      ...prev,
      custom_grid: createEmptyGrid(safeRows, safeColumns, prev.custom_grid?.title || 'Set Title'),
    }))
  }

  const updateBuilderGridTitle = (title: string) => {
    setFormBuilderSchema(prev => ({
      ...prev,
      custom_grid: prev.custom_grid
        ? { ...prev.custom_grid, title }
        : { ...createEmptyGrid(formBuilderRows, formBuilderColumns), title },
    }))
  }

  const updateGridCell = (rowIndex: number, columnIndex: number, patch: Partial<GridCellSchema>) => {
    setFormBuilderSchema(prev => {
      const grid = prev.custom_grid || createEmptyGrid()
      return {
        ...prev,
        custom_grid: {
          ...grid,
          cells: grid.cells.map((row, r) => r === rowIndex
            ? row.map((cell, c) => {
              if (c !== columnIndex) return cell
              const nextType = patch.type || cell.type
              const hasOptionsPatch = Object.prototype.hasOwnProperty.call(patch, 'options')
              return {
                ...cell,
                ...patch,
                options: nextType === 'radio'
                  ? (patch.options || cell.options || DEFAULT_GRID_OPTIONS)
                  : nextType === 'checkbox'
                    ? (hasOptionsPatch ? patch.options : cell.options)
                    : undefined,
              }
            })
            : row),
        },
      }
    })
  }

  const addGridCell = (rowIndex: number, columnIndex: number) => {
    setFormBuilderSchema(prev => {
      const grid = prev.custom_grid || createEmptyGrid()
      const nextCells = grid.cells.map((row, index) => {
        if (index !== rowIndex) return row
        const nextCell = {
          ...createGridCell(rowIndex, row.length),
          id: `cell_${rowIndex + 1}_${Date.now()}`,
        }
        return [...row.slice(0, columnIndex + 1), nextCell, ...row.slice(columnIndex + 1)]
      })
      return {
        ...prev,
        custom_grid: {
          ...grid,
          columns: Math.max(...nextCells.map(row => row.length)),
          cells: nextCells,
        },
      }
    })
  }

  const removeGridCell = (rowIndex: number, columnIndex: number) => {
    setFormBuilderSchema(prev => {
      const grid = prev.custom_grid || createEmptyGrid()
      const totalCells = grid.cells.reduce((sum, row) => sum + row.length, 0)
      if (totalCells <= 1) {
        toast.error('At least one cell is required')
        return prev
      }
      const nextCells = grid.cells
        .map((row, index) => index === rowIndex ? row.filter((_, cellIndex) => cellIndex !== columnIndex) : row)
        .filter(row => row.length > 0)
      return {
        ...prev,
        custom_grid: {
          ...grid,
          rows: nextCells.length,
          columns: Math.max(...nextCells.map(row => row.length)),
          cells: nextCells,
        },
      }
    })
  }

  const updateGridCellOption = (rowIndex: number, columnIndex: number, optionIndex: number, value: string) => {
    const cell = formBuilderSchema.custom_grid?.cells?.[rowIndex]?.[columnIndex]
    const options = [...(cell?.options || DEFAULT_GRID_OPTIONS)]
    options[optionIndex] = value
    updateGridCell(rowIndex, columnIndex, { options: options.map(option => option.trim()).filter(Boolean) })
  }

  const addGridCellOption = (rowIndex: number, columnIndex: number) => {
    const cell = formBuilderSchema.custom_grid?.cells?.[rowIndex]?.[columnIndex]
    updateGridCell(rowIndex, columnIndex, { options: [...(cell?.options || []), 'Option'] })
  }

  const removeGridCellOption = (rowIndex: number, columnIndex: number, optionIndex: number) => {
    const cell = formBuilderSchema.custom_grid?.cells?.[rowIndex]?.[columnIndex]
    const options = (cell?.options || []).filter((_, index) => index !== optionIndex)
    updateGridCell(rowIndex, columnIndex, { options: options.length ? options : undefined })
  }

  const moveGridCellOption = (rowIndex: number, columnIndex: number, fromIndex: number, toIndex: number) => {
    const cell = formBuilderSchema.custom_grid?.cells?.[rowIndex]?.[columnIndex]
    const options = [...(cell?.options || [])]
    if (fromIndex === toIndex || toIndex < 0 || toIndex >= options.length) return
    const [moved] = options.splice(fromIndex, 1)
    options.splice(toIndex, 0, moved)
    updateGridCell(rowIndex, columnIndex, { options })
  }

  const addSelectedCellBlock = (type: GridCellBlockType) => {
    if (!selectedBuilderCell) return toast.info('Select a table cell first')
    const cell = formBuilderSchema.custom_grid?.cells?.[selectedBuilderCell.row]?.[selectedBuilderCell.column]
    const blocks = [...(cell?.blocks || []), createGridCellBlock(type, cell?.blocks?.length || 0)]
    updateGridCell(selectedBuilderCell.row, selectedBuilderCell.column, { blocks, type: 'text', options: undefined })
  }

  const updateGridCellBlock = (rowIndex: number, columnIndex: number, blockIndex: number, patch: Partial<GridCellBlock>) => {
    const cell = formBuilderSchema.custom_grid?.cells?.[rowIndex]?.[columnIndex]
    if (!cell) return
    const blocks = [...(cell.blocks || [])]
    const current = blocks[blockIndex]
    if (!current) return
    const nextType = patch.type || current.type
    blocks[blockIndex] = {
      ...current,
      ...patch,
      options: nextType === 'checkbox' || nextType === 'radio'
        ? (patch.options || current.options || ['Option'])
        : undefined,
    }
    updateGridCell(rowIndex, columnIndex, { blocks })
  }

  const removeGridCellBlock = (rowIndex: number, columnIndex: number, blockIndex: number) => {
    const cell = formBuilderSchema.custom_grid?.cells?.[rowIndex]?.[columnIndex]
    const blocks = (cell?.blocks || []).filter((_, index) => index !== blockIndex)
    updateGridCell(rowIndex, columnIndex, { blocks: blocks.length ? blocks : undefined })
  }

  const addGridCellBlockOption = (rowIndex: number, columnIndex: number, blockIndex: number) => {
    const block = formBuilderSchema.custom_grid?.cells?.[rowIndex]?.[columnIndex]?.blocks?.[blockIndex]
    updateGridCellBlock(rowIndex, columnIndex, blockIndex, { options: [...(block?.options?.length ? block.options : ['Option']), 'Option'] })
  }

  const updateGridCellBlockOption = (rowIndex: number, columnIndex: number, blockIndex: number, optionIndex: number, value: string) => {
    const block = formBuilderSchema.custom_grid?.cells?.[rowIndex]?.[columnIndex]?.blocks?.[blockIndex]
    const options = [...(block?.options || ['Option'])]
    options[optionIndex] = value
    updateGridCellBlock(rowIndex, columnIndex, blockIndex, { options: options.map(option => option.trim()) })
  }

  const removeGridCellBlockOption = (rowIndex: number, columnIndex: number, blockIndex: number, optionIndex: number) => {
    const block = formBuilderSchema.custom_grid?.cells?.[rowIndex]?.[columnIndex]?.blocks?.[blockIndex]
    const options = (block?.options || []).filter((_, index) => index !== optionIndex)
    updateGridCellBlock(rowIndex, columnIndex, blockIndex, { options: options.length ? options : ['Option'] })
  }

  const moveGridCellBlock = (rowIndex: number, columnIndex: number, fromIndex: number, toIndex: number) => {
    const cell = formBuilderSchema.custom_grid?.cells?.[rowIndex]?.[columnIndex]
    if (!cell?.blocks?.length || fromIndex === toIndex || toIndex < 0 || toIndex >= cell.blocks.length) return
    const blocks = [...cell.blocks]
    const [moved] = blocks.splice(fromIndex, 1)
    blocks.splice(toIndex, 0, moved)
    updateGridCell(rowIndex, columnIndex, { blocks })
  }

  const moveGridRow = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return
    setFormBuilderSchema(prev => {
      const grid = prev.custom_grid
      if (!grid) return prev
      const cells = [...grid.cells]
      const [removed] = cells.splice(fromIndex, 1)
      cells.splice(toIndex, 0, removed)
      return { ...prev, custom_grid: { ...grid, cells, rows: cells.length } }
    })
    if (selectedBuilderCell) {
      const { row, column } = selectedBuilderCell
      let nextRow = row
      if (row === fromIndex) nextRow = toIndex
      else if (fromIndex < toIndex && row > fromIndex && row <= toIndex) nextRow = row - 1
      else if (fromIndex > toIndex && row >= toIndex && row < fromIndex) nextRow = row + 1
      if (nextRow !== row) setSelectedBuilderCell({ row: nextRow, column })
    }
  }

  const moveGridCellBlockOption = (rowIndex: number, columnIndex: number, blockIndex: number, fromIndex: number, toIndex: number) => {
    const block = formBuilderSchema.custom_grid?.cells?.[rowIndex]?.[columnIndex]?.blocks?.[blockIndex]
    const options = [...(block?.options?.length ? block.options : ['Option'])]
    if (fromIndex === toIndex || toIndex < 0 || toIndex >= options.length) return
    const [moved] = options.splice(fromIndex, 1)
    options.splice(toIndex, 0, moved)
    updateGridCellBlock(rowIndex, columnIndex, blockIndex, { options })
  }

  const nudgeGridCellBlockOption = (rowIndex: number, columnIndex: number, blockIndex: number, optionIndex: number, direction: -1 | 1) => {
    moveGridCellBlockOption(rowIndex, columnIndex, blockIndex, optionIndex, optionIndex + direction)
  }

  const moveGridCellBlockById = (rowIndex: number, columnIndex: number, blockId: string, toIndex: number) => {
    const cell = formBuilderSchema.custom_grid?.cells?.[rowIndex]?.[columnIndex]
    const fromIndex = cell?.blocks?.findIndex(block => block.id === blockId) ?? -1
    if (fromIndex < 0) return
    moveGridCellBlock(rowIndex, columnIndex, fromIndex, toIndex)
  }

  const handleBuilderBlockDragEnter = (rowIndex: number, columnIndex: number, targetBlock: GridCellBlock, targetIndex: number) => {
    const activeDrag = builderDragRef.current
    if (activeDrag?.kind !== 'block' || activeDrag.blockId === targetBlock.id) return
    moveGridCellBlockById(rowIndex, columnIndex, activeDrag.blockId, targetIndex)
  }

  const handleBuilderOptionDragEnter = (rowIndex: number, columnIndex: number, block: GridCellBlock, targetIndex: number) => {
    const activeDrag = builderDragRef.current
    if (activeDrag?.kind !== 'option' || activeDrag.blockId !== block.id || activeDrag.optionIndex === targetIndex) return
    const blockIndex = formBuilderSchema.custom_grid?.cells?.[rowIndex]?.[columnIndex]?.blocks?.findIndex(item => item.id === block.id) ?? -1
    if (blockIndex < 0) return
    moveGridCellBlockOption(rowIndex, columnIndex, blockIndex, activeDrag.optionIndex, targetIndex)
    setBuilderDragState({ kind: 'option', blockId: block.id, optionIndex: targetIndex })
  }

  const selectedGridCell = selectedBuilderCell
    ? formBuilderSchema.custom_grid?.cells?.[selectedBuilderCell.row]?.[selectedBuilderCell.column]
    : null

  const selectedRowIndex = selectedBuilderCell?.row ?? 0
  const selectedColumnIndex = selectedBuilderCell?.column ?? 0

  const setSelectedGridCellType = (type: GridCellType) => {
    if (!selectedBuilderCell) return toast.info('Select a table cell first')
    updateGridCell(selectedBuilderCell.row, selectedBuilderCell.column, {
      type,
      options: type === 'radio' ? (selectedGridCell?.options?.length ? selectedGridCell.options : DEFAULT_GRID_OPTIONS) : type === 'checkbox' ? selectedGridCell?.options : undefined,
    })
  }

  const updateSelectedGridCell = (patch: Partial<GridCellSchema>) => {
    if (!selectedBuilderCell) return toast.info('Select a table cell first')
    updateGridCell(selectedBuilderCell.row, selectedBuilderCell.column, patch)
  }

  const updateSelectedGridCellBlock = (blockIndex: number, patch: Partial<GridCellBlock>) => {
    if (!selectedBuilderCell) return toast.info('Select a table cell first')
    updateGridCellBlock(selectedBuilderCell.row, selectedBuilderCell.column, blockIndex, patch)
  }

  const renderBuilderGridCellBlocks = (cell: GridCellSchema, rowIndex: number, columnIndex: number, isSelected: boolean) => {
    const blockEntries = builderGridCellBlockEntries(cell)
    if (!blockEntries.length) return null

    const dragHandleSx = {
      width: 28,
      height: 28,
      borderRadius: '10px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      bgcolor: palette.indigoTint,
      color: palette.brandDeep,
      border: `1px solid ${palette.brandBorder}`,
      cursor: 'grab',
      '&:active': { cursor: 'grabbing' },
      '&:hover': { bgcolor: palette.brandSoft, borderColor: palette.brandStrong },
    } as const

    return (
      <Box sx={{ display: 'grid', gap: 1, width: '100%', textAlign: cell.align || 'center' }}>
        {blockEntries.map(({ block, index: blockIndex }) => {
          const isInlineInput = block.type === 'input' && (block.layout ? block.layout === 'inline' : Boolean(block.inline))
          const allowOptionDrag = isSelected && (block.type === 'radio' || block.type === 'checkbox')
          const options = block.options?.length ? block.options : ['Option']

          const blockShell = (content: ReactNode) => (
            <Box
              key={block.id}
              onClick={event => event.stopPropagation()}
              onDragOver={(event) => {
                if (!isSelected) return
                event.preventDefault()
              }}
              onDragEnter={(event) => {
                if (!isSelected) return
                event.preventDefault()
                handleBuilderBlockDragEnter(rowIndex, columnIndex, block, blockIndex)
              }}
              onMouseEnter={() => {
                if (!isSelected || builderDragRef.current?.kind !== 'block') return
                handleBuilderBlockDragEnter(rowIndex, columnIndex, block, blockIndex)
              }}
              onDrop={(event) => {
                if (!isSelected) return
                event.preventDefault()
                event.stopPropagation()
                const activeDrag = builderDragRef.current
                if (activeDrag?.kind === 'block') {
                  moveGridCellBlockById(rowIndex, columnIndex, activeDrag.blockId, blockIndex)
                } else {
                  const fromIndex = Number(event.dataTransfer.getData('application/x-grid-block-index'))
                  if (Number.isFinite(fromIndex)) moveGridCellBlock(rowIndex, columnIndex, fromIndex, blockIndex)
                }
                setBuilderDragState(null)
              }}
              sx={{
                display: 'grid',
                gridTemplateColumns: isSelected ? 'auto minmax(0, 1fr)' : '1fr',
                gap: 0.75,
                alignItems: 'start',
                justifyItems: cell.align === 'left' ? 'start' : cell.align === 'right' ? 'end' : 'center',
                width: '100%',
                p: isSelected ? 0.5 : 0,
                borderRadius: '12px',
                border: isSelected ? '1px dashed transparent' : 'none',
                '&:hover': isSelected ? { borderColor: palette.brandPale, bgcolor: 'rgba(245, 243, 255, 0.55)' } : undefined,
              }}
            >
              {isSelected && (
                <Tooltip title="Drag this item">
                  <Box
                    draggable
                    onMouseDown={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      setBuilderDragState({ kind: 'block', blockId: block.id })
                    }}
                    onDragStart={(event) => {
                      event.stopPropagation()
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData('application/x-grid-block-index', String(blockIndex))
                      event.dataTransfer.setData('text/plain', `block:${block.id}`)
                      setBuilderDragState({ kind: 'block', blockId: block.id })
                    }}
                    onDragEnd={() => {
                      setBuilderDragState(null)
                    }}
                    sx={dragHandleSx}
                  >
                    <DragIndicatorIcon fontSize="small" />
                  </Box>
                </Tooltip>
              )}
              <Box sx={{ width: '100%', minWidth: 0 }}>{content}</Box>
            </Box>
          )

          if (block.type === 'label') {
            return blockShell(
              <Typography sx={{ fontWeight: 900, color: palette.ink, textAlign: cell.align || 'center' }}>
                {block.label || `Text ${blockIndex + 1}`}
              </Typography>,
            )
          }

          if (block.type === 'input') {
            return blockShell(
              <Box sx={{
                display: isInlineInput ? 'grid' : 'block',
                gridTemplateColumns: isInlineInput ? 'auto minmax(80px, 1fr)' : undefined,
                gap: 1,
                alignItems: 'center',
                width: '100%',
                maxWidth: block.width || 180,
              }}>
                {block.label?.trim() && <Typography sx={{ fontWeight: 900, color: palette.slate600, whiteSpace: 'nowrap' }}>{block.label}</Typography>}
                <TextField
                  size="small"
                  disabled
                  fullWidth
                  placeholder=""
                  sx={{ '& .MuiInputBase-root': { height: block.height || 40 } }}
                />
              </Box>,
            )
          }

          if (block.type === 'textarea') {
            return blockShell(
              <Box sx={{ display: 'grid', gap: 0.75, width: '100%', maxWidth: block.width || 220 }}>
                {block.label?.trim() && <Typography sx={{ fontWeight: 900, color: palette.slate600 }}>{block.label}</Typography>}
                <TextField
                  size="small"
                  disabled
                  fullWidth
                  multiline
                  placeholder={block.label?.trim() ? '' : 'Comments'}
                  sx={{ '& .MuiInputBase-root': { height: block.height || 90, alignItems: 'flex-start' } }}
                />
              </Box>,
            )
          }

          if (block.type === 'radio') {
            return blockShell(
              <Box sx={{ display: 'grid', gap: 0.75, width: '100%' }}>
                {block.label?.trim() && <Typography sx={{ fontWeight: 900, color: palette.slate600 }}>{block.label}</Typography>}
                <Box sx={gridOptionContainerSx(block.optionLayout, cell.align)}>
                  {options.map((option, optionIndex) => (
                    <Box
                      key={`${block.id}-builder-radio-${optionIndex}`}
                      draggable={false}
                      onDragStart={(event) => {
                        if (!allowOptionDrag) return
                        event.stopPropagation()
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('application/x-grid-option-index', String(optionIndex))
                        event.dataTransfer.setData('text/plain', `option:${block.id}:${optionIndex}`)
                        setBuilderDragState({ kind: 'option', blockId: block.id, optionIndex })
                      }}
                      onDragOver={(event) => {
                        if (!allowOptionDrag) return
                        event.preventDefault()
                      }}
                      onDragEnter={(event) => {
                        if (!allowOptionDrag) return
                        event.preventDefault()
                        event.stopPropagation()
                        handleBuilderOptionDragEnter(rowIndex, columnIndex, block, optionIndex)
                      }}
                      onMouseDown={(event) => {
                        if (!allowOptionDrag) return
                        event.preventDefault()
                        event.stopPropagation()
                        setBuilderDragState({ kind: 'option', blockId: block.id, optionIndex })
                      }}
                      onMouseEnter={() => {
                        if (!allowOptionDrag || builderDragRef.current?.kind !== 'option') return
                        handleBuilderOptionDragEnter(rowIndex, columnIndex, block, optionIndex)
                      }}
                      onDrop={(event) => {
                        if (!allowOptionDrag) return
                        event.preventDefault()
                        event.stopPropagation()
                        const activeDrag = builderDragRef.current
                        const fromIndex = activeDrag?.kind === 'option' && activeDrag.blockId === block.id
                          ? activeDrag.optionIndex
                          : Number(event.dataTransfer.getData('application/x-grid-option-index'))
                        if (Number.isFinite(fromIndex)) moveGridCellBlockOption(rowIndex, columnIndex, blockIndex, fromIndex, optionIndex)
                        setBuilderDragState(null)
                      }}
                      onDragEnd={() => setBuilderDragState(null)}
                      sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 0.25,
                        borderRadius: '999px',
                        px: isSelected ? 0.5 : 0,
                        border: isSelected ? '1px solid transparent' : 'none',
                        cursor: allowOptionDrag ? 'grab' : 'default',
                        '&:hover': isSelected ? { borderColor: palette.brandBorder, bgcolor: palette.surface } : undefined,
                      }}
                    >
                      {isSelected && <DragIndicatorIcon sx={{ fontSize: 16, color: palette.textFaint }} />}
                      {isSelected && (
                        <Box sx={{ display: 'inline-flex', gap: 0.25 }}>
                          <IconButton
                            size="small"
                            aria-label="Move option left"
                            disabled={optionIndex === 0}
                            onMouseDown={event => event.stopPropagation()}
                            onClick={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              nudgeGridCellBlockOption(rowIndex, columnIndex, blockIndex, optionIndex, -1)
                            }}
                            sx={{ width: 24, height: 24, color: palette.brandDeep }}
                          >
                            <KeyboardArrowLeftIcon fontSize="small" />
                          </IconButton>
                          <IconButton
                            size="small"
                            aria-label="Move option right"
                            disabled={optionIndex >= options.length - 1}
                            onMouseDown={event => event.stopPropagation()}
                            onClick={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              nudgeGridCellBlockOption(rowIndex, columnIndex, blockIndex, optionIndex, 1)
                            }}
                            sx={{ width: 24, height: 24, color: palette.brandDeep }}
                          >
                            <KeyboardArrowRightIcon fontSize="small" />
                          </IconButton>
                        </Box>
                      )}
                      <FormControlLabel
                        control={<Radio disabled size="small" />}
                        label={option || `Option ${optionIndex + 1}`}
                        sx={{ m: 0, '& .MuiFormControlLabel-label': { fontWeight: 800, color: palette.slate600 } }}
                      />
                    </Box>
                  ))}
                </Box>
              </Box>,
            )
          }

          return blockShell(
            <Box sx={{ display: 'grid', gap: 0.75, width: '100%' }}>
              {block.label?.trim() && <Typography sx={{ fontWeight: 900, color: palette.slate600 }}>{block.label}</Typography>}
              <Box sx={gridOptionContainerSx(block.optionLayout, cell.align)}>
                {options.map((option, optionIndex) => (
                  <Box
                    key={`${block.id}-builder-checkbox-${optionIndex}`}
                    draggable={false}
                      onDragStart={(event) => {
                        if (!allowOptionDrag) return
                        event.stopPropagation()
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('application/x-grid-option-index', String(optionIndex))
                        event.dataTransfer.setData('text/plain', `option:${block.id}:${optionIndex}`)
                        setBuilderDragState({ kind: 'option', blockId: block.id, optionIndex })
                      }}
                      onDragOver={(event) => {
                        if (!allowOptionDrag) return
                        event.preventDefault()
                      }}
                      onDragEnter={(event) => {
                        if (!allowOptionDrag) return
                        event.preventDefault()
                        event.stopPropagation()
                        handleBuilderOptionDragEnter(rowIndex, columnIndex, block, optionIndex)
                      }}
                      onMouseDown={(event) => {
                        if (!allowOptionDrag) return
                        event.preventDefault()
                        event.stopPropagation()
                        setBuilderDragState({ kind: 'option', blockId: block.id, optionIndex })
                      }}
                      onMouseEnter={() => {
                        if (!allowOptionDrag || builderDragRef.current?.kind !== 'option') return
                        handleBuilderOptionDragEnter(rowIndex, columnIndex, block, optionIndex)
                      }}
                      onDrop={(event) => {
                        if (!allowOptionDrag) return
                        event.preventDefault()
                        event.stopPropagation()
                        const activeDrag = builderDragRef.current
                        const fromIndex = activeDrag?.kind === 'option' && activeDrag.blockId === block.id
                          ? activeDrag.optionIndex
                          : Number(event.dataTransfer.getData('application/x-grid-option-index'))
                        if (Number.isFinite(fromIndex)) moveGridCellBlockOption(rowIndex, columnIndex, blockIndex, fromIndex, optionIndex)
                        setBuilderDragState(null)
                      }}
                      onDragEnd={() => setBuilderDragState(null)}
                      sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 0.25,
                      borderRadius: '999px',
                      px: isSelected ? 0.5 : 0,
                      border: isSelected ? '1px solid transparent' : 'none',
                      cursor: allowOptionDrag ? 'grab' : 'default',
                      '&:hover': isSelected ? { borderColor: palette.brandBorder, bgcolor: palette.surface } : undefined,
                    }}
                  >
                    {isSelected && <DragIndicatorIcon sx={{ fontSize: 16, color: palette.textFaint }} />}
                    {isSelected && (
                      <Box sx={{ display: 'inline-flex', gap: 0.25 }}>
                        <IconButton
                          size="small"
                          aria-label="Move option left"
                          disabled={optionIndex === 0}
                          onMouseDown={event => event.stopPropagation()}
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            nudgeGridCellBlockOption(rowIndex, columnIndex, blockIndex, optionIndex, -1)
                          }}
                          sx={{ width: 24, height: 24, color: palette.brandDeep }}
                        >
                          <KeyboardArrowLeftIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          aria-label="Move option right"
                          disabled={optionIndex >= options.length - 1}
                          onMouseDown={event => event.stopPropagation()}
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            nudgeGridCellBlockOption(rowIndex, columnIndex, blockIndex, optionIndex, 1)
                          }}
                          sx={{ width: 24, height: 24, color: palette.brandDeep }}
                        >
                          <KeyboardArrowRightIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    )}
                    <FormControlLabel
                      control={<Checkbox disabled size="small" />}
                      label={option || `Option ${optionIndex + 1}`}
                      sx={{ m: 0, '& .MuiFormControlLabel-label': { fontWeight: 800, color: palette.slate600 } }}
                    />
                  </Box>
                ))}
              </Box>
            </Box>,
          )
        })}
      </Box>
    )
  }

  const addBuilderRow = () => {
    setFormBuilderSchema(prev => {
      const grid = prev.custom_grid || createEmptyGrid()
      const insertAfter = selectedBuilderCell?.row ?? grid.cells.length - 1
      const columnCount = Math.max(1, grid.columns || Math.max(...grid.cells.map(row => row.length)))
      const nextRow = Array.from({ length: columnCount }, (_, column) => createGridCell(insertAfter + 1, column))
      const cells = [...grid.cells.slice(0, insertAfter + 1), nextRow, ...grid.cells.slice(insertAfter + 1)]
      return { ...prev, custom_grid: { ...grid, rows: cells.length, columns: columnCount, cells } }
    })
  }

  const addBuilderColumn = () => {
    setFormBuilderSchema(prev => {
      const grid = prev.custom_grid || createEmptyGrid()
      const insertAfter = selectedBuilderCell?.column ?? Math.max(0, grid.columns - 1)
      const cells = grid.cells.map((row, rowIndex) => [
        ...row.slice(0, insertAfter + 1),
        createGridCell(rowIndex, insertAfter + 1),
        ...row.slice(insertAfter + 1),
      ])
      return { ...prev, custom_grid: { ...grid, rows: cells.length, columns: Math.max(...cells.map(row => row.length)), cells } }
    })
  }

  const deleteBuilderRow = () => {
    if (!formBuilderSchema.custom_grid || formBuilderSchema.custom_grid.cells.length <= 1) return toast.error('At least one row is required')
    setFormBuilderSchema(prev => {
      const grid = prev.custom_grid || createEmptyGrid()
      const removeIndex = Math.min(selectedRowIndex, grid.cells.length - 1)
      const cells = grid.cells.filter((_, index) => index !== removeIndex)
      return { ...prev, custom_grid: { ...grid, rows: cells.length, columns: Math.max(...cells.map(row => row.length)), cells } }
    })
    setSelectedBuilderCell(null)
  }

  const deleteBuilderColumn = () => {
    const grid = formBuilderSchema.custom_grid
    if (!grid || Math.max(...grid.cells.map(row => row.length)) <= 1) return toast.error('At least one column is required')
    setFormBuilderSchema(prev => {
      const grid = prev.custom_grid || createEmptyGrid()
      const removeIndex = Math.min(selectedColumnIndex, Math.max(...grid.cells.map(row => row.length)) - 1)
      const cells = grid.cells.map(row => row.filter((_, index) => index !== removeIndex)).filter(row => row.length > 0)
      return { ...prev, custom_grid: { ...grid, rows: cells.length, columns: Math.max(...cells.map(row => row.length)), cells } }
    })
    setSelectedBuilderCell(null)
  }

  const duplicateBuilderRow = () => {
    const grid = formBuilderSchema.custom_grid
    if (!grid) return
    const rowIndex = Math.min(selectedRowIndex, grid.cells.length - 1)
    setFormBuilderSchema(prev => {
      const grid = prev.custom_grid || createEmptyGrid()
      const cloned = grid.cells[rowIndex].map((cell, columnIndex) => ({
        ...cell,
        id: `cell_${rowIndex + 2}_${columnIndex + 1}_${Date.now()}`,
        hidden: false,
        rowSpan: 1,
        colSpan: 1,
      }))
      const cells = [...grid.cells.slice(0, rowIndex + 1), cloned, ...grid.cells.slice(rowIndex + 1)]
      return { ...prev, custom_grid: { ...grid, rows: cells.length, columns: Math.max(...cells.map(row => row.length)), cells } }
    })
  }

  const clearSelectedBuilderCell = () => {
    if (!selectedBuilderCell) return toast.info('Select a table cell first')
    updateGridCell(selectedBuilderCell.row, selectedBuilderCell.column, { label: '', type: 'text', options: undefined, blocks: undefined, rowSpan: 1, colSpan: 1, hidden: false })
  }

  const startGridCellResize = (
    event: MouseEvent<HTMLElement>,
    rowIndex: number,
    columnIndex: number,
    axis: 'width' | 'height',
  ) => {
    event.preventDefault()
    event.stopPropagation()
    const cell = formBuilderSchema.custom_grid?.cells?.[rowIndex]?.[columnIndex]
    if (!cell) return
    const startX = event.clientX
    const startY = event.clientY
    const startWidth = Number(cell.width || 180)
    const startHeight = Number(cell.height || 74)

    const onMove = (moveEvent: globalThis.MouseEvent) => {
      const nextSize = axis === 'width'
        ? Math.max(90, Math.min(720, startWidth + moveEvent.clientX - startX))
        : Math.max(44, Math.min(520, startHeight + moveEvent.clientY - startY))
      updateGridCell(rowIndex, columnIndex, axis === 'width' ? { width: nextSize } : { height: nextSize })
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = axis === 'width' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const splitSelectedBuilderCell = () => {
    if (!selectedBuilderCell || !selectedGridCell) return toast.info('Select a merged cell first')
    const rowSpan = selectedGridCell.rowSpan || 1
    const colSpan = selectedGridCell.colSpan || 1
    setFormBuilderSchema(prev => {
      const grid = prev.custom_grid || createEmptyGrid()
      const cells = grid.cells.map((row, rowIndex) => row.map((cell, columnIndex) => {
        const inMerge = rowIndex >= selectedBuilderCell.row
          && rowIndex < selectedBuilderCell.row + rowSpan
          && columnIndex >= selectedBuilderCell.column
          && columnIndex < selectedBuilderCell.column + colSpan
        if (!inMerge) return cell
        if (rowIndex === selectedBuilderCell.row && columnIndex === selectedBuilderCell.column) {
          return { ...cell, rowSpan: 1, colSpan: 1, hidden: false }
        }
        return { ...cell, hidden: false, rowSpan: 1, colSpan: 1 }
      }))
      return { ...prev, custom_grid: { ...grid, cells } }
    })
  }

  const mergeSelectedBuilderCell = (direction: 'right' | 'down') => {
    if (!selectedBuilderCell || !selectedGridCell) return toast.info('Select a table cell first')
    const grid = formBuilderSchema.custom_grid
    if (!grid) return
    const row = selectedBuilderCell.row
    const column = selectedBuilderCell.column
    const rowSpan = selectedGridCell.rowSpan || 1
    const colSpan = selectedGridCell.colSpan || 1
    const targetRow = direction === 'down' ? row + rowSpan : row
    const targetColumn = direction === 'right' ? column + colSpan : column
    const target = grid.cells[targetRow]?.[targetColumn]
    if (!target || target.hidden) return toast.error(`No visible cell to merge ${direction}`)
    const targetRowSpan = target.rowSpan || 1
    const targetColSpan = target.colSpan || 1
    const mergeRows = direction === 'down'
      ? { start: row + rowSpan, end: row + rowSpan + targetRowSpan }
      : { start: row, end: row + rowSpan }
    const mergeColumns = direction === 'right'
      ? { start: column + colSpan, end: column + colSpan + targetColSpan }
      : { start: column, end: column + colSpan }
    const canMergeRectangle = Array.from({ length: mergeRows.end - mergeRows.start }, (_, rowOffset) => mergeRows.start + rowOffset)
      .every(rowIndex => Array.from({ length: mergeColumns.end - mergeColumns.start }, (_, columnOffset) => mergeColumns.start + columnOffset)
        .every(columnIndex => Boolean(grid.cells[rowIndex]?.[columnIndex])))
    if (!canMergeRectangle) return toast.error('Only a complete rectangular merge is supported')
    setFormBuilderSchema(prev => {
      const grid = prev.custom_grid || createEmptyGrid()
      const cells = grid.cells.map((gridRow, rowIndex) => gridRow.map((cell, columnIndex) => {
        if (rowIndex === row && columnIndex === column) {
          return {
            ...cell,
            rowSpan: direction === 'down' ? rowSpan + targetRowSpan : rowSpan,
            colSpan: direction === 'right' ? colSpan + targetColSpan : colSpan,
          }
        }
        const inMergedRectangle = rowIndex >= mergeRows.start
          && rowIndex < mergeRows.end
          && columnIndex >= mergeColumns.start
          && columnIndex < mergeColumns.end
        if (inMergedRectangle) {
          return { ...cell, hidden: true }
        }
        return cell
      }))
      return { ...prev, custom_grid: { ...grid, cells } }
    })
  }

  const saveFormBuilder = () => {
    const name = formBuilderName.trim()
    if (!name) return toast.error('Form name is required')
    const schema = schemaToPayload({
      ...formBuilderSchema,
      title: name,
      source: 'medrad_grid_form_builder',
      version: 3,
      formio_form: null,
    }, name)
    if (formBuilderMode === 'report-custom') {
      setCustomFormName(name)
      setCustomFormDescription(formBuilderDescription)
      setReportCustomSchema(schema)
      setReport((prev: any) => mergeSchemaDefaultsIntoReport(prev, schema))
      setReportFormSource('custom')
      setFormBuilderOpen(false)
      toast.success('Custom report form updated')
      return
    }
    formBuilderMut.mutate()
  }

  const updateReportGridValue = (cellId: string, value: any) => {
    setReport((prev: any) => ({
      ...prev,
      custom_grid_values: {
        ...(prev?.custom_grid_values || {}),
        [cellId]: value,
      },
    }))
  }

  const applyReportFormSource = (source: ReportFormSource) => {
    setReportFormSource(source)
    if (source === 'default') {
      setSelectedReportFormId(defaultReportForm?.id || reportInspection?.form_template_id || null)
      const base = defaultReportForm ? schemaForForm(defaultReportForm) : null
      setReportCustomSchema(base)
      setReport((prev: any) => mergeSchemaDefaultsIntoReport(prev, base))
      return
    }
    if (source === 'attached') {
      setSelectedReportFormId(reportInspection?.attached_form_id || null)
      const base = reportInspection?.attached_form_schema
        ? normalizeInspectionFormSchema(reportInspection.attached_form_schema, reportInspection.attached_form_name || 'Asset attached form')
        : null
      setReportCustomSchema(base)
      setReport((prev: any) => mergeSchemaDefaultsIntoReport(prev, base))
      return
    }
    if (source === 'existing') {
      const selectedId = selectedReportTemplate?.id || defaultReportForm?.id || inspectionForms[0]?.id || null
      setSelectedReportFormId(selectedId)
      const template = inspectionForms.find(form => form.id === selectedId) || defaultReportForm || inspectionForms[0] || null
      const base = template ? schemaForForm(template) : null
      setReportCustomSchema(base)
      setReport((prev: any) => mergeSchemaDefaultsIntoReport(prev, base))
      return
    }
    setSelectedReportFormId(null)
    const base = reportCustomSchema || (reportInspection?.form_template_schema ? normalizeInspectionFormSchema(reportInspection.form_template_schema, reportInspection.form_template_name || 'Custom form') : activeReportSchema)
    if (base) {
      setReportCustomSchema(base)
      setReport((prev: any) => mergeSchemaDefaultsIntoReport(prev, base))
    }
  }

  const selectedReportFormName = () => {
    if (reportFormSource === 'attached') return reportInspection?.attached_form_name || 'Asset attached form'
    if (reportFormSource === 'existing') return selectedReportTemplate?.name || 'Existing inspection form'
    if (reportFormSource === 'custom') return customFormName || 'Customized form'
    return defaultReportForm?.name || 'Default form'
  }

  const buildReusableFormSchema = (formName: string, currentReport: any) => ({
    title: formName,
    version: currentReport?.formio_form || reportCustomSchema?.formio_form ? 4 : 3,
    source: currentReport?.formio_form || reportCustomSchema?.formio_form ? FORMIO_SCHEMA_SOURCE : 'medrad_grid_form_builder',
    based_on: reportInspection?.form_template_name || defaultReportForm?.name || 'Default inspection report',
    formio_form: currentReport?.formio_form || reportCustomSchema?.formio_form || null,
    custom_grid: currentReport?.custom_grid || reportCustomSchema?.custom_grid || null,
  })

  const submitReport = async () => {
    if (!canEditInspections) return toast.error('You do not have permission to update inspection reports')
    if (!reportInspection || !report) return
    let formTemplateId = selectedReportFormId || reportInspection.form_template_id
    let formTemplateName = selectedReportFormName()
    if (reportFormSource === 'custom' && saveCustomForm) {
      const name = customFormName.trim()
      if (!name) {
        toast.error('Enter a custom form name before saving it for future use')
        return
      }
      try {
        const created = await createInspectionForm({
          name,
          description: customFormDescription.trim() || `Custom inspection form created from ${reportInspection.inspection_number}`,
          modality_id: null,
          schema: schemaToPayload(reportCustomSchema || normalizeInspectionFormSchema(buildReusableFormSchema(name, report), name), name),
        })
        formTemplateId = created.id
        formTemplateName = created.name
        queryClient.invalidateQueries({ queryKey: ['inspection-forms'] })
        toast.success('Custom inspection form saved for future use')
      } catch (e: any) {
        toast.error(e.response?.data?.detail || 'Could not save custom inspection form')
        return
      }
    }
    const normalizedReport = mergeSchemaDefaultsIntoReport(report, activeReportSchema)
    const hasFail = Object.values(normalizedReport.checks || {}).includes('fail')
    const partTotal = (normalizedReport.parts || []).reduce((sum: number, part: any) => sum + Number(part.price || 0), 0)
    const formData = {
      ...normalizedReport,
      form_template: {
        id: formTemplateId,
        name: formTemplateName,
        source: reportFormSource,
        saved_as_template: reportFormSource === 'custom' ? saveCustomForm : true,
        schema: reportFormSource === 'custom'
          ? schemaToPayload(reportCustomSchema || normalizeInspectionFormSchema(buildReusableFormSchema(formTemplateName, normalizedReport), formTemplateName), formTemplateName)
          : activeReportSchema,
      },
    }
    reportMut.mutate({
      id: reportInspection.id,
      data: {
        status: reportStatus,
        result: hasFail ? 'fail' : 'pass',
        form_data: formData,
        form_template_id: formTemplateId,
        corrective_actions: normalizedReport.diagnostics?.corrective_action_taken || '',
        parts_amount: Number(normalizedReport.billing?.parts || partTotal || 0),
        inspection_charge: Number(normalizedReport.billing?.inspection_charges || 0),
        other_charges: Number(normalizedReport.billing?.others || 0),
        notes: `Inspection completed for ${reportInspection.asset_name || reportInspection.inspection_number}`,
      },
    })
  }

  const openAssetActions = (event: MouseEvent<HTMLElement>, asset: Inspection) => {
    setAssetActionAnchor(event.currentTarget)
    setAssetActionItem(asset)
  }

  const closeAssetActions = () => {
    setAssetActionAnchor(null)
    setAssetActionItem(null)
  }

  const openTechnicianDialog = (asset: Inspection) => {
    if (!canEditInspections) return toast.error('You do not have permission to change inspection technicians')
    closeAssetActions()
    setTechEdit(asset)
    setSelectedTechId(asset.inspector_id || '')
  }

  const saveTechnician = () => {
    if (!canEditInspections) return toast.error('You do not have permission to change inspection technicians')
    if (!techEdit) return
    techMut.mutate({ inspectionId: techEdit.id, inspectorId: selectedTechId ? Number(selectedTechId) : null })
  }

  const submitBatchAsset = () => {
    if (!canInitiateInspections) return toast.error('You do not have permission to add assets to inspection batches')
    if (!selectedBatch) return
    if (selectedBatchBillingApproved) return toast.error('Assets cannot be added after the batch invoice is approved for billing')
    if (!batchAssetForm.asset_tag || !batchAssetForm.make || !batchAssetForm.model || !batchAssetForm.serial_number || !batchAssetForm.modality_id) {
      toast.error('Asset #, make, model, serial, and modality are required')
      return
    }
    addBatchAssetMut.mutate({ batchId: selectedBatch.id, data: batchAssetForm })
  }

  const submitExistingBatchAssets = () => {
    if (!canInitiateInspections) return toast.error('You do not have permission to add assets to inspection batches')
    if (!selectedBatch) return
    if (selectedBatchBillingApproved) return toast.error('Assets cannot be added after the batch invoice is approved for billing')
    if (!selectedExistingEquipmentIds.length) {
      toast.error('Select at least one existing asset')
      return
    }
    addBatchExistingAssetsMut.mutate({ batchId: selectedBatch.id, equipmentIds: selectedExistingEquipmentIds })
  }

  const handlePrintReport = (asset: Inspection) => {
    closeAssetActions()
    printInspectionReport(asset)
  }

  const renderKpi = (label: string, value: number, icon: JSX.Element, color: string, targetTab: number) => (
    <Card
      key={label}
      data-no-reveal="true"
      role="button"
      tabIndex={0}
      aria-pressed={tab === targetTab}
      onClick={() => selectTab(targetTab)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          selectTab(targetTab)
        }
      }}
      sx={{
        p: 2.2,
        borderRadius: '18px',
        border: tab === targetTab ? `2px solid ${color}` : `1px solid ${palette.borderSoft}`,
        boxShadow: tab === targetTab ? `0 18px 40px ${color}24` : '0 14px 34px rgba(6,78,59,0.07)',
        cursor: 'pointer',
        transform: tab === targetTab ? 'translateY(-2px)' : 'none',
        transition: 'transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease',
        '&:hover': { transform: 'translateY(-3px)', boxShadow: `0 18px 40px ${color}20` },
        '&:focus-visible': { outline: `3px solid ${color}35`, outlineOffset: 2 },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.4 }}>
        <Avatar sx={{ bgcolor: `${color}18`, color, borderRadius: '14px' }}>{icon}</Avatar>
        <Box>
          <Typography sx={{ color: palette.textMuted, fontSize: 12, fontWeight: 900, textTransform: 'uppercase' }}>{label}</Typography>
          <Typography sx={{ color: palette.ink, fontSize: 28, fontWeight: 900, lineHeight: 1 }}>{typeof value === 'number' ? <AnimatedNumber value={value} /> : value}</Typography>
        </Box>
      </Box>
    </Card>
  )

  const renderPagination = (
    total: number,
    page: number,
    setPage: (page: number) => void,
  ) => (
    <TablePagination
      component="div"
      count={total}
      page={page}
      onPageChange={(_, nextPage) => setPage(nextPage)}
      rowsPerPage={pageSize}
      rowsPerPageOptions={[pageSize]}
      labelDisplayedRows={({ from, to, count }) => `${from}-${to} of ${count}`}
    />
  )

  const renderInspectionRows = (items: Inspection[], loading: boolean, mode: 'progress' | 'completed') => (
    <TableContainer className="list-scroll-panel">
      <Table stickyHeader>
        <TableHead>
          <TableRow sx={{ bgcolor: palette.surfaceFaint }}>
            <TableCell sx={{ fontWeight: 900 }}>Inspection #</TableCell>
            <TableCell sx={{ fontWeight: 900 }}>Facility</TableCell>
            <TableCell sx={{ fontWeight: 900 }}>Asset</TableCell>
            <TableCell sx={{ fontWeight: 900 }}>Tier</TableCell>
            <TableCell sx={{ fontWeight: 900 }}>Result</TableCell>
            <TableCell sx={{ fontWeight: 900 }}>Date</TableCell>
            <TableCell align="right" sx={{ fontWeight: 900 }}>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {loading ? Array.from({ length: 4 }).map((_, i) => (
            <TableRow key={i}><TableCell colSpan={7}><Skeleton /></TableCell></TableRow>
          )) : items.length === 0 ? (
            <TableRow><TableCell colSpan={7} align="center" sx={{ py: 5, color: palette.textMuted, fontWeight: 700 }}>No inspections found.</TableCell></TableRow>
          ) : items.map(item => {
            const resultStyle = statusChip(item.result)
            return (
              <ContextTableRow
                key={item.id}
                recordKey={`inspection-${item.id}`}
                recordLabel={item.inspection_number}
                hover
              >
                <TableCell><ClippedTooltipText value={item.inspection_number} monospace color={palette.brand} fontWeight={900} onClick={() => openInspectionRecord(item, mode)} /></TableCell>
              <TableCell><ClippedTooltipText value={item.facility_name || '-'} fontWeight={700} onClick={item.facility_name ? () => openFacilityFromInspection(item.facility_name) : undefined} /></TableCell>
              <TableCell>
                <ClippedTooltipText value={item.asset_name || item.equipment_name || '-'} fontWeight={800} onClick={() => openInspectionRecord(item, mode)} />
                <ClippedTooltipText value={item.serial_number || item.part_number || '-'} variant="caption" color="#8B95A7" fontWeight={500} onClick={() => openInspectionRecord(item, mode)} />
              </TableCell>
                <TableCell>{item.tier_name || '-'}</TableCell>
                <TableCell><Chip size="small" label={item.result} sx={{ bgcolor: resultStyle.bg, color: resultStyle.color, fontWeight: 900 }} /></TableCell>
                <TableCell>{formatDate(mode === 'progress' ? item.started_at : item.completed_at)}</TableCell>
                <TableCell align="right">
                  {mode === 'progress' && canEditInspections ? (
                    <Button startIcon={<AssignmentTurnedInIcon />} variant="contained" onClick={() => setReportInspection(item)} sx={{ borderRadius: '12px', textTransform: 'none', fontWeight: 900 }}>
                      Fill Report
                    </Button>
                  ) : mode === 'progress' ? (
                    <Chip size="small" label="View only" sx={{ fontWeight: 900 }} />
                  ) : (
                    <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                      <Button size="small" startIcon={<AssessmentIcon />} variant="outlined" onClick={() => setViewReport(item)} sx={{ borderRadius: '12px', textTransform: 'none', fontWeight: 900 }}>
                        Report
                      </Button>
                    </Box>
                  )}
                </TableCell>
              </ContextTableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableContainer>
  )

  const renderBatchRows = (items: InspectionBatch[], loading: boolean, mode: 'progress' | 'completed' = 'progress') => (
    <TableContainer className="list-scroll-panel">
      <Table stickyHeader>
        <TableHead>
          <TableRow sx={{ bgcolor: palette.surfaceFaint }}>
            <TableCell sx={{ fontWeight: 900 }}>Work Order</TableCell>
            <TableCell sx={{ fontWeight: 900 }}>Facility</TableCell>
            <TableCell sx={{ fontWeight: 900 }}>Assets</TableCell>
            <TableCell sx={{ fontWeight: 900 }}>Progress</TableCell>
            <TableCell sx={{ fontWeight: 900 }}>{mode === 'completed' ? 'Completed' : 'Started'}</TableCell>
            <TableCell align="right" sx={{ fontWeight: 900 }}>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {loading ? Array.from({ length: 4 }).map((_, i) => (
            <TableRow key={i}><TableCell colSpan={6}><Skeleton /></TableCell></TableRow>
          )) : items.length === 0 ? (
            <TableRow><TableCell colSpan={6} align="center" sx={{ py: 5, color: palette.textMuted, fontWeight: 700 }}>No {mode === 'completed' ? 'completed' : 'in progress'} inspection batches.</TableCell></TableRow>
          ) : items.map(batch => {
            const done = batch.completed_count || 0
            const total = batch.asset_count || 0
            return (
              <ContextTableRow
                key={batch.id}
                recordKey={`inspection-batch-${batch.id}`}
                recordLabel={batch.batch_number}
                hover
              >
                <TableCell><ClippedTooltipText value={batch.batch_number} monospace color={palette.brand} fontWeight={900} onClick={() => setSelectedBatchId(batch.id)} /></TableCell>
                <TableCell><ClippedTooltipText value={batch.facility_name || '-'} fontWeight={800} onClick={batch.facility_name ? () => openFacilityFromInspection(batch.facility_name) : undefined} /></TableCell>
                <TableCell>
                  <Typography sx={{ fontWeight: 900, color: palette.ink }}>{total} asset{total === 1 ? '' : 's'}</Typography>
                  <Typography sx={{ color: '#8B95A7', fontSize: 12 }}>{batch.inspection_frequency || 'instant'} inspection batch</Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={`${done} completed of ${total}`}
                    sx={{ bgcolor: palette.indigoTint, color: palette.indigo, fontWeight: 900 }}
                  />
                </TableCell>
                <TableCell>{formatDate(mode === 'completed' ? batch.completed_at : (batch.started_at || batch.scheduled_date))}</TableCell>
                <TableCell align="right">
                  <Box sx={{ display: 'flex', gap: 0.75, justifyContent: 'flex-end', alignItems: 'center' }}>
                    {mode === 'completed' && (
                      <>
                        <Tooltip title="Print All Reports">
                          <IconButton
                            size="small"
                            onClick={async () => {
                              try {
                                const detail = await fetchInspectionBatch(batch.id)
                                printBatchReport(detail)
                              } catch { toast.error('Could not load batch') }
                            }}
                            sx={{ bgcolor: palette.indigoTint, color: palette.indigo, '&:hover': { bgcolor: '#E0E7FF' } }}
                          >
                            <AssessmentIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </>
                    )}
                    <Button
                      startIcon={<AssessmentIcon />}
                      variant="contained"
                      onClick={() => setSelectedBatchId(batch.id)}
                      sx={{ borderRadius: '12px', textTransform: 'none', fontWeight: 900 }}
                    >
                      {mode === 'completed' ? 'View' : 'View Batch'}
                    </Button>
                  </Box>
                </TableCell>
              </ContextTableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableContainer>
  )

  const renderUpcomingRows = () => (
    <>
    <TableContainer className="list-scroll-panel">
      <Table stickyHeader sx={{ width: 1360, minWidth: 1360, tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 150 }} />
          <col style={{ width: 220 }} />
          <col style={{ width: 280 }} />
          <col style={{ width: 120 }} />
          <col style={{ width: 130 }} />
          <col style={{ width: 360 }} />
          <col style={{ width: 160 }} />
          <col style={{ width: 140 }} />
        </colgroup>
        <TableHead>
          <TableRow sx={{ bgcolor: palette.surfaceFaint }}>
            <TableCell sx={{ fontWeight: 900 }}>Inspection #</TableCell>
            <TableCell sx={{ fontWeight: 900 }}>Facility</TableCell>
            <TableCell sx={{ fontWeight: 900 }}>Equipment</TableCell>
            <TableCell sx={{ fontWeight: 900 }}>Frequency</TableCell>
            <TableCell sx={{ fontWeight: 900 }}>Criticality</TableCell>
            <TableCell sx={{ fontWeight: 900 }}>Requirement</TableCell>
            <TableCell sx={{ fontWeight: 900 }}>Scheduled</TableCell>
            <TableCell align="right" sx={{ fontWeight: 900 }}>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {upcomingQ.isLoading ? Array.from({ length: 4 }).map((_, i) => (
            <TableRow key={i}><TableCell colSpan={8}><Skeleton /></TableCell></TableRow>
          )) : (upcomingQ.data?.items || []).length === 0 ? (
            <TableRow><TableCell colSpan={8} align="center" sx={{ py: 5, color: palette.textMuted, fontWeight: 700 }}>No upcoming inspections scheduled.</TableCell></TableRow>
          ) : upcomingQ.data!.items.map(item => (
            <ContextTableRow
              key={item.id}
              recordKey={`inspection-${item.id}`}
              recordLabel={item.inspection_number}
              hover
            >
              <TableCell><ClippedTooltipText value={item.inspection_number} monospace color={palette.brand} fontWeight={900} onClick={() => openInspectionInfo(item)} /></TableCell>
              <TableCell><ClippedTooltipText value={item.facility_name || '-'} fontWeight={700} onClick={item.facility_name ? () => openFacilityFromInspection(item.facility_name) : undefined} /></TableCell>
              <TableCell>
                <ClippedTooltipText value={item.asset_name || '-'} fontWeight={800} onClick={() => openInspectionInfo(item)} />
                <ClippedTooltipText value={item.serial_number || '-'} variant="caption" color="#8B95A7" fontWeight={500} onClick={() => openInspectionInfo(item)} />
              </TableCell>
              <TableCell>{(item.inspection_frequency || 'annual').replace('_', '-')}</TableCell>
              <TableCell><Chip size="small" label={item.criticality || 'standard'} sx={{ fontWeight: 900 }} /></TableCell>
              <TableCell sx={{ overflow: 'hidden', maxWidth: 360, pr: 2 }}>
                <ClippedTooltipText value={item.compliance_requirement || '-'} field maxWidth="100%" />
              </TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(item.scheduled_date)}</TableCell>
              <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                {canEditInspections ? (
                  <IconButton
                    size="small"
                    aria-label={`Actions for ${item.inspection_number}`}
                    onClick={(event) => openUpcomingActions(event, item)}
                    sx={{ bgcolor: '#f1fffb', color: palette.brand, '&:hover': { bgcolor: palette.brandSoft } }}
                  >
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                ) : (
                  <Chip size="small" label="View only" sx={{ fontWeight: 900 }} />
                )}
              </TableCell>
            </ContextTableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
    <Menu
      anchorEl={upcomingActionAnchor}
      open={Boolean(upcomingActionAnchor && upcomingActionItem)}
      onClose={closeUpcomingActions}
      PaperProps={{ sx: { borderRadius: '14px', minWidth: 190, boxShadow: palette.shadowMenu } }}
    >
      <MenuItem
        onClick={() => {
          const inspection = upcomingActionItem
          closeUpcomingActions()
          if (inspection) startMut.mutate(inspection.id)
        }}
        disabled={startMut.isPending}
        sx={{ gap: 1.25, fontWeight: 800 }}
      >
        <PlayArrowIcon fontSize="small" sx={{ color: palette.brand }} />
        Start
      </MenuItem>
      <MenuItem
        onClick={() => upcomingActionItem && openRescheduleDialog(upcomingActionItem)}
        sx={{ gap: 1.25, fontWeight: 800 }}
      >
        <EventAvailableIcon fontSize="small" sx={{ color: palette.infoStrong }} />
        Reschedule
      </MenuItem>
      <Divider sx={{ my: 0.5 }} />
      <MenuItem
        onClick={() => {
          const inspection = upcomingActionItem
          closeUpcomingActions()
          if (inspection) setCloseInspectionTarget(inspection)
        }}
        sx={{ gap: 1.25, fontWeight: 800, color: palette.dangerStrong }}
      >
        <CancelIcon fontSize="small" />
        Close inspection
      </MenuItem>
    </Menu>
    </>
  )

  const renderClosedRows = () => (
    <>
      <TableContainer className="list-scroll-panel">
        <Table stickyHeader sx={{ minWidth: 1180, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 155 }} />
            <col style={{ width: 220 }} />
            <col style={{ width: 280 }} />
            <col style={{ width: 150 }} />
            <col style={{ width: 170 }} />
            <col style={{ width: 170 }} />
            <col style={{ width: 120 }} />
          </colgroup>
          <TableHead>
            <TableRow sx={{ bgcolor: palette.surfaceFaint }}>
              <TableCell sx={{ fontWeight: 900 }}>Inspection #</TableCell>
              <TableCell sx={{ fontWeight: 900 }}>Facility</TableCell>
              <TableCell sx={{ fontWeight: 900 }}>Equipment</TableCell>
              <TableCell sx={{ fontWeight: 900 }}>Status</TableCell>
              <TableCell sx={{ fontWeight: 900 }}>Scheduled</TableCell>
              <TableCell sx={{ fontWeight: 900 }}>Closed</TableCell>
              <TableCell align="right" sx={{ fontWeight: 900 }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {closedQ.isLoading ? Array.from({ length: 4 }).map((_, index) => (
              <TableRow key={index}><TableCell colSpan={7}><Skeleton /></TableCell></TableRow>
            )) : (closedQ.data?.items || []).length === 0 ? (
              <TableRow><TableCell colSpan={7} align="center" sx={{ py: 5, color: palette.textMuted, fontWeight: 700 }}>No closed inspections match these filters.</TableCell></TableRow>
            ) : closedQ.data!.items.map(item => (
              <ContextTableRow
                key={item.id}
                recordKey={`inspection-${item.id}`}
                recordLabel={item.inspection_number}
                hover
              >
                <TableCell><ClippedTooltipText value={item.inspection_number} monospace color={palette.brand} fontWeight={900} onClick={() => openInspectionInfo(item)} /></TableCell>
                <TableCell><ClippedTooltipText value={item.facility_name || '-'} fontWeight={700} onClick={item.facility_name ? () => openFacilityFromInspection(item.facility_name) : undefined} /></TableCell>
                <TableCell>
                  <ClippedTooltipText value={item.asset_name || '-'} fontWeight={800} onClick={() => openInspectionInfo(item)} />
                  <ClippedTooltipText value={item.serial_number || '-'} variant="caption" color="#8B95A7" fontWeight={500} onClick={() => openInspectionInfo(item)} />
                </TableCell>
                <TableCell><Chip size="small" label="Closed" sx={{ fontWeight: 900, bgcolor: statusChip('closed').bg, color: statusChip('closed').color }} /></TableCell>
                <TableCell>{formatDate(item.scheduled_date)}</TableCell>
                <TableCell>{formatDate(item.updated_at)}</TableCell>
                <TableCell align="right">
                  {canEditInspections ? (
                    <IconButton
                      size="small"
                      onClick={event => openClosedActions(event, item)}
                      sx={{ bgcolor: '#f1fffb', color: palette.brand, '&:hover': { bgcolor: palette.brandSoft } }}
                    >
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  ) : (
                    <Button size="small" onClick={() => openInspectionInfo(item)} sx={{ fontWeight: 900, textTransform: 'none' }}>View</Button>
                  )}
                </TableCell>
              </ContextTableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Menu
        anchorEl={closedActionAnchor}
        open={Boolean(closedActionAnchor && closedActionItem)}
        onClose={closeClosedActions}
        PaperProps={{ sx: { borderRadius: '14px', minWidth: 190, boxShadow: palette.shadowMenu } }}
      >
        <MenuItem
          onClick={() => {
            const inspection = closedActionItem
            closeClosedActions()
            if (inspection) openInspectionInfo(inspection)
          }}
          sx={{ gap: 1.25, fontWeight: 800 }}
        >
          <VisibilityOutlinedIcon fontSize="small" sx={{ color: palette.infoStrong }} />
          View
        </MenuItem>
        <MenuItem
          onClick={() => {
            const inspection = closedActionItem
            closeClosedActions()
            if (inspection) setReopenInspectionTarget(inspection)
          }}
          sx={{ gap: 1.25, fontWeight: 800 }}
        >
          <EventAvailableIcon fontSize="small" sx={{ color: palette.brandStrong }} />
          Reopen
        </MenuItem>
        <MenuItem
          onClick={() => {
            const inspection = closedActionItem
            closeClosedActions()
            if (inspection) openRescheduleDialog(inspection)
          }}
          sx={{ gap: 1.25, fontWeight: 800 }}
        >
          <EditIcon fontSize="small" sx={{ color: palette.brand }} />
          Reschedule & reopen
        </MenuItem>
      </Menu>
    </>
  )

  // Overall live-report status: 'fail' if any pass/fail field is set to fail,
  // 'pass' only when every pass/fail field is answered and none failed,
  // 'pending' while pass/fail questions are still unanswered.
  const computeLiveReportStatus = (): 'pass' | 'fail' | 'pending' | null => {
    if (!report) return null
    let hasFail = false
    let hasPending = false

    // options === undefined means the field is a known pass/fail field (checks, measurements).
    // For option-based fields we only count them when a "Fail" choice exists.
    const consider = (value: unknown, options?: string[]) => {
      if (options && !options.some(opt => opt.trim().toLowerCase() === 'fail')) return
      const v = String(value ?? '').trim().toLowerCase()
      if (!v) { hasPending = true; return }
      if (v === 'fail') hasFail = true
    }

    Object.values((report.checks || {}) as Record<string, string>).forEach(v => consider(v))
    ;(report.measurements || []).forEach((m: any) => consider(m?.status))

    const canvas = activeReportSchema?.canvas_form
    if (canvas?.elements?.length) {
      canvas.elements.forEach(el => {
        if (el.type !== 'radio') return
        consider(canvasFormValues[el.id], el.options?.length ? el.options : [])
      })
    } else {
      const grid = activeReportSchema?.custom_grid || report?.custom_grid
      if (grid && !activeReportSchema?.formio_form && !report?.formio_form) {
        const values = report?.custom_grid_values || {}
        grid.cells.flat().forEach((cell: GridCellSchema) => {
          if (cell.hidden) return
          if (cell.blocks?.length) {
            cell.blocks.forEach((block: GridCellBlock) => {
              if (block.type !== 'radio') return
              consider(values[gridCellBlockValueKey(cell, block)], block.options?.length ? block.options : [])
            })
          } else if (cell.type === 'radio') {
            consider(values[cell.id], cell.options?.length ? cell.options : [])
          }
        })
      }
    }

    if (hasFail) return 'fail'
    if (hasPending) return 'pending'
    return 'pass'
  }

  const renderLiveReportStatusChip = () => {
    const status = computeLiveReportStatus()
    if (!status) return null
    const config = status === 'fail'
      ? { label: 'FAIL', bgcolor: palette.dangerStrong, icon: <CancelIcon sx={{ fontSize: 18, color: '#fff !important' }} /> }
      : status === 'pass'
        ? { label: 'PASS', bgcolor: palette.brand, icon: <CheckCircleIcon sx={{ fontSize: 18, color: '#fff !important' }} /> }
        : { label: 'IN PROGRESS', bgcolor: palette.textFaint, icon: undefined }
    return (
      <Chip
        icon={config.icon}
        label={config.label}
        sx={{
          bgcolor: config.bgcolor,
          color: '#fff',
          fontWeight: 900,
          letterSpacing: '0.5px',
          px: 0.5,
          '& .MuiChip-icon': { color: '#fff' },
        }}
      />
    )
  }

  const renderFixedInspectionTable = () => {
    const leftChecks = ['physical_inspection', 'display', 'functional', 'electrical_safety', 'battery', 'pm_kit'].map(key => [key, CHECK_FIELD_LABELS[key]] as [string, string])
    const rightChecks = ['cleaning', 'lubrication', 'calibration'].map(key => [key, CHECK_FIELD_LABELS[key]] as [string, string])
    const maxRows = 6
    return (
      <Card sx={{ p: 2, borderRadius: '16px', border: `1px solid ${palette.borderSoft}`, boxShadow: 'none' }}>
        <Typography sx={{ fontWeight: 900, color: palette.ink, mb: 1.5 }}>Inspection Report</Typography>
        <TableContainer sx={{ border: '1px solid #D8DEE9', borderRadius: '10px' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                {['Test', 'Pass', 'Fail', 'N/A', 'Test', 'Pass', 'Fail', 'N/A'].map(header => (
                  <TableCell key={header} align="center" sx={{ fontWeight: 900 }}>{header}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {Array.from({ length: maxRows }).map((_, index) => {
                const left = leftChecks[index]
                const right = rightChecks[index]
                return (
                  <TableRow key={index} sx={{ bgcolor: index % 2 ? '#fff' : palette.surfaceGray }}>
                    <TableCell align="center">{left?.[1] || ''}</TableCell>
                    {['pass', 'fail', 'na'].map(value => (
                      <TableCell key={`left-${value}`} align="center">
                        {left && <Radio checked={report.checks?.[left[0]] === value} onChange={() => updateReport('checks', left[0], value)} size="small" />}
                      </TableCell>
                    ))}
                    <TableCell align="center">
                      {right?.[1] || (index === 3 ? 'Set:' : index === 4 || index === 5 ? 'Replaced on' : '')}
                    </TableCell>
                    {right ? ['pass', 'fail', 'na'].map(value => (
                      <TableCell key={`right-${value}`} align="center">
                        <Radio checked={report.checks?.[right[0]] === value} onChange={() => updateReport('checks', right[0], value)} size="small" />
                      </TableCell>
                    )) : (
                      <>
                        <TableCell align="center">
                          {index >= 3 && (
                            <TextField size="small" value={report.measurements?.[index - 3]?.set_value || ''} onChange={e => updateArrayReport('measurements', index - 3, 'set_value', e.target.value)} />
                          )}
                        </TableCell>
                        <TableCell align="center">{index === 3 ? 'Read:' : index === 4 || index === 5 ? 'Due' : ''}</TableCell>
                        <TableCell align="center">
                          {index >= 3 && (
                            <TextField size="small" value={report.measurements?.[index - 3]?.read_value || ''} onChange={e => updateArrayReport('measurements', index - 3, 'read_value', e.target.value)} />
                          )}
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
    )
  }

  const renderCustomGridCellBlocks = (cell: GridCellSchema, values: Record<string, any>, readOnly = false) => (
    <Box sx={{ display: 'grid', gap: 1, width: '100%', textAlign: cell.align || 'left' }}>
      {shouldShowGridCellTitle(cell) && (
        <Typography sx={{ fontWeight: 900, color: palette.ink, textAlign: cell.align || 'left' }}>{cell.label}</Typography>
      )}
      {(cell.blocks || []).map((block, blockIndex) => {
        const key = gridCellBlockValueKey(cell, block)
        if (block.type === 'label') {
          return (
            <Typography key={block.id} sx={{ fontWeight: 900, color: palette.slate600, textAlign: cell.align || 'left' }}>
              {block.label || `Label ${blockIndex + 1}`}
            </Typography>
          )
        }
        if (block.type === 'input') {
          const isInline = block.layout ? block.layout === 'inline' : Boolean(block.inline)
          return (
            <Box key={block.id} sx={{ display: isInline ? 'grid' : 'block', gridTemplateColumns: isInline ? 'auto minmax(80px, 1fr)' : undefined, gap: 1, alignItems: 'center', width: '100%', maxWidth: block.width || 180 }}>
              {block.label?.trim() && <Typography sx={{ fontWeight: 900, color: palette.slate600, whiteSpace: 'nowrap' }}>{block.label}</Typography>}
              <TextField
                disabled={readOnly}
                size="small"
                fullWidth
                value={values[key] || ''}
                onChange={e => updateReportGridValue(key, e.target.value)}
                sx={{ '& .MuiInputBase-root': { height: block.height || 40 } }}
              />
            </Box>
          )
        }
        if (block.type === 'textarea') {
          return (
            <Box key={block.id} sx={{ display: 'grid', gap: 0.75, width: '100%', maxWidth: block.width || 220 }}>
              {block.label?.trim() && <Typography sx={{ fontWeight: 900, color: palette.slate600 }}>{block.label}</Typography>}
              <TextField
                disabled={readOnly}
                size="small"
                fullWidth
                multiline
                value={values[key] || ''}
                onChange={e => updateReportGridValue(key, e.target.value)}
                sx={{ '& .MuiInputBase-root': { height: block.height || 90, alignItems: 'flex-start' } }}
              />
            </Box>
          )
        }
        if (block.type === 'radio') {
          const options = block.options?.length ? block.options : ['Option']
          return (
            <Box key={block.id} sx={{ display: 'grid', gap: 0.5 }}>
              {block.label?.trim() && <Typography sx={{ fontWeight: 900, color: palette.slate600 }}>{block.label}</Typography>}
              <RadioGroup
                row={normalizeGridOptionLayout(block.optionLayout) !== 'vertical'}
                value={values[key] || ''}
                onChange={e => updateReportGridValue(key, e.target.value)}
                sx={gridOptionContainerSx(block.optionLayout, cell.align)}
              >
                {options.map((option, optionIndex) => (
                  <FormControlLabel
                    key={`${block.id}-radio-${optionIndex}`}
                    value={option || `Option ${optionIndex + 1}`}
                    control={<Radio disabled={readOnly} size="small" />}
                    label={option || `Option ${optionIndex + 1}`}
                  />
                ))}
              </RadioGroup>
            </Box>
          )
        }
        const options = block.options?.length ? block.options : ['Option']
        return (
          <Box key={block.id} sx={{ display: 'grid', gap: 0.5 }}>
            {block.label?.trim() && <Typography sx={{ fontWeight: 900, color: palette.slate600 }}>{block.label}</Typography>}
            <Box sx={gridOptionContainerSx(block.optionLayout, cell.align)}>
              {options.map((option, optionIndex) => {
                const optionKey = gridCellBlockValueKey(cell, block, optionIndex)
                return (
                  <FormControlLabel
                    key={optionKey}
                    control={
                      <Checkbox
                        disabled={readOnly}
                        size="small"
                        checked={Boolean(values[optionKey])}
                        onChange={e => updateReportGridValue(optionKey, e.target.checked)}
                      />
                    }
                    label={option || `Option ${optionIndex + 1}`}
                  />
                )
              })}
            </Box>
          </Box>
        )
      })}
    </Box>
  )

  const renderCustomGridReport = () => {
    const grid = activeReportSchema?.custom_grid || report?.custom_grid
    if (!grid) return null
    const values = report?.custom_grid_values || {}
    const title = activeReportSchema?.title || report?.form_template?.name || selectedReportFormName()
    return (
      <Card sx={{ p: 2, borderRadius: '16px', border: `1px solid ${palette.brandSoft}`, boxShadow: 'none' }}>
        <Typography sx={{ fontWeight: 900, color: palette.ink }}>{title || 'Custom Inspection Form'}</Typography>
        <Typography sx={{ fontWeight: 900, color: palette.indigo, mb: 1.5, mt: 1 }}>{grid.title || 'Set Title'}</Typography>
        <TableContainer sx={{ border: '1px solid #D8DEE9', borderRadius: '10px' }}>
          <Table size="small">
            <TableBody>
              {grid.cells.map((row: GridCellSchema[], rowIndex: number) => (
                <TableRow key={rowIndex} sx={{ bgcolor: rowIndex % 2 ? '#fff' : palette.surfaceGray }}>
                  {row.map((cell: GridCellSchema) => cell.hidden ? null : (
                    <TableCell
                      key={cell.id}
                      align={cell.align || 'center'}
                      colSpan={cell.colSpan || 1}
                      rowSpan={cell.rowSpan || 1}
                      sx={{
                        minWidth: cell.width || 180,
                        width: cell.width || 180,
                        height: cell.height || 74,
                        verticalAlign: cell.verticalAlign || 'middle',
                      }}
                    >
                      <Box
                        sx={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 0.75,
                          minHeight: Math.max(44, Number(cell.height || 74)) - 16,
                          alignItems: gridAlignItems(cell.align),
                          justifyContent: gridJustifyContent(cell.verticalAlign),
                          textAlign: cell.align || 'center',
                        }}
                      >
                        {cell.blocks?.length ? renderCustomGridCellBlocks(cell, values) : (
                          <>
                            {shouldShowGridCellTitle(cell) && (
                              <Typography sx={{ fontWeight: 900, color: palette.ink, textAlign: cell.align || 'center' }}>{cell.label}</Typography>
                            )}
                            {cell.type === 'text' ? null : cell.type === 'input' ? (
                          <TextField size="small" fullWidth value={values[cell.id] || ''} onChange={e => updateReportGridValue(cell.id, e.target.value)} />
                        ) : cell.type === 'radio' ? (
                          <RadioGroup row value={values[cell.id] || ''} onChange={e => updateReportGridValue(cell.id, e.target.value)} sx={{ justifyContent: gridAlignItems(cell.align) }}>
                            {(cell.options?.length ? cell.options : DEFAULT_GRID_OPTIONS).map((option: string) => (
                              <FormControlLabel key={option} value={option} control={<Radio size="small" />} label={option} />
                            ))}
                          </RadioGroup>
                        ) : cell.options?.length ? (
                          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: gridAlignItems(cell.align) }}>
                            {cell.options.map((option: string) => (
                              <FormControlLabel
                                key={option}
                                control={
                                  <Checkbox
                                    size="small"
                                    checked={isCheckboxOptionChecked(values[cell.id], option)}
                                    onChange={e => updateReportGridValue(cell.id, toggleCheckboxOptionValue(values[cell.id], option, e.target.checked))}
                                  />
                                }
                                label={option}
                              />
                            ))}
                          </Box>
                        ) : (
                          <Checkbox
                            size="small"
                            checked={Boolean(values[cell.id])}
                            onChange={e => updateReportGridValue(cell.id, e.target.checked)}
                          />
                        )}
                          </>
                        )}
                      </Box>
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
    )
  }

  const renderFormioReport = () => {
    const formioForm = activeReportSchema?.formio_form || report?.formio_form
    if (!formioForm?.components) return null
    return (
      <Card sx={{ p: 2, borderRadius: '16px', border: `1px solid ${palette.brandSoft}`, boxShadow: 'none' }}>
        <Typography sx={{ fontWeight: 900, color: palette.ink, mb: 1.5 }}>
          {formioForm.title || activeReportSchema?.title || 'Custom Inspection Form'}
        </Typography>
        <Typography sx={{ color: palette.textMuted, fontWeight: 800 }}>
          This form was created with the temporary Form.io builder. Please recreate it with the custom grid builder before using it for reports.
        </Typography>
      </Card>
    )
  }

  const renderBiomedNotes = () => (
    <Card sx={{ p: 2, borderRadius: '16px', border: `1px solid ${palette.borderSoft}`, boxShadow: 'none' }}>
      <Typography sx={{ fontWeight: 900, color: palette.ink, mb: 1.5 }}>Biomed Notes</Typography>
      <TableContainer sx={{ border: '1px solid #D8DEE9', borderRadius: '10px' }}>
        <Table size="small">
          <TableBody>
            {[
              ['reported_problem', 'Reported Problem'],
              ['problem_found', 'Problem Found'],
              ['corrective_action_taken', 'Corrective action taken'],
              ['summary', 'Summary'],
            ].map(([key, label]) => (
              <TableRow key={key}>
                <TableCell sx={{ width: 280, fontWeight: 900 }}>{label}</TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    fullWidth
                    value={report.diagnostics?.[key] || ''}
                    onChange={e => updateReport('diagnostics', key, e.target.value)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Card>
  )

  const renderDefaultReportCore = () => (
    <>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(4, 1fr)' }, gap: 2 }}>
        {Object.entries(report.identity || {}).map(([key, value]) => (
          <TextField key={key} label={labelFromKey(key)} value={value as string} onChange={e => updateReport('identity', key, e.target.value)} size="small" />
        ))}
      </Box>
      <Divider />
      <Typography sx={{ fontWeight: 900, color: palette.ink }}>Checks</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 2 }}>
        {CHECK_FIELDS.map(([key, label]) => (
          <Card key={key} sx={{ p: 1.5, borderRadius: '14px', border: `1px solid ${palette.borderSoft}`, boxShadow: 'none' }}>
            <Typography sx={{ color: palette.ink, fontWeight: 900, fontSize: 13, mb: 0.5 }}>{label}</Typography>
            <RadioGroup row value={report.checks?.[key] || 'pass'} onChange={e => updateReport('checks', key, e.target.value)}>
              <FormControlLabel value="pass" control={<Radio size="small" />} label="Pass" />
              <FormControlLabel value="fail" control={<Radio size="small" />} label="Fail" />
              <FormControlLabel value="na" control={<Radio size="small" />} label="N/A" />
            </RadioGroup>
          </Card>
        ))}
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' }, gap: 2 }}>
        {Object.entries(report.diagnostics || {}).map(([key, value]) => (
          <TextField key={key} label={labelFromKey(key)} value={value as string} onChange={e => updateReport('diagnostics', key, e.target.value)} multiline rows={key === 'summary' ? 3 : 2} />
        ))}
      </Box>
    </>
  )

  const renderCanvasReport = () => {
    const canvas = activeReportSchema?.canvas_form
    if (!canvas?.elements?.length) return null
    const title = activeReportSchema?.title || selectedReportFormName()
    return (
      <Card sx={{ p: 2, borderRadius: '16px', border: `1px solid ${palette.brandSoft}`, boxShadow: 'none' }}>
        <Typography sx={{ fontWeight: 900, color: palette.ink, mb: 1.5 }}>{title || 'Custom Inspection Form'}</Typography>
        <Box sx={{ overflowX: 'auto' }}>
          <CanvasFormViewer
            schema={canvas}
            values={canvasFormValues}
            onChange={setCanvasFormValues}
          />
        </Box>
      </Card>
    )
  }

  const isCustomGridReport = () => Boolean(activeReportSchema?.canvas_form?.elements?.length || activeReportSchema?.custom_grid || activeReportSchema?.formio_form || report?.custom_grid || report?.formio_form)
    || (reportFormSource === 'attached' && Boolean(activeReportSchema?.custom_grid))
    || (reportFormSource === 'existing' && Boolean(activeReportSchema?.custom_grid))

  return (
    <Box className="page-enter" sx={{ maxWidth: 1440, mx: 'auto' }}>
      <Card sx={{ p: 3, mb: 3, borderRadius: '24px', border: '1px solid #E6E8F2', background: 'linear-gradient(135deg, #F8FAFF 0%, #ECFDF5 100%)', boxShadow: '0 18px 45px rgba(6,78,59,0.08)' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
          <Box>
            <Typography variant="h4" sx={{ color: palette.ink, fontWeight: 900 }}>Inspection Module</Typography>
            <Typography sx={{ color: palette.textMuted, fontWeight: 700 }}>Schedule equipment compliance inspections, initiate on-demand checks, complete technician reports, and prepare billing.</Typography>
          </Box>
          <Avatar sx={{ bgcolor: palette.brandTint, color: palette.brand, width: 58, height: 58, borderRadius: '18px' }}><AssignmentTurnedInIcon /></Avatar>
        </Box>
      </Card>

      <Card sx={{ p: 2, mb: 2.5, borderRadius: '20px', border: `1px solid ${palette.borderSoft}`, boxShadow: '0 12px 30px rgba(6,78,59,0.06)' }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            label="From"
            type="date"
            value={dateFrom}
            onChange={(event) => changeDateFilter('date_from', event.target.value)}
            InputLabelProps={{ shrink: true }}
            inputProps={{ max: dateTo || undefined }}
            error={invalidDateRange}
            sx={{ width: { xs: '100%', sm: 180 }, '& .MuiOutlinedInput-root': { borderRadius: '14px' } }}
          />
          <TextField
            size="small"
            label="To"
            type="date"
            value={dateTo}
            onChange={(event) => changeDateFilter('date_to', event.target.value)}
            InputLabelProps={{ shrink: true }}
            inputProps={{ min: dateFrom || undefined }}
            error={invalidDateRange}
            helperText={invalidDateRange ? 'To date must be on or after From date.' : undefined}
            sx={{ width: { xs: '100%', sm: 220 }, '& .MuiOutlinedInput-root': { borderRadius: '14px' } }}
          />
          {(dateFrom || dateTo) && (
            <Button onClick={clearDateFilters} variant="text" sx={{ minHeight: 40, borderRadius: '12px', fontWeight: 900, textTransform: 'none' }}>
              Clear Dates
            </Button>
          )}
          <Typography sx={{ color: palette.textMuted, fontSize: 12, fontWeight: 700, alignSelf: 'center', ml: { md: 'auto' } }}>
            Dates filter inspection totals and the active inspection list without changing asset scheduling.
          </Typography>
        </Box>
      </Card>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' }, gap: 2, mb: 3 }}>
        {renderKpi('Upcoming', stats.upcoming, <EventAvailableIcon />, palette.infoStrong, 0)}
        {renderKpi('Assets', stats.instantItems, <BoltIcon />, palette.brand, 1)}
        {renderKpi('In Progress', stats.inProgress, <BuildIcon />, palette.warningBright, 2)}
        {renderKpi('Completed', stats.completed, <CheckCircleIcon />, palette.brandStrong, 3)}
      </Box>

      <Card sx={{ borderRadius: '24px', overflow: 'hidden', border: `1px solid ${palette.borderSoft}`, boxShadow: '0 18px 45px rgba(6,78,59,0.08)' }}>
        <Tabs value={tab} onChange={(_, v) => selectTab(v)} variant="scrollable" sx={{ px: 2, borderBottom: `1px solid ${palette.borderSoft}` }}>
          <Tab value={0} icon={<EventAvailableIcon />} iconPosition="start" label="Upcoming" />
          <Tab value={1} icon={<BoltIcon />} iconPosition="start" label="Instant Inspection" />
          <Tab value={2} icon={<BuildIcon />} iconPosition="start" label="In Progress" />
          <Tab value={3} icon={<CheckCircleIcon />} iconPosition="start" label="Completed" />
          <Tab value={5} icon={<CancelIcon />} iconPosition="start" label="Closed" />
          <Tab value={4} icon={<AssignmentTurnedInIcon />} iconPosition="start" label="Inspection Forms" />
        </Tabs>

        {tab === 0 && (
          <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 180px 180px auto auto' }, gap: 2, alignItems: 'center', mb: 3 }}>
              <SearchableSelect<number>
                label="Facility"
                value={facilityId}
                onChange={(nextFacilityId) => {
                  setFacilityId(nextFacilityId)
                  setSelectedInstantEquipmentIds([])
                  setSelectedEquipmentIds([])
                  setScheduleAssetSearch('')
                  setDebouncedScheduleAssetSearch('')
                }}
                loading={facilitiesQ.isLoading}
                options={facilityOptions.map(facility => ({
                  value: facility.id,
                  label: facility.name,
                  secondary: `#${facility.id} · ${facility.tier_name || 'No tier'} · ${facility.inventory_count} asset(s)`,
                  keywords: `${facility.id} ${facility.tier_name || ''}`,
                }))}
                placeholder="Search facility name, tier, or ID"
                noOptionsText="No matching facilities available"
              />
              <TextField select label="Frequency" value={frequency} onChange={e => setFrequency(e.target.value as InspectionFrequency)}>
                <MenuItem value="quarterly">Quarterly</MenuItem>
                <MenuItem value="semi_annual">Semi-Annual</MenuItem>
                <MenuItem value="annual">Annual</MenuItem>
              </TextField>
              <TextField label="Schedule Date" type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} InputLabelProps={{ shrink: true }} />
              <Button startIcon={<EventAvailableIcon />} variant="outlined" onClick={scheduleSelected} disabled={!canAddInspections || !facilityId || !selectedEquipmentIds.length || scheduleMut.isPending} sx={{ height: 54, borderRadius: '14px', fontWeight: 900, textTransform: 'none' }}>
                Schedule Selected
              </Button>
              <Button startIcon={<AutoFixHighIcon />} variant="contained" disabled={!canAddInspections || generateMut.isPending} onClick={() => {
                if (!canAddInspections) return toast.error('You do not have permission to auto-generate inspections')
                generateMut.mutate({ facility_id: facilityId ? Number(facilityId) : undefined, days_ahead: 90 })
              }} sx={{ height: 54, borderRadius: '14px', fontWeight: 900, textTransform: 'none' }}>
                Auto Generate
              </Button>
            </Box>
            {facilityId && (
              <Box sx={{ mb: 3 }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '190px minmax(0, 1fr)' }, gap: 1.5, mb: 1.5 }}>
                  <SearchFieldSelect
                    value={scheduleAssetSearchField}
                    options={INSPECTION_ASSET_SEARCH_FIELDS}
                    onChange={setScheduleAssetSearchField}
                    ariaLabel="Scheduled asset search field"
                  />
                  <TextField
                    label="Search assets to schedule"
                    placeholder={`Search ${INSPECTION_ASSET_SEARCH_FIELDS.find((field) => field.value === scheduleAssetSearchField)?.label.toLowerCase() || 'assets'}...`}
                    value={scheduleAssetSearch}
                    onChange={event => setScheduleAssetSearch(event.target.value)}
                    fullWidth
                  />
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 1.5 }}>
                  <Typography sx={{ color: palette.textMuted, fontWeight: 800 }}>
                    {selectedEquipmentIds.length} of {equipment.length} asset{equipment.length === 1 ? '' : 's'} selected for scheduling.
                  </Typography>
                  <Button
                    size="small"
                    variant={allScheduleEquipmentSelected ? 'outlined' : 'contained'}
                    onClick={toggleAllEquipment}
                    disabled={equipmentQ.isLoading || equipment.length === 0}
                    sx={{ borderRadius: '12px', textTransform: 'none', fontWeight: 900 }}
                  >
                    {allScheduleEquipmentSelected ? 'Clear Selection' : 'Select All Assets'}
                  </Button>
                </Box>
                <TableContainer className="list-scroll-panel" sx={{ border: `1px solid ${palette.borderSoft}`, borderRadius: '18px' }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow sx={{ bgcolor: palette.surfaceFaint }}>
                        <TableCell padding="checkbox" />
                        <TableCell sx={{ fontWeight: 900 }}>Asset Tag</TableCell>
                        <TableCell sx={{ fontWeight: 900 }}>Equipment</TableCell>
                        <TableCell sx={{ fontWeight: 900 }}>Modality</TableCell>
                        <TableCell sx={{ fontWeight: 900 }}>Criticality</TableCell>
                        <TableCell sx={{ fontWeight: 900 }}>Serial #</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {equipmentQ.isLoading ? <TableRow><TableCell colSpan={6}><Skeleton /></TableCell></TableRow> : equipment.length === 0 ? (
                        <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4, color: palette.textMuted, fontWeight: 700 }}>No facility inventory found for scheduling.</TableCell></TableRow>
                      ) : equipment.map((item: InspectionEquipmentItem) => (
                        <ContextTableRow
                          key={item.id}
                          recordKey={`inspection-asset-${item.id}`}
                          recordLabel={item.asset_tag}
                          contextSelected={selectedEquipmentIds.includes(item.id)}
                          hover
                          onClick={() => toggleEquipment(item.id)}
                          sx={{ cursor: 'pointer' }}
                        >
                          <TableCell padding="checkbox"><Checkbox checked={selectedEquipmentIds.includes(item.id)} /></TableCell>
                          <TableCell sx={{ fontFamily: 'monospace', color: palette.brand, fontWeight: 900 }}>{item.asset_tag}</TableCell>
                          <TableCell><ClippedTooltipText value={`${item.make} ${item.model}`} /></TableCell>
                          <TableCell>{item.modality_name || '-'}</TableCell>
                          <TableCell>{item.criticality}</TableCell>
                          <TableCell><ClippedTooltipText value={item.serial_number} /></TableCell>
                        </ContextTableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}
            <Card sx={{ p: 2, mb: 2, borderRadius: '18px', border: `1px solid ${palette.borderSoft}`, boxShadow: 'none' }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '180px minmax(0, 1fr) 220px' }, gap: 2, alignItems: 'center' }}>
                <SearchFieldSelect
                  value={upcomingSearchField}
                  options={INSPECTION_SEARCH_FIELDS}
                  onChange={setUpcomingSearchField}
                  ariaLabel="Upcoming inspection search field"
                />
                <DebouncedSearchField
                  key={`upcoming-${activitySearch}-${searchResetSeed}`}
                  defaultValue={activitySearch}
                  onDebouncedChange={setDebouncedUpcomingSearch}
                  label="Search upcoming inspections"
                  placeholder={`Search ${INSPECTION_SEARCH_FIELDS.find((field) => field.value === upcomingSearchField)?.label.toLowerCase() || 'inspections'}...`}
                  fullWidth
                />
                <TextField
                  select
                  label="Due within"
                  value={upcomingRange}
                  onChange={e => setUpcomingRange(e.target.value as UpcomingDateRange)}
                  disabled={Boolean(dateFrom || dateTo)}
                >
                  {UPCOMING_DATE_RANGES.map(option => (
                    <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                  ))}
                </TextField>
              </Box>
              <Typography sx={{ color: palette.textMuted, fontSize: 12, fontWeight: 700, mt: 1 }}>
                {dateFrom || dateTo
                  ? `Showing inspections${dateFrom ? ` from ${formatDate(dateFrom)}` : ''}${dateTo ? ` through ${formatDate(dateTo)}` : ''}. Clear the module dates to use Due within.`
                  : `Showing inspections scheduled from ${formatDate(upcomingWindow.date_from)} to ${formatDate(upcomingWindow.date_to)}.`}
              </Typography>
            </Card>
            {renderUpcomingRows()}
            {renderPagination(upcomingQ.data?.total || 0, upcomingPage, setUpcomingPage)}
          </Box>
        )}

        {tab === 1 && (
          <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr auto' }, gap: 2, alignItems: 'center', mb: 3 }}>
              <SearchableSelect<number>
                label="Facility"
                value={facilityId}
                onChange={(nextFacilityId) => {
                  setFacilityId(nextFacilityId)
                  setSelectedInstantEquipmentIds([])
                  setSelectedEquipmentIds([])
                  setInstantAssetSearch('')
                  setDebouncedInstantAssetSearch('')
                }}
                loading={facilitiesQ.isLoading}
                options={facilityOptions.map(facility => ({
                  value: facility.id,
                  label: facility.name,
                  secondary: `#${facility.id} · ${facility.tier_name || 'No tier'} · ${facility.inventory_count} asset(s)`,
                  keywords: `${facility.id} ${facility.tier_name || ''}`,
                }))}
                placeholder="Search facility name, tier, or ID"
                noOptionsText="No matching facilities available"
              />
              <TextField select label="Frequency" value={frequency} onChange={e => setFrequency(e.target.value as InspectionFrequency)} sx={{ minWidth: 180 }}>
                <MenuItem value="instant">Instant</MenuItem>
                <MenuItem value="quarterly">Quarterly</MenuItem>
                <MenuItem value="semi_annual">Semi-Annual</MenuItem>
                <MenuItem value="annual">Annual</MenuItem>
              </TextField>
              <Button
                startIcon={createMut.isPending ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : <PlayArrowIcon />}
                variant="contained"
                onClick={startInspection}
                disabled={!canInitiateInspections || !facilityId || !selectedInstantEquipmentIds.length || createMut.isPending}
                sx={{ height: 54, borderRadius: '14px', px: 3, fontWeight: 900, textTransform: 'none', background: palette.gradientBrand }}
              >
                Start Selected Inspection{selectedInstantEquipmentIds.length === 1 ? '' : 's'}
              </Button>
            </Box>
            {selectedFacility && (
              <Box sx={{ mb: 2 }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '190px minmax(0, 1fr)' }, gap: 1.5, mb: 1.5 }}>
                  <SearchFieldSelect
                    value={instantAssetSearchField}
                    options={INSPECTION_ASSET_SEARCH_FIELDS}
                    onChange={setInstantAssetSearchField}
                    ariaLabel="Instant inspection asset search field"
                  />
                  <TextField
                    label="Search facility assets"
                    placeholder={`Search ${INSPECTION_ASSET_SEARCH_FIELDS.find((field) => field.value === instantAssetSearchField)?.label.toLowerCase() || 'assets'}...`}
                    value={instantAssetSearch}
                    onChange={event => setInstantAssetSearch(event.target.value)}
                    fullWidth
                  />
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                  <Typography sx={{ color: palette.textMuted, fontWeight: 800 }}>
                    {selectedFacility.name}: {selectedInstantEquipmentIds.length} selected; {equipment.length} matching asset{equipment.length === 1 ? '' : 's'} shown.
                  </Typography>
                  <Button
                    size="small"
                    variant={allInstantEquipmentSelected ? 'outlined' : 'contained'}
                    onClick={toggleAllInstantEquipment}
                    disabled={equipmentQ.isLoading || equipment.length === 0}
                    sx={{ borderRadius: '12px', textTransform: 'none', fontWeight: 900 }}
                  >
                    {allInstantEquipmentSelected ? 'Clear Shown Selection' : 'Select All Shown Assets'}
                  </Button>
                </Box>
              </Box>
            )}
            <TableContainer className="list-scroll-panel">
              <Table stickyHeader>
                <TableHead>
                  <TableRow sx={{ bgcolor: palette.surfaceFaint }}>
                    <TableCell padding="checkbox" />
                    <TableCell sx={{ fontWeight: 900 }}>Asset Tag</TableCell>
                    <TableCell sx={{ fontWeight: 900 }}>Equipment</TableCell>
                    <TableCell sx={{ fontWeight: 900 }}>Modality</TableCell>
                    <TableCell sx={{ fontWeight: 900 }}>Serial #</TableCell>
                    <TableCell sx={{ fontWeight: 900 }}>Tier</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {equipmentQ.isLoading ? Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}><TableCell colSpan={6}><Skeleton /></TableCell></TableRow>
                  )) : equipment.length === 0 ? (
                    <TableRow><TableCell colSpan={6} align="center" sx={{ py: 5, color: palette.textMuted, fontWeight: 700 }}>Select a facility with assets.</TableCell></TableRow>
                  ) : equipment.map((item: InspectionEquipmentItem) => (
                    <ContextTableRow
                      key={item.id}
                      recordKey={`inspection-asset-${item.id}`}
                      recordLabel={item.asset_tag}
                      contextSelected={selectedInstantEquipmentIds.includes(item.id)}
                      hover
                      onClick={() => toggleInstantEquipment(item.id)}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell padding="checkbox"><Checkbox checked={selectedInstantEquipmentIds.includes(item.id)} /></TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', color: palette.brand, fontWeight: 900 }}>{item.asset_tag}</TableCell>
                      <TableCell><ClippedTooltipText value={`${item.make} ${item.model}`} /></TableCell>
                      <TableCell>{item.modality_name || '-'}</TableCell>
                      <TableCell><ClippedTooltipText value={item.serial_number || '-'} /></TableCell>
                      <TableCell>{item.tier_name || '-'}</TableCell>
                    </ContextTableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}

        {tab === 2 && (
          <Box>
            <Box sx={{ p: 3, pb: 0 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '190px minmax(0, 1fr)' }, gap: 1.5 }}>
                <SearchFieldSelect
                  value={inProgressSearchField}
                  options={INSPECTION_SEARCH_FIELDS}
                  onChange={setInProgressSearchField}
                  ariaLabel="In-progress inspection search field"
                />
                <DebouncedSearchField
                  key={`inprogress-${activitySearch}-${searchResetSeed}`}
                  defaultValue={activitySearch}
                  onDebouncedChange={setDebouncedInProgressSearch}
                  label="Search in-progress inspections"
                  placeholder={`Search ${INSPECTION_SEARCH_FIELDS.find((field) => field.value === inProgressSearchField)?.label.toLowerCase() || 'inspections'}...`}
                  fullWidth
                />
              </Box>
            </Box>
            {renderBatchRows(inProgressBatchesQ.data?.items || [], inProgressBatchesQ.isLoading)}
            {renderPagination(inProgressBatchesQ.data?.total || 0, inProgressBatchPage, setInProgressBatchPage)}
            {(inProgressQ.data?.total || 0) > 0 && (
              <Box sx={{ borderTop: `1px solid ${palette.borderSoft}` }}>
                <Typography sx={{ px: 3, pt: 2, pb: 1, color: palette.textMuted, fontSize: 12, fontWeight: 900, textTransform: 'uppercase' }}>
                  Legacy Individual Inspections
                </Typography>
                {renderInspectionRows(legacyInProgress, inProgressQ.isLoading, 'progress')}
                {renderPagination(inProgressQ.data?.total || 0, legacyInProgressPage, setLegacyInProgressPage)}
              </Box>
            )}
          </Box>
        )}
        {tab === 3 && (
          <Box>
            <Box sx={{ p: 3, pb: 0 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '190px minmax(0, 1fr)' }, gap: 1.5 }}>
                <SearchFieldSelect
                  value={completedSearchField}
                  options={INSPECTION_SEARCH_FIELDS}
                  onChange={setCompletedSearchField}
                  ariaLabel="Completed inspection search field"
                />
                <DebouncedSearchField
                  key={`completed-${activitySearch}-${searchResetSeed}`}
                  defaultValue={activitySearch}
                  onDebouncedChange={setDebouncedCompletedSearch}
                  label="Search completed inspections"
                  placeholder={`Search ${INSPECTION_SEARCH_FIELDS.find((field) => field.value === completedSearchField)?.label.toLowerCase() || 'inspections'}...`}
                  fullWidth
                />
              </Box>
            </Box>
            {renderBatchRows(completedBatchesQ.data?.items || [], completedBatchesQ.isLoading, 'completed')}
            {renderPagination(completedBatchesQ.data?.total || 0, completedBatchPage, setCompletedBatchPage)}
            {(completedQ.data?.total || 0) > 0 && (
              <Box sx={{ borderTop: `1px solid ${palette.borderSoft}` }}>
                <Typography sx={{ px: 3, pt: 2, pb: 1, color: palette.textMuted, fontSize: 12, fontWeight: 900, textTransform: 'uppercase' }}>
                  Legacy Individual Inspections
                </Typography>
                {renderInspectionRows(legacyCompleted, completedQ.isLoading, 'completed')}
                {renderPagination(completedQ.data?.total || 0, legacyCompletedPage, setLegacyCompletedPage)}
              </Box>
            )}
          </Box>
        )}

        {tab === 5 && (
          <Box sx={{ p: 3 }}>
            <Card sx={{ p: 2, mb: 2, borderRadius: '18px', border: `1px solid ${palette.borderSoft}`, boxShadow: 'none' }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '180px minmax(0, 1fr) 320px' }, gap: 2 }}>
                <SearchFieldSelect
                  value={closedSearchField}
                  options={INSPECTION_SEARCH_FIELDS}
                  onChange={setClosedSearchField}
                  ariaLabel="Closed inspection search field"
                />
                <DebouncedSearchField
                  key={`closed-${activitySearch}-${searchResetSeed}`}
                  defaultValue={activitySearch}
                  onDebouncedChange={setDebouncedClosedSearch}
                  label="Search closed inspections"
                  placeholder={`Search ${INSPECTION_SEARCH_FIELDS.find((field) => field.value === closedSearchField)?.label.toLowerCase() || 'inspections'}...`}
                  fullWidth
                />
                <SearchableSelect<number>
                  label="Facility"
                  value={closedFacilityId}
                  onChange={setClosedFacilityId}
                  loading={facilitiesQ.isLoading}
                  options={facilityOptions.map(facility => ({
                    value: facility.id,
                    label: facility.name,
                    secondary: `#${facility.id} · ${facility.inventory_count} asset(s)`,
                    keywords: `${facility.id} ${facility.tier_name || ''}`,
                  }))}
                  placeholder="Search facility name or ID"
                  noOptionsText="No matching facilities"
                  helperText="Leave empty to include all facilities"
                />
              </Box>
              <Typography sx={{ color: palette.textMuted, fontSize: 12, fontWeight: 700, mt: 1 }}>
                Module From/To dates also filter this list by its scheduled date. Reopening preserves the existing schedule; rescheduling assigns a new date and reopens it.
              </Typography>
            </Card>
            {renderClosedRows()}
            {renderPagination(closedQ.data?.total || 0, closedPage, setClosedPage)}
          </Box>
        )}

        {tab === 4 && (
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: 'center', flexWrap: 'wrap', mb: 2 }}>
              <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap', flex: 1 }}>
                <SearchFieldSelect
                  value={formSearchField}
                  options={INSPECTION_FORM_SEARCH_FIELDS}
                  onChange={setFormSearchField}
                  ariaLabel="Inspection form search field"
                />
                <TextField
                  label="Search inspection forms"
                  placeholder={`Search ${INSPECTION_FORM_SEARCH_FIELDS.find((field) => field.value === formSearchField)?.label.toLowerCase() || 'forms'}...`}
                  value={formSearch}
                  onChange={event => setFormSearch(event.target.value)}
                  sx={{ minWidth: { xs: '100%', sm: 360 }, flex: 1 }}
                />
              </Box>
              <Button startIcon={<AddIcon />} variant="contained" onClick={openCreateFormBuilder} disabled={!canAddInspections} sx={{ borderRadius: '12px', textTransform: 'none', fontWeight: 900 }}>
                New Form
              </Button>
            </Box>
            <TableContainer className="list-scroll-panel">
              <Table stickyHeader>
                <TableHead>
                  <TableRow sx={{ bgcolor: palette.surfaceFaint }}>
                    <TableCell sx={{ fontWeight: 900 }}>Form</TableCell>
                    <TableCell sx={{ fontWeight: 900 }}>Description</TableCell>
                    <TableCell sx={{ fontWeight: 900 }}>Fields</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 900 }}>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {formsQ.isLoading ? Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}><TableCell colSpan={4}><Skeleton /></TableCell></TableRow>
                  )) : (formsQ.data?.items || []).length === 0 ? (
                    <TableRow><TableCell colSpan={4} align="center" sx={{ py: 5, color: palette.textMuted, fontWeight: 700 }}>No inspection forms found.</TableCell></TableRow>
                  ) : formsQ.data!.items.map((form: InspectionFormOption) => {
                    const schema = schemaForForm(form)
                    const grid = schema.custom_grid
                    const formioForm = schema.formio_form
                    const cellCount = grid ? grid.rows * grid.columns : 0
                    const fieldCount = formioForm?.components?.length || cellCount
                    return (
                      <ContextTableRow
                        key={form.id}
                        recordKey={`inspection-form-${form.id}`}
                        recordLabel={form.name}
                        hover
                      >
                        <TableCell sx={{ fontWeight: 900, color: palette.ink }}>
                          <ClippedTooltipText value={form.name} fontWeight={900} onClick={() => setViewForm(form)} />
                          <Typography sx={{ color: '#8B95A7', fontSize: 12 }}>
                            Fixed checklist + {formioForm ? 'temporary external form' : grid ? `${grid.rows}x${grid.columns} custom grid` : 'no custom form'} + Biomed Notes
                          </Typography>
                        </TableCell>
                        <TableCell><ClippedTooltipText value={form.description || '-'} field /></TableCell>
                        <TableCell><Chip size="small" label={`${fieldCount} custom field${fieldCount === 1 ? '' : 's'}`} sx={{ fontWeight: 900 }} /></TableCell>
                        <TableCell align="right">
                          <IconButton
                            size="small"
                            onClick={(event) => {
                              setFormActionAnchor(event.currentTarget)
                              setFormActionItem(form)
                            }}
                            sx={{ bgcolor: '#f1fffb', color: palette.brand }}
                          >
                            <MoreVertIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </ContextTableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}
      </Card>

      <Dialog open={Boolean(selectedBatchId)} onClose={() => setSelectedBatchId(null)} maxWidth="lg" fullWidth PaperProps={{ sx: { borderRadius: '22px' } }}>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: 'center', fontWeight: 900, color: palette.ink }}>
          <Box>
            Inspection Batch
            <Typography sx={{ color: palette.textMuted, fontSize: 13, fontWeight: 700 }}>
              {selectedBatch?.batch_number || 'Loading'} - {selectedBatch?.facility_name || ''}
            </Typography>
          </Box>
          {selectedBatch && canInitiateInspections && (
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {selectedBatchBillingApproved && (
                <Chip
                  size="small"
                  label="Billing approved · batch locked"
                  sx={{ alignSelf: 'center', bgcolor: palette.brandTint, color: palette.brand, fontWeight: 900 }}
                />
              )}
              {selectedBatch.batch_invoice && !selectedBatchBillingApproved && (
                <Chip
                  size="small"
                  label={`${selectedBatch.batch_invoice.invoice_number} will be updated`}
                  sx={{ alignSelf: 'center', bgcolor: palette.brandTint, color: palette.brandDeep, fontWeight: 900 }}
                />
              )}
              <Tooltip
                title={selectedBatchBillingApproved ? 'The approved batch invoice protects this inspection scope from further asset additions.' : ''}
              >
                <span>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AddIcon />}
                    onClick={() => setAddExistingAssetOpen(true)}
                    disabled={!canAddAssetsToSelectedBatch}
                    sx={{ borderRadius: '12px', textTransform: 'none', fontWeight: 900 }}
                  >
                    Add Existing Inventory
                  </Button>
                </span>
              </Tooltip>
              <Tooltip
                title={selectedBatchBillingApproved ? 'The approved batch invoice protects this inspection scope from further asset additions.' : ''}
              >
                <span>
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={() => setAddAssetOpen(true)}
                    disabled={!canAddAssetsToSelectedBatch}
                    sx={{ borderRadius: '12px', textTransform: 'none', fontWeight: 900, bgcolor: palette.brand }}
                  >
                    Add New Inventory
                  </Button>
                </span>
              </Tooltip>
            </Box>
          )}
        </DialogTitle>
        <DialogContent dividers>
          {batchDetailQ.isLoading ? (
            <Box sx={{ display: 'grid', gap: 1 }}>
              {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} height={44} />)}
            </Box>
          ) : selectedBatch ? (
            <Box sx={{ display: 'grid', gap: 2 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2 }}>
                <Card sx={{ p: 2, borderRadius: '16px', border: `1px solid ${palette.borderSoft}`, boxShadow: 'none' }}>
                  <Typography sx={{ color: palette.textFaint, fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Work Order</Typography>
                  <Typography sx={{ color: palette.brandDeep, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 900, fontSize: '1.02rem', mt: 0.75 }}>{selectedBatch.batch_number}</Typography>
                </Card>
                <Card sx={{ p: 2, borderRadius: '16px', border: `1px solid ${palette.borderSoft}`, boxShadow: 'none' }}>
                  <Typography sx={{ color: palette.textFaint, fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Assets</Typography>
                  <Typography sx={{ color: palette.ink, fontWeight: 900, fontSize: '1.6rem', lineHeight: 1, mt: 0.75 }}>{selectedBatch.asset_count}</Typography>
                </Card>
                <Card sx={{ p: 2, borderRadius: '16px', border: `1px solid ${palette.borderSoft}`, boxShadow: 'none' }}>
                  <Typography sx={{ color: palette.textFaint, fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Completed</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, mt: 0.75 }}>
                    <Typography sx={{ color: palette.brandStrong, fontWeight: 900, fontSize: '1.6rem', lineHeight: 1 }}>{selectedBatch.completed_count}</Typography>
                    <Typography sx={{ color: palette.textFaint, fontWeight: 800, fontSize: '0.85rem' }}>/ {selectedBatch.asset_count}</Typography>
                  </Box>
                  <Box sx={{ mt: 1, height: 6, borderRadius: '999px', bgcolor: palette.brandTint, overflow: 'hidden' }}>
                    <Box sx={{ height: '100%', borderRadius: '999px', bgcolor: palette.brandMid, transition: 'width .4s ease', width: `${selectedBatch.asset_count ? Math.round((selectedBatch.completed_count / selectedBatch.asset_count) * 100) : 0}%` }} />
                  </Box>
                </Card>
                <Card sx={{ p: 2, borderRadius: '16px', border: `1px solid ${palette.borderSoft}`, boxShadow: 'none' }}>
                  <Typography sx={{ color: palette.textFaint, fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Technician</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.75, minWidth: 0 }}>
                    <Box sx={{ width: 26, height: 26, borderRadius: '50%', bgcolor: '#f1fffb', color: palette.brand, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <PersonIcon sx={{ fontSize: '0.95rem' }} />
                    </Box>
                    <Typography sx={{ color: palette.ink, fontWeight: 900, fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedBatch.inspector_name || '—'}</Typography>
                  </Box>
                </Card>
              </Box>

              <TableContainer className="list-scroll-panel">
                <Table stickyHeader>
                  <TableHead>
                    <TableRow sx={{ bgcolor: palette.surfaceFaint }}>
                      <TableCell sx={{ fontWeight: 900 }}>Asset #</TableCell>
                      <TableCell sx={{ fontWeight: 900 }}>Serial</TableCell>
                      <TableCell sx={{ fontWeight: 900 }}>Description</TableCell>
                      <TableCell sx={{ fontWeight: 900 }}>Tier</TableCell>
                      <TableCell sx={{ fontWeight: 900 }}>Technician</TableCell>
                      <TableCell sx={{ fontWeight: 900 }}>Status</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 900 }}>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(selectedBatch.assets || []).map(asset => {
                      const chip = statusChip(asset.status)
                      return (
                        <ContextTableRow
                          key={asset.id}
                          recordKey={`inspection-${asset.id}`}
                          recordLabel={asset.inspection_number}
                          hover
                        >
                          <TableCell><ClippedTooltipText value={asset.asset_tag || asset.part_number || '-'} monospace color={palette.brand} fontWeight={900} onClick={() => openInspectionRecord(asset, selectedBatch.status === 'completed' ? 'completed' : 'progress')} /></TableCell>
                          <TableCell><ClippedTooltipText value={asset.serial_number || '-'} onClick={() => openInspectionRecord(asset, selectedBatch.status === 'completed' ? 'completed' : 'progress')} /></TableCell>
                          <TableCell>
                            <ClippedTooltipText
                              value={asset.asset_name || asset.equipment_name || '-'}
                              fontWeight={800}
                              color={palette.brandDeep}
                              maxWidth={210}
                              sx={{ display: 'inline-block', width: 210, maxWidth: 210, px: 1.1, py: 0.5, borderRadius: '8px', bgcolor: palette.brandTint }}
                              onClick={() => openInspectionRecord(asset, selectedBatch.status === 'completed' ? 'completed' : 'progress')}
                            />
                          </TableCell>
                          <TableCell>
                            <ClippedTooltipText
                              value={asset.tier_name || '-'}
                              fontWeight={700}
                              color={palette.slate600}
                              maxWidth={210}
                              sx={{ display: 'inline-block', width: 210, maxWidth: 210, px: 1.1, py: 0.5, borderRadius: '8px', bgcolor: palette.surfaceMuted }}
                            />
                          </TableCell>
                          <TableCell>{asset.inspector_name || '-'}</TableCell>
                          <TableCell><Chip size="small" label={String(asset.status || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} sx={{ bgcolor: chip.bg, color: chip.color, fontWeight: 800, textTransform: 'none', borderRadius: '8px' }} /></TableCell>
                          <TableCell align="right">
                            <IconButton size="small" onClick={(event) => openAssetActions(event, asset)} sx={{ bgcolor: '#f1fffb', color: palette.brand, '&:hover': { bgcolor: palette.brandSoft } }}>
                              <MoreVertIcon fontSize="small" />
                            </IconButton>
                          </TableCell>
                        </ContextTableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          ) : (
            <Typography sx={{ color: palette.textMuted, fontWeight: 700 }}>Batch not found.</Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
          {selectedBatch && (
            <>
              <Button
                startIcon={<AssessmentIcon />}
                variant="outlined"
                onClick={() => printBatchReport(selectedBatch)}
                disabled={!selectedBatch.assets?.length}
                sx={{ borderRadius: '12px', fontWeight: 900, textTransform: 'none' }}
              >
                Print All Reports
              </Button>
              <Button
                startIcon={generateBatchInvoiceMut.isPending ? <CircularProgress size={18} /> : <ReceiptLongIcon />}
                variant="outlined"
                onClick={() => generateBatchInvoiceMut.mutate(selectedBatch.id)}
                disabled={
                  !canEditInspections ||
                  selectedBatch.status !== 'completed' ||
                  !selectedBatch.assets?.length ||
                  Boolean(selectedBatch.batch_invoice) ||
                  generateBatchInvoiceMut.isPending
                }
                sx={{ borderRadius: '12px', fontWeight: 900, textTransform: 'none', color: palette.brandStrong, borderColor: palette.brandStrong, '&:hover': { borderColor: palette.brand, bgcolor: palette.successTint } }}
              >
                {selectedBatch.batch_invoice ? 'Batch Invoice Generated' : 'Generate Batch Invoice'}
              </Button>
            </>
          )}
          <Button onClick={() => setSelectedBatchId(null)} variant="contained" sx={{ borderRadius: '12px', fontWeight: 900, textTransform: 'none' }}>Close</Button>
        </DialogActions>
      </Dialog>

      <Menu anchorEl={assetActionAnchor} open={Boolean(assetActionAnchor)} onClose={closeAssetActions}>
        {canEditInspections && (
          <MenuItem
            onClick={() => {
              if (!assetActionItem) return
              setReportInspection(assetActionItem)
              closeAssetActions()
            }}
          >
            <AssignmentTurnedInIcon fontSize="small" sx={{ mr: 1 }} /> Report Activity
          </MenuItem>
        )}
        {canEditInspections && assetActionItem?.status !== 'completed' && (
          <MenuItem
            onClick={() => {
              if (assetActionItem) openTechnicianDialog(assetActionItem)
              closeAssetActions()
            }}
          >
            <PersonIcon fontSize="small" sx={{ mr: 1 }} /> Change Technician
          </MenuItem>
        )}
        <MenuItem onClick={() => assetActionItem && handlePrintReport(assetActionItem)}>
          <AssessmentIcon fontSize="small" sx={{ mr: 1 }} /> Print Report
        </MenuItem>
        <MenuItem
          disabled={
            !canEditInspections ||
            assetActionItem?.status !== 'completed' ||
            Boolean(assetActionItem?.invoice) ||
            generateInvoiceMut.isPending
          }
          onClick={() => {
            if (assetActionItem) generateInvoiceMut.mutate(assetActionItem.id)
          }}
        >
          <ReceiptLongIcon fontSize="small" sx={{ mr: 1 }} /> {assetActionItem?.invoice ? 'Invoice Generated' : 'Generate Invoice'}
        </MenuItem>
        {canDeleteInspections && assetActionItem?.status !== 'completed' && (
          <MenuItem
            disabled={removeBatchAssetMut.isPending}
            onClick={() => {
              if (selectedBatch && assetActionItem) {
                removeBatchAssetMut.mutate({ batchId: selectedBatch.id, inspectionId: assetActionItem.id })
              }
              closeAssetActions()
            }}
            sx={{ color: palette.dangerStrong, borderTop: `1px solid ${palette.surfaceMuted}`, mt: 0.5, pt: 1 }}
          >
            <DeleteIcon fontSize="small" sx={{ mr: 1 }} /> Remove from Batch
          </MenuItem>
        )}
      </Menu>

      <Menu
        anchorEl={formActionAnchor}
        open={Boolean(formActionAnchor)}
        onClose={() => {
          setFormActionAnchor(null)
          setFormActionItem(null)
        }}
      >
        <MenuItem
          onClick={() => {
            if (!formActionItem) return
            setViewForm(formActionItem)
            setFormActionAnchor(null)
            setFormActionItem(null)
          }}
        >
          <VisibilityOutlinedIcon fontSize="small" sx={{ mr: 1 }} /> View Form
        </MenuItem>
        <MenuItem
          disabled={!canEditInspections}
          onClick={() => {
            if (!formActionItem) return
            openEditFormBuilder(formActionItem)
            setFormActionAnchor(null)
            setFormActionItem(null)
          }}
        >
          <EditIcon fontSize="small" sx={{ mr: 1 }} /> Edit Form
        </MenuItem>
        {/* A blank sheet to carry to the equipment. Reading a form is
            not the same as being able to fill one in on paper. */}
        <MenuItem
          onClick={() => {
            if (!formActionItem) return
            printInspectionFormSheet(formActionItem)
            setFormActionAnchor(null)
            setFormActionItem(null)
          }}
        >
          <PrintOutlinedIcon fontSize="small" sx={{ mr: 1 }} /> Print Form
        </MenuItem>
        {/* Removing a form. The default report is left out entirely: it is
            recreated on demand, so removing it would achieve nothing. */}
        {!formActionItem?.is_default && [
          <Divider key="remove-divider" sx={{ my: 0.5 }} />,
          <MenuItem
            key="archive"
            disabled={!canEditInspections || Boolean(formActionItem?.archived_at)}
            onClick={() => {
              if (!formActionItem) return
              setRemovingForm(formActionItem)
              setFormActionAnchor(null)
              setFormActionItem(null)
            }}
          >
            <Inventory2OutlinedIcon fontSize="small" sx={{ mr: 1 }} />
            {formActionItem?.archived_at ? 'Archived' : 'Archive Form'}
          </MenuItem>,
          <MenuItem
            key="delete"
            disabled={!canEditInspections}
            onClick={() => {
              if (!formActionItem) return
              setRemovingForm(formActionItem)
              setFormActionAnchor(null)
              setFormActionItem(null)
            }}
            sx={{ color: palette.danger }}
          >
            <DeleteOutlineIcon fontSize="small" sx={{ mr: 1 }} /> Delete Form
          </MenuItem>,
        ]}
      </Menu>

      {/* One dialog for both, because the choice depends on something the
          user cannot see: whether any inspection was ever run against this
          form. It says which, and offers only what is actually possible. */}
      <Dialog
        open={Boolean(removingForm)}
        onClose={() => setRemovingForm(null)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: '18px' } }}
      >
        <DialogTitle sx={{ fontWeight: 900, color: palette.ink }}>
          Remove {removingForm?.name}?
        </DialogTitle>
        <DialogContent dividers>
          {removingForm?.can_delete ? (
            <Typography sx={{ fontSize: 14, color: '#334155' }}>
              No inspection has ever been run against this form, so it can be
              deleted for good. Any equipment or parts pointing at it keep
              working and simply lose the attachment.
            </Typography>
          ) : (
            <Box sx={{ display: 'grid', gap: 1.25 }}>
              <Typography sx={{ fontSize: 14, color: '#334155' }}>
                <strong>{removingForm?.usage_count}</strong> inspection
                {removingForm?.usage_count === 1 ? ' has' : 's have'} been run
                against this form, so it cannot be deleted — those
                inspections would no longer open.
              </Typography>
              <Typography sx={{ fontSize: 13.5, color: palette.textSubtle }}>
                Archiving takes it out of the picker so nobody starts a new
                inspection with it. Everything already built on it is
                untouched.
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setRemovingForm(null)} sx={{ fontWeight: 900 }}>
            Cancel
          </Button>
          <Button
            onClick={() => removingForm && archiveFormMut.mutate(removingForm)}
            disabled={archiveFormMut.isPending || Boolean(removingForm?.archived_at)}
            variant="outlined"
            sx={{ borderRadius: '12px', fontWeight: 900, textTransform: 'none' }}
          >
            {removingForm?.archived_at ? 'Already archived' : 'Archive'}
          </Button>
          {removingForm?.can_delete && (
            <Button
              onClick={() => removingForm && deleteFormMut.mutate(removingForm)}
              disabled={deleteFormMut.isPending}
              variant="contained"
              color="error"
              sx={{ borderRadius: '12px', fontWeight: 900, textTransform: 'none' }}
            >
              Delete
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(techEdit)} onClose={() => setTechEdit(null)} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: '18px' } }}>
        <DialogTitle sx={{ fontWeight: 900, color: palette.ink }}>Change Technician</DialogTitle>
        <DialogContent dividers>
          <SearchableSelect<number>
            label="Technician"
            value={selectedTechId}
            onChange={setSelectedTechId}
            options={batchTechnicians.map(user => ({
              value: user.id,
              label: user.full_name || user.username,
              secondary: `${user.role.replace(/_/g, ' ')} · ${user.email}`,
              keywords: `${user.username} ${user.email} ${user.role}`,
            }))}
            placeholder="Search technician name, username, or email"
            helperText="Leave empty to keep the inspection unassigned"
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setTechEdit(null)} sx={{ fontWeight: 900 }}>Cancel</Button>
          <Button onClick={saveTechnician} disabled={!canEditInspections || techMut.isPending} variant="contained" sx={{ borderRadius: '12px', fontWeight: 900, textTransform: 'none' }}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={addExistingAssetOpen} onClose={() => setAddExistingAssetOpen(false)} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: '22px' } }}>
        <DialogTitle sx={{ fontWeight: 900, color: palette.ink }}>
          Add Existing Inventory to Batch
          <Typography sx={{ color: palette.textMuted, fontSize: 13, fontWeight: 700 }}>
            Select assets from {selectedBatch?.facility_name || 'this facility'} that are not already part of this inspection batch.
          </Typography>
        </DialogTitle>
        <DialogContent dividers>
          <TextField
            label="Search facility assets"
            placeholder="Search asset #, make, model, serial, modality..."
            value={existingAssetSearch}
            onChange={e => setExistingAssetSearch(e.target.value)}
            fullWidth
            sx={{ mb: 2 }}
          />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 1.5 }}>
            <Typography sx={{ color: palette.textMuted, fontWeight: 800 }}>
              {selectedExistingEquipmentIds.length} of {availableExistingBatchAssets.length} available asset{availableExistingBatchAssets.length === 1 ? '' : 's'} selected.
            </Typography>
            <Button
              size="small"
              variant={allExistingBatchEquipmentSelected ? 'outlined' : 'contained'}
              onClick={toggleAllExistingBatchEquipment}
              disabled={batchEquipmentQ.isLoading || availableExistingBatchAssets.length === 0}
              sx={{ borderRadius: '12px', textTransform: 'none', fontWeight: 900 }}
            >
              {allExistingBatchEquipmentSelected ? 'Clear Selection' : 'Select All Assets'}
            </Button>
          </Box>
          <TableContainer className="list-scroll-panel" sx={{ border: `1px solid ${palette.borderSoft}`, borderRadius: '16px' }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: palette.surfaceFaint }}>
                  <TableCell padding="checkbox" />
                  <TableCell sx={{ fontWeight: 900 }}>Asset #</TableCell>
                  <TableCell sx={{ fontWeight: 900 }}>Equipment</TableCell>
                  <TableCell sx={{ fontWeight: 900 }}>Modality</TableCell>
                  <TableCell sx={{ fontWeight: 900 }}>Serial #</TableCell>
                  <TableCell sx={{ fontWeight: 900 }}>Criticality</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {batchEquipmentQ.isLoading ? (
                  Array.from({ length: 4 }).map((_, index) => (
                    <TableRow key={index}><TableCell colSpan={6}><Skeleton /></TableCell></TableRow>
                  ))
                ) : availableExistingBatchAssets.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 5, color: palette.textMuted, fontWeight: 700 }}>
                      {batchEquipmentIds.size ? 'No remaining facility assets available for this batch.' : 'No facility assets found.'}
                    </TableCell>
                  </TableRow>
                ) : availableExistingBatchAssets.map((item: InspectionEquipmentItem) => (
                  <ContextTableRow
                    key={item.id}
                    recordKey={`inspection-asset-${item.id}`}
                    recordLabel={item.asset_tag}
                    contextSelected={selectedExistingEquipmentIds.includes(item.id)}
                    hover
                    onClick={() => toggleExistingBatchEquipment(item.id)}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell padding="checkbox"><Checkbox checked={selectedExistingEquipmentIds.includes(item.id)} /></TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', color: palette.brand, fontWeight: 900 }}>{item.asset_tag}</TableCell>
                    <TableCell><ClippedTooltipText value={`${item.make} ${item.model}`} fontWeight={800} /></TableCell>
                    <TableCell>{item.modality_name || '-'}</TableCell>
                    <TableCell><ClippedTooltipText value={item.serial_number || '-'} /></TableCell>
                    <TableCell><Chip size="small" label={item.criticality || 'standard'} sx={{ fontWeight: 900 }} /></TableCell>
                  </ContextTableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setAddExistingAssetOpen(false)} sx={{ fontWeight: 900 }}>Cancel</Button>
          <Button
            startIcon={addBatchExistingAssetsMut.isPending ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : <AddIcon />}
            onClick={submitExistingBatchAssets}
            disabled={!canAddAssetsToSelectedBatch || addBatchExistingAssetsMut.isPending || selectedExistingEquipmentIds.length === 0}
            variant="contained"
            sx={{ borderRadius: '12px', fontWeight: 900, textTransform: 'none' }}
          >
            Add {selectedExistingEquipmentIds.length || ''} Asset{selectedExistingEquipmentIds.length === 1 ? '' : 's'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={addAssetOpen} onClose={() => setAddAssetOpen(false)} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: '22px' } }}>
        <DialogTitle sx={{ fontWeight: 900, color: palette.ink }}>Add New Inventory to Batch</DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 2, pt: 1 }}>
            <TextField label="Asset # *" value={batchAssetForm.asset_tag} onChange={e => setBatchAssetForm(prev => ({ ...prev, asset_tag: e.target.value }))} />
            <TextField label="Make *" value={batchAssetForm.make} onChange={e => setBatchAssetForm(prev => ({ ...prev, make: e.target.value }))} />
            <TextField label="Model *" value={batchAssetForm.model} onChange={e => setBatchAssetForm(prev => ({ ...prev, model: e.target.value }))} />
            <TextField label="Serial # *" value={batchAssetForm.serial_number} onChange={e => setBatchAssetForm(prev => ({ ...prev, serial_number: e.target.value }))} />
            <SearchableSelect<number>
              label="Modality"
              value={batchAssetForm.modality_id || ''}
              required
              options={assignableModalities.map(modality => ({
                value: modality.id,
                label: modality.name,
                secondary: modality.category || undefined,
                keywords: modality.description || '',
              }))}
              onChange={value => setBatchAssetForm(prev => ({ ...prev, modality_id: Number(value) }))}
              placeholder="Search modalities..."
              noOptionsText="No matching modalities"
            />
            <TextField select label="PM Scheduling" value={batchAssetForm.pm_scheduling || 'annual'} onChange={e => setBatchAssetForm(prev => ({ ...prev, pm_scheduling: e.target.value }))}>
              <MenuItem value="monthly">Monthly</MenuItem>
              <MenuItem value="quarterly">Quarterly</MenuItem>
              <MenuItem value="semi_annual">Semi-Annual</MenuItem>
              <MenuItem value="annual">Annual</MenuItem>
            </TextField>
            <TextField label="Location" value={batchAssetForm.location || ''} onChange={e => setBatchAssetForm(prev => ({ ...prev, location: e.target.value }))} />
            <TextField label="Risk Priority" value={batchAssetForm.risk_priority || ''} onChange={e => setBatchAssetForm(prev => ({ ...prev, risk_priority: e.target.value }))} />
            <TextField label="Risk Name" value={batchAssetForm.risk_name || ''} onChange={e => setBatchAssetForm(prev => ({ ...prev, risk_name: e.target.value }))} />
            <TextField label="Last PM Date" type="date" value={batchAssetForm.last_pm_date || ''} onChange={e => setBatchAssetForm(prev => ({ ...prev, last_pm_date: e.target.value || null }))} InputLabelProps={{ shrink: true }} />
            <TextField label="Installation Date" type="date" value={batchAssetForm.installation_date || ''} onChange={e => setBatchAssetForm(prev => ({ ...prev, installation_date: e.target.value || null }))} InputLabelProps={{ shrink: true }} />
            <TextField label="Inventory Date" type="date" value={batchAssetForm.inventory_date || ''} onChange={e => setBatchAssetForm(prev => ({ ...prev, inventory_date: e.target.value || null }))} InputLabelProps={{ shrink: true }} />
            <TextField label="Description" value={batchAssetForm.description || ''} onChange={e => setBatchAssetForm(prev => ({ ...prev, description: e.target.value }))} multiline rows={3} sx={{ gridColumn: '1 / -1' }} />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setAddAssetOpen(false)} sx={{ fontWeight: 900 }}>Cancel</Button>
          <Button startIcon={addBatchAssetMut.isPending ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : <AddIcon />} onClick={submitBatchAsset} disabled={!canAddAssetsToSelectedBatch || addBatchAssetMut.isPending} variant="contained" sx={{ borderRadius: '12px', fontWeight: 900, textTransform: 'none', bgcolor: palette.brandMid }}>
            Add Asset
          </Button>
        </DialogActions>
      </Dialog>

      {viewForm && (() => {
        const previewSchema = schemaForForm(viewForm)
        const grid = previewSchema.custom_grid
        const formioForm = previewSchema.formio_form
        const canvasForm = previewSchema.canvas_form?.elements?.length ? previewSchema.canvas_form : null
        const leftChecks = ['physical_inspection', 'display', 'functional', 'electrical_safety', 'battery', 'pm_kit'].map(key => [key, CHECK_FIELD_LABELS[key]] as [string, string])
        const rightChecks = ['cleaning', 'lubrication', 'calibration'].map(key => [key, CHECK_FIELD_LABELS[key]] as [string, string])
        return (
          <Dialog open={Boolean(viewForm)} onClose={() => setViewForm(null)} maxWidth="lg" fullWidth PaperProps={{ sx: { borderRadius: '22px' } }}>
            <DialogTitle sx={{ fontWeight: 900, color: palette.ink }}>
              {viewForm.name}
              <Typography sx={{ color: palette.textMuted, fontSize: 13, fontWeight: 700 }}>
                {viewForm.description || 'Inspection form preview'}
              </Typography>
            </DialogTitle>
            <DialogContent dividers>
              <Box sx={{ display: 'grid', gap: 2.5 }}>
                <Card sx={{ p: 2, borderRadius: '16px', border: `1px solid ${palette.borderSoft}`, boxShadow: 'none' }}>
                  <Typography sx={{ fontWeight: 900, color: palette.ink, mb: 1.5 }}>Inspection Report</Typography>
                  <TableContainer sx={{ border: '1px solid #D8DEE9', borderRadius: '10px' }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          {['Test', 'Pass', 'Fail', 'N/A', 'Test', 'Pass', 'Fail', 'N/A'].map(header => (
                            <TableCell key={header} align="center" sx={{ fontWeight: 900 }}>{header}</TableCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {Array.from({ length: 6 }).map((_, index) => {
                          const left = leftChecks[index]
                          const right = rightChecks[index]
                          return (
                            <TableRow key={index} sx={{ bgcolor: index % 2 ? '#fff' : palette.surfaceGray }}>
                              <TableCell align="center">{left?.[1] || ''}</TableCell>
                              {['pass', 'fail', 'na'].map(value => (
                                <TableCell key={`preview-left-${value}`} align="center">{left && <Radio disabled size="small" />}</TableCell>
                              ))}
                              <TableCell align="center">
                                {right?.[1] || (index === 3 ? 'Set:' : index === 4 || index === 5 ? 'Replaced on' : '')}
                              </TableCell>
                              {right ? ['pass', 'fail', 'na'].map(value => (
                                <TableCell key={`preview-right-${value}`} align="center"><Radio disabled size="small" /></TableCell>
                              )) : (
                                <>
                                  <TableCell align="center">{index >= 3 && <TextField disabled size="small" />}</TableCell>
                                  <TableCell align="center">{index === 3 ? 'Read:' : index === 4 || index === 5 ? 'Due' : ''}</TableCell>
                                  <TableCell align="center">{index >= 3 && <TextField disabled size="small" />}</TableCell>
                                </>
                              )}
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Card>

                <Card sx={{ p: 2, borderRadius: '16px', border: `1px solid ${palette.brandSoft}`, boxShadow: 'none' }}>
                  <Typography sx={{ fontWeight: 900, color: palette.indigo, mb: 1.5 }}>{canvasForm ? previewSchema.title : formioForm?.title || grid?.title || 'Custom Form'}</Typography>
                  {canvasForm ? (
                    <Box sx={{ overflowX: 'auto' }}>
                      <CanvasFormViewer schema={canvasForm} readOnly />
                    </Box>
                  ) : formioForm?.components ? (
                    <Typography sx={{ color: palette.textMuted, fontWeight: 800 }}>
                      This is a temporary Form.io form. Please edit/recreate it with the custom grid builder.
                    </Typography>
                  ) : !grid ? (
                    <Typography sx={{ color: palette.textMuted, fontWeight: 800 }}>No custom grid is saved on this form.</Typography>
                  ) : (
                    <TableContainer sx={{ border: '1px solid #D8DEE9', borderRadius: '10px' }}>
                      <Table size="small">
                        <TableBody>
                          {grid.cells.map((row, rowIndex) => (
                            <TableRow key={rowIndex} sx={{ bgcolor: rowIndex % 2 ? '#fff' : palette.surfaceGray }}>
                              {row.map((cell) => cell.hidden ? null : (
                                <TableCell
                                  key={cell.id}
                                  align={cell.align || 'center'}
                                  colSpan={cell.colSpan || 1}
                                  rowSpan={cell.rowSpan || 1}
                                  sx={{
                                    minWidth: cell.width || 180,
                                    width: cell.width || 180,
                                    height: cell.height || 74,
                                    verticalAlign: cell.verticalAlign || 'middle',
                                  }}
                                >
                                  <Box
                                    sx={{
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: 0.75,
                                      minHeight: Math.max(44, Number(cell.height || 74)) - 16,
                                      alignItems: gridAlignItems(cell.align),
                                      justifyContent: gridJustifyContent(cell.verticalAlign),
                                      textAlign: cell.align || 'center',
                                    }}
                                  >
                                    {cell.blocks?.length ? renderCustomGridCellBlocks(cell, {}, true) : (
                                      <>
                                        {shouldShowGridCellTitle(cell) && (
                                          <Typography sx={{ fontWeight: 900, color: palette.ink, textAlign: cell.align || 'center' }}>{cell.label}</Typography>
                                        )}
                                        {cell.type === 'text' ? null : cell.type === 'input' ? (
                <TextField disabled size="small" fullWidth placeholder="" />
                                    ) : cell.type === 'radio' ? (
                                      <RadioGroup row sx={{ justifyContent: gridAlignItems(cell.align) }}>
                                        {(cell.options?.length ? cell.options : DEFAULT_GRID_OPTIONS).map((option: string) => (
                                          <FormControlLabel key={option} value={option} control={<Radio disabled size="small" />} label={option} />
                                        ))}
                                      </RadioGroup>
                                    ) : cell.options?.length ? (
                                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: gridAlignItems(cell.align) }}>
                                        {cell.options.map((option: string) => (
                                          <FormControlLabel key={option} control={<Checkbox disabled size="small" />} label={option} />
                                        ))}
                                      </Box>
                                    ) : (
                                      <Checkbox disabled size="small" />
                                    )}
                                      </>
                                    )}
                                  </Box>
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </Card>

                <Card sx={{ p: 2, borderRadius: '16px', border: `1px solid ${palette.borderSoft}`, boxShadow: 'none' }}>
                  <Typography sx={{ fontWeight: 900, color: palette.ink, mb: 1.5 }}>Biomed Notes</Typography>
                  <TableContainer sx={{ border: '1px solid #D8DEE9', borderRadius: '10px' }}>
                    <Table size="small">
                      <TableBody>
                        {[
                          ['Reported Problem'],
                          ['Problem Found'],
                          ['Corrective action taken'],
                          ['Summary'],
                        ].map(([label]) => (
                          <TableRow key={label}>
                            <TableCell sx={{ width: 280, fontWeight: 900 }}>{label}</TableCell>
                            <TableCell><TextField disabled size="small" fullWidth /></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Card>
              </Box>
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 2 }}>
              <Button onClick={() => setViewForm(null)} variant="contained" sx={{ borderRadius: '12px', textTransform: 'none', fontWeight: 900 }}>Close</Button>
            </DialogActions>
          </Dialog>
        )
      })()}

      <Dialog open={formBuilderOpen} onClose={() => setFormBuilderOpen(false)} maxWidth="lg" fullWidth PaperProps={{ sx: { borderRadius: '22px' } }}>
        <DialogTitle sx={{ fontWeight: 900, color: palette.ink }}>
          {formBuilderMode === 'create' ? 'Create Inspection Form' : formBuilderMode === 'report-custom' ? 'Customize Report Form' : 'Edit Inspection Form'}
          <Typography sx={{ color: palette.textMuted, fontSize: 13, fontWeight: 700 }}>
            The default Inspection Report and Biomed Notes stay fixed. Build the reusable middle custom grid here.
          </Typography>
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: 'grid', gap: 2.5 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1.4fr' }, gap: 2 }}>
              <TextField label="Form Title / Name" value={formBuilderName} onChange={e => setFormBuilderName(e.target.value)} />
              <TextField label="Description" value={formBuilderDescription} onChange={e => setFormBuilderDescription(e.target.value)} />
            </Box>

            <Card sx={{ p: 2, borderRadius: '16px', border: `1px solid ${palette.border}`, boxShadow: 'none' }}>
              <Typography sx={{ fontWeight: 900, color: palette.ink }}>Inspection Report</Typography>
              <Typography sx={{ color: palette.textMuted, fontSize: 13, fontWeight: 700 }}>
                Fixed default checklist: test rows, Pass / Fail / N/A radio buttons, Set / Read, Replaced On / Due.
              </Typography>
            </Card>

            <Card sx={{ p: 2, borderRadius: '16px', border: `1px solid ${palette.brandSoft}`, boxShadow: 'none' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
                <Typography sx={{ fontWeight: 900, color: palette.ink }}>Middle Custom Section</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography sx={{ fontSize: 12, color: palette.textSubtle, fontWeight: 700 }}>Builder:</Typography>
                  <Box sx={{ display: 'flex', borderRadius: '10px', border: `1px solid ${palette.brandBorder}`, overflow: 'hidden' }}>
                    {(['grid', 'canvas'] as const).map(eng => (
                      <Box
                        key={eng}
                        onClick={() => {
                          setFormBuilderEngine(eng)
                          if (eng === 'canvas' && !canvasFormSchema) setCanvasFormSchema({ canvas_width: 1080, canvas_height: 900, elements: [] })
                        }}
                        sx={{
                          px: 2, py: 0.5, cursor: 'pointer', fontSize: 12, fontWeight: 800,
                          bgcolor: formBuilderEngine === eng ? palette.brand : 'transparent',
                          color: formBuilderEngine === eng ? '#fff' : palette.ink,
                          transition: 'all 0.15s',
                          '&:hover': { bgcolor: formBuilderEngine === eng ? palette.brandDeep : palette.brandTint },
                          textTransform: 'capitalize',
                        }}
                      >
                        {eng === 'grid' ? 'Grid' : 'Canvas'}
                      </Box>
                    ))}
                  </Box>
                </Box>
              </Box>

              {formBuilderEngine === 'canvas' && (
                <Box sx={{ height: 640, borderRadius: '12px', overflow: 'auto', border: `1px solid ${palette.borderSlate}`, WebkitOverflowScrolling: 'touch' }}>
                  <CanvasFormBuilder
                    schema={canvasFormSchema}
                    onChange={setCanvasFormSchema}
                    onRemoveForm={
                      // Only for a form that exists. A form being created has
                      // nothing to delete, and Cancel already discards it.
                      formBuilderMode === 'edit' && formBuilderId && canEditInspections
                        ? () => {
                            const target = (formsQ.data?.items || [])
                              .find((item: InspectionFormOption) => item.id === formBuilderId)
                            if (target) setRemovingForm(target)
                          }
                        : undefined
                    }
                  />
                </Box>
              )}
              {formBuilderEngine !== 'canvas' && (
              <Box>
              <Typography sx={{ color: palette.textMuted, fontSize: 13, fontWeight: 700, mb: 1.5 }}>
                Create the table first, then click any cell to add input fields, radio groups, checkboxes, or text.
              </Typography>
              {!formBuilderSchema.custom_grid ? (
                <Card sx={{ p: 2, borderRadius: '16px', border: `1px solid ${palette.brandBorder}`, bgcolor: '#fafffe', boxShadow: 'none' }}>
                  <Box sx={{ display: 'flex', gap: 2.5, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
                    <Box sx={{ textAlign: { xs: 'center', md: 'left' } }}>
                      <Typography sx={{ fontWeight: 950, color: palette.ink, fontSize: 18 }}>Insert table</Typography>
                      <Typography sx={{ color: palette.textSubtle, fontSize: 13, fontWeight: 800 }}>
                        Hover over the boxes and click the size you want.
                      </Typography>
                      <Chip
                        size="small"
                        label={tablePickerHover ? `${tablePickerHover.rows} x ${tablePickerHover.columns}` : 'Select table size'}
                        sx={{ mt: 1, bgcolor: palette.brandSoft, color: palette.ink, fontWeight: 950 }}
                      />
                    </Box>
                    <Box
                      onMouseLeave={() => setTablePickerHover(null)}
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(10, 22px)',
                        gap: 0.5,
                        p: 1,
                        borderRadius: '12px',
                        bgcolor: palette.white,
                        border: `1px solid ${palette.border}`,
                      }}
                    >
                      {Array.from({ length: 100 }).map((_, index) => {
                        const row = Math.floor(index / 10) + 1
                        const column = (index % 10) + 1
                        const activeRows = tablePickerHover?.rows || 0
                        const activeColumns = tablePickerHover?.columns || 0
                        const active = row <= activeRows && column <= activeColumns
                        return (
                          <Box
                            key={`table-picker-${row}-${column}`}
                            role="button"
                            tabIndex={0}
                            aria-label={`Create ${row} by ${column} table`}
                            onMouseEnter={() => setTablePickerHover({ rows: row, columns: column })}
                            onClick={() => {
                              setFormBuilderRows(row)
                              setFormBuilderColumns(column)
                              setBuilderGrid(row, column)
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                setFormBuilderRows(row)
                                setFormBuilderColumns(column)
                                setBuilderGrid(row, column)
                              }
                            }}
                            sx={{
                              width: 22,
                              height: 22,
                              borderRadius: '5px',
                              border: active ? `1px solid ${palette.brand}` : '1px solid #CBD5E1',
                              bgcolor: active ? palette.brandBorder : palette.white,
                              cursor: 'pointer',
                              transition: 'all 120ms ease',
                              '&:hover': { transform: 'scale(1.08)' },
                            }}
                          />
                        )
                      })}
                    </Box>
                  </Box>
                </Card>
              ) : (
                <Box sx={{ display: 'grid', gap: 1.5 }}>
                  <TextField
                    label="Custom Section Title"
                    value={formBuilderSchema.custom_grid?.title || 'Set Title'}
                    onChange={e => updateBuilderGridTitle(e.target.value)}
                  />
                  <Card sx={{ p: 1.5, borderRadius: '14px', border: `1px solid ${palette.brandBorder}`, bgcolor: '#fafffe', boxShadow: 'none' }}>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                      <Chip
                        label={selectedBuilderCell ? `Selected: Cell ${selectedBuilderCell.row + 1}.${selectedBuilderCell.column + 1}` : 'Select a cell to edit'}
                        sx={{ fontWeight: 900, bgcolor: palette.brandSoft, color: palette.ink }}
                      />
                      <Divider orientation="vertical" flexItem />
                      <Button size="small" startIcon={<AddIcon />} onClick={addBuilderRow} sx={{ borderRadius: '10px', textTransform: 'none', fontWeight: 900 }}>Add Row</Button>
                      <Button size="small" startIcon={<AddIcon />} onClick={addBuilderColumn} sx={{ borderRadius: '10px', textTransform: 'none', fontWeight: 900 }}>Add Column</Button>
                      <Button size="small" onClick={duplicateBuilderRow} disabled={!selectedBuilderCell} sx={{ borderRadius: '10px', textTransform: 'none', fontWeight: 900 }}>Duplicate Row</Button>
                      <Button size="small" startIcon={<RemoveIcon />} onClick={deleteBuilderRow} disabled={!selectedBuilderCell} color="error" sx={{ borderRadius: '10px', textTransform: 'none', fontWeight: 900 }}>Delete Row</Button>
                      <Button size="small" startIcon={<RemoveIcon />} onClick={deleteBuilderColumn} disabled={!selectedBuilderCell} color="error" sx={{ borderRadius: '10px', textTransform: 'none', fontWeight: 900 }}>Delete Column</Button>
                      <Divider orientation="vertical" flexItem />
                      <Button size="small" onClick={() => mergeSelectedBuilderCell('right')} disabled={!selectedBuilderCell} sx={{ borderRadius: '10px', textTransform: 'none', fontWeight: 900 }}>Merge Right</Button>
                      <Button size="small" onClick={() => mergeSelectedBuilderCell('down')} disabled={!selectedBuilderCell} sx={{ borderRadius: '10px', textTransform: 'none', fontWeight: 900 }}>Merge Down</Button>
                      <Button size="small" onClick={splitSelectedBuilderCell} disabled={!selectedBuilderCell || !selectedGridCell || ((selectedGridCell.rowSpan || 1) === 1 && (selectedGridCell.colSpan || 1) === 1)} sx={{ borderRadius: '10px', textTransform: 'none', fontWeight: 900 }}>Split</Button>
                      <Button size="small" onClick={clearSelectedBuilderCell} disabled={!selectedBuilderCell} color="error" sx={{ borderRadius: '10px', textTransform: 'none', fontWeight: 900 }}>Clear Cell</Button>
                    </Box>
                    <Typography sx={{ mt: 1, color: palette.textSubtle, fontSize: 12, fontWeight: 800 }}>
                      Tip: drag the right edge of a cell to resize width, or the bottom edge to resize height.
                    </Typography>
                  </Card>

                  {selectedBuilderCell && selectedGridCell && (
                    <Card sx={{ p: 1.5, borderRadius: '16px', border: `1px solid ${palette.brandPale}`, bgcolor: palette.white, boxShadow: 'none' }}>
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1.5, flexWrap: 'wrap', mb: 1.5 }}>
                        <Box>
                          <Typography sx={{ fontWeight: 950, color: palette.ink, fontSize: 20 }}>
                            Edit Cell {selectedBuilderCell.row + 1}.{selectedBuilderCell.column + 1}
                          </Typography>
                          <Typography sx={{ color: palette.textSubtle, fontSize: 13, fontWeight: 800 }}>
                            Add what this table cell should contain. The table preview updates below.
                          </Typography>
                        </Box>
                      </Box>

                      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr auto' }, gap: 1, alignItems: 'center', mb: 1.5 }}>
                        <TextField
                          size="small"
                          label="Cell title (optional)"
                          placeholder="Example: General Information"
                          value={selectedGridCell.label}
                          onChange={e => updateSelectedGridCell({ label: e.target.value })}
                        />
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', justifyContent: { xs: 'flex-start', md: 'flex-end' } }}>
                          {(['left', 'center', 'right'] as GridHorizontalAlign[]).map(align => (
                            <Button key={align} size="small" variant={(selectedGridCell.align || 'center') === align ? 'contained' : 'outlined'} onClick={() => updateSelectedGridCell({ align })} sx={{ minWidth: 64, borderRadius: '10px', textTransform: 'capitalize', fontWeight: 900 }}>{align}</Button>
                          ))}
                          {(['top', 'middle', 'bottom'] as GridVerticalAlign[]).map(verticalAlign => (
                            <Button key={verticalAlign} size="small" variant={(selectedGridCell.verticalAlign || 'middle') === verticalAlign ? 'contained' : 'outlined'} onClick={() => updateSelectedGridCell({ verticalAlign })} sx={{ minWidth: 72, borderRadius: '10px', textTransform: 'capitalize', fontWeight: 900 }}>{verticalAlign}</Button>
                          ))}
                        </Box>
                      </Box>

                      <Typography sx={{ color: palette.slate600, fontSize: 12, fontWeight: 950, mb: 0.75 }}>Add to this cell</Typography>
                      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(5, 1fr)' }, gap: 1, mb: 1.5 }}>
                        {[
                          { label: 'Input', helper: 'Single text box', type: 'input' as GridCellBlockType },
                          { label: 'Radio', helper: 'Pick one option', type: 'radio' as GridCellBlockType },
                          { label: 'Checkboxes', helper: 'Pick many options', type: 'checkbox' as GridCellBlockType },
                          { label: 'Text', helper: 'Static label', type: 'label' as GridCellBlockType },
                          { label: 'Comments', helper: 'Long text box', type: 'textarea' as GridCellBlockType },
                        ].map(action => (
                          <Button
                            key={action.type}
                            startIcon={<AddIcon />}
                            onClick={() => addSelectedCellBlock(action.type)}
                            sx={{
                              p: 1.25,
                              borderRadius: '14px',
                              border: `1px solid ${palette.brandBorder}`,
                              bgcolor: palette.white,
                              color: palette.ink,
                              textTransform: 'none',
                              justifyContent: 'flex-start',
                              textAlign: 'left',
                              '&:hover': { bgcolor: palette.brandTint, borderColor: palette.brand },
                            }}
                          >
                            <Box>
                              <Typography sx={{ fontWeight: 950, lineHeight: 1.1 }}>{action.label}</Typography>
                              <Typography sx={{ fontSize: 11, fontWeight: 800, opacity: 0.78 }}>{action.helper}</Typography>
                            </Box>
                          </Button>
                        ))}
                      </Box>

                      <Typography sx={{ color: palette.slate600, fontSize: 12, fontWeight: 950, mb: 0.75 }}>Cell contents</Typography>
                      {selectedGridCell.blocks?.length ? (
                        <Box sx={{ display: 'grid', gap: 1 }}>
                          {selectedGridCell.blocks.map((block, blockIndex) => {
                            const blockName = block.type === 'radio'
                              ? 'Radio group'
                              : block.type === 'checkbox'
                                ? 'Checkbox group'
                                : block.type === 'input'
                                  ? 'Input field'
                                  : block.type === 'textarea'
                                    ? 'Comments box'
                                    : 'Text label'
                            const labelName = block.type === 'radio'
                              ? 'Radio title (optional)'
                              : block.type === 'checkbox'
                                ? 'Checkbox title (optional)'
                                : block.type === 'input'
                                  ? 'Input title (optional)'
                                  : block.type === 'textarea'
                                    ? 'Comments title (optional)'
                                    : 'Text'
                            return (
                              <Box
                                key={block.id}
                                draggable
                                onDragStart={(event) => event.dataTransfer.setData('application/x-grid-block-index', String(blockIndex))}
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={(event) => {
                                  event.preventDefault()
                                  const fromIndex = Number(event.dataTransfer.getData('application/x-grid-block-index'))
                                  if (Number.isFinite(fromIndex)) moveGridCellBlock(selectedBuilderCell.row, selectedBuilderCell.column, fromIndex, blockIndex)
                                }}
                                sx={{ p: 1.25, borderRadius: '14px', border: `1px solid ${palette.border}`, bgcolor: palette.surface, display: 'grid', gap: 1, cursor: 'grab', '&:active': { cursor: 'grabbing' } }}
                              >
                                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'auto 1fr auto' }, gap: 1, alignItems: 'center' }}>
                                  <Chip size="small" label={`Drag · ${blockName}`} sx={{ fontWeight: 950, bgcolor: palette.brandSoft, color: palette.ink }} />
                                  <TextField
                                    size="small"
                                    label={labelName}
                                    value={block.label}
                                    onChange={e => updateGridCellBlock(selectedBuilderCell.row, selectedBuilderCell.column, blockIndex, { label: e.target.value })}
                                  />
                                  <IconButton size="small" color="error" onClick={() => removeGridCellBlock(selectedBuilderCell.row, selectedBuilderCell.column, blockIndex)} sx={{ border: '1px solid #FECACA', bgcolor: palette.dangerWash }}>
                                    <RemoveIcon fontSize="small" />
                                  </IconButton>
                                </Box>
                                {(block.type === 'input' || block.type === 'textarea') && (
                                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: '140px 140px' }, gap: 1, pl: { xs: 0, md: 8 } }}>
                                    <NumericField
                                      label="Box width"
                                      value={block.width || (block.type === 'textarea' ? 220 : 180)}
                                      onChange={value => updateGridCellBlock(selectedBuilderCell.row, selectedBuilderCell.column, blockIndex, { width: Math.max(60, Math.min(520, Number(value || 60))) })}
                                    />
                                    <NumericField
                                      label="Box height"
                                      value={block.height || (block.type === 'textarea' ? 90 : 40)}
                                      onChange={value => updateGridCellBlock(selectedBuilderCell.row, selectedBuilderCell.column, blockIndex, { height: Math.max(28, Math.min(240, Number(value || 28))) })}
                                    />
                                  </Box>
                                )}
                                {(block.type === 'checkbox' || block.type === 'radio') && (
                                  <Box sx={{ display: 'grid', gap: 0.75, pl: { xs: 0, md: 8 } }}>
                                    <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
                                      <Typography sx={{ color: palette.textSubtle, fontSize: 12, fontWeight: 950, mr: 0.5 }}>
                                        Option layout
                                      </Typography>
                                      {([
                                        ['wrap', 'Wrap'],
                                        ['horizontal', 'Horizontal'],
                                        ['vertical', 'Vertical'],
                                      ] as [GridOptionLayout, string][]).map(([layoutValue, layoutLabel]) => (
                                        <Button
                                          key={layoutValue}
                                          size="small"
                                          variant={normalizeGridOptionLayout(block.optionLayout) === layoutValue ? 'contained' : 'outlined'}
                                          onClick={() => updateGridCellBlock(selectedBuilderCell.row, selectedBuilderCell.column, blockIndex, { optionLayout: layoutValue })}
                                          sx={{ borderRadius: '999px', textTransform: 'none', fontWeight: 900, minWidth: 90 }}
                                        >
                                          {layoutLabel}
                                        </Button>
                                      ))}
                                    </Box>
                                    {(block.options?.length ? block.options : ['Option']).map((option, optionIndex) => (
                                      <Box
                                        key={`${block.id}-panel-option-${optionIndex}`}
                                        sx={{ display: 'grid', gridTemplateColumns: { xs: 'auto 1fr auto', md: '88px 1fr auto' }, gap: 0.75, alignItems: 'center' }}
                                      >
                                        <Box sx={{ display: 'inline-flex', gap: 0.25 }}>
                                          <IconButton
                                            size="small"
                                            aria-label="Move option up"
                                            disabled={optionIndex === 0}
                                            onClick={() => nudgeGridCellBlockOption(selectedBuilderCell.row, selectedBuilderCell.column, blockIndex, optionIndex, -1)}
                                            sx={{ width: 30, height: 30, color: palette.brandDeep, border: `1px solid ${palette.brandSoft}` }}
                                          >
                                            <KeyboardArrowUpIcon fontSize="small" />
                                          </IconButton>
                                          <IconButton
                                            size="small"
                                            aria-label="Move option down"
                                            disabled={optionIndex >= (block.options?.length ? block.options : ['Option']).length - 1}
                                            onClick={() => nudgeGridCellBlockOption(selectedBuilderCell.row, selectedBuilderCell.column, blockIndex, optionIndex, 1)}
                                            sx={{ width: 30, height: 30, color: palette.brandDeep, border: `1px solid ${palette.brandSoft}` }}
                                          >
                                            <KeyboardArrowDownIcon fontSize="small" />
                                          </IconButton>
                                        </Box>
                                        <TextField
                                          size="small"
                                          label={`Option ${optionIndex + 1}`}
                                          value={option}
                                          onChange={e => updateGridCellBlockOption(selectedBuilderCell.row, selectedBuilderCell.column, blockIndex, optionIndex, e.target.value)}
                                        />
                                        <IconButton size="small" onClick={() => removeGridCellBlockOption(selectedBuilderCell.row, selectedBuilderCell.column, blockIndex, optionIndex)} disabled={(block.options?.length ? block.options : ['Option']).length <= 1} sx={{ color: palette.dangerStrong }}>
                                          <RemoveIcon fontSize="small" />
                                        </IconButton>
                                      </Box>
                                    ))}
                                    <Button size="small" startIcon={<AddIcon />} onClick={() => addGridCellBlockOption(selectedBuilderCell.row, selectedBuilderCell.column, blockIndex)} sx={{ justifySelf: 'start', borderRadius: '10px', textTransform: 'none', fontWeight: 900 }}>
                                      Add option
                                    </Button>
                                  </Box>
                                )}
                              </Box>
                            )
                          })}
                        </Box>
                      ) : (
                        <Box sx={{ p: 2, borderRadius: '12px', border: `1px dashed ${palette.brandPale}`, bgcolor: '#f5ffff' }}>
                          <Typography sx={{ color: palette.ink, fontWeight: 900 }}>
                            Empty cell. Choose Input, Radio, Checkboxes, Text, or Comments above.
                          </Typography>
                        </Box>
                      )}
                    </Card>
                  )}

                  <TableContainer sx={{ display: 'none', border: '1px solid #D8DEE9', borderRadius: '12px', maxHeight: 560, overflow: 'auto', bgcolor: palette.white }}>
                    <Table size="small" sx={{ tableLayout: 'fixed', borderCollapse: 'collapse' }}>
                      <TableBody>
                        {formBuilderSchema.custom_grid.cells.map((row, rowIndex) => (
                          <TableRow key={rowIndex}>
                            {row.map((cell, columnIndex) => {
                              if (cell.hidden) return null
                              const isSelected = selectedBuilderCell?.row === rowIndex && selectedBuilderCell?.column === columnIndex
                              const options = cell.options?.length ? cell.options : cell.type === 'radio' ? DEFAULT_GRID_OPTIONS : []
                              return (
                                <TableCell
                                  key={cell.id}
                                  colSpan={cell.colSpan || 1}
                                  rowSpan={cell.rowSpan || 1}
                                  onClick={() => setSelectedBuilderCell({ row: rowIndex, column: columnIndex })}
                                  sx={{
                                    width: cell.width || 180,
                                    minWidth: cell.width || 180,
                                    maxWidth: cell.width || 180,
                                    height: cell.height || 74,
                                    verticalAlign: cell.verticalAlign || 'middle',
                                    border: '1px solid #D8DEE9',
                                    bgcolor: isSelected ? palette.brandTint : rowIndex % 2 ? '#FAFAFA' : palette.white,
                                    outline: isSelected ? `2px solid ${palette.brand}` : 'none',
                                    outlineOffset: '-2px',
                                    cursor: 'pointer',
                                    position: 'relative',
                                    p: 0,
                                  }}
                                >
                                  <Box
                                    sx={{
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: 1,
                                      minHeight: Math.max(44, Number(cell.height || 74)),
                                      p: 1.25,
                                      alignItems: gridAlignItems(cell.align),
                                      justifyContent: gridJustifyContent(cell.verticalAlign),
                                      textAlign: cell.align || 'center',
                                    }}
                                  >
                                    <Typography sx={{ color: palette.textSubtle, fontSize: 12, fontWeight: 900 }}>
                                      Cell {rowIndex + 1}.{columnIndex + 1}
                                      {(cell.rowSpan || 1) > 1 || (cell.colSpan || 1) > 1
                                        ? ` · ${cell.rowSpan || 1}x${cell.colSpan || 1}`
                                        : ''}
                                    </Typography>
                                    {shouldShowGridCellTitle(cell) ? (
                                      <Typography sx={{ fontWeight: 900, color: palette.ink, textAlign: cell.align || 'center' }}>
                                        {cell.label}
                                      </Typography>
                                    ) : !cell.blocks?.length && cell.type === 'text' ? (
                                      <Typography sx={{ color: palette.textFaint, fontSize: 12, fontWeight: 800 }}>
                                        Click to edit
                                      </Typography>
                                    ) : null}
                                    {cell.blocks?.length ? renderBuilderGridCellBlocks(cell, rowIndex, columnIndex, isSelected) : null}
                                    {!cell.blocks?.length && cell.type === 'input' && (
                                      <TextField size="small" disabled fullWidth placeholder="" />
                                    )}
                                    {!cell.blocks?.length && cell.type === 'radio' && (
                                      <Box sx={{ display: 'grid', gap: 0.75 }}>
                                        <RadioGroup row sx={{ justifyContent: gridAlignItems(cell.align), gap: 0.5 }}>
                                          {options.map(option => (
                                            <FormControlLabel key={option} value={option} control={<Radio size="small" disabled />} label={option} />
                                          ))}
                                        </RadioGroup>
                                      </Box>
                                    )}
                                    {!cell.blocks?.length && cell.type === 'checkbox' && (
                                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: gridAlignItems(cell.align) }}>
                                        {options.length ? options.map(option => (
                                          <FormControlLabel key={option} control={<Checkbox size="small" disabled />} label={option} />
                                        )) : (
                                          <Checkbox size="small" disabled />
                                        )}
                                      </Box>
                                    )}
                                  </Box>
                                </TableCell>
                              )
                            })}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>

                  <TableContainer sx={{ border: '1px solid #D8DEE9', borderRadius: '12px', maxHeight: 560, overflow: 'auto', bgcolor: palette.white }}>
                    <Table size="small" sx={{ tableLayout: 'fixed', borderCollapse: 'collapse' }}>
                      <TableBody>
                        {formBuilderSchema.custom_grid.cells.map((row, rowIndex) => (
                          <TableRow
                            key={rowIndex}
                            onDragOver={(event) => {
                              if (builderDragRef.current?.kind !== 'row') return
                              event.preventDefault()
                            }}
                            onDrop={(event) => {
                              const activeDrag = builderDragRef.current
                              if (activeDrag?.kind !== 'row') return
                              event.preventDefault()
                              moveGridRow(activeDrag.rowIndex, rowIndex)
                              setBuilderDragState(null)
                            }}
                            sx={{ opacity: builderDrag?.kind === 'row' && builderDrag.rowIndex === rowIndex ? 0.4 : 1, transition: 'opacity 0.12s' }}
                          >
                            <TableCell
                              draggable
                              onMouseDown={(event) => {
                                event.stopPropagation()
                                setBuilderDragState({ kind: 'row', rowIndex })
                              }}
                              onDragStart={(event) => {
                                event.dataTransfer.effectAllowed = 'move'
                                event.dataTransfer.setData('application/x-grid-row-index', String(rowIndex))
                                setBuilderDragState({ kind: 'row', rowIndex })
                              }}
                              onDragEnd={() => setBuilderDragState(null)}
                              onClick={(event) => event.stopPropagation()}
                              sx={{
                                width: 22,
                                minWidth: 22,
                                maxWidth: 22,
                                p: 0,
                                border: '1px solid #D8DEE9',
                                bgcolor: palette.surface,
                                textAlign: 'center',
                                verticalAlign: 'middle',
                                cursor: 'grab',
                                '&:active': { cursor: 'grabbing' },
                                '&:hover': { bgcolor: palette.brandSoft },
                              }}
                            >
                              <Tooltip title={`Drag to reorder row ${rowIndex + 1}`} placement="left">
                                <DragIndicatorIcon sx={{ fontSize: 16, color: palette.textFaint, display: 'block', mx: 'auto' }} />
                              </Tooltip>
                            </TableCell>
                            {row.map((cell, columnIndex) => {
                              if (cell.hidden) return null
                              const isSelected = selectedBuilderCell?.row === rowIndex && selectedBuilderCell?.column === columnIndex
                              const options = cell.options?.length ? cell.options : cell.type === 'radio' ? DEFAULT_GRID_OPTIONS : []
                              return (
                                <TableCell
                                  key={cell.id}
                                  colSpan={cell.colSpan || 1}
                                  rowSpan={cell.rowSpan || 1}
                                  onClick={() => setSelectedBuilderCell({ row: rowIndex, column: columnIndex })}
                                  sx={{
                                    width: cell.width || 180,
                                    minWidth: cell.width || 180,
                                    maxWidth: cell.width || 180,
                                    height: cell.height || 74,
                                    verticalAlign: cell.verticalAlign || 'middle',
                                    border: '1px solid #D8DEE9',
                                    bgcolor: isSelected ? palette.brandTint : rowIndex % 2 ? '#FAFAFA' : palette.white,
                                    outline: isSelected ? `2px solid ${palette.brand}` : 'none',
                                    outlineOffset: '-2px',
                                    cursor: 'pointer',
                                    position: 'relative',
                                    p: 0,
                                  }}
                                >
                                  <Box
                                    sx={{
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: 1,
                                      minHeight: Math.max(44, Number(cell.height || 74)),
                                      p: 1.25,
                                      alignItems: gridAlignItems(cell.align),
                                      justifyContent: gridJustifyContent(cell.verticalAlign),
                                      textAlign: cell.align || 'center',
                                    }}
                                  >
                                    <Typography sx={{ color: palette.textSubtle, fontSize: 12, fontWeight: 900 }}>
                                      Cell {rowIndex + 1}.{columnIndex + 1}
                                      {(cell.rowSpan || 1) > 1 || (cell.colSpan || 1) > 1
                                        ? ` · ${cell.rowSpan || 1}x${cell.colSpan || 1}`
                                        : ''}
                                    </Typography>
                                    {shouldShowGridCellTitle(cell) ? (
                                      <Typography sx={{ fontWeight: 900, color: palette.ink, textAlign: cell.align || 'center' }}>
                                        {cell.label}
                                      </Typography>
                                    ) : !cell.blocks?.length && cell.type === 'text' ? (
                                      <Typography sx={{ color: palette.textFaint, fontSize: 12, fontWeight: 800 }}>
                                        Click to edit
                                      </Typography>
                                    ) : null}
                                    {cell.blocks?.length ? renderBuilderGridCellBlocks(cell, rowIndex, columnIndex, isSelected) : null}
                                    {!cell.blocks?.length && cell.type === 'input' && (
                                      <TextField size="small" disabled fullWidth placeholder="" />
                                    )}
                                    {!cell.blocks?.length && cell.type === 'radio' && (
                                      <Box sx={{ display: 'grid', gap: 0.75 }}>
                                        <RadioGroup row sx={{ justifyContent: gridAlignItems(cell.align), gap: 0.5 }}>
                                          {options.map(option => (
                                            <FormControlLabel key={option} value={option} control={<Radio size="small" disabled />} label={option} />
                                          ))}
                                        </RadioGroup>
                                      </Box>
                                    )}
                                    {!cell.blocks?.length && cell.type === 'checkbox' && (
                                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: gridAlignItems(cell.align) }}>
                                        {options.length ? options.map(option => (
                                          <FormControlLabel key={option} control={<Checkbox size="small" disabled />} label={option} />
                                        )) : (
                                          <Checkbox size="small" disabled />
                                        )}
                                      </Box>
                                    )}
                                    {isSelected && !cell.blocks?.length && optionCellTypes.includes(cell.type) && (
                                      <Box sx={{ display: 'grid', gap: 0.75, mt: 0.5 }}>
                                        {options.map((option, optionIndex) => {
                                          const isCellOptDragging = builderDrag?.kind === 'cell-option'
                                            && builderDrag.row === rowIndex && builderDrag.col === columnIndex
                                            && builderDrag.optionIndex === optionIndex
                                          return (
                                            <Box
                                              key={`${cell.id}-option-${optionIndex}`}
                                              onMouseEnter={() => {
                                                const drag = builderDragRef.current
                                                if (drag?.kind !== 'cell-option' || drag.row !== rowIndex || drag.col !== columnIndex || drag.optionIndex === optionIndex) return
                                                moveGridCellOption(rowIndex, columnIndex, drag.optionIndex, optionIndex)
                                                setBuilderDragState({ kind: 'cell-option', row: rowIndex, col: columnIndex, optionIndex })
                                              }}
                                              sx={{
                                                display: 'grid',
                                                gridTemplateColumns: 'auto 1fr auto',
                                                gap: 0.75,
                                                alignItems: 'center',
                                                opacity: isCellOptDragging ? 0.4 : 1,
                                                transition: 'opacity 0.1s',
                                              }}
                                            >
                                              <Tooltip title="Drag to reorder">
                                                <Box
                                                  onMouseDown={(event) => {
                                                    event.preventDefault()
                                                    event.stopPropagation()
                                                    setBuilderDragState({ kind: 'cell-option', row: rowIndex, col: columnIndex, optionIndex })
                                                  }}
                                                  sx={{
                                                    width: 24, height: 24,
                                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                                    cursor: 'grab', color: palette.textFaint, borderRadius: '6px',
                                                    '&:active': { cursor: 'grabbing' },
                                                    '&:hover': { bgcolor: palette.brandSoft, color: palette.brandDeep },
                                                  }}
                                                >
                                                  <DragIndicatorIcon sx={{ fontSize: 16 }} />
                                                </Box>
                                              </Tooltip>
                                              <TextField
                                                size="small"
                                                label={`Option ${optionIndex + 1}`}
                                                value={option}
                                                onChange={e => updateGridCellOption(rowIndex, columnIndex, optionIndex, e.target.value)}
                                                onClick={event => event.stopPropagation()}
                                                onMouseDown={event => event.stopPropagation()}
                                              />
                                              <IconButton
                                                size="small"
                                                onClick={(event) => {
                                                  event.stopPropagation()
                                                  removeGridCellOption(rowIndex, columnIndex, optionIndex)
                                                }}
                                                disabled={cell.type === 'radio' && options.length <= 1}
                                                sx={{ color: palette.dangerStrong }}
                                              >
                                                <RemoveIcon fontSize="small" />
                                              </IconButton>
                                            </Box>
                                          )
                                        })}
                                        <Button
                                          size="small"
                                          startIcon={<AddIcon />}
                                          onClick={(event) => {
                                            event.stopPropagation()
                                            addGridCellOption(rowIndex, columnIndex)
                                          }}
                                          sx={{ justifySelf: 'center', borderRadius: '10px', textTransform: 'none', fontWeight: 900 }}
                                        >
                                          Add option
                                        </Button>
                                      </Box>
                                    )}
                                  </Box>
                                  <Box
                                    onMouseDown={(event) => startGridCellResize(event, rowIndex, columnIndex, 'width')}
                                    onClick={event => event.stopPropagation()}
                                    sx={{
                                      position: 'absolute',
                                      top: 0,
                                      right: -3,
                                      width: 7,
                                      height: '100%',
                                      cursor: 'col-resize',
                                      zIndex: 2,
                                      '&:hover': { bgcolor: 'rgba(4,120,87, 0.18)' },
                                    }}
                                  />
                                  <Box
                                    onMouseDown={(event) => startGridCellResize(event, rowIndex, columnIndex, 'height')}
                                    onClick={event => event.stopPropagation()}
                                    sx={{
                                      position: 'absolute',
                                      left: 0,
                                      bottom: -3,
                                      width: '100%',
                                      height: 7,
                                      cursor: 'row-resize',
                                      zIndex: 2,
                                      '&:hover': { bgcolor: 'rgba(4,120,87, 0.18)' },
                                    }}
                                  />
                                </TableCell>
                              )
                            })}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              )}
              </Box>
              )}
            </Card>

            <Card sx={{ p: 2, borderRadius: '16px', border: `1px solid ${palette.border}`, boxShadow: 'none' }}>
              <Typography sx={{ fontWeight: 900, color: palette.ink }}>Biomed Notes</Typography>

              <Typography sx={{ color: palette.textMuted, fontSize: 13, fontWeight: 700 }}>
                Fixed default notes: Reported Problem, Problem Found, Corrective action taken, and Summary.
              </Typography>
            </Card>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setFormBuilderOpen(false)} sx={{ fontWeight: 900 }}>Cancel</Button>
          <Button
            startIcon={formBuilderMut.isPending ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : <SaveIcon />}
            onClick={saveFormBuilder}
            disabled={!canEditInspections || formBuilderMut.isPending}
            variant="contained"
            sx={{ borderRadius: '12px', fontWeight: 900, textTransform: 'none' }}
          >
            {formBuilderMode === 'report-custom' ? 'Apply Custom Form' : 'Save Form'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(reportInspection)} onClose={() => setReportInspection(null)} maxWidth="lg" fullWidth PaperProps={{ sx: { borderRadius: '22px' } }}>
        <DialogTitle sx={{ fontWeight: 900, color: palette.ink, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
          <Box>
            Technician Inspection Report
            <Typography sx={{ color: palette.textMuted, fontSize: 13, fontWeight: 700 }}>
              {reportInspection?.batch_number || reportInspection?.inspection_number} - {reportInspection?.asset_name || reportInspection?.equipment_name}
            </Typography>
          </Box>
          {renderLiveReportStatusChip()}
        </DialogTitle>
        <DialogContent dividers>
          {report && (
            <Box sx={{ display: 'grid', gap: 3 }}>
              <Card sx={{ p: 2, borderRadius: '16px', border: `1px solid ${palette.brandSoft}`, bgcolor: '#f5ffff' }}>
                <Typography sx={{ fontWeight: 900, color: palette.ink, mb: 0.5 }}>Report Activity Form</Typography>
                <Typography sx={{ color: palette.textMuted, fontSize: 13, fontWeight: 700, mb: 1.5 }}>
                  Choose the form source for this inspection report. Custom forms can be saved for future assets.
                </Typography>
                <RadioGroup row value={reportFormSource} onChange={(event) => applyReportFormSource(event.target.value as ReportFormSource)}>
                  <FormControlLabel
                    value="default"
                    control={<Radio />}
                    label={`Default Form${defaultReportForm?.name ? ` - ${defaultReportForm.name}` : ''}`}
                  />
                  <FormControlLabel
                    value="attached"
                    disabled={!reportInspection?.attached_form_id}
                    control={<Radio />}
                    label={reportInspection?.attached_form_id ? `Asset Attached Form - ${reportInspection.attached_form_name}` : 'Asset Attached Form - none attached'}
                  />
                  <FormControlLabel
                    value="existing"
                    disabled={formsQ.isLoading || inspectionForms.length === 0}
                    control={<Radio />}
                    label="Existing Form"
                  />
                  <FormControlLabel value="custom" control={<Radio />} label="Customize Form" />
                </RadioGroup>
                <Box sx={{ mt: 1.5, p: 1.5, borderRadius: '14px', bgcolor: palette.white, border: reportFormSource === 'existing' ? `1px solid ${palette.brand}` : `1px solid ${palette.brandSoft}`, maxWidth: 620 }}>
                  <Typography sx={{ fontWeight: 900, color: palette.ink, mb: 0.75 }}>
                    Use Existing Inspection Form
                  </Typography>
                  <TextField
                    select
                    fullWidth
                    size="small"
                    label="Select from saved Inspection Forms"
                    value={reportFormSource === 'existing' ? selectedReportFormId || '' : ''}
                    onChange={e => {
                      const formId = Number(e.target.value)
                      const template = inspectionForms.find(form => form.id === formId) || null
                      const schema = template ? schemaForForm(template) : null
                      setReportFormSource('existing')
                      setSelectedReportFormId(formId || null)
                      setReportCustomSchema(schema)
                      setReport((prev: any) => mergeSchemaDefaultsIntoReport(prev, schema))
                    }}
                    disabled={formsQ.isLoading || inspectionForms.length === 0}
                    helperText={
                      formsQ.isLoading
                        ? 'Loading saved inspection forms...'
                        : inspectionForms.length
                          ? 'Selecting a form here will use that saved form for this report.'
                          : 'No saved inspection forms are available yet.'
                    }
                  >
                    {inspectionForms.map(form => (
                      <MenuItem key={form.id} value={form.id}>
                        {form.name}
                      </MenuItem>
                    ))}
                  </TextField>
                </Box>
                {reportFormSource === 'custom' && (
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1.4fr auto' }, gap: 1.5, mt: 1.5, alignItems: 'center' }}>
                    <TextField size="small" label="Reusable Form Name" value={customFormName} onChange={e => setCustomFormName(e.target.value)} />
                    <TextField size="small" label="Description" value={customFormDescription} onChange={e => setCustomFormDescription(e.target.value)} />
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <FormControlLabel
                        control={<Checkbox checked={saveCustomForm} onChange={e => setSaveCustomForm(e.target.checked)} />}
                        label="Save to Inspection Forms"
                      />
                      <Button size="small" startIcon={<EditIcon />} variant="outlined" onClick={openReportCustomBuilder} sx={{ borderRadius: '12px', textTransform: 'none', fontWeight: 900 }}>
                        Edit Fields
                      </Button>
                      <Button
                        size="small"
                        startIcon={saveCustomTemplateMut.isPending ? <CircularProgress size={16} /> : <SaveIcon />}
                        variant="contained"
                        onClick={() => saveCustomTemplateMut.mutate()}
                        disabled={saveCustomTemplateMut.isPending || (!reportCustomSchema?.custom_grid && !reportCustomSchema?.formio_form?.components)}
                        sx={{ borderRadius: '12px', textTransform: 'none', fontWeight: 900 }}
                      >
                        Save Form Only
                      </Button>
                    </Box>
                  </Box>
                )}
              </Card>
              {isCustomGridReport() ? (
                <>
                  {renderFixedInspectionTable()}
                  {activeReportSchema?.canvas_form?.elements?.length
                    ? renderCanvasReport()
                    : activeReportSchema?.formio_form || report?.formio_form
                      ? renderFormioReport()
                      : renderCustomGridReport()}
                  {renderBiomedNotes()}
                </>
              ) : renderDefaultReportCore()}
              <Divider />
              <Typography sx={{ fontWeight: 900, color: palette.ink }}>Operational Report Details</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1.2fr 1fr' }, gap: 2 }}>
                <Card sx={{ p: 2, borderRadius: '16px', border: `1px solid ${palette.borderSoft}` }}>
                  <Typography sx={{ fontWeight: 900, color: palette.ink, mb: 1 }}>Measurements</Typography>
                  {(report.measurements || []).map((item: any, index: number) => (
                    <Box key={index} sx={{ display: 'grid', gridTemplateColumns: '1.1fr 0.8fr 0.8fr 0.6fr 0.8fr', gap: 1, mb: 1 }}>
                      <TextField size="small" label="Measurement" value={item.name} onChange={e => updateArrayReport('measurements', index, 'name', e.target.value)} />
                      <TextField size="small" label="Set" value={item.set_value} onChange={e => updateArrayReport('measurements', index, 'set_value', e.target.value)} />
                      <TextField size="small" label="Read" value={item.read_value} onChange={e => updateArrayReport('measurements', index, 'read_value', e.target.value)} />
                      <TextField size="small" label="Unit" value={item.unit} onChange={e => updateArrayReport('measurements', index, 'unit', e.target.value)} />
                      <TextField size="small" select label="Status" value={item.status} onChange={e => updateArrayReport('measurements', index, 'status', e.target.value)}>
                        <MenuItem value="pass">Pass</MenuItem>
                        <MenuItem value="fail">Fail</MenuItem>
                      </TextField>
                    </Box>
                  ))}
                </Card>
                <Card sx={{ p: 2, borderRadius: '16px', border: `1px solid ${palette.borderSoft}` }}>
                  <Typography sx={{ fontWeight: 900, color: palette.ink, mb: 1 }}>Photo Documentation</Typography>
                  {(report.photo_documentation || []).map((item: any, index: number) => (
                    <Box key={index} sx={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 1, mb: 1 }}>
                      <TextField size="small" label="Label" value={item.label} onChange={e => updateArrayReport('photo_documentation', index, 'label', e.target.value)} />
                      <TextField size="small" label="Photo URL / reference" value={item.url} onChange={e => updateArrayReport('photo_documentation', index, 'url', e.target.value)} />
                    </Box>
                  ))}
                </Card>
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '180px 1fr 1fr' }, gap: 2 }}>
                <TextField select label="Certified" value={report.compliance?.certified || 'yes'} onChange={e => updateReport('compliance', 'certified', e.target.value)}>
                  <MenuItem value="yes">Yes</MenuItem>
                  <MenuItem value="conditional">Conditional</MenuItem>
                  <MenuItem value="no">No</MenuItem>
                </TextField>
                <TextField label="Compliance Standard" value={report.compliance?.standard || ''} onChange={e => updateReport('compliance', 'standard', e.target.value)} />
                <TextField label="Recommendations" value={report.compliance?.recommendations || ''} onChange={e => updateReport('compliance', 'recommendations', e.target.value)} />
              </Box>
              <Divider />
              <Typography sx={{ fontWeight: 900, color: palette.ink }}>Parts & Test Equipment</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
                <Card sx={{ p: 2, borderRadius: '16px', border: `1px solid ${palette.borderSoft}` }}>
                  <Autocomplete
                    multiple
                    options={reportPartsQ.data?.items || []}
                    inputValue={partSearch}
                    onInputChange={(_, value, reason) => {
                      if (reason !== 'reset') setPartSearch(value)
                    }}
                    filterOptions={(options) => options}
                    value={(report.parts || []).filter((selected: any) => selected.id)}
                    onChange={(_, value) => setReport((prev: any) => ({
                      ...prev,
                      parts: value.length ? value.map(inventoryPartSnapshot) : [{ description: '', part_number: '', price: 0, condition: '' }],
                    }))}
                    getOptionLabel={(option) => `${option.part_number}${option.description ? ` - ${option.description}` : ''}`}
                    isOptionEqualToValue={(option, value) => option.id === value.id}
                    loading={reportPartsQ.isLoading}
                    renderOption={(props, option) => (
                      <Box component="li" {...props} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Avatar variant="rounded" sx={{ width: 34, height: 34, bgcolor: palette.indigoTint, color: palette.indigo, fontWeight: 900 }}>
                          {(option.part_number || 'P').slice(0, 1).toUpperCase()}
                        </Avatar>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography sx={{ fontWeight: 800 }}>{option.part_number}</Typography>
                          <Typography variant="caption" sx={{ color: palette.textMuted }}>
                            {[option.description, option.make, option.model, option.serial_number].filter(Boolean).join(' / ') || 'No details'}
                          </Typography>
                        </Box>
                      </Box>
                    )}
                    renderInput={(params) => (
                      <TextField {...params} size="small" label="Select Parts Used" placeholder="Attach used parts from inventory" />
                    )}
                    sx={{ mb: 1.5 }}
                  />
                  {(report.parts || []).map((part: any, index: number) => (
                    <Box key={index} sx={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 0.8fr 1fr', gap: 1, mb: 1 }}>
                      <TextField size="small" label="Description" value={part.description} onChange={e => updateArrayReport('parts', index, 'description', e.target.value)} />
                      <TextField size="small" label="Part #" value={part.part_number} onChange={e => updateArrayReport('parts', index, 'part_number', e.target.value)} />
                      <NumericField size="small" label="Price" value={part.price} onChange={val => updateArrayReport('parts', index, 'price', val)} />
                      <TextField size="small" label="Condition" value={part.condition} onChange={e => updateArrayReport('parts', index, 'condition', e.target.value)} />
                    </Box>
                  ))}
                </Card>
                <Card sx={{ p: 2, borderRadius: '16px', border: `1px solid ${palette.borderSoft}` }}>
                  <Autocomplete
                    multiple
                    options={testEquipmentQ.data?.items || []}
                    inputValue={testEquipmentSearch}
                    onInputChange={(_, value, reason) => {
                      if (reason !== 'reset') setTestEquipmentSearch(value)
                    }}
                    filterOptions={(options) => options}
                    value={(report.test_equipment || []).filter((selected: any) => selected.id)}
                    onChange={(_, value) => setReport((prev: any) => ({ ...prev, test_equipment: value.map(testEquipmentSnapshot) }))}
                    getOptionLabel={(option) => `${option.tem}${option.serial_number ? ` - ${option.serial_number}` : ''}`}
                    isOptionEqualToValue={(option, value) => option.id === value.id}
                    loading={testEquipmentQ.isLoading}
                    renderOption={(props, option) => (
                      <Box component="li" {...props} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Avatar src={resolveUploadUrl(option.image_url)} variant="rounded" sx={{ width: 34, height: 34, bgcolor: palette.brandTint, color: palette.brand }}>
                          <AssessmentIcon fontSize="small" />
                        </Avatar>
                        <Box>
                          <Typography sx={{ fontWeight: 800 }}>{option.tem}</Typography>
                          <Typography variant="caption" sx={{ color: palette.textMuted }}>
                            {[option.mrf, option.model, option.serial_number].filter(Boolean).join(' / ') || 'No details'}
                          </Typography>
                        </Box>
                      </Box>
                    )}
                    renderInput={(params) => (
                      <TextField {...params} size="small" label="Select Test Equipment" placeholder="Attach used equipment" />
                    )}
                    sx={{ mb: 1.5 }}
                  />
                  {(report.test_equipment || []).map((item: any, index: number) => (
                    <Box key={index} sx={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 1, mb: 1 }}>
                      <TextField size="small" label="Description" value={item.description} onChange={e => updateArrayReport('test_equipment', index, 'description', e.target.value)} />
                      <TextField size="small" label="Make" value={item.make} onChange={e => updateArrayReport('test_equipment', index, 'make', e.target.value)} />
                      <TextField size="small" label="SN #" value={item.serial_number} onChange={e => updateArrayReport('test_equipment', index, 'serial_number', e.target.value)} />
                    </Box>
                  ))}
                </Card>
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 2 }}>
                <NumericField label="Parts" value={report.billing.parts} onChange={val => updateReport('billing', 'parts', val)} />
                <NumericField label="Inspection Charges" value={report.billing.inspection_charges} onChange={val => updateReport('billing', 'inspection_charges', val)} />
                <NumericField label="Others" value={report.billing.others} onChange={val => updateReport('billing', 'others', val)} />
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(4, 1fr)' }, gap: 2 }}>
                {Object.entries(report.dates || {}).map(([key, value]) => (
                  <TextField key={key} label={labelFromKey(key)} type={key.includes('date') ? 'date' : 'text'} value={value as string} onChange={e => updateReport('dates', key, e.target.value)} InputLabelProps={{ shrink: true }} />
                ))}
              </Box>
              <TextField
                select
                label="Report Status"
                value={reportStatus}
                onChange={e => setReportStatus(e.target.value as 'completed' | 'in_progress')}
                sx={{ maxWidth: 260 }}
              >
                <MenuItem value="completed">Completed</MenuItem>
                <MenuItem value="in_progress">In Progress</MenuItem>
              </TextField>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setReportInspection(null)} sx={{ fontWeight: 900 }}>Cancel</Button>
          <Button startIcon={reportMut.isPending ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : <SaveIcon />} onClick={submitReport} disabled={!canEditInspections || reportMut.isPending} variant="contained" sx={{ borderRadius: '12px', fontWeight: 900, textTransform: 'none' }}>
            {reportStatus === 'completed' ? 'Complete Report' : 'Save as In Progress'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(rescheduleInspection)} onClose={() => !rescheduleMut.isPending && setRescheduleInspection(null)} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: '20px' } }}>
        <DialogTitle sx={{ fontWeight: 900, color: palette.ink }}>
          {rescheduleInspection?.status === 'closed' ? 'Reschedule & Reopen Inspection' : 'Reschedule Inspection'}
          <Typography sx={{ mt: 0.5, color: palette.textMuted, fontSize: 13, fontWeight: 700 }}>
            {rescheduleInspection?.inspection_number}
          </Typography>
        </DialogTitle>
        <DialogContent dividers>
          <TextField
            fullWidth
            type="datetime-local"
            label="Scheduled date and time"
            value={rescheduleDate}
            onChange={event => setRescheduleDate(event.target.value)}
            InputLabelProps={{ shrink: true }}
            helperText={rescheduleInspection?.status === 'closed'
              ? 'Saving will return this inspection to Upcoming. Past dates are allowed.'
              : 'Past dates are allowed when correcting or backdating the schedule.'}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setRescheduleInspection(null)} disabled={rescheduleMut.isPending} sx={{ fontWeight: 800 }}>Cancel</Button>
          <Button
            variant="contained"
            onClick={submitReschedule}
            disabled={!rescheduleDate || rescheduleMut.isPending}
            startIcon={rescheduleMut.isPending ? <CircularProgress size={18} color="inherit" /> : <EventAvailableIcon />}
            sx={{ borderRadius: '12px', fontWeight: 900, textTransform: 'none' }}
          >
            {rescheduleInspection?.status === 'closed' ? 'Reopen with Schedule' : 'Save Schedule'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(closeInspectionTarget)} onClose={() => !closeInspectionMut.isPending && setCloseInspectionTarget(null)} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: '20px' } }}>
        <DialogTitle sx={{ fontWeight: 900, color: palette.ink }}>Close Inspection?</DialogTitle>
        <DialogContent dividers>
          <Typography sx={{ color: palette.slate600, fontWeight: 650, lineHeight: 1.65 }}>
            {closeInspectionTarget?.inspection_number} will be removed from Upcoming without being completed or deleted. Its audit record will remain available.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setCloseInspectionTarget(null)} disabled={closeInspectionMut.isPending} sx={{ fontWeight: 800 }}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => closeInspectionTarget && closeInspectionMut.mutate(closeInspectionTarget.id)}
            disabled={closeInspectionMut.isPending}
            startIcon={closeInspectionMut.isPending ? <CircularProgress size={18} color="inherit" /> : <CancelIcon />}
            sx={{ borderRadius: '12px', fontWeight: 900, textTransform: 'none' }}
          >
            Close Inspection
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(reopenInspectionTarget)} onClose={() => !reopenInspectionMut.isPending && setReopenInspectionTarget(null)} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: '20px' } }}>
        <DialogTitle sx={{ fontWeight: 900, color: palette.ink }}>Reopen Inspection?</DialogTitle>
        <DialogContent dividers>
          <Typography sx={{ color: palette.slate600, fontWeight: 650, lineHeight: 1.65 }}>
            {reopenInspectionTarget?.inspection_number} will return to Upcoming using its existing scheduled date of {formatDate(reopenInspectionTarget?.scheduled_date)}.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setReopenInspectionTarget(null)} disabled={reopenInspectionMut.isPending} sx={{ fontWeight: 800 }}>Cancel</Button>
          <Button
            color="success"
            variant="contained"
            onClick={() => reopenInspectionTarget && reopenInspectionMut.mutate(reopenInspectionTarget.id)}
            disabled={reopenInspectionMut.isPending}
            startIcon={reopenInspectionMut.isPending ? <CircularProgress size={18} color="inherit" /> : <EventAvailableIcon />}
            sx={{ borderRadius: '12px', fontWeight: 900, textTransform: 'none' }}
          >
            Reopen Inspection
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(infoInspection)} onClose={closeInspectionInfo} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: '22px' } }}>
        <DialogTitle sx={{ color: palette.ink }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
            <Box>
              <Typography sx={{ fontWeight: 900, color: palette.ink, fontSize: '1.15rem' }}>Inspection Details</Typography>
              <Typography sx={{ color: palette.textMuted, fontSize: 13, fontWeight: 700 }}>
                {infoEditing ? 'Edit upcoming inspection information' : 'Inspection information'}
              </Typography>
            </Box>
            {canEditInspections && infoInspection?.status === 'upcoming' && !infoEditing && (
              <Tooltip title="Edit inspection details">
                <IconButton
                  onClick={() => setInfoEditing(true)}
                  sx={{ bgcolor: palette.brandTint, color: palette.brand, '&:hover': { bgcolor: palette.brandSoft } }}
                >
                  <EditIcon />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          {infoInspection && (
            <Box sx={{ display: 'grid', gap: 2 }}>
              {infoEditing && infoDraft && (
                <Card sx={{ p: 2.25, borderRadius: '16px', border: `1px solid ${palette.brandBorder}`, bgcolor: '#FAFAFF' }}>
                  <Typography sx={{ mb: 2, color: palette.ink, fontWeight: 900 }}>Editable scheduling information</Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
                    <TextField
                      type="datetime-local"
                      label="Scheduled date and time"
                      value={infoDraft.scheduledDate}
                      onChange={event => setInfoDraft(previous => previous ? { ...previous, scheduledDate: event.target.value } : previous)}
                      InputLabelProps={{ shrink: true }}
                      helperText="Past dates are allowed when correcting or backdating the schedule."
                      required
                    />
                    <TextField
                      select
                      label="Frequency"
                      value={infoDraft.frequency}
                      onChange={event => setInfoDraft(previous => previous ? { ...previous, frequency: event.target.value } : previous)}
                      required
                    >
                      {!['instant', 'quarterly', 'semi_annual', 'annual'].includes(infoDraft.frequency) && (
                        <MenuItem value={infoDraft.frequency}>{infoDraft.frequency.replace(/_/g, ' ')}</MenuItem>
                      )}
                      <MenuItem value="instant">Instant</MenuItem>
                      <MenuItem value="quarterly">Quarterly</MenuItem>
                      <MenuItem value="semi_annual">Semi-Annual</MenuItem>
                      <MenuItem value="annual">Annual</MenuItem>
                    </TextField>
                    <TextField
                      label="Criticality"
                      value={infoDraft.criticality}
                      onChange={event => setInfoDraft(previous => previous ? { ...previous, criticality: event.target.value } : previous)}
                      placeholder="For example: High"
                    />
                    <SearchableSelect<number>
                      label="Assigned technician"
                      value={infoDraft.inspectorId}
                      onChange={inspectorId => setInfoDraft(previous => previous ? { ...previous, inspectorId } : previous)}
                      options={infoTechnicians.map((user: UserData) => ({
                        value: user.id,
                        label: user.full_name || user.username,
                        secondary: `${user.role.replace(/_/g, ' ')} · ${user.email}`,
                        keywords: `${user.username} ${user.email} ${user.role}`,
                      }))}
                      placeholder="Search technician name, username, or email"
                      helperText="Leave empty to keep the inspection unassigned"
                    />
                    <SearchableSelect<number>
                      label="Inspection form"
                      value={infoDraft.formTemplateId}
                      onChange={formTemplateId => setInfoDraft(previous => previous ? { ...previous, formTemplateId: Number(formTemplateId) } : previous)}
                      disabled={formsQ.isLoading}
                      required
                      options={inspectionForms.map(form => ({
                        value: form.id,
                        label: form.name,
                        secondary: form.description || `Inspection form #${form.id}`,
                        keywords: `${form.id} ${form.description || ''}`,
                      }))}
                      placeholder="Search inspection forms"
                    />
                    <TextField
                      label="Compliance requirement"
                      value={infoDraft.complianceRequirement}
                      onChange={event => setInfoDraft(previous => previous ? { ...previous, complianceRequirement: event.target.value } : previous)}
                      multiline
                      minRows={3}
                      sx={{ gridColumn: { md: '1 / -1' } }}
                    />
                  </Box>
                  <Typography sx={{ mt: 1.5, color: palette.textSubtle, fontSize: 12.5, fontWeight: 700 }}>
                    Facility, equipment, asset tag, serial number, and batch identity stay read-only to protect inspection history.
                  </Typography>
                </Card>
              )}
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 2 }}>
                <Card sx={{ p: 2, borderRadius: '16px', border: `1px solid ${palette.borderSoft}` }}>
                  <Typography sx={{ color: palette.textMuted, fontSize: 12, fontWeight: 900, textTransform: 'uppercase' }}>Inspection #</Typography>
                  <Typography sx={{ color: palette.brand, fontWeight: 900, fontFamily: 'monospace' }}>{infoInspection.inspection_number}</Typography>
                </Card>
                <Card sx={{ p: 2, borderRadius: '16px', border: `1px solid ${palette.borderSoft}` }}>
                  <Typography sx={{ color: palette.textMuted, fontSize: 12, fontWeight: 900, textTransform: 'uppercase' }}>Status</Typography>
                  <Chip
                    size="small"
                    label={String(infoInspection.status).replace(/_/g, ' ')}
                    sx={{
                      mt: 1,
                      fontWeight: 900,
                      textTransform: 'uppercase',
                      bgcolor: statusChip(infoInspection.status).bg,
                      color: statusChip(infoInspection.status).color,
                    }}
                  />
                </Card>
                <Card sx={{ p: 2, borderRadius: '16px', border: `1px solid ${palette.borderSoft}` }}>
                  <Typography sx={{ color: palette.textMuted, fontSize: 12, fontWeight: 900, textTransform: 'uppercase' }}>Scheduled</Typography>
                  <Typography sx={{ color: palette.ink, fontWeight: 900 }}>{formatDate(infoInspection.scheduled_date)}</Typography>
                </Card>
              </Box>

              <Card sx={{ p: 2, borderRadius: '16px', border: `1px solid ${palette.borderSoft}`, bgcolor: palette.surface }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' }, gap: 2 }}>
                  {[
                    ['Facility', infoInspection.facility_name || '-'],
                    ['Asset / Equipment', infoInspection.asset_name || infoInspection.equipment_name || infoInspection.inventory_part_name || '-'],
                    ['Asset Tag', infoInspection.asset_tag || '-'],
                    ['Serial #', infoInspection.serial_number || '-'],
                    ['Make / Model', [infoInspection.make, infoInspection.model].filter(Boolean).join(' / ') || '-'],
                    ['Tier', infoInspection.tier_name || '-'],
                    ['Frequency', String(infoInspection.inspection_frequency || '-').replace(/_/g, ' ')],
                    ['Criticality', infoInspection.criticality || '-'],
                    ['Technician', infoInspection.inspector_name || '-'],
                    ['Batch', infoInspection.batch_number || '-'],
                  ].map(([label, value]) => (
                    <Box key={label}>
                      <Typography sx={{ color: palette.textMuted, fontSize: 12, fontWeight: 900, textTransform: 'uppercase' }}>{label}</Typography>
                      <Typography sx={{ color: palette.ink, fontWeight: 800 }}>{value}</Typography>
                    </Box>
                  ))}
                  <Box sx={{ gridColumn: '1 / -1' }}>
                    <Typography sx={{ color: palette.textMuted, fontSize: 12, fontWeight: 900, textTransform: 'uppercase' }}>Requirement</Typography>
                    <Typography sx={{ color: palette.ink, fontWeight: 800, whiteSpace: 'pre-wrap' }}>{infoInspection.compliance_requirement || '-'}</Typography>
                  </Box>
                </Box>
              </Card>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          {infoEditing ? (
            <>
              <Button onClick={cancelInspectionDetailsEdit} disabled={updateDetailsMut.isPending} sx={{ fontWeight: 900, textTransform: 'none' }}>Cancel</Button>
              <Button
                onClick={submitInspectionDetails}
                disabled={!infoDraft?.scheduledDate || !infoDraft?.formTemplateId || updateDetailsMut.isPending}
                startIcon={updateDetailsMut.isPending ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
                variant="contained"
                sx={{ borderRadius: '12px', fontWeight: 900, textTransform: 'none' }}
              >
                Save Changes
              </Button>
            </>
          ) : (
            <>
              {infoInspection?.status === 'closed' && canEditInspections && (
                <>
                  <Button
                    onClick={() => {
                      const inspection = infoInspection
                      closeInspectionInfo()
                      if (inspection) openRescheduleDialog(inspection)
                    }}
                    variant="outlined"
                    startIcon={<EditIcon />}
                    sx={{ borderRadius: '12px', fontWeight: 900, textTransform: 'none' }}
                  >
                    Reschedule & Reopen
                  </Button>
                  <Button
                    onClick={() => {
                      const inspection = infoInspection
                      closeInspectionInfo()
                      setReopenInspectionTarget(inspection)
                    }}
                    color="success"
                    variant="outlined"
                    startIcon={<EventAvailableIcon />}
                    sx={{ borderRadius: '12px', fontWeight: 900, textTransform: 'none' }}
                  >
                    Reopen
                  </Button>
                </>
              )}
              <Button onClick={closeInspectionInfo} variant="contained" sx={{ borderRadius: '12px', fontWeight: 900, textTransform: 'none' }}>Done</Button>
            </>
          )}
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(viewReport)} onClose={() => setViewReport(null)} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: '22px' } }}>
        <DialogTitle sx={{ fontWeight: 900, color: palette.ink }}>
          Inspection Report
          <Typography sx={{ color: palette.textMuted, fontSize: 13, fontWeight: 700 }}>
            {viewReport?.inspection_number} - {viewReport?.asset_name}
          </Typography>
        </DialogTitle>
        <DialogContent dividers sx={{ p: 0, bgcolor: palette.brandTint }}>
          <Box
            component="iframe"
            title="Inspection report preview"
            srcDoc={viewReportHtml}
            sx={{ width: '100%', height: '72vh', border: 'none', display: 'block' }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          {viewReport?.status === 'completed' && (
            <Button
              startIcon={generateInvoiceMut.isPending ? <CircularProgress size={18} /> : <ReceiptLongIcon />}
              onClick={() => viewReport && generateInvoiceMut.mutate(viewReport.id)}
              disabled={!canEditInspections || Boolean(viewReport.invoice) || generateInvoiceMut.isPending}
              variant="outlined"
              sx={{ borderRadius: '12px', fontWeight: 900, textTransform: 'none', color: palette.brandStrong, borderColor: palette.brandStrong, '&:hover': { borderColor: palette.brand, bgcolor: palette.successTint } }}
            >
              {viewReport.invoice ? 'Invoice Generated' : 'Generate Invoice'}
            </Button>
          )}
          <Button onClick={() => viewReport && printInspectionReport(viewReport)} variant="outlined" sx={{ borderRadius: '12px', fontWeight: 900, textTransform: 'none' }}>Print Report</Button>
          <Button onClick={() => setViewReport(null)} variant="contained" sx={{ borderRadius: '12px', fontWeight: 900, textTransform: 'none' }}>Close</Button>
        </DialogActions>
      </Dialog>

    </Box>
  )
}

export default Inspections
