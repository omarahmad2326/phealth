import { useState, useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Dialog, DialogContent, DialogActions,
  Button, TextField, Grid, Box, Typography, IconButton,
  MenuItem, CircularProgress, Divider, Tabs, Tab, Checkbox, 
  FormControlLabel, Autocomplete, Skeleton
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import BusinessIcon from '@mui/icons-material/Business'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import DeleteIcon from '@mui/icons-material/Delete'
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile'
import DownloadIcon from '@mui/icons-material/Download'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { toast } from 'react-toastify'

import { 
  createFacility, updateFacility, searchFacilities,
  uploadFacilityDocument, fetchFacilityDocuments, downloadFacilityDocument, deleteFacilityDocument, exportFacilityPdf,
  type Facility, type FacilityCreate 
} from '@/api/facilities'
import { FACILITY_TIMEZONE_OPTIONS, formatUSPhoneInput, normalizeFacilityTimezone } from '@/utils/formatters'
import { useListContext } from '@/contexts/ListContext'
import { palette } from '@/theme/palette'

const schema = z.object({
  // General Info
  name: z.string().min(2, 'Name must be at least 2 characters'),
  contact_person: z.string().optional().nullable(),
  phone: z.string().min(7, 'Valid phone is required'),
  email: z.string().email('Valid email is required'),
  address: z.string().min(5, 'Address is required'),
  suite: z.string().optional().nullable(),
  city: z.string().min(2, 'City is required'),
  state: z.string().min(2, 'State is required'),
  zip_code: z.string().min(3, 'Zip code is required'),
  country: z.string().min(2, 'Country is required'),
  website: z.string().optional().nullable(),
  timezone: z.string().default('America/Chicago'),
  operating_hours: z.string().optional().nullable(),
  
  // Size, for the inspection dashboard
  beds: z.coerce.number().min(0).max(100000).nullable().optional(),
  area_sqft: z.coerce.number().min(0).max(100000000).nullable().optional(),
  size_band: z.string().optional().nullable(),

  // Details
  parent_facility_id: z.number().nullable().optional(),
  status: z.string().default('active'),
  tier_id: z.coerce.number().nullable().optional(),

  // Billing
  billing_name: z.string().optional().nullable(),
  billing_email: z.string().optional().nullable(),
  billing_street: z.string().optional().nullable(),
  billing_suite: z.string().optional().nullable(),
  billing_city: z.string().optional().nullable(),
  billing_state: z.string().optional().nullable(),
  billing_zip_code: z.string().optional().nullable(),

  // Other
  tax_exemption: z.boolean().default(false),
  inheritance: z.string().optional().nullable(),
  installment_type: z.string().optional().nullable(),
  payment_method: z.string().optional().nullable(),
  delivery_email: z.string().optional().nullable(),
})

type FormData = z.infer<typeof schema>

const INHERITANCE_OPTIONS = ['Full', 'Partial', 'None']
const INSTALLMENT_OPTIONS = ['Monthly', 'Quarterly', 'Annual', 'One-time']
const PAYMENT_OPTIONS = ['Credit Card', 'Wire Transfer', 'Check', 'ACH']

interface Props {
  open: boolean
  onClose: () => void
  facility?: Facility | null
  /**
   * Offer to jump to the facilities list after saving. False when the form is
   * opened from a site's own dashboard, where a link away to a list of every
   * hospital is the opposite of useful.
   */
  locateOnSave?: boolean
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function CustomTabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`simple-tabpanel-${index}`}
      aria-labelledby={`simple-tab-${index}`}
      {...other}
      style={{ height: '100%', outline: 'none' }}
    >
      {value === index && (
        <Box sx={{ py: 3, outline: 'none' }}>
          {children}
        </Box>
      )}
    </div>
  );
}

