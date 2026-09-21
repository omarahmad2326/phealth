import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Avatar,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import PeopleIcon from '@mui/icons-material/People'
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1'
import { toast } from 'react-toastify'
import CreateUserModal from '@/pages/Users/CreateUserModal'
import { assignFacilityManagerRole, fetchFacilityManagerCandidates, fetchFacilityUsers, type FacilityUser } from '@/api/facilityUsers'
import { type Facility } from '@/api/facilities'
import { useAuthStore } from '@/stores/authStore'
import { palette } from '@/theme/palette'

interface Props {
  open: boolean
  onClose: () => void
  facility?: Facility | null
}

const ROLE_COLORS: Record<string, { bg: string; color: string }> = {
  facility_admin: { bg: palette.brandTint, color: palette.brand },
  facility_manager: { bg: palette.infoTint, color: palette.infoBright },
}

const avatarColors = [palette.brand, palette.accent, palette.infoBright, palette.brandMid, palette.warningBright, palette.dangerBright]

const roleLabel = (role: string) => role.split('_').join(' ')

const getInitials = (name: string) =>
  name.split(' ').map((part) => part[0]).join('').toUpperCase().slice(0, 2)

const getAvatarColor = (name: string) =>
  avatarColors[name.charCodeAt(0) % avatarColors.length]