const FacilityFormModal = ({ open, onClose, facility, locateOnSave = true }: Props) => {
  const queryClient = useQueryClient()
  const { focusRecord } = useListContext()
  const isEdit = !!facility && facility.id !== 0
  const isDuplicate = !!facility && facility.id === 0

  const [activeTab, setActiveTab] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const { control, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '', contact_person: '', phone: '', email: '', 
      address: '', suite: '', city: '', state: '', zip_code: '', country: '', 
      website: '', timezone: 'America/Chicago', operating_hours: '',
      parent_facility_id: null, status: 'active', tier_id: null,
      billing_name: '', billing_email: '', billing_street: '', billing_suite: '', 
      billing_city: '', billing_state: '', billing_zip_code: '',
      tax_exemption: false, inheritance: '', installment_type: '', payment_method: '', delivery_email: ''
    },
  })

  useEffect(() => {
    if (open) {
      setActiveTab(0);
      setUploadFile(null);
    }
    
    if (facility && open) {
      // Need to clean nulls to empty strings where applicable to avoid controlled component warnings
      const cleanedData: any = {};
      Object.keys(facility).forEach(key => {
        cleanedData[key] = (facility as any)[key] === null && key !== 'parent_facility_id' && key !== 'tier_id' ? '' : (facility as any)[key];
      });
      
      reset({
        ...cleanedData,
        timezone: normalizeFacilityTimezone(cleanedData.timezone),
        phone: formatUSPhoneInput(cleanedData.phone),
        tax_exemption: facility.tax_exemption || false,
      });
    } else if (open) {
      reset({
        name: '', contact_person: '', phone: '', email: '', 
        address: '', suite: '', city: '', state: '', zip_code: '', country: '', 
        website: '', timezone: 'America/Chicago', operating_hours: '',
        parent_facility_id: null, status: 'active', tier_id: null,
        billing_name: '', billing_email: '', billing_street: '', billing_suite: '', 
        billing_city: '', billing_state: '', billing_zip_code: '',
        tax_exemption: false, inheritance: '', installment_type: '', payment_method: '', delivery_email: ''
      })
    }
  }, [facility, open, reset])

  const mutation = useMutation({
    mutationFn: (data: FacilityCreate) =>
      isEdit ? updateFacility(facility!.id, data) : createFacility(data, isDuplicate),
    onSuccess: (savedFacility) => {
      toast.success(isEdit ? 'Facility updated successfully!' : 'Facility created successfully!')
      if (locateOnSave) {
        focusRecord(`facility-${savedFacility.id}`, savedFacility.name, {
          message: isEdit ? 'Facility updated' : 'Facility created',
          pathname: '/facilities',
          query: { search: savedFacility.name },
        })
      }
      queryClient.invalidateQueries({ queryKey: ['facilities'] })
      onClose()
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || 'Something went wrong')
    },
  })

  // Queries
  const { data: parentOpts } = useQuery({
    queryKey: ['facilitySearch', searchQuery],
    queryFn: () => searchFacilities(searchQuery, isEdit ? facility.id : undefined),
    enabled: open,
  })

  const { data: docsData, refetch: refetchDocs } = useQuery({
    queryKey: ['facilityDocs', facility?.id],
    queryFn: () => fetchFacilityDocuments(facility!.id),
    enabled: open && isEdit,
  })

  const uploadMut = useMutation({
    mutationFn: () => uploadFacilityDocument(facility!.id, uploadFile!),
    onSuccess: () => {
      toast.success('Document uploaded')
      setUploadFile(null)
      refetchDocs()
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'Upload failed')
  })

  const deleteDocMut = useMutation({
    mutationFn: (docId: number) => deleteFacilityDocument(facility!.id, docId),
    onSuccess: () => {
      toast.success('Document deleted')
      refetchDocs()
    }
  })

  const onSubmit = (data: FormData) => {
    // Need to handle conversion of empty strings to null for some fields if required by backend, 
    // but schema optional handles it fine. Let's sanitize slightly.
    const payload = { ...data, timezone: normalizeFacilityTimezone(data.timezone), phone: formatUSPhoneInput(data.phone) };
    Object.keys(payload).forEach(key => {
      if (payload[key as keyof FormData] === '') {
        (payload as any)[key] = null;
      }
    });

    if (payload.parent_facility_id === null) {
        delete payload.parent_facility_id; // Let backend handle
    } else {
        // Enforce integer
        payload.parent_facility_id = parseInt(payload.parent_facility_id as any, 10);
    }
    
    mutation.mutate(payload as any as FacilityCreate)
  }

  const handleDocumentExport = () => {
    if (facility?.id) {
      exportFacilityPdf(facility.id);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth
      PaperProps={{ sx: { borderRadius: '24px', overflow: 'hidden', height: '90vh', display: 'flex', flexDirection: 'column' } }}
    >
      {/* Header */}
      <Box sx={{
        backgroundColor: palette.brand, px: 3.5, py: 2.5,
        display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0
      }}>
        <Box sx={{
          width: 40, height: 40, borderRadius: '12px',
          background: 'rgba(255,255,255,0.2)', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <BusinessIcon sx={{ color: '#fff', fontSize: '1.3rem' }} />
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h6" sx={{ color: '#fff', fontWeight: 700, lineHeight: 1.2 }}>
            {isEdit ? 'Edit Facility' : isDuplicate ? 'Duplicate Facility' : 'New Facility'}
          </Typography>
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.75)' }}>
            {isEdit ? `Editing: ${facility?.name}` : isDuplicate ? `Duplicating: ${facility?.name?.replace(/\s+\(Copy(?:\s+\d+)?\)$/i, '')}` : 'Fill out details to add a new facility'}
          </Typography>
        </Box>
        <IconButton onClick={onClose} sx={{ color: '#fff', '&:hover': { background: 'rgba(255,255,255,0.1)' } }}>
          <CloseIcon />
        </IconButton>
      </Box>

      {/* Tabs Menu */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3.5, flexShrink: 0 }}>
        <Tabs value={activeTab} onChange={(e, val) => setActiveTab(val)} 
           TabIndicatorProps={{ sx: { backgroundColor: palette.brand, height: 3, borderTopLeftRadius: 3, borderTopRightRadius: 3 } }}
           sx={{ '& .MuiTab-root': { fontWeight: 600, textTransform: 'none', color: palette.textMuted }, '& .Mui-selected': { color: '#047857 !important' } }}>
          <Tab label="General Info" />
          <Tab label="Facility Details" />
          <Tab label="Billing" />
          <Tab label="Other Settings" />
          <Tab label="Documents" />
        </Tabs>
      </Box>

      <DialogContent sx={{ p: 0, overflowY: 'auto', flex: 1 }}>
        <Box sx={{ px: 3.5 }}>
          <form id="facility-form" onSubmit={handleSubmit(onSubmit)}>
            
            {/* TAB 0 - General Info */}
            <CustomTabPanel value={activeTab} index={0}>
              <Grid container spacing={2.5}>
                <Grid item xs={12} sm={6}>
                  <Controller name="name" control={control} render={({ field }) => (
                    <TextField {...field} fullWidth label="Facility Name *" error={!!errors.name} helperText={errors.name?.message} />
                  )} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Controller name="contact_person" control={control} render={({ field }) => (
                    <TextField {...field} value={field.value || ''} fullWidth label="Contact Person" error={!!errors.contact_person} helperText={errors.contact_person?.message} />
                  )} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Controller name="phone" control={control} render={({ field }) => (
                    <TextField {...field} value={field.value || ''} onChange={(event) => field.onChange(formatUSPhoneInput(event.target.value))} fullWidth label="Phone Number *" error={!!errors.phone} helperText={errors.phone?.message} />
                  )} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Controller name="email" control={control} render={({ field }) => (
                    <TextField {...field} fullWidth label="Email Address *" error={!!errors.email} helperText={errors.email?.message} />
                  )} />
                </Grid>
                
                <Grid item xs={12} sm={8}>
                  <Controller name="address" control={control} render={({ field }) => (
                    <TextField {...field} fullWidth label="Street Address *" error={!!errors.address} helperText={errors.address?.message} />
                  )} />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Controller name="suite" control={control} render={({ field }) => (
                    <TextField {...field} value={field.value || ''} fullWidth label="Suite / Apt" error={!!errors.suite} helperText={errors.suite?.message} />
                  )} />
                </Grid>
                
                <Grid item xs={12} sm={4}>
                  <Controller name="city" control={control} render={({ field }) => (
                    <TextField {...field} fullWidth label="City *" error={!!errors.city} helperText={errors.city?.message} />
                  )} />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Controller name="state" control={control} render={({ field }) => (
                    <TextField {...field} fullWidth label="State / Province *" error={!!errors.state} helperText={errors.state?.message} />
                  )} />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Controller name="zip_code" control={control} render={({ field }) => (
                    <TextField {...field} fullWidth label="Zip / Postal Code *" error={!!errors.zip_code} helperText={errors.zip_code?.message} />
                  )} />
                </Grid>
                
                <Grid item xs={12} sm={4}>
                  <Controller name="country" control={control} render={({ field }) => (
                    <TextField {...field} fullWidth label="Country *" error={!!errors.country} helperText={errors.country?.message} />
                  )} />
                </Grid>
                <Grid item xs={12} sm={8}>
                  <Controller name="website" control={control} render={({ field }) => (
                    <TextField {...field} value={field.value || ''} fullWidth label="Website URL" error={!!errors.website} helperText={errors.website?.message} />
                  )} />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <Controller name="timezone" control={control} render={({ field }) => (
                    <TextField {...field} fullWidth select label="Timezone" error={!!errors.timezone} helperText={errors.timezone?.message}>
                      {FACILITY_TIMEZONE_OPTIONS.map((tz) => (
                        <MenuItem key={tz.value} value={tz.value}>{tz.label}</MenuItem>
                      ))}
                    </TextField>
                  )} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Controller name="operating_hours" control={control} render={({ field }) => (
                    <TextField {...field} value={field.value || ''} fullWidth label="Operating Hours" placeholder="e.g. Mon-Fri 8am-5pm" error={!!errors.operating_hours} helperText={errors.operating_hours?.message} />
                  )} />
                </Grid>
                {/* How big the site is. The band is what the inspection
                    dashboard groups by; beds and area are what people quote. */}
                <Grid item xs={12} sm={4}>
                  <Controller name="beds" control={control} render={({ field }) => (
                    <TextField {...field} value={field.value ?? ''} type="number" fullWidth label="Beds"
                               onChange={(event) => field.onChange(event.target.value === '' ? null : Number(event.target.value))}
                               inputProps={{ min: 0 }} />
                  )} />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Controller name="area_sqft" control={control} render={({ field }) => (
                    <TextField {...field} value={field.value ?? ''} type="number" fullWidth label="Area (sq ft)"
                               onChange={(event) => field.onChange(event.target.value === '' ? null : Number(event.target.value))}
                               inputProps={{ min: 0 }} />
                  )} />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Controller name="size_band" control={control} render={({ field }) => (
                    <TextField {...field} value={field.value || ''} select fullWidth label="Size">
                      <MenuItem value="">Not set</MenuItem>
                      <MenuItem value="small">Small</MenuItem>
                      <MenuItem value="medium">Medium</MenuItem>
                      <MenuItem value="large">Large</MenuItem>
                    </TextField>
                  )} />
                </Grid>
              </Grid>
            </CustomTabPanel>

            {/* TAB 1 - Details */}
            <CustomTabPanel value={activeTab} index={1}>
              <Grid container spacing={2.5}>
                <Grid item xs={12}>
                  <Typography variant="subtitle2" sx={{ color: '#4B5563', mb: 1 }}>Parent Facility Details</Typography>
                  <Controller name="parent_facility_id" control={control} render={({ field }) => (
                    <Autocomplete
                      options={parentOpts || []}
                      getOptionLabel={(option) => `${option.name} (ID: ${option.id})`}
                      value={parentOpts?.find((opt) => opt.id === field.value) || null}
                      isOptionEqualToValue={(option, value) => option.id === value?.id}
                      onInputChange={(_, value) => setSearchQuery(value)}
                      onChange={(_, value) => field.onChange(value ? value.id : null)}
                      renderInput={(params) => (
                        <TextField {...params} label="Search & Select Parent Facility" variant="outlined" fullWidth placeholder="Type to search facilities..." />
                      )}
                    />
                  )} />
                </Grid>

                <Grid item xs={12}>
                  <Divider sx={{ my: 1 }} />
                  <Typography variant="subtitle2" sx={{ color: '#4B5563', mb: 1 }}>Operating Status</Typography>
                  <Controller name="status" control={control} render={({ field }) => (
                    <TextField {...field} select fullWidth label="Status">
                      <MenuItem value="active">Active</MenuItem>
                      <MenuItem value="inactive">Inactive</MenuItem>
                    </TextField>
                  )} />
                </Grid>
              </Grid>
            </CustomTabPanel>

            {/* TAB 2 - Billing */}
            <CustomTabPanel value={activeTab} index={2}>
              <Grid container spacing={2.5}>
                <Grid item xs={12} sm={6}>
                  <Controller name="billing_name" control={control} render={({ field }) => (
                    <TextField {...field} value={field.value || ''} fullWidth label="Billing Contact Name" />
                  )} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Controller name="billing_email" control={control} render={({ field }) => (
                    <TextField {...field} value={field.value || ''} fullWidth label="Billing Email" />
                  )} />
                </Grid>
                
                <Grid item xs={12} sm={8}>
                  <Controller name="billing_street" control={control} render={({ field }) => (
                    <TextField {...field} value={field.value || ''} fullWidth label="Billing Street Address" />
                  )} />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Controller name="billing_suite" control={control} render={({ field }) => (
                    <TextField {...field} value={field.value || ''} fullWidth label="Billing Suite" />
                  )} />
                </Grid>
                
                <Grid item xs={12} sm={4}>
                  <Controller name="billing_city" control={control} render={({ field }) => (
                    <TextField {...field} value={field.value || ''} fullWidth label="Billing City" />
                  )} />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Controller name="billing_state" control={control} render={({ field }) => (
                    <TextField {...field} value={field.value || ''} fullWidth label="Billing State" />
                  )} />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <Controller name="billing_zip_code" control={control} render={({ field }) => (
                    <TextField {...field} value={field.value || ''} fullWidth label="Billing Zip Code" />
                  )} />
                </Grid>
              </Grid>
            </CustomTabPanel>

            {/* TAB 3 - Other Settings */}
            <CustomTabPanel value={activeTab} index={3}>
              <Grid container spacing={2.5}>
                <Grid item xs={12}>
                  <Controller name="tax_exemption" control={control} render={({ field }) => (
                    <FormControlLabel control={<Checkbox checked={field.value} onChange={e => field.onChange(e.target.checked)} color="primary" />} label="Tax Exempt Facility" />
                  )} />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <Controller name="inheritance" control={control} render={({ field }) => (
                    <TextField {...field} value={field.value || ''} select fullWidth label="Inheritance Rules">
                      {INHERITANCE_OPTIONS.map(o => <MenuItem key={o} value={o}>{o}</MenuItem>)}
                    </TextField>
                  )} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Controller name="installment_type" control={control} render={({ field }) => (
                    <TextField {...field} value={field.value || ''} select fullWidth label="Installment Type">
                      {INSTALLMENT_OPTIONS.map(o => <MenuItem key={o} value={o}>{o}</MenuItem>)}
                    </TextField>
                  )} />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <Controller name="payment_method" control={control} render={({ field }) => (
                    <TextField {...field} value={field.value || ''} select fullWidth label="Preferred Payment Method">
                      {PAYMENT_OPTIONS.map(o => <MenuItem key={o} value={o}>{o}</MenuItem>)}
                    </TextField>
                  )} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Controller name="delivery_email" control={control} render={({ field }) => (
                    <TextField {...field} value={field.value || ''} fullWidth label="Delivery / Shipping Email" />
                  )} />
                </Grid>
              </Grid>
            </CustomTabPanel>
          </form>

          {/* TAB 4 - Documents (Not in form) */}
          <CustomTabPanel value={activeTab} index={4}>
            {!isEdit ? (
              <Box sx={{ p: 4, textAlign: 'center', backgroundColor: palette.surfaceFaint, borderRadius: '16px', border: '1px dashed #D1D5DB' }}>
                <CloudUploadIcon sx={{ fontSize: 48, color: palette.textDisabled, mb: 2 }} />
                <Typography variant="h6" sx={{ color: palette.textStrong, mb: 1 }}>Save Facility First</Typography>
                <Typography variant="body2" sx={{ color: palette.textMuted }}>
                  You must save this facility before you can upload or manage documents.
                </Typography>
              </Box>
            ) : (
              <Box>
                {/* Upload Area */}
                <Box sx={{ mb: 3, p: 3, borderRadius: '16px', backgroundColor: palette.brandTint, border: `1px solid ${palette.brandBorder}`, display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Button variant="contained" component="label" startIcon={<CloudUploadIcon />} sx={{ backgroundColor: palette.brand, whiteSpace: 'nowrap' }}>
                    Select File
                    <input type="file" hidden onChange={(e) => setUploadFile(e.target.files?.[0] || null)} />
                  </Button>
                  <Typography variant="body2" sx={{ flex: 1, color: uploadFile ? palette.ink : palette.textDisabled, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {uploadFile ? uploadFile.name : 'No file selected'}
                  </Typography>
                  <Button variant="contained" disabled={!uploadFile || uploadMut.isPending} onClick={() => uploadMut.mutate()} sx={{ backgroundColor: palette.brandMid, '&:hover': { backgroundColor: palette.brandStrong } }}>
                    {uploadMut.isPending ? <CircularProgress size={20} sx={{ color: '#fff' }} /> : 'Upload'}
                  </Button>
                </Box>

                {/* PDF Export */}
                <Box sx={{ mb: 3 }}>
                  <Button variant="outlined" onClick={handleDocumentExport} sx={{ borderColor: palette.brand, color: palette.brand }}>
                    Export Facility as PDF
                  </Button>
                </Box>

                {/* List Files */}
                <Typography variant="subtitle2" sx={{ color: '#4B5563', mb: 2 }}>Attached Documents</Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  {docsData?.items?.length === 0 && <Typography variant="body2" color="text.secondary">No documents uploaded yet.</Typography>}
                  {docsData?.items?.map((doc) => (
                    <Box key={doc.id} sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2, borderRadius: '12px', border: `1px solid ${palette.border}`, backgroundColor: '#fff' }}>
                      <InsertDriveFileIcon sx={{ color: palette.brand }} />
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, color: palette.ink }}>{doc.filename}</Typography>
                        <Typography variant="caption" sx={{ color: palette.textMuted }}>
                          Uploaded {new Date(doc.uploaded_at).toLocaleDateString()}
                        </Typography>
                      </Box>
                      <IconButton
                        color="primary"
                        size="small"
                        onClick={() => downloadFacilityDocument(facility!.id, doc).catch(() => toast.error('Unable to download document'))}
                      >
                        <DownloadIcon />
                      </IconButton>
                      <IconButton color="error" size="small" onClick={() => deleteDocMut.mutate(doc.id)} disabled={deleteDocMut.isPending}>
                        <DeleteIcon />
                      </IconButton>
                    </Box>
                  ))}
                </Box>
              </Box>
            )}
          </CustomTabPanel>
        </Box>
      </DialogContent>

      {/* Footer */}
      <DialogActions sx={{ px: 3.5, pb: 2.5, pt: 2, gap: 1, backgroundColor: '#FAFAFA', borderTop: `1px solid ${palette.surfaceGray}`, flexShrink: 0 }}>
        <Button onClick={onClose} variant="outlined" sx={{ borderColor: palette.border, color: palette.textMuted, flex: 1, py: 1.2 }}>
          Cancel
        </Button>
        <Button
          type="submit" form="facility-form" variant="contained" disabled={mutation.isPending}
          sx={{ flex: 2, backgroundColor: palette.brand, py: 1.2, boxShadow: '0 4px 16px rgba(4,120,87,0.3)', '&:hover': { backgroundColor: palette.brandDeep } }}
        >
          {mutation.isPending ? <CircularProgress size={20} sx={{ color: '#fff' }} /> : isEdit ? 'Save Changes' : 'Create Facility'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default FacilityFormModal