const FacilityUsersModal = ({ open, onClose, facility }: Props) => {
  // This panel could only ever attach somebody who already existed. A new
  // starter at this hospital had to be created from the organisation-wide
  // Users screen and then assigned back here, which is two screens and a
  // facility dropdown to answer a question the context already knows.
  const [addOpen, setAddOpen] = useState(false)
  const queryClient = useQueryClient()
  const currentUser = useAuthStore((state) => state.user)
  const isSuperAdmin = currentUser?.role === 'superadmin'
  const [selectedUser, setSelectedUser] = useState<FacilityUser | null>(null)
  const [selectedRole, setSelectedRole] = useState<'facility_admin' | 'facility_manager'>('facility_manager')
  // What the box shows and what is searched for are two things: picking
  // somebody puts their name in the box without searching for that name.
  const [candidateSearch, setCandidateSearch] = useState('')
  const [candidateText, setCandidateText] = useState('')

  useEffect(() => {
    if (!open) return
    setSelectedUser(null)
    setSelectedRole('facility_manager')
    setCandidateSearch('')
    setCandidateText('')
  }, [facility?.id, open])

  // Everyone assigned to this site - here as their main site or as an
  // additional one - in any role, and nobody who is not. It used to ask for
  // managers and admins only, so the inspectors and technicians who work
  // here were missing from a list called People here.
  const { data, isLoading } = useQuery({
    queryKey: ['facility-managers', facility?.id],
    queryFn: () => fetchFacilityUsers(facility?.id),
    enabled: open && !!facility,
  })

  const { data: candidateUsersData, isLoading: candidateUsersLoading } = useQuery({
    queryKey: ['facility-manager-candidates', facility?.id, candidateSearch],
    queryFn: () => fetchFacilityManagerCandidates(facility!.id, candidateSearch),
    enabled: open && !!facility && isSuperAdmin,
  })

  const assignMutation = useMutation({
    mutationFn: () => assignFacilityManagerRole(facility!.id, selectedUser!.id, selectedRole),
    onSuccess: () => {
      toast.success('Facility role updated')
      setSelectedUser(null)
      setCandidateText('')
      setCandidateSearch('')
      queryClient.invalidateQueries({ queryKey: ['facility-managers', facility?.id] })
      queryClient.invalidateQueries({ queryKey: ['facility-manager-candidates', facility?.id] })
      queryClient.invalidateQueries({ queryKey: ['facilities'] })
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (err: any) => toast.error(err.response?.data?.detail || 'Failed to assign facility role'),
  })

  const users = [...(data?.items ?? [])].sort((a, b) => a.full_name.localeCompare(b.full_name))
  const candidateUsers = candidateUsersData?.items ?? []

  return (
    <>
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: '24px', overflow: 'hidden' } }}>
      <Box sx={{
        background: `linear-gradient(135deg, ${palette.brand} 0%, ${palette.ink} 100%)`,
        px: 3.5,
        py: 3,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
      }}>
        <Box sx={{ width: 48, height: 48, borderRadius: '14px', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <PeopleIcon sx={{ color: '#fff', fontSize: '1.5rem' }} />
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h6" sx={{ color: '#fff', fontWeight: 700 }}>
            People here
          </Typography>
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.75)' }}>
            {facility
              ? isLoading ? `Assigned to ${facility.name}`
                : `${users.length} ${users.length === 1 ? 'person' : 'people'} assigned to ${facility.name}`
              : 'Select a site to see who works in it'}
          </Typography>
        </Box>
        {facility && (
          <Button
            size="small" variant="contained" startIcon={<PersonAddAlt1Icon />}
            onClick={() => setAddOpen(true)}
            sx={{ fontWeight: 900, borderRadius: '10px', bgcolor: '#fff', color: palette.brand,
                  '&:hover': { bgcolor: palette.brandTint } }}
          >
            Add a person
          </Button>
        )}
        <IconButton onClick={onClose} sx={{ color: '#fff', '&:hover': { background: 'rgba(255,255,255,0.12)' } }}>
          <CloseIcon />
        </IconButton>
      </Box>

      <DialogContent sx={{ p: 3.5, pt: 2.5 }}>
        <TableContainer className="list-scroll-panel">
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>User</TableCell>
                <TableCell>Role</TableCell>
                <TableCell>Assignment</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, index) => (
                  <TableRow key={index}>
                    {Array.from({ length: 4 }).map((__, cellIndex) => (
                      <TableCell key={cellIndex}><Skeleton /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} align="center" sx={{ py: 5 }}>
                    <PeopleIcon sx={{ fontSize: '2.5rem', color: palette.border, mb: 1, display: 'block', mx: 'auto' }} />
                    <Typography variant="body2" color="text.secondary">
                      Nobody is assigned to this site yet
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : users.map((user) => {
                const roleColor = ROLE_COLORS[user.role] || ROLE_COLORS.facility_manager
                const isPrimary = user.facility_id === facility?.id
                return (
                  <TableRow key={user.id} sx={{ '&:hover': { backgroundColor: '#FAFAFF' } }}>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Avatar sx={{ width: 32, height: 32, backgroundColor: getAvatarColor(user.full_name), color: '#fff', fontSize: '0.8rem', fontWeight: 700 }}>
                          {getInitials(user.full_name)}
                        </Avatar>
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 600, color: palette.ink }}>
                            {user.full_name}
                          </Typography>
                          <Typography variant="caption" sx={{ color: palette.textDisabled }}>
                            {user.email}
                          </Typography>
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={roleLabel(user.role)}
                        size="small"
                        sx={{ backgroundColor: roleColor.bg, color: roleColor.color, fontWeight: 600, fontSize: '0.7rem', textTransform: 'capitalize' }}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={isPrimary ? 'Primary' : 'Additional'}
                        size="small"
                        variant={isPrimary ? 'filled' : 'outlined'}
                        sx={isPrimary
                          ? { color: palette.brandStrong, backgroundColor: palette.brandTint, fontSize: '0.65rem', fontWeight: 700 }
                          : { color: palette.textMuted, fontSize: '0.65rem' }}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={user.is_active ? 'Active' : 'Inactive'}
                        size="small"
                        sx={{
                          backgroundColor: user.is_active ? palette.successTint : palette.dangerWash,
                          color: user.is_active ? palette.brandMid : palette.dangerBright,
                          fontWeight: 600,
                          fontSize: '0.7rem',
                        }}
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>

        {/* The people assigned here come first; this adds to them, searching
            every active user, so it sits below the list rather than above it. */}
        {isSuperAdmin && (
          <Box sx={{ mt: 3, p: 2, backgroundColor: palette.surface, borderRadius: '16px', border: `1px solid ${palette.border}` }}>
            <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 700, color: palette.textStrong, display: 'flex', alignItems: 'center', gap: 1 }}>
              <PersonAddAlt1Icon sx={{ fontSize: '1.2rem', color: palette.brand }} />
              Make someone a manager or admin here
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 220px auto' }, gap: 1.5 }}>
              <Autocomplete
                options={candidateUsers}
                loading={candidateUsersLoading}
                value={selectedUser}
                onChange={(_, value) => setSelectedUser(value)}
                inputValue={candidateText}
                onInputChange={(_, value, reason) => {
                  setCandidateText(value)
                  // Typing searches; picking somebody only shows their name.
                  if (reason !== 'reset') setCandidateSearch(value)
                }}
                // The server has already searched name, email and username.
                filterOptions={(options) => options}
                getOptionLabel={(option) => `${option.full_name} (${roleLabel(option.role)})`}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="User"
                    placeholder="Search active users"
                  />
                )}
              />
              <FormControl fullWidth>
                <InputLabel>Facility Role</InputLabel>
                <Select
                  value={selectedRole}
                  label="Facility Role"
                  onChange={(event) => setSelectedRole(event.target.value as 'facility_admin' | 'facility_manager')}
                >
                  <MenuItem value="facility_manager">Facility Manager</MenuItem>
                  <MenuItem value="facility_admin">Facility Admin</MenuItem>
                </Select>
              </FormControl>
              <Button
                variant="contained"
                disabled={!selectedUser || assignMutation.isPending}
                onClick={() => assignMutation.mutate()}
                sx={{ minWidth: 132, borderRadius: '12px', fontWeight: 800 }}
              >
                {assignMutation.isPending ? <CircularProgress size={20} color="inherit" /> : 'Assign'}
              </Button>
            </Box>
            <Typography variant="caption" sx={{ display: 'block', mt: 1.25, color: palette.textSubtle }}>
              Search an active user, then assign them as facility admin or facility manager for this facility.
            </Typography>
          </Box>
        )}
      </DialogContent>
    </Dialog>

    {addOpen && facility && (
      <CreateUserModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        // The hospital is already known, so the form does not ask. It shows
        // the site read-only and assigns on save.
        facilityContext={{ id: facility.id, name: facility.name }}
      />
    )}
    </>
  )
}

export default FacilityUsersModal
